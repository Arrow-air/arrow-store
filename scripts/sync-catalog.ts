// Sync the canonical catalog from arrow-catalog into the gitignored .catalog/
// snapshot, then validate it (schema + cross-references). A failed validation
// fails the sync — and therefore the build.
//
// Sources, in precedence order:
//   1. ARROW_CATALOG_LOCAL_PATH — copy from a local arrow-catalog checkout.
//   2. GitHub, pinned to catalog.lock.json (override repo/ref with
//      ARROW_CATALOG_REPO / ARROW_CATALOG_REF; GITHUB_TOKEN is honored).
//
// `--update` resolves the lock file's branch ref to its current commit SHA and
// rewrites catalog.lock.json (commit as `chore: bump catalog pin`).

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { clearCatalogCache, loadCatalog } from '../src/catalog/load.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const LOCK_PATH = path.join(ROOT, 'catalog.lock.json');
const CATALOG_DIR = path.join(ROOT, '.catalog');
const STAGING_DIR = path.join(ROOT, '.catalog.tmp');
const CATALOG_SUBDIRS = ['products', 'manufacturers', 'checkout-groups', 'policies'];

interface LockFile {
  repo: string;
  ref: string;
  resolvedSha: string;
  syncedAt: string;
}

async function main(): Promise<void> {
  const update = process.argv.includes('--update');
  const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as LockFile;

  rmSync(STAGING_DIR, { recursive: true, force: true });
  mkdirSync(STAGING_DIR, { recursive: true });

  const localPath = process.env.ARROW_CATALOG_LOCAL_PATH;
  let manifest: { repo: string; resolvedSha: string; syncedAt: string; source: 'github' | 'local' };

  if (localPath) {
    manifest = syncFromLocal(path.resolve(ROOT, localPath));
  } else {
    const repo = process.env.ARROW_CATALOG_REPO ?? lock.repo;
    const ref = process.env.ARROW_CATALOG_REF ?? (update ? lock.ref : lock.resolvedSha);
    manifest = await syncFromGitHub(repo, ref);
  }

  writeFileSync(
    path.join(STAGING_DIR, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  clearCatalogCache();
  try {
    const catalog = loadCatalog(STAGING_DIR);
    console.log(
      `catalog ok: ${catalog.products.length} products, ` +
        `${catalog.manufacturers.length} manufacturers, ` +
        `${catalog.checkoutGroups.length} checkout groups, ` +
        `${Object.keys(catalog.policies).length} policies ` +
        `(source: ${manifest.source}, ${manifest.resolvedSha.slice(0, 12)})`,
    );
  } catch (error) {
    rmSync(STAGING_DIR, { recursive: true, force: true });
    throw error;
  }
  clearCatalogCache();

  rmSync(CATALOG_DIR, { recursive: true, force: true });
  renameSync(STAGING_DIR, CATALOG_DIR);

  if (update && manifest.source === 'github') {
    const updated: LockFile = {
      repo: manifest.repo,
      ref: process.env.ARROW_CATALOG_REF ?? lock.ref,
      resolvedSha: manifest.resolvedSha,
      syncedAt: manifest.syncedAt,
    };
    writeFileSync(LOCK_PATH, `${JSON.stringify(updated, null, 2)}\n`);
    console.log(`catalog.lock.json updated: ${updated.ref} -> ${updated.resolvedSha.slice(0, 12)}`);
  } else if (update) {
    console.warn('--update ignored: syncing from ARROW_CATALOG_LOCAL_PATH, not GitHub');
  }
}

function syncFromLocal(checkout: string) {
  const sourceCatalog = path.join(checkout, 'catalog');
  if (!existsSync(sourceCatalog)) {
    fail(`ARROW_CATALOG_LOCAL_PATH=${checkout} has no catalog/ directory`);
  }
  for (const subdir of CATALOG_SUBDIRS) {
    const source = path.join(sourceCatalog, subdir);
    if (!existsSync(source)) {
      fail(`local catalog checkout is missing catalog/${subdir}`);
    }
    cpSync(source, path.join(STAGING_DIR, subdir), { recursive: true });
  }

  let sha = 'unknown';
  try {
    sha = git(checkout, 'rev-parse', 'HEAD');
    if (git(checkout, 'status', '--porcelain') !== '') sha += '-dirty';
  } catch {
    // not a git checkout; keep "unknown"
  }

  return {
    repo: `local:${checkout}`,
    resolvedSha: sha,
    syncedAt: new Date().toISOString(),
    source: 'local' as const,
  };
}

async function syncFromGitHub(repo: string, ref: string) {
  const tree = (await githubApi(
    `https://api.github.com/repos/${repo}/git/trees/${ref}?recursive=1`,
  )) as { sha: string; truncated: boolean; tree: Array<{ path: string; type: string }> };

  if (tree.truncated) {
    fail(`git tree listing for ${repo}@${ref} was truncated; cannot sync safely`);
  }

  const files = tree.tree.filter(
    (entry) =>
      entry.type === 'blob' &&
      CATALOG_SUBDIRS.some((subdir) => entry.path.startsWith(`catalog/${subdir}/`)),
  );
  if (files.length === 0) {
    fail(`no catalog/ files found in ${repo}@${ref}`);
  }

  await Promise.all(
    files.map(async (entry) => {
      const url = `https://raw.githubusercontent.com/${repo}/${tree.sha}/${entry.path}`;
      const response = await fetch(url, { headers: githubHeaders(false) });
      if (!response.ok) {
        fail(`failed to download ${url}: ${response.status} ${response.statusText}`);
      }
      const target = path.join(STAGING_DIR, path.relative('catalog', entry.path));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, Buffer.from(await response.arrayBuffer()));
    }),
  );

  return {
    repo,
    resolvedSha: tree.sha,
    syncedAt: new Date().toISOString(),
    source: 'github' as const,
  };
}

async function githubApi(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: githubHeaders(true) });
  if (!response.ok) {
    fail(`GitHub API request failed (${response.status} ${response.statusText}): ${url}`);
  }
  return response.json();
}

function githubHeaders(api: boolean): Record<string, string> {
  const headers: Record<string, string> = { 'user-agent': 'arrow-store-catalog-sync' };
  if (api) headers.accept = 'application/vnd.github+json';
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function fail(message: string): never {
  throw new Error(message);
}

main().catch((error: Error) => {
  console.error(`sync-catalog: ${error.message}`);
  process.exit(1);
});

// Provision admin users for the order workflow. The access key is printed
// ONCE and stored only as a hash — share it with the user over a secure
// channel.
//
//   node scripts/create-admin-user.ts --name "Thomas" --role manufacturer-admin --manufacturer thomas-texas
//   node scripts/create-admin-user.ts --name "Store Ops" --role store-admin
//   node scripts/create-admin-user.ts --list
//   node scripts/create-admin-user.ts --disable usr_...

import { existsSync } from 'node:fs';
import process from 'node:process';
import { DEFAULT_CATALOG_DIR, loadCatalog } from '../src/catalog/load.ts';
import {
  createAdminUser,
  disableAdminUser,
  listAdminUsers,
  type AdminRole,
} from '../src/server/auth.ts';

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main(): void {
  if (process.argv.includes('--list')) {
    for (const user of listAdminUsers()) {
      console.log(
        [
          user.id,
          user.role.padEnd(18),
          (user.manufacturerId ?? '-').padEnd(16),
          user.disabled ? 'DISABLED' : 'active',
          user.displayName,
        ].join('  '),
      );
    }
    return;
  }

  const disableId = arg('--disable');
  if (disableId) {
    if (!disableAdminUser(disableId)) {
      console.error(`no such user: ${disableId}`);
      process.exit(1);
    }
    console.log(`${disableId} disabled and its sessions revoked`);
    return;
  }

  const displayName = arg('--name');
  const role = arg('--role') as AdminRole | undefined;
  const manufacturerId = arg('--manufacturer');

  if (!displayName || !role || !['store-admin', 'manufacturer-admin'].includes(role)) {
    console.error(
      'usage: create-admin-user.ts --name <display name> --role store-admin|manufacturer-admin [--manufacturer <id>]',
    );
    process.exit(1);
  }
  if (role === 'manufacturer-admin') {
    if (!manufacturerId) {
      console.error('manufacturer-admin users need --manufacturer <id>');
      process.exit(1);
    }
    if (existsSync(DEFAULT_CATALOG_DIR)) {
      const known = loadCatalog().manufacturers.map((manufacturer) => manufacturer.id);
      if (!known.includes(manufacturerId)) {
        console.error(`unknown manufacturer ${manufacturerId} (catalog has: ${known.join(', ')})`);
        process.exit(1);
      }
    }
  }

  const { user, accessKey } = createAdminUser({ displayName, role, manufacturerId });
  console.log(`created ${user.id} (${user.role}${user.manufacturerId ? `, ${user.manufacturerId}` : ''})`);
  console.log('');
  console.log(`  access key (shown once): ${accessKey}`);
  console.log('');
  console.log('Share it over a secure channel; it cannot be recovered, only replaced.');
}

main();

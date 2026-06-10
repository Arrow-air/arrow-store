// Region helpers shared by the storefront, the client checkout form, and the
// server-side order validation. Catalog `shipsTo` arrays mix ISO country codes
// (e.g. "US") with the region token "EU"; expansion to concrete countries
// lives here for v1 (worth upstreaming to arrow-catalog later).

export const EU_COUNTRY_CODES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
] as const;

export const COUNTRY_NAMES: Record<string, string> = {
  AT: 'Austria',
  BE: 'Belgium',
  BG: 'Bulgaria',
  CA: 'Canada',
  CH: 'Switzerland',
  CY: 'Cyprus',
  CZ: 'Czechia',
  DE: 'Germany',
  DK: 'Denmark',
  EE: 'Estonia',
  ES: 'Spain',
  FI: 'Finland',
  FR: 'France',
  GB: 'United Kingdom',
  GR: 'Greece',
  HR: 'Croatia',
  HU: 'Hungary',
  IE: 'Ireland',
  IT: 'Italy',
  LT: 'Lithuania',
  LU: 'Luxembourg',
  LV: 'Latvia',
  MT: 'Malta',
  NL: 'Netherlands',
  NO: 'Norway',
  PL: 'Poland',
  PT: 'Portugal',
  RO: 'Romania',
  SE: 'Sweden',
  SI: 'Slovenia',
  SK: 'Slovakia',
  US: 'United States',
};

/** Expand a catalog shipsTo list ("US", "EU", ...) into unique ISO country codes. */
export function expandShipsTo(shipsTo: readonly string[]): string[] {
  const codes = new Set<string>();
  for (const entry of shipsTo) {
    if (entry === 'EU') {
      for (const code of EU_COUNTRY_CODES) codes.add(code);
    } else {
      codes.add(entry);
    }
  }
  return [...codes].sort();
}

/** Countries every item in a cart can ship to (intersection across items). */
export function shippableCountries(shipsToLists: ReadonlyArray<readonly string[]>): string[] {
  if (shipsToLists.length === 0) return [];
  let result = new Set(expandShipsTo(shipsToLists[0]!));
  for (const list of shipsToLists.slice(1)) {
    const expanded = new Set(expandShipsTo(list));
    result = new Set([...result].filter((code) => expanded.has(code)));
  }
  return [...result].sort();
}

export function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}

// Builds src/data/purebreedsSnapshot.json from a saved response of
// https://server.fcbc.fun/api/v1/zora/species (e.g. new-fcbc/recovery/raw-api-response.json).
// The app uses this snapshot only when the live API is unreachable.
// Market fields (price, mcap, holders) are left out on purpose: they go stale.
//
// Usage: node scripts/build_species_snapshot.mjs <path-to-api-response.json> [snapshot-date]
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inputPath, snapshotDate = new Date().toISOString().slice(0, 10)] = process.argv;
if (!inputPath) {
  console.error('Usage: node scripts/build_species_snapshot.mjs <api-response.json> [YYYY-MM-DD]');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(inputPath, 'utf8'));
const records = Array.isArray(raw) ? raw : raw.data;
if (!Array.isArray(records)) throw new Error('Input has no data array');

// Some saved responses have Python-style stringified values ("None", "{'a': 1}")
const clean = (v) => (v === 'None' || v === '' || v == null ? undefined : v);
const parseToken = (v) => {
  if (!v || v === 'None') return undefined;
  if (typeof v === 'object') return v;
  return JSON.parse(v.replace(/'/g, '"'));
};

const data = records.map((s) => ({
  id: s.id,
  name: s.name,
  symbol: s.symbol,
  code: clean(s.code),
  status: clean(s.status),
  iucnStatus: clean(s.iucnStatus),
  rarity: clean(s.rarity),
  image: clean(s.image),
  description: clean(s.description),
  tokenAddress: clean(s.tokenAddress),
  poolCurrencyToken: parseToken(s.poolCurrencyToken),
  chainId: s.chainId ? Number(s.chainId) : undefined,
}));

const missing = data.filter((s) => !s.name || !s.symbol || !s.image || !s.tokenAddress);
if (missing.length) console.warn(`Warning: ${missing.length} records missing name/symbol/image/tokenAddress`);

writeFileSync('src/data/purebreedsSnapshot.json', JSON.stringify({ snapshotDate, data }) + '\n');
console.log(`Wrote ${data.length} species (snapshot ${snapshotDate})`);

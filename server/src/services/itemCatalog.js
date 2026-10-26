/**
 * Item catalog for pretend drops (sandbox) and any display-only features.
 * Supply items via a JSON file (ITEM_CATALOG_FILE) shaped like:
 *   [{ "name": "...", "imageUrl": "...", "priceUsd": 1.25,
 *      "typeLabel": "...", "rarityLabel": "..." }, ...]
 * Falls back to a small built-in demo catalog so a fresh clone works.
 */
const fs = require('fs');

const DEMO_ITEMS = [
  { name: 'Demo Cap', imageUrl: null, priceUsd: 0.5, typeLabel: 'Hat', rarityLabel: 'Common' },
  { name: 'Demo Jacket', imageUrl: null, priceUsd: 2.25, typeLabel: 'Outfit', rarityLabel: 'Uncommon' },
  { name: 'Demo Visor', imageUrl: null, priceUsd: 8.0, typeLabel: 'Glasses', rarityLabel: 'Rare' },
  { name: 'Demo Crown', imageUrl: null, priceUsd: 64.0, typeLabel: 'Hat', rarityLabel: 'Legendary' }
];

let cache = null;

function catalogItems() {
  if (cache) return cache;
  const file = process.env.ITEM_CATALOG_FILE;
  if (file) {
    try {
      const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(rows) && rows.length) {
        cache = rows.filter((r) => r && r.name && Number(r.priceUsd) > 0);
        return cache;
      }
    } catch (_) { /* fall through to demo */ }
  }
  cache = DEMO_ITEMS;
  return cache;
}

module.exports = { catalogItems };

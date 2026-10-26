// Minimal catalog merge for the inventory panel. A real deployment can
// replace these with its own catalog service.
export async function fetchLocalCatalogMaps() {
  return { byMarketHash: new Map(), byDisplayName: new Map(), byClass: new Map() };
}

export function mergeInventoryWithLocalCatalog(items) {
  return items || [];
}

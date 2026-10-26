export const getInventoryDisplayImageUrl = (item) => (item && (item.imageUrl || item.iconUrl)) || null;
export const withThumbWidth = (url) => url || '';

// Catalog overlays are deployment-specific; wire this to your own data
// source if you want marketplace prices layered onto inventory rows.
export async function overlayInventoryRowsFromMarketplace(rows) {
  return rows || [];
}

export function deriveItemMarketState(item) {
  const listed = Number(item?.tradable) !== 0;
  return { listed, sellListings: 0, buyOrders: 0, marketPrice: item?.marketPrice ?? null };
}

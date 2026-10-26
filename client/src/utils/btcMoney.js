export function usdToBtc(usd, btcUsd) {
  const dollars = Number(usd);
  const rate = Number(btcUsd);
  if (!(dollars > 0) || !(rate > 0)) return 0;
  return dollars / rate;
}

export function formatBtcFromUsd(usd, btcUsd, { digits = 8 } = {}) {
  const btc = usdToBtc(usd, btcUsd);
  if (!(btc > 0)) return null;
  return `${btc.toFixed(digits)} BTC`;
}

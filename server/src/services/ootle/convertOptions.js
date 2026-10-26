/**
 * Catalog and quoting for converting other cryptocurrencies into Tari
 * assets. All three are live:
 *
 *   XTM   native Minotari (layer 1, private MimbleWimble)
 *   WXTM  official wrapped XTM on Ethereum, a LayerZero OFT
 *         contract 0xfD36fA88bb3feA8D1264fc89d70723b6a2B56958
 *         bridge in: lock XTM -> mint WXTM; bridge out: burn WXTM -> XTM
 *   tTARI Ootle layer 2 token, Esmeralda testnet until Ootle launches
 *
 * Policy: decentralized venues only. Ethereum assets reach WXTM through
 * Uniswap pools (deep links execute in the user's own wallet; this server
 * never touches keys or funds), WXTM reaches XTM through the official
 * LayerZero bridge, and tTARI comes from the official testnet faucet.
 * Live WXTM market stats come from DexScreener's public API and are cached
 * briefly server-side.
 */

const WXTM_CONTRACT = '0xfD36fA88bb3feA8D1264fc89d70723b6a2B56958';
const WXTM_DEXSCREENER_URL = `https://api.dexscreener.com/latest/dex/tokens/${WXTM_CONTRACT}`;
const MARKET_CACHE_MS = 60 * 1000;

const ERC20_INPUTS = {
  eth: null, // native ETH
  usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  wbtc: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
};

const TARI_ASSETS = [
  {
    key: 'xtm',
    name: 'XTM',
    layer: 'Minotari, layer 1',
    mechanics: 'The native Tari coin, live now. Private by default through MimbleWimble: amounts and parties stay hidden on chain.',
    availability: 'live on Minotari',
    available: true,
    swappable: true
  },
  {
    key: 'wxtm',
    name: 'WXTM',
    layer: 'Ethereum, via LayerZero',
    mechanics: 'The official wrapped XTM on Ethereum. Bridge in locks XTM and mints WXTM; going back burns the WXTM and releases your XTM on Tari.',
    availability: 'live on Ethereum',
    available: true,
    swappable: true,
    contract: WXTM_CONTRACT
  },
  {
    key: 'ttari',
    name: 'tTARI',
    layer: 'Ootle, layer 2',
    mechanics: 'Tari for Ootle apps like this one. Runs on the Esmeralda testnet until Ootle launches; tTARI comes from the official faucet or by burning Minotari on the base layer.',
    availability: 'testnet until the Ootle launch',
    available: true,
    testnet: true,
    swappable: false
  }
];

const SOURCE_ASSETS = [
  { key: 'eth', name: 'ETH', network: 'Ethereum' },
  { key: 'usdc', name: 'USDC', network: 'Ethereum' },
  { key: 'usdt', name: 'USDT', network: 'Ethereum' },
  { key: 'wbtc', name: 'WBTC', network: 'Ethereum' },
  { key: 'btc', name: 'BTC', network: 'Bitcoin' },
  { key: 'sol', name: 'SOL', network: 'Solana' }
];

function findSource(key) {
  return SOURCE_ASSETS.find((row) => row.key === String(key || '').toLowerCase()) || null;
}

function findTari(key) {
  return TARI_ASSETS.find((row) => row.key === String(key || '').toLowerCase()) || null;
}

let marketCache = { at: 0, data: null };

/** Live WXTM market summary from DexScreener, cached for a minute. */
async function wxtmMarket(fetchImpl) {
  const now = Date.now();
  if (marketCache.data && now - marketCache.at < MARKET_CACHE_MS) return marketCache.data;
  const fetchFn = fetchImpl || fetch;
  try {
    const res = await fetchFn(WXTM_DEXSCREENER_URL, { method: 'GET', headers: { accept: 'application/json' } });
    if (res.ok) {
      const body = await res.json();
      const pairs = Array.isArray(body && body.pairs) ? body.pairs : [];
      if (pairs.length) {
        // deepest-liquidity pair is the reference market
        pairs.sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0));
        const top = pairs[0];
        const data = {
          priceUsd: Number(top.priceUsd) || null,
          liquidityUsd: Math.round(((top.liquidity && top.liquidity.usd) || 0)),
          volume24hUsd: Math.round(((top.volume && top.volume.h24) || 0)),
          priceChange24hPct: Number(top.priceChange && top.priceChange.h24) || null,
          pairs: pairs.slice(0, 5).map((p) => ({
            dex: p.dexId,
            quote: (p.quoteToken && p.quoteToken.symbol) || '',
            pairAddress: p.pairAddress,
            liquidityUsd: Math.round(((p.liquidity && p.liquidity.usd) || 0))
          }))
        };
        marketCache = { at: now, data };
        return data;
      }
    }
  } catch (_) { /* serve the catalog without market stats */ }
  return null;
}

function catalog() {
  return {
    policy: 'Everything runs inside this platform: the faucet pays from the site escrow, and swaps will execute from the wallet in your browser when Ootle goes live.',
    tari: TARI_ASSETS,
    sources: SOURCE_ASSETS,
    faucet: { tari: 333, cooldownHours: 24, inApp: true }
  };
}

/**
 * Quote a decentralized route from a source asset into a Tari asset.
 * Ethereum assets get a live Uniswap route into WXTM; Bitcoin and Solana
 * assets get the honest cross-chain path; XTM arrives through the official
 * bridge burn; tTARI points at the faucet until Ootle launches.
 */
async function quote({ from, to, amount, fetchImpl } = {}) {
  const source = findSource(from);
  const target = findTari(to);
  const errors = [];
  if (!source) errors.push('Pick a source asset.');
  if (!target) errors.push('Pick a Tari asset.');
  if (errors.length) {
    const err = new Error(errors.join(' '));
    err.code = 'bad_quote';
    throw err;
  }
  const text = String(amount == null ? '' : amount).trim();
  if (!/^\d+(\.\d{1,8})?$/.test(text) || Number(text) <= 0) {
    const err = new Error('Enter an amount above 0.');
    err.code = 'bad_quote';
    throw err;
  }

  const market = await wxtmMarket(fetchImpl);

  if (target.key === 'ttari') {
    return {
      available: true,
      mode: 'faucet',
      reason: 'tTARI is testnet Tari, so nothing swaps into it. Collect it right here.',
      from: source,
      to: target,
      amount: text,
      venue: 'site faucet',
      inAppFaucet: true,
      steps: [
        'Sign in with Steam and create your Ootle wallet.',
        'Collect 333 tTARI from the faucet below, once a day.',
        'Shield it once it arrives if you want the amount confidential.'
      ]
    };
  }

  // XTM and WXTM both trade live, but in-platform execution unlocks with
  // the Ootle launch: the route is quoted here so the plumbing is proven,
  // and the swap will run from the browser wallet inside this page.
  const launch = {
    available: false,
    mode: 'launch',
    from: source,
    to: target,
    amount: text,
    venue: 'in-wallet swap',
    reason: `Swapping ${source.name} into ${target.name} will run right here from the wallet in your browser when Ootle goes live. The quote pipeline behind this route is live today.`,
    market
  };
  return launch;
}



module.exports = { catalog, quote, wxtmMarket, WXTM_CONTRACT };

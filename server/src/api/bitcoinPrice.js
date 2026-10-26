/**
 * USD price for one BTC, for display alongside tTARI amounts. Backed by
 * CoinGecko's public endpoint (no key), cached for a minute so a busy page
 * of players costs nothing. When the upstream is unreachable the route
 * answers success:false and the client keeps showing tTARI/USD only.
 */

const express = require('express');
const axios = require('axios');

const router = express.Router();
const CACHE_TTL_MS = 60 * 1000;
let cache = { at: 0, usd: null };

router.get('/price', async (_req, res) => {
  if (cache.usd != null && Date.now() - cache.at < CACHE_TTL_MS) {
    return res.json({ success: true, data: { btc_usd: cache.usd, lastUpdated: new Date(cache.at).toISOString() } });
  }
  try {
    const { data } = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      { timeout: 8000 }
    );
    const usd = Number(data?.bitcoin?.usd);
    if (!(usd > 0)) throw new Error('unexpected shape');
    cache = { at: Date.now(), usd };
    return res.json({ success: true, data: { btc_usd: usd, lastUpdated: new Date(cache.at).toISOString() } });
  } catch (err) {
    if (cache.usd != null) {
      return res.json({ success: true, data: { btc_usd: cache.usd, lastUpdated: new Date(cache.at).toISOString() } });
    }
    return res.json({ success: false, data: null });
  }
});

module.exports = { router };

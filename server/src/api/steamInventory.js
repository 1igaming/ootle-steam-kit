/**
 * Steam inventory proxy for the Trade view. The game is whatever the
 * operator configures: STEAM_INVENTORY_APP_ID + STEAM_INVENTORY_CONTEXT_ID
 * (context 2 is the tradable inventory for most games — CS2 730, TF2 440,
 * Dota 2 570). Without an app id the route answers inventory_not_configured
 * so the client can explain itself instead of guessing.
 *
 * Steam's inventory endpoint has no CORS headers and profiles can hide
 * inventories, so the fetch happens here with the signed-in player's id.
 * Rows are normalized from Steam's assets/descriptions pairs; prices stay
 * empty unless a catalog overlay fills them in.
 */

const express = require('express');
const axios = require('axios');
const { ensureAuthenticated } = require('./auth');

const router = express.Router();

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // steamId -> { at, appId, contextId, rows }

function inventoryConfig() {
  const appId = String(process.env.STEAM_INVENTORY_APP_ID || '').trim();
  if (!appId || appId === 'your-game-appid') return null;
  const contextId = String(process.env.STEAM_INVENTORY_CONTEXT_ID || '2').trim() || '2';
  return { appId, contextId };
}

function normalizeRows(body) {
  const descriptions = new Map(
    (Array.isArray(body.descriptions) ? body.descriptions : [])
      .map((d) => [`${d.classid}_${d.instanceid}`, d])
  );
  return (Array.isArray(body.assets) ? body.assets : []).map((asset) => {
    const d = descriptions.get(`${asset.classid}_${asset.instanceid}`) || {};
    const icon = d.icon_url
      ? `https://community.cloudflare.steamstatic.com/economy/image/${d.icon_url}`
      : null;
    return {
      assetId: String(asset.assetid),
      classId: String(asset.classid),
      instanceId: String(asset.instanceid || ''),
      quantity: parseInt(asset.amount, 10) || 1,
      name: d.name || d.market_hash_name || 'Unknown item',
      marketHashName: d.market_hash_name || null,
      type: d.type || '',
      tradable: d.tradable !== 0 && d.tradable !== false,
      iconUrl: icon,
      imageUrl: icon,
      description: '',
      marketPrice: 0,
      offerPrice: 0
    };
  });
}

router.get('/inventory', ensureAuthenticated, async (req, res) => {
  const cfg = inventoryConfig();
  if (!cfg) {
    return res.status(400).json({
      error: 'inventory_not_configured',
      message: 'No game is configured for trading. Set STEAM_INVENTORY_APP_ID (and optionally STEAM_INVENTORY_CONTEXT_ID) in server/.env, then restart.'
    });
  }
  const steamId = String(req.user.steamId || req.user.id || '');
  if (!steamId) return res.status(401).json({ error: 'Unauthorized', message: 'Sign in with Steam first.' });

  const force = req.query.forceRefresh === 'true';
  const hit = cache.get(steamId);
  if (!force && hit && hit.appId === cfg.appId && Date.now() - hit.at < CACHE_TTL_MS) {
    return res.json({ appId: cfg.appId, contextId: cfg.contextId, data: hit.rows });
  }

  const url = `https://steamcommunity.com/inventory/${encodeURIComponent(steamId)}/${encodeURIComponent(cfg.appId)}/${encodeURIComponent(cfg.contextId)}?l=english&count=2000`;
  try {
    const steam = await axios.get(url, { timeout: 12000, headers: { 'Accept': 'application/json' } });
    const body = steam.data;
    if (!body || body.success === false || (!Array.isArray(body.assets) && body.total_inventory_count == null)) {
      // Steam answers success:false when the profile hides its inventory
      return res.status(403).json({
        error: 'private_inventory',
        message: 'Your Steam inventory is private. Set inventory visibility to Public in your Steam privacy settings.'
      });
    }
    const rows = normalizeRows(body);
    cache.set(steamId, { at: Date.now(), appId: cfg.appId, contextId: cfg.contextId, rows });
    return res.json({ appId: cfg.appId, contextId: cfg.contextId, data: rows });
  } catch (err) {
    const status = err && err.response ? err.response.status : null;
    if (status === 403) {
      return res.status(403).json({
        error: 'private_inventory',
        message: 'Your Steam inventory is private. Set inventory visibility to Public in your Steam privacy settings.'
      });
    }
    console.error('[SteamInventory] fetch failed:', err.message);
    return res.status(502).json({ error: 'steam_unavailable', message: 'Steam did not answer. Try again in a moment.' });
  }
});

module.exports = { router, inventoryConfig };

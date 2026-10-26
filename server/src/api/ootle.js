/**
 * DApp API: browser-wallet operations, testnet faucet, games (crash arena,
 * sandbox, dig), admin-managed prediction markets, escrow P2P demo, and
 * Tari shielding/unshielding.
 */
const express = require('express');
const { ensureAuthenticated } = require('./auth');
const { verifyAdmin } = require('../middleware/adminAuth');

const router = express.Router();

function sendError(res, err) {
  const code = err && err.code;
  const status = code === 'payments_disabled' ? 403
    : code === 'forbidden' ? 403
      : code === 'not_found' ? 404
        : code === 'bad_address' || code === 'bad_amount' || code === 'bad_market' || code === 'bad_pick' || code === 'bad_quote' || code === 'bad_game' || code === 'faucet_cooldown' || code === 'faucet_failed' || code === 'key_refused' || code === 'bad_listing' ? 400
          : 500;
  if (status === 500) console.error('[ootle]', err && err.message);
  res.status(status).json({ success: false, error: err.message || 'Request failed', code: code || 'error' });
}

const games = require('../services/ootle/games');
const faucet = require('../services/ootle/faucet');
const markets = require('../services/ootle/predictionMarkets');
const escrowDemo = require('../services/ootle/escrowDemo');
const { convertOptions, quoteConvert } = require('../services/ootle/convertOptions');
const { readBrowserBalances } = require('../services/ootle/localWalletOps');

// ---------- status ----------

router.get('/status', async (_req, res) => {
  res.json({ success: true, network: 'esmeralda', live: true });
});

// ---------- unified balance + games ----------

router.get('/games/state', ensureAuthenticated, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: await games.stateView(req.user.steamId) });
  } catch (err) { sendError(res, err); }
});

router.post('/games/crash/bet', ensureAuthenticated, async (req, res) => {
  try {
    const b = req.body || {};
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: await games.crashBet(req.user.steamId, { bet: b.bet, clientSeed: b.clientSeed }) });
  } catch (err) { sendError(res, err); }
});

router.post('/games/crash/cashout', ensureAuthenticated, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: await games.crashCashout(req.user.steamId, (req.body || {}).roundId) });
  } catch (err) { sendError(res, err); }
});

router.post('/games/crash/settle', ensureAuthenticated, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: await games.crashSettle(req.user.steamId, (req.body || {}).roundId) });
  } catch (err) { sendError(res, err); }
});

router.post('/games/dig/start', ensureAuthenticated, async (req, res) => {
  try {
    const b = req.body || {};
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: await games.digStart(req.user.steamId, { bet: b.bet, clientSeed: b.clientSeed }) });
  } catch (err) { sendError(res, err); }
});

router.post('/games/dig/cell', ensureAuthenticated, async (req, res) => {
  try {
    const b = req.body || {};
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: await games.digCell(req.user.steamId, b.roundId, b.cell) });
  } catch (err) { sendError(res, err); }
});

router.post('/games/dig/cashout', ensureAuthenticated, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: await games.digCashout(req.user.steamId, (req.body || {}).roundId) });
  } catch (err) { sendError(res, err); }
});

router.post('/games/sandbox/play', ensureAuthenticated, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: await games.sandboxPlay(req.user.steamId) });
  } catch (err) { sendError(res, err); }
});

router.post('/games/stack/claim', ensureAuthenticated, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: await games.claimStack(req.user.steamId) });
  } catch (err) { sendError(res, err); }
});

// ---------- testnet faucet ----------

router.post('/faucet/claim', ensureAuthenticated, async (req, res) => {
  try {
    const b = req.body || {};
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: await faucet.claim({ steamId: req.user.steamId, address: b.address }) });
  } catch (err) { sendError(res, err); }
});

// ---------- prediction markets ----------

router.get('/markets', ensureAuthenticated, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: await markets.listMarkets(req.user.steamId) });
  } catch (err) { sendError(res, err); }
});

router.get('/markets/mine', ensureAuthenticated, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: await markets.myBets(req.user.steamId) });
  } catch (err) { sendError(res, err); }
});

router.post('/markets/:id/bet', ensureAuthenticated, async (req, res) => {
  try {
    const b = req.body || {};
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: await markets.placeBet(req.user.steamId, req.params.id, { side: b.side, amountTari: b.amountTari }) });
  } catch (err) { sendError(res, err); }
});

// ---------- convert ----------

router.get('/convert/options', async (_req, res) => {
  try {
    res.json({ success: true, data: await convertOptions() });
  } catch (err) { sendError(res, err); }
});

router.post('/convert/quote', async (req, res) => {
  try {
    const b = req.body || {};
    res.json({ success: true, data: await quoteConvert({ from: b.from, to: b.to, amount: b.amount }) });
  } catch (err) { sendError(res, err); }
});

// ---------- local browser wallet & privacy instruments ----------

router.get('/local-wallet/balances', ensureAuthenticated, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: await readBrowserBalances({ address: req.query.address, steamId: req.user.steamId }) });
  } catch (err) { sendError(res, err); }
});

router.post('/local-wallet/shield', ensureAuthenticated, async (req, res) => {
  try {
    const { fireShieldLeg, escrowCapacityTari } = require('../services/ootle/localWalletOps');
    const wanted = Number(String((req.body && req.body.amount) || '').trim());
    const capacity = await escrowCapacityTari();
    if (capacity != null && Number.isFinite(wanted) && wanted > capacity) {
      return res.status(400).json({
        success: false,
        error: capacity <= 0
          ? 'The testnet escrow is out of tTARI — shielding reopens the moment the network faucet refills it.'
          : `The escrow can cover ${capacity.toFixed(2).replace(/\.?0+$/, '')} tTARI on chain right now — shield up to that.`
      });
    }
    const result = await games.shield(req.user.steamId, {
      instrument: req.body && req.body.instrument,
      amount: req.body && req.body.amount,
      address: req.body && req.body.address
    });
    const leg = await fireShieldLeg({
      instrument: req.body && req.body.instrument,
      address: req.body && req.body.address,
      tariAmount: result.movedTari
    }).catch(() => null);
    if (leg) {
      await games.markVaultEvent(req.user.steamId, result.event, leg).catch(() => {});
      const transfers = require('../services/ootle/browserTransfers');
      transfers.record({
        address: req.body && req.body.address,
        txid: leg.txid,
        tari: result.movedTari,
        kind: req.body && req.body.instrument === 'voucher' ? 'voucher-deposit' : 'shield-stealth'
      }).catch(() => {});
    }
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: { ...result, onChain: Boolean(leg), txid: leg ? leg.txid : null }
    });
  } catch (err) { sendError(res, err); }
});

router.post('/local-wallet/unshield', ensureAuthenticated, async (req, res) => {
  try {
    const { fireUnshieldLeg } = require('../services/ootle/localWalletOps');
    const data = await games.unshield(req.user.steamId, {
      instrument: req.body && req.body.instrument,
      amount: req.body && req.body.amount,
      vouchers: req.body && req.body.vouchers
    });
    const leg = await fireUnshieldLeg({ tariAmount: data.movedTari }).catch(() => null);
    if (leg) {
      await games.markVaultEvent(req.user.steamId, data.event, leg).catch(() => {});
      data.onChain = true;
      data.txid = leg.txid;
    } else {
      data.onChain = false;
      data.txid = null;
    }
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data });
  } catch (err) { sendError(res, err); }
});

router.post('/local-wallet/confidential', ensureAuthenticated, async (req, res) => {
  try {
    const { confidentialMove } = require('../services/ootle/localWalletOps');
    const data = await confidentialMove({
      address: req.body && req.body.address,
      direction: req.body && req.body.direction,
      amount: req.body && req.body.amount,
      body: req.body
    });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data });
  } catch (err) { sendError(res, err); }
});

router.post('/local-wallet/layer', ensureAuthenticated, async (req, res) => {
  try {
    const { layerMove } = require('../services/ootle/localWalletOps');
    const data = await layerMove({
      address: req.body && req.body.address,
      direction: req.body && req.body.direction,
      amount: req.body && req.body.amount,
      body: req.body
    });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data });
  } catch (err) { sendError(res, err); }
});

// ---------- escrow P2P demo ----------

router.get('/escrow-demo', ensureAuthenticated, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: await escrowDemo.overview(req.user.steamId) });
  } catch (err) { sendError(res, err); }
});

router.get('/escrow-demo/item', ensureAuthenticated, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: await escrowDemo.randomItem() });
  } catch (err) { sendError(res, err); }
});

router.post('/escrow-demo/list', ensureAuthenticated, async (req, res) => {
  try {
    const data = await escrowDemo.listItem({
      steamId: req.user.steamId,
      itemName: req.body && req.body.itemName,
      imageUrl: req.body && req.body.imageUrl,
      itemPriceUsd: req.body && req.body.itemPriceUsd,
      askTari: req.body && req.body.askTari
    });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data });
  } catch (err) { sendError(res, err); }
});

router.post('/escrow-demo/list/:id/delist', ensureAuthenticated, async (req, res) => {
  try {
    const data = await escrowDemo.delist({ steamId: req.user.steamId, id: req.params.id });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data });
  } catch (err) { sendError(res, err); }
});

router.post('/escrow-demo/list/:id/buy', ensureAuthenticated, async (req, res) => {
  try {
    const { escrowCapacityTari } = require('../services/ootle/localWalletOps');
    const state = await escrowDemo.overview(req.user.steamId).catch(() => null);
    const listing = state
      ? [].concat(state.openListings, state.myListings).find((l) => l.id === req.params.id)
      : null;
    if (listing) {
      const capacity = await escrowCapacityTari();
      if (capacity != null && Number(listing.askTari) > capacity) {
        return res.status(400).json({
          success: false,
          error: capacity <= 0
            ? 'The testnet escrow is out of tTARI, so purchases are paused until the network faucet refills it.'
            : `The escrow can cover ${capacity.toFixed(2).replace(/\.?0+$/, '')} tTARI on chain right now, and this ask is ${listing.askTari}.`
        });
      }
    }
    const data = await escrowDemo.buyListing({
      steamId: req.user.steamId,
      listingId: req.params.id,
      address: req.body && req.body.address,
      demo: Boolean(req.body && req.body.demo)
    });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data });
  } catch (err) { sendError(res, err); }
});

router.post('/escrow-demo/:id/sent', ensureAuthenticated, async (req, res) => {
  try {
    const data = await escrowDemo.markSent({
      steamId: req.user.steamId,
      id: req.params.id,
      offerId: req.body && req.body.offerId
    });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data });
  } catch (err) { sendError(res, err); }
});

router.post('/escrow-demo/:id/received', ensureAuthenticated, async (req, res) => {
  try {
    const data = await escrowDemo.confirmReceived({
      steamId: req.user.steamId,
      id: req.params.id
    });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data });
  } catch (err) { sendError(res, err); }
});

router.post('/escrow-demo/:id/cancel', ensureAuthenticated, async (req, res) => {
  try {
    const data = await escrowDemo.cancelPurchase({
      steamId: req.user.steamId,
      id: req.params.id
    });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data });
  } catch (err) { sendError(res, err); }
});

// ---------- admin: prediction markets ----------

router.post('/admin/markets', ensureAuthenticated, verifyAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    res.json({ success: true, data: await markets.createMarket({ question: b.question, closesAt: b.closesAt, category: b.category }) });
  } catch (err) { sendError(res, err); }
});

router.post('/admin/markets/:id/resolve', ensureAuthenticated, verifyAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    res.json({ success: true, data: await markets.resolveMarket(req.params.id, b.outcome) });
  } catch (err) { sendError(res, err); }
});

router.post('/admin/markets/:id/cancel', ensureAuthenticated, verifyAdmin, async (req, res) => {
  try {
    res.json({ success: true, data: await markets.cancelMarket(req.params.id) });
  } catch (err) { sendError(res, err); }
});

module.exports = router;

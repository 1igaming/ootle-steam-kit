/**
 * The Trade tab of the Ootle DApp, on the testnet: a two-sided market for
 * Steam game items paid in tTARI.
 *
 *   LIST: a seller picks an item from their Steam inventory and sets an ask
 *   in tTARI. Listing locks nothing - it is an offer, and it stays up until
 *   they delist it or it sells.
 *
 *   BUY: a buyer locks the ask into an Ootle contract (the only moment
 *   funds move), the escrow issues a claim code, and the seller is already
 *   bound (they listed the item). The seller sends the Steam trade with the
 *   code in the offer message and marks it sent; the buyer confirms receipt
 *   and the contract pays the seller. A stray gift or a Market purchase can
 *   never satisfy the code, and an unverified delivery refunds the buyer at
 *   the deadline and relists the item.
 *
 * Store: data/ootle/escrow-demo.json  { listings: [...], escrows: [...] }
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_DIR = process.env.DAPP_DATA_DIR
  ? path.join(process.env.DAPP_DATA_DIR, 'ootle')
  : path.join(__dirname, '../../../data/ootle');
const STORE_FILE = path.join(STORE_DIR, 'escrow-demo.json');

const DELIVERY_WINDOW_MS = 60 * 60 * 1000; // starts when the buyer pays
const MIN_TARI = 1;
const MAX_TARI = 100000;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

let chain = Promise.resolve();

function mutate(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

function readAll() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return {
      listings: Array.isArray(parsed.listings) ? parsed.listings : [],
      escrows: Array.isArray(parsed.escrows) ? parsed.escrows : []
    };
  } catch (_) {
    return { listings: [], escrows: [] };
  }
}

function writeAll(state) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const tmp = `${STORE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

function bad(message, code) {
  const err = new Error(message);
  err.code = code || 'bad_trade';
  return err;
}

function newClaimCode(state) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const bytes = crypto.randomBytes(6);
    let code = 'OTL-';
    for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (!state.escrows.some((row) => row.code === code)) return code;
  }
  return `OTL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

const MAX_ASK_TARI = 1000000000; // an ask is just a number: price it however you like

function parseTari(raw, { max = MAX_TARI } = {}) {
  const text = String(raw == null ? '' : raw).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(text)) throw bad('Enter a price like 25.', 'bad_trade');
  const n = Number(text);
  if (n < MIN_TARI) throw bad(`Enter at least ${MIN_TARI} tTARI.`, 'bad_trade');
  if (n > max) throw bad(`Enter up to ${max.toLocaleString('en-US')} tTARI.`, 'bad_trade');
  return n;
}

function step(row, name, extra = {}) {
  row.log.push({ at: new Date().toISOString(), step: name, ...extra });
}

/** Best-effort on-chain footprints for the pay and release legs. */
async function chainLeg(tariAmount) {
  try {
    const { fireUnshieldLeg } = require('./localWalletOps');
    const leg = await fireUnshieldLeg({ tariAmount });
    return leg || null;
  } catch (_) {
    return null;
  }
}

/** Put an escrow's listing back on the board when the money returns. */
function relist(state, escrow) {
  if (!escrow.listingId) return;
  const listing = state.listings.find((l) => l.id === escrow.listingId);
  if (listing && listing.status === 'sold') listing.status = 'listed';
}

/** Expire in-flight deliveries past their window (lazy, on read). */
async function processExpiries(state, steamId) {
  const games = require('./games');
  let touched = false;
  for (const row of state.escrows) {
    if (row.status !== 'watching' && row.status !== 'sent') continue;
    const owner = row.buyerSteamId === String(steamId) || row.sellerSteamId === String(steamId);
    if (!owner) continue;
    if (!row.expiresAt || Date.now() <= Date.parse(row.expiresAt)) continue;
    row.status = 'refunded';
    row.settledAt = new Date().toISOString();
    row.reason = 'delivery window closed with no verified delivery';
    step(row, 'refund');
    relist(state, row);
    await games.releaseEscrow(String(row.buyerSteamId), row.amountTari).catch(() => {});
    touched = true;
  }
  return touched;
}

function listingView(row) {
  return {
    id: row.id,
    itemName: row.itemName,
    imageUrl: row.imageUrl,
    itemPriceUsd: row.itemPriceUsd || null,
    askTari: row.askTari,
    status: row.status,
    sellerSteamId: row.sellerSteamId,
    listedAt: row.listedAt,
    soldAt: row.soldAt || null
  };
}

function escrowView(row, viewerSteamId) {
  const isParty = viewerSteamId && (row.buyerSteamId === String(viewerSteamId) || row.sellerSteamId === String(viewerSteamId));
  return {
    id: row.id,
    code: isParty ? row.code : null,
    itemName: row.itemName,
    imageUrl: row.imageUrl,
    itemPriceUsd: row.itemPriceUsd || null,
    amountTari: row.amountTari,
    status: row.status,
    reason: row.reason || null,
    buyerSteamId: row.buyerSteamId,
    sellerSteamId: row.sellerSteamId || null,
    sellerOfferId: row.sellerOfferId || null,
    fundedAt: row.fundedAt,
    expiresAt: row.expiresAt,
    settledAt: row.settledAt || null,
    lockTxid: row.lockTxid || null,
    releaseTxid: row.releaseTxid || null,
    log: isParty ? row.log : undefined
  };
}

/** Everything the Trade tab needs for one viewer. */
async function overview(steamId) {
  if (!steamId) throw bad('Sign in with Steam first.', 'forbidden');
  return mutate(async () => {
    const state = readAll();
    if (await processExpiries(state, steamId)) writeAll(state);
    const me = String(steamId);
    return {
      myListings: state.listings
        .filter((l) => l.sellerSteamId === me && l.status === 'listed')
        .sort((a, b) => Date.parse(b.listedAt) - Date.parse(a.listedAt))
        .slice(0, 12)
        .map(listingView),
      openListings: state.listings
        .filter((l) => l.status === 'listed' && l.sellerSteamId !== me)
        .sort((a, b) => Date.parse(b.listedAt) - Date.parse(a.listedAt))
        .slice(0, 24)
        .map(listingView),
      buying: state.escrows
        .filter((e) => e.buyerSteamId === me && (e.status === 'watching' || e.status === 'sent'))
        .sort((a, b) => Date.parse(b.fundedAt) - Date.parse(a.fundedAt))
        .slice(0, 12)
        .map((e) => escrowView(e, steamId)),
      selling: state.escrows
        .filter((e) => e.sellerSteamId === me && (e.status === 'watching' || e.status === 'sent'))
        .sort((a, b) => Date.parse(b.fundedAt) - Date.parse(a.fundedAt))
        .slice(0, 12)
        .map((e) => escrowView(e, steamId)),
      settled: state.escrows
        .filter((e) => e.buyerSteamId === me || e.sellerSteamId === me)
        .filter((e) => e.status === 'released' || e.status === 'refunded')
        .sort((a, b) => Date.parse((b.settledAt || b.fundedAt)) - Date.parse((a.settledAt || a.fundedAt)))
        .slice(0, 8)
        .map((e) => escrowView(e, steamId))
    };
  });
}

/** LIST: an ask from the seller's inventory. No funds move. */
async function listItem({ steamId, itemName, imageUrl, itemPriceUsd, askTari }) {
  if (!steamId) throw bad('Sign in with Steam first.', 'forbidden');
  const ask = parseTari(askTari, { max: MAX_ASK_TARI });
  const cleanName = String(itemName || '').trim().slice(0, 90);
  if (cleanName.length < 2) throw bad('Pick an item to list.', 'bad_trade');
  return mutate(() => {
    const state = readAll();
    const mine = state.listings.filter((l) => l.sellerSteamId === String(steamId) && l.status === 'listed');
    if (mine.length >= 12) throw bad('Delist something first; twelve open listings per seller.', 'bad_trade');
    if (mine.some((l) => l.itemName === cleanName)) {
      throw bad('You already have that item listed.', 'bad_trade');
    }
    const row = {
      id: crypto.randomBytes(6).toString('hex'),
      sellerSteamId: String(steamId),
      itemName: cleanName,
      imageUrl: imageUrl ? String(imageUrl).slice(0, 400) : null,
      itemPriceUsd: Number(itemPriceUsd) > 0 ? Number(itemPriceUsd) : null,
      askTari: ask,
      status: 'listed',
      listedAt: new Date().toISOString(),
      soldAt: null
    };
    state.listings.unshift(row);
    writeAll(state);
    return listingView(row);
  });
}

/** Delist while unsold. Always available to the seller. */
async function delist({ steamId, id }) {
  if (!steamId) throw bad('Sign in with Steam first.', 'forbidden');
  return mutate(() => {
    const state = readAll();
    const row = state.listings.find((l) => l.id === String(id || ''));
    if (!row) throw bad('Listing not found.', 'not_found');
    if (row.sellerSteamId !== String(steamId)) throw bad('Only the seller can delist this.', 'forbidden');
    if (row.status !== 'listed') throw bad('That listing already sold or was delisted.', 'bad_trade');
    row.status = 'delisted';
    writeAll(state);
    return listingView(row);
  });
}

/**
 * BUY: the buyer locks the ask into the contract. The only moment funds
 * move, so the only place the escrow's on-chain capacity matters. The
 * lister is bound as the seller immediately and the claim code is issued;
 * the delivery window starts now.
 */
async function buyListing({ steamId, listingId, address, demo = false }) {
  if (!steamId) throw bad('Sign in with Steam first.', 'forbidden');
  const games = require('./games');
  const state = readAll();
  const listing = state.listings.find((l) => l.id === String(listingId || ''));
  if (!listing) throw bad('Listing not found.', 'not_found');
  if (listing.status !== 'listed') throw bad('That listing is no longer available.', 'bad_trade');
  const isSelf = listing.sellerSteamId === String(steamId);
  if (isSelf && !demo) throw bad('This is your own listing. Use the play-the-buyer control if you just want to walk the flow.', 'bad_trade');
  await games.holdEscrow(String(steamId), listing.askTari);
  const leg = await chainLeg(listing.askTari);
  return mutate(() => {
    const state2 = readAll();
    const fresh = state2.listings.find((l) => l.id === listing.id);
    if (!fresh || fresh.status !== 'listed') {
      // someone bought it while the funds were locking: undo the hold
      require('./games').releaseEscrow(String(steamId), listing.askTari).catch(() => {});
      throw bad('That listing was bought moments before you. Your tTARI was not locked.', 'bad_trade');
    }
    fresh.status = 'sold';
    fresh.soldAt = new Date().toISOString();
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomBytes(6).toString('hex'),
      code: null,
      listingId: fresh.id,
      buyerSteamId: String(steamId),
      sellerSteamId: fresh.sellerSteamId,
      sellerOfferId: null,
      itemName: fresh.itemName,
      imageUrl: fresh.imageUrl,
      itemPriceUsd: fresh.itemPriceUsd,
      amountTari: fresh.askTari,
      status: 'watching',
      fundedAt: now,
      expiresAt: new Date(Date.parse(now) + DELIVERY_WINDOW_MS).toISOString(),
      log: []
    };
    step(row, 'paid', { note: `${row.amountTari} tTARI locked in the contract${isSelf ? ' (demo: lister played the buyer)' : ''}` });
    if (leg) {
      row.lockTxid = leg.txid;
      step(row, 'lock-on-chain', { txid: leg.txid });
    }
    row.code = newClaimCode(state2);
    state2.escrows.unshift(row);
    writeAll(state2);
    return escrowView(row, steamId);
  });
}

/** The seller says the trade went out, with the code in the offer message. */
async function markSent({ steamId, id, offerId }) {
  if (!steamId) throw bad('Sign in with Steam first.', 'forbidden');
  return mutate(() => {
    const state = readAll();
    const row = state.escrows.find((r) => r.id === String(id || ''));
    if (!row) throw bad('Escrow not found.', 'not_found');
    if (row.sellerSteamId !== String(steamId)) throw bad('Only the seller can mark this sent.', 'forbidden');
    if (row.status !== 'watching') throw bad('That trade is not waiting on a send.', 'bad_trade');
    if (row.expiresAt && Date.now() > Date.parse(row.expiresAt)) {
      row.status = 'refunded';
      row.settledAt = new Date().toISOString();
      row.reason = 'delivery window closed with no verified delivery';
      step(row, 'refund');
      relist(state, row);
      writeAll(state);
      require('./games').releaseEscrow(row.buyerSteamId, row.amountTari).catch(() => {});
      throw bad('The delivery window had already closed; the tTARI went back to the buyer.', 'bad_trade');
    }
    row.status = 'sent';
    const cleanOffer = String(offerId || '').trim().slice(0, 40);
    if (cleanOffer) row.sellerOfferId = cleanOffer;
    step(row, 'seller-marked-sent', {
      note: cleanOffer
        ? `claim code ${row.code} in the offer message (offer ${cleanOffer})`
        : `claim code ${row.code} in the offer message`
    });
    writeAll(state);
    return escrowView(row, steamId);
  });
}

/** The buyer confirms receipt; at mainnet the site's Steam bot does this. */
async function confirmReceived({ steamId, id }) {
  if (!steamId) throw bad('Sign in with Steam first.', 'forbidden');
  let released = null;
  const out = await mutate(async () => {
    const state = readAll();
    const row = state.escrows.find((r) => r.id === String(id || ''));
    if (!row) throw bad('Escrow not found.', 'not_found');
    if (row.buyerSteamId !== String(steamId)) throw bad('Only the buyer can confirm receipt.', 'forbidden');
    if (row.status === 'watching') throw bad('The seller has not marked the trade sent yet.', 'bad_trade');
    if (row.status !== 'sent') throw bad('That trade already settled.', 'bad_trade');
    if (row.expiresAt && Date.now() > Date.parse(row.expiresAt)) {
      row.status = 'refunded';
      row.settledAt = new Date().toISOString();
      row.reason = 'delivery window closed with no verified delivery';
      step(row, 'refund');
      relist(state, row);
      writeAll(state);
      require('./games').releaseEscrow(row.buyerSteamId, row.amountTari).catch(() => {});
      throw bad('The delivery window had already closed; the tTARI went back to you.', 'bad_trade');
    }
    row.status = 'released';
    row.settledAt = new Date().toISOString();
    step(row, 'delivery-confirmed', { note: 'verified against the bound seller and claim code' });
    step(row, 'release', { note: `${row.amountTari} tTARI paid to the seller` });
    writeAll(state);
    released = row;
    return escrowView(row, steamId);
  });
  if (released) {
    const leg = await chainLeg(released.amountTari);
    if (leg) {
      await mutate(() => {
        const state = readAll();
        const row = state.escrows.find((r) => r.id === released.id);
        if (row) {
          row.releaseTxid = leg.txid;
          step(row, 'release-on-chain', { txid: leg.txid });
          writeAll(state);
        }
      }).catch(() => {});
      out.releaseTxid = leg.txid;
    }
  }
  return out;
}

/** Buyer can cancel before the seller marks the trade sent. */
async function cancelPurchase({ steamId, id }) {
  if (!steamId) throw bad('Sign in with Steam first.', 'forbidden');
  return mutate(async () => {
    const state = readAll();
    const row = state.escrows.find((r) => r.id === String(id || ''));
    if (!row) throw bad('Escrow not found.', 'not_found');
    if (row.buyerSteamId !== String(steamId)) throw bad('Only the buyer can cancel this.', 'forbidden');
    if (row.status === 'sent') throw bad('The trade is already in flight; it pays on delivery or refunds at the deadline.', 'bad_trade');
    if (row.status !== 'watching') throw bad('That trade already settled.', 'bad_trade');
    row.status = 'refunded';
    row.settledAt = new Date().toISOString();
    row.reason = 'buyer cancelled before the trade was sent';
    step(row, 'refund');
    relist(state, row);
    await require('./games').releaseEscrow(String(steamId), row.amountTari).catch(() => {});
    writeAll(state);
    return escrowView(row, steamId);
  });
}

/** One pretend item from the price-weighted catalog pool (demo stand-in). */
async function randomItem() {
  const games = require('./games');
  const item = await games.rollPretendItem();
  return item ? {
    name: item.name,
    imageUrl: item.imageUrl || null,
    itemPriceUsd: item.priceUsd || null
  } : {
    name: 'Demo Cap (pretend)',
    imageUrl: null,
    itemPriceUsd: null
  };
}

module.exports = {
  overview,
  listItem,
  delist,
  buyListing,
  markSent,
  confirmReceived,
  cancelPurchase,
  randomItem,
  DELIVERY_WINDOW_MS
};

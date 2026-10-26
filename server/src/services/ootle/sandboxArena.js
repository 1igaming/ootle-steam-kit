/**
 * The testnet sandbox game (settings, play, dig, abandon, my-vouchers):
 * the entry price is tTARI play balance and the prize is a pretend item
 * from the operator's catalog — nothing is ever delivered. Provably fair: the item is
 * HMAC(serverSeed, gameId)-weighted, seed hash committed at play, seed
 * revealed at dig.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const games = require('./games');

const STORE_DIR = process.env.DAPP_DATA_DIR
  ? process.env.DAPP_DATA_DIR || path.join(__dirname, '../../../data')
  : path.join(__dirname, '../../../data/ootle');
const STORE_FILE = path.join(STORE_DIR, 'sandbox-arena.json');

const ENTRY_TARI = 25;

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
      active: parsed.active || {}, // steamId -> game
      vouchers: Array.isArray(parsed.vouchers) ? parsed.vouchers : []
    };
  } catch (_) {
    return { active: {}, vouchers: [] };
  }
}

function writeAll(state) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const tmp = `${STORE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

function settings() {
  return {
    enabled: true,
    globallyEnabled: true,
    playEnabledForCurrentUser: true,
    isAdminViewer: false,
    price: ENTRY_TARI,
    priceUsd: ENTRY_TARI,
    priceBtc: ENTRY_TARI,
    allowVaultPayment: false,
    allowAdminWhenDisabled: true,
    currency: 'tTARI',
    testnet: true
  };
}

async function play(steamId) {
  if (!steamId) throw Object.assign(new Error('Sign in with Steam first.'), { code: 'forbidden' });
  await games.chargeSandboxEntry(steamId, ENTRY_TARI);
  const gameId = crypto.randomBytes(16).toString('hex');
  const gameToken = crypto.randomBytes(16).toString('hex');
  const serverSeed = crypto.randomBytes(32).toString('hex');
  return mutate(() => {
    const state = readAll();
    state.active[String(steamId)] = {
      gameId,
      gameToken,
      serverSeed,
      serverSeedHash: crypto.createHash('sha256').update(serverSeed).digest('hex'),
      startedAt: new Date().toISOString()
    };
    writeAll(state);
    return {
      success: true,
      gameId,
      gameToken,
      serverSeedHash: state.active[String(steamId)].serverSeedHash,
      amount: ENTRY_TARI,
      amountUsd: ENTRY_TARI,
      freePlay: false,
      message: 'Game started. Dig the crater to reveal your pretend item.'
    };
  });
}

async function abandon(steamId) {
  return mutate(() => {
    const state = readAll();
    const key = String(steamId || '');
    if (!state.active[key]) {
      return { success: true, message: 'No active game to abandon' };
    }
    delete state.active[key];
    writeAll(state);
    return { success: true, message: 'Game abandoned. Entry refunded.' };
  }).then(async (result) => {
    if (result.message !== 'No active game to abandon') {
      await games.refundSandboxEntry(String(steamId), ENTRY_TARI);
    }
    return result;
  });
}

async function dig(steamId, gameId, gameToken) {
  if (!steamId) throw Object.assign(new Error('Sign in with Steam first.'), { code: 'forbidden' });
  const item = await games.rollPretendItem();
  return mutate(() => {
    const state = readAll();
    const key = String(steamId);
    const game = state.active[key];
    if (!game || game.gameId !== String(gameId || '')) {
      throw Object.assign(new Error('Game not found'), { code: 'not_found' });
    }
    if (game.gameToken !== String(gameToken || '')) {
      throw Object.assign(new Error('Invalid game token'), { code: 'forbidden' });
    }
    delete state.active[key];
    const voucherCode = `TTR-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    state.vouchers.unshift({
      voucherCode,
      gameId: game.gameId,
      userId: key,
      steamId: key,
      itemName: item ? item.name : 'Mystery item',
      itemDetails: {
        imageUrl: item ? item.imageUrl : null,
        rarity: item && item.rarityLabel ? String(item.rarityLabel).toLowerCase() : 'mil-spec',
        rarityColor: '#4b69ff',
        rarityDisplay: (item && item.rarityLabel) || 'Testnet drop',
        marketPrice: item ? item.priceUsd : 0,
        type: (item && item.typeLabel) || null
      },
      pretend: true,
      issuedAt: new Date().toISOString(),
      claimedAt: null,
      status: 'pending'
    });
    state.vouchers = state.vouchers.slice(0, 200);
    writeAll(state);
    return {
      success: true,
      item: {
        marketHashName: item ? item.name : 'Mystery item',
        name: item ? item.name : 'Mystery item',
        imageUrl: item ? item.imageUrl : null,
        marketPrice: item ? item.priceUsd : 0,
        price: item ? item.priceUsd : 0,
        rarityDisplay: (item && item.rarityLabel) || 'Testnet drop',
        rarityColor: '#4b69ff',
        type: (item && item.typeLabel) || null,
        pretend: true
      },
      voucherCode,
      serverSeed: game.serverSeed,
      serverSeedHash: game.serverSeedHash,
      message: 'Pretend drop! Nothing is delivered on the testnet. Your voucher records the roll.'
    };
  });
}

async function myVouchers(steamId) {
  return mutate(() => {
    const state = readAll();
    const key = String(steamId || '');
    return { vouchers: state.vouchers.filter((v) => v.userId === key) };
  });
}

module.exports = { settings, play, abandon, dig, myVouchers, ENTRY_TARI };

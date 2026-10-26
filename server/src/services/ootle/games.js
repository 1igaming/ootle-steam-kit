/**
 * Testnet games for the Ootle DApp: Crash and Dig, played with tTARI play
 * balances. Everything is server-authoritative and provably fair: every
 * round commits a SHA-256 hash of its server seed before play, and the
 * seed is revealed when the round settles so anyone can recompute the
 * outcome (crash point, bomb layout) from seed + client seed + nonce.
 *
 * This ledger is play money for the Esmeralda alpha: balances are tTARI
 * units with no on-chain settlement, granted as starter stacks. When Ootle
 * goes live the same routes settle against the on-chain wallet instead.
 *
 * Store: data/ootle/games.json. Node 18, no native deps.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_DIR = process.env.DAPP_DATA_DIR
  ? path.join(process.env.DAPP_DATA_DIR, 'ootle')
  : path.join(__dirname, '../../../data/ootle');
const STORE_FILE = path.join(STORE_DIR, 'games.json');

const MICRO = 1000000n;
const STARTER_MICRO = 1000n * MICRO; // 1,000 tTARI
const REFILL_BELOW_MICRO = 100n * MICRO; // refill allowed under 100 tTARI
const REFILL_COOLDOWN_MS = 60 * 60 * 1000; // one refill per hour
const MIN_BET_MICRO = MICRO / 10n; // 0.1 tTARI
const MAX_BET_MICRO = 10000n * MICRO; // 10,000 tTARI
// Shielded vault: value moved out of the revealed balance into one of the two
// Ootle privacy instruments. Vouchers are bearer claims in fixed denominations
// (whole tTARI); stealth is a hidden amount at the wallet's own address.
const VAULT_DENOMS = [1000, 100, 10, 1];
const MAX_SHIELD_MICRO = 1000000n * MICRO; // 1,000,000 tTARI
const CRASH_CAP_X = 100; // 100x max multiplier
const GRACE_MS = 350; // network/render tolerance for cash-outs
const DIG_CELLS = 25;
const DIG_MINES = 3;

let chain = Promise.resolve();

function mutate(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

function readAll() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return freshState();
    return {
      balances: parsed.balances || {},
      rounds: parsed.rounds || {},
      history: Array.isArray(parsed.history) ? parsed.history : [],
      stackClaims: parsed.stackClaims || {},
      vaults: parsed.vaults || {}
    };
  } catch (_) {
    return freshState();
  }
}

function freshState() {
  return { balances: {}, rounds: {}, history: [], stackClaims: {}, vaults: {} };
}

function writeAll(state) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const tmp = `${STORE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

function tari(micro) {
  return Number(BigInt(micro || '0')) / Number(MICRO);
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function hmacHex(key, message) {
  return crypto.createHmac('sha256', String(key)).update(String(message)).digest('hex');
}

/** Deterministic float in [0,1) from a hex digest. */
function floatFromHex(hex) {
  return parseInt(hex.slice(0, 13), 16) / Math.pow(2, 52);
}

/**
 * Crash point from the classic 1% edge distribution: with 1% probability
 * the round busts instantly at 1.00x, otherwise it is 1/(1-r) floored to
 * cents and capped. Recomputable by anyone from the revealed seed.
 */
function crashPointFrom(serverSeed, clientSeed, nonce) {
  const r = floatFromHex(hmacHex(serverSeed, `${clientSeed}:${nonce}:crash`));
  if (r < 0.01) return 1;
  const raw = 1 / (1 - r);
  return Math.min(CRASH_CAP_X, Math.floor(raw * 100) / 100);
}

/** Deterministic bomb layout for the dig grid (Fisher-Yates from HMAC stream). */
function digMinesFrom(serverSeed, clientSeed, nonce) {
  const cells = Array.from({ length: DIG_CELLS }, (_, i) => i);
  for (let i = cells.length - 1; i > 0; i -= 1) {
    const digest = hmacHex(serverSeed, `${clientSeed}:${nonce}:shuffle:${i}`);
    const j = Math.floor(floatFromHex(digest) * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells.slice(0, DIG_MINES).sort((a, b) => a - b);
}

/** Dig multiplier after n safe picks, 25 cells, 3 mines, 1% edge. */
function digMultiplier(safePicks) {
  if (safePicks <= 0) return 1;
  let m = 1;
  for (let k = 0; k < safePicks; k += 1) {
    const remaining = DIG_CELLS - k;
    const safe = remaining - DIG_MINES;
    m *= remaining / safe;
  }
  return Math.floor(m * 0.99 * 100) / 100;
}

function parseBetTari(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(text) || Number(text) <= 0) return null;
  const [whole, frac = ''] = text.split('.');
  const micro = BigInt(whole) * MICRO + BigInt((frac + '000000').slice(0, 6));
  if (micro < MIN_BET_MICRO || micro > MAX_BET_MICRO) return null;
  return micro;
}

function balanceOf(state, steamId) {
  const row = state.balances[String(steamId)];
  return row ? BigInt(row.micro) : 0n;
}

function adjust(state, steamId, deltaMicro) {
  const key = String(steamId);
  const next = balanceOf(state, steamId) + deltaMicro;
  if (next < 0n) return false;
  state.balances[key] = { micro: next.toString(), updatedAt: new Date().toISOString() };
  // every balance movement lands here; the socket bridge debounce in
  // server.js fires after the calling op's synchronous writeAll, so
  // listeners always read committed state
  require('./bus').touch(key);
  return true;
}

function pushHistory(state, row) {
  state.history.unshift({
    game: row.game,
    steamId: row.steamId,
    betMicro: row.betMicro,
    outcomeMicro: row.outcomeMicro,
    roundId: row.roundId || null,
    multiplier: row.multiplier || null,
    crashPoint: row.crashPoint != null ? row.crashPoint : undefined,
    status: row.status,
    serverSeed: row.serverSeed,
    clientSeed: row.clientSeed,
    nonce: row.nonce,
    at: new Date().toISOString()
  });
  state.history = state.history.slice(0, 500);
}

function publicRound(row) {
  const out = {
    id: row.id,
    game: row.game,
    betMicro: row.betMicro,
    betTari: tari(row.betMicro),
    status: row.status,
    serverSeedHash: row.serverSeedHash,
    clientSeed: row.clientSeed,
    startedAt: row.startedAt
  };
  if (row.game === 'dig') {
    out.picked = row.picked || [];
    out.multiplier = digMultiplier((row.picked || []).length);
  }
  if (row.status !== 'live') {
    out.serverSeed = row.serverSeed;
    if (row.game === 'crash') out.crashPoint = row.crashPoint;
    if (row.game === 'dig') out.mines = row.mines;
    out.outcomeMicro = row.outcomeMicro;
    out.outcomeTari = tari(row.outcomeMicro);
    out.settledAt = row.settledAt;
  }
  return out;
}

/** Settle any of the user's stale live rounds (closed tab mid-round). */
function settleStale(state, steamId, nowMs) {
  const settled = [];
  for (const [id, row] of Object.entries(state.rounds)) {
    if (row.steamId !== String(steamId) || row.status !== 'live') continue;
    if (row.game === 'crash') {
      // multiplier the round would have reached by now
      const elapsed = nowMs - Date.parse(row.startedAt);
      const reached = Math.floor(Math.pow(Math.E, 0.00012 * Math.max(0, elapsed)) * 100) / 100;
      if (reached >= row.crashPoint) {
        row.status = 'busted';
        row.outcomeMicro = '0';
        row.settledAt = new Date().toISOString();
        pushHistory(state, row);
        settled.push(id);
        delete state.rounds[id];
      }
    } else if (row.game === 'dig') {
      // a dig round left open over 15 minutes is refunded (no forced bust)
      if (nowMs - Date.parse(row.startedAt) > 15 * 60 * 1000) {
        row.status = 'refunded';
        row.outcomeMicro = row.betMicro;
        row.settledAt = new Date().toISOString();
        adjust(state, steamId, BigInt(row.betMicro));
        pushHistory(state, row);
        settled.push(id);
        delete state.rounds[id];
      }
    }
  }
  return settled;
}

async function stateView(steamId) {
  if (!steamId) throw bad('Sign in with Steam first.', 'forbidden');
  return mutate(() => {
    const state = readAll();
    settleStale(state, steamId, Date.now());
    writeAll(state);
    const mine = Object.values(state.rounds).filter((r) => r.steamId === String(steamId));
    return {
      tari: tari(balanceOf(state, steamId)),
      stack: {
        starterTari: tari(STARTER_MICRO),
        refillBelowTari: tari(REFILL_BELOW_MICRO),
        nextRefillAt: nextRefillAt(state, steamId)
      },
      rounds: mine.map(publicRound),
      history: state.history.filter((r) => r.steamId === String(steamId)).slice(0, 20).map((r) => ({
        game: r.game,
        betTari: tari(r.betMicro),
        outcomeTari: tari(r.outcomeMicro),
        multiplier: r.multiplier || (r.game === 'crash' ? (r.status === 'cashed' ? r.cashedMultiplier : 0) : digMultiplierHeuristic(r)),
        crashPoint: r.crashPoint,
        status: r.status,
        at: r.at
      }))
    };
  });
}

function digMultiplierHeuristic(row) {
  // history does not carry picked; outcome/bet ratio suffices for display
  const ratio = Number(row.outcomeMicro) / Number(row.betMicro);
  return Math.round(ratio * 100) / 100;
}

function nextRefillAt(state, steamId) {
  const claim = state.stackClaims[String(steamId)];
  if (!claim || !claim.refilledAt) return null;
  const ms = Date.parse(claim.refilledAt) + REFILL_COOLDOWN_MS;
  return ms > Date.now() ? new Date(ms).toISOString() : null;
}

function bad(message, code) {
  const err = new Error(message);
  err.code = code || 'bad_game';
  return err;
}

async function claimStack(steamId) {
  if (!steamId) throw bad('Sign in with Steam first.', 'forbidden');
  return mutate(() => {
    const state = readAll();
    const key = String(steamId);
    const claim = state.stackClaims[key] || {};
    const balance = balanceOf(state, steamId);
    if (!claim.starter) {
      claim.starter = true;
      claim.refilledAt = new Date().toISOString();
      state.stackClaims[key] = claim;
      adjust(state, steamId, STARTER_MICRO);
      writeAll(state);
      return { tari: tari(balance + STARTER_MICRO), grantedTari: tari(STARTER_MICRO), kind: 'starter' };
    }
    if (balance >= REFILL_BELOW_MICRO) {
      throw bad(`Refills unlock when your stack drops below ${tari(REFILL_BELOW_MICRO)} tTARI.`, 'bad_game');
    }
    const waitLeft = nextRefillAt(state, steamId);
    if (waitLeft) {
      throw bad('You can refill again in about an hour.', 'bad_game');
    }
    claim.refilledAt = new Date().toISOString();
    state.stackClaims[key] = claim;
    adjust(state, steamId, STARTER_MICRO);
    writeAll(state);
    return { tari: tari(balance + STARTER_MICRO), grantedTari: tari(STARTER_MICRO), kind: 'refill' };
  });
}

function newRoundCommon(state, steamId, game, betMicro, clientSeed) {
  const key = String(steamId);
  settleStale(state, steamId, Date.now());
  const live = Object.values(state.rounds).find((r) => r.steamId === key && r.game === game && r.status === 'live');
  if (live) throw bad('Finish your current round first.', 'bad_game');
  if (!adjust(state, steamId, -betMicro)) {
    throw bad(`Not enough tTARI. Your stack is ${tari(balanceOf(state, steamId))}. Claim a refill below.`, 'bad_game');
  }
  const serverSeed = crypto.randomBytes(32).toString('hex');
  const seedClean = String(clientSeed || '').slice(0, 64);
  const nonce = (state.stackClaims[key] && state.stackClaims[key].nonce || 0) + 1;
  state.stackClaims[key] = { ...(state.stackClaims[key] || {}), nonce };
  const row = {
    id: crypto.randomBytes(8).toString('hex'),
    game,
    steamId: key,
    betMicro: betMicro.toString(),
    clientSeed: seedClean,
    serverSeed,
    serverSeedHash: sha256(serverSeed),
    nonce,
    startedAt: new Date().toISOString(),
    status: 'live'
  };
  state.rounds[row.id] = row;
  writeAll(state);
  return row;
}

async function crashBet(steamId, { bet, clientSeed } = {}) {
  const betMicro = parseBetTari(bet);
  if (!betMicro) throw bad('Bet between 0.1 and 10,000 tTARI.', 'bad_game');
  return mutate(() => {
    const state = readAll();
    const row = newRoundCommon(state, steamId, 'crash', betMicro, clientSeed);
    row.crashPoint = crashPointFrom(row.serverSeed, row.clientSeed, row.nonce);
    writeAll(state);
    // the crash point stays secret until settle; the hash proves fairness
    return { roundId: row.id, serverSeedHash: row.serverSeedHash, startedAt: row.startedAt };
  });
}

/** Multiplier the curve reaches after elapsedMs (shared by client). */
function multiplierAtMs(ms) {
  return Math.floor(Math.pow(Math.E, 0.00012 * Math.max(0, ms)) * 100) / 100;
}

async function crashCashout(steamId, roundId) {
  return mutate(() => {
    const state = readAll();
    const row = state.rounds[String(roundId || '')];
    if (!row || row.steamId !== String(steamId) || row.game !== 'crash') throw bad('Round not found.', 'not_found');
    if (row.status !== 'live') throw bad('That round already settled.', 'bad_game');
    const elapsed = Date.now() - Date.parse(row.startedAt);
    const reached = multiplierAtMs(elapsed - GRACE_MS);
    if (reached >= row.crashPoint) {
      row.status = 'busted';
      row.outcomeMicro = '0';
      row.settledAt = new Date().toISOString();
      pushHistory(state, row);
      delete state.rounds[row.id];
      writeAll(state);
      throw bad(`Busted at ${row.crashPoint.toFixed(2)}x. The round crashed before your cash-out landed.`, 'bad_game');
    }
    const multiplier = Math.max(1, reached);
    const payout = (BigInt(row.betMicro) * BigInt(Math.round(multiplier * 100))) / 100n;
    adjust(state, steamId, payout);
    row.status = 'cashed';
    row.outcomeMicro = payout.toString();
    row.multiplier = multiplier;
    row.settledAt = new Date().toISOString();
    pushHistory(state, row);
    const view = publicRound(row);
    delete state.rounds[row.id];
    writeAll(state);
    return view;
  });
}

async function crashSettle(steamId, roundId) {
  return mutate(() => {
    const state = readAll();
    const row = state.rounds[String(roundId || '')];
    if (!row || row.steamId !== String(steamId) || row.game !== 'crash') throw bad('Round not found.', 'not_found');
    if (row.status !== 'live') throw bad('That round already settled.', 'bad_game');
    const elapsed = Date.now() - Date.parse(row.startedAt);
    const reached = multiplierAtMs(elapsed);
    if (reached < row.crashPoint) {
      throw bad('That round is still flying. Cash out or wait for the bust.', 'bad_game');
    }
    row.status = 'busted';
    row.outcomeMicro = '0';
    row.settledAt = new Date().toISOString();
    pushHistory(state, row);
    const view = publicRound(row);
    delete state.rounds[row.id];
    writeAll(state);
    return view;
  });
}

async function digStart(steamId, { bet, clientSeed } = {}) {
  const betMicro = parseBetTari(bet);
  if (!betMicro) throw bad('Bet between 0.1 and 10,000 tTARI.', 'bad_game');
  return mutate(() => {
    const state = readAll();
    // another tab (or an earlier visit) may already hold a live dig round:
    // resume it instead of erroring, so stale tabs can never wedge the game
    const existing = Object.values(state.rounds).find(
      (r) => r.steamId === String(steamId) && r.game === 'dig' && r.status === 'live'
    );
    if (existing) {
      return {
        roundId: existing.id,
        serverSeedHash: existing.serverSeedHash,
        cells: DIG_CELLS,
        mines: DIG_MINES,
        picked: existing.picked || [],
        resumed: true
      };
    }
    const row = newRoundCommon(state, steamId, 'dig', betMicro, clientSeed);
    row.mines = digMinesFrom(row.serverSeed, row.clientSeed, row.nonce);
    row.picked = [];
    writeAll(state);
    return { roundId: row.id, serverSeedHash: row.serverSeedHash, cells: DIG_CELLS, mines: DIG_MINES };
  });
}

async function digCell(steamId, roundId, cell) {
  const index = parseInt(cell, 10);
  return mutate(() => {
    const state = readAll();
    const row = state.rounds[String(roundId || '')];
    if (!row || row.steamId !== String(steamId) || row.game !== 'dig') {
      throw bad('That round already ended — rounds left open past 15 minutes are refunded automatically. Start a fresh one.', 'not_found');
    }
    if (row.status !== 'live') throw bad('That round already settled.', 'bad_game');
    if (!Number.isInteger(index) || index < 0 || index >= DIG_CELLS) throw bad('Pick a cell on the grid.', 'bad_game');
    if ((row.picked || []).includes(index)) throw bad('You already dug that cell.', 'bad_game');
    row.picked = [...(row.picked || []), index];
    if (row.mines.includes(index)) {
      row.status = 'busted';
      row.outcomeMicro = '0';
      row.settledAt = new Date().toISOString();
      pushHistory(state, row);
      const view = publicRound(row);
      delete state.rounds[row.id];
      writeAll(state);
      return { ...view, hit: index };
    }
    const safeLeft = DIG_CELLS - DIG_MINES - row.picked.length;
    if (safeLeft === 0) {
      // cleared the whole grid: auto cash out at full multiplier
      return finishDig(state, steamId, row);
    }
    writeAll(state);
    return publicRound(row);
  });
}

function finishDig(state, steamId, row) {
  const picks = (row.picked || []).length;
  const multiplier = digMultiplier(picks);
  const payout = (BigInt(row.betMicro) * BigInt(Math.round(multiplier * 100))) / 100n;
  adjust(state, steamId, payout);
  row.status = 'cashed';
  row.outcomeMicro = payout.toString();
  row.multiplier = multiplier;
  row.settledAt = new Date().toISOString();
  pushHistory(state, row);
  const view = publicRound(row);
  delete state.rounds[row.id];
  writeAll(state);
  return view;
}

async function digCashout(steamId, roundId) {
  return mutate(() => {
    const state = readAll();
    const row = state.rounds[String(roundId || '')];
    if (!row || row.steamId !== String(steamId) || row.game !== 'dig') {
      throw bad('That round already ended — rounds left open past 15 minutes are refunded automatically. Start a fresh one.', 'not_found');
    }
    if (row.status !== 'live') throw bad('That round already settled.', 'bad_game');
    if ((row.picked || []).length === 0) throw bad('Dig at least one safe cell first.', 'bad_game');
    return finishDig(state, steamId, row);
  });
}

/**
 * Sandbox dig: the testnet mirror of the main site's sandbox game. Pay a
 * fixed entry, dig a mound, and the prize is tTARI play balance instead of
 * items. Provably fair: the prize tier comes from HMAC(serverSeed,
 * clientSeed:nonce:sandbox) and the seed is revealed with the result. The
 * tier table returns ~95% over time (house edge covers nothing; this is
 * play money and just needs to feel honest).
 */
const SANDBOX_COST_MICRO = 25n * MICRO;

/** Pretend loot pool: real item names/images, weighted by market price. */
let lootCache = { at: 0, pool: [] };

async function lootPool() {
  if (lootCache.pool.length && Date.now() - lootCache.at < 10 * 60 * 1000) return lootCache.pool;
  try {
    const { catalogItems } = require('../itemCatalog');
    const rows = catalogItems();
    const pool = rows
      .filter((r) => r && r.name && Number(r.priceUsd) > 0)
      .map((r) => ({
        name: String(r.name),
        imageUrl: r.imageUrl || null,
        priceUsd: Number(r.priceUsd),
        typeLabel: r.typeLabel || null,
        rarityLabel: r.rarityLabel || null,
        weight: 1 / Math.max(0.05, Number(r.priceUsd))
      }));
    if (pool.length) lootCache = { at: Date.now(), pool };
    return pool;
  } catch (_) {
    return lootCache.pool || [];
  }
}

function pickWeighted(pool, r) {
  const total = pool.reduce((s, item) => s + item.weight, 0);
  let acc = r * total;
  for (const item of pool) {
    acc -= item.weight;
    if (acc <= 0) return item;
  }
  return pool[pool.length - 1];
}
const SANDBOX_TIERS = [
  { chance: 0.45, prizeMicro: 0n },
  { chance: 0.25, prizeMicro: 10n * MICRO },
  { chance: 0.15, prizeMicro: 20n * MICRO },
  { chance: 0.08, prizeMicro: 40n * MICRO },
  { chance: 0.05, prizeMicro: 100n * MICRO },
  { chance: 0.02, prizeMicro: 500n * MICRO }
];

function sandboxPrizeFrom(serverSeed, clientSeed, nonce) {
  const r = floatFromHex(hmacHex(serverSeed, `${clientSeed}:${nonce}:sandbox`));
  let acc = 0;
  for (const tier of SANDBOX_TIERS) {
    acc += tier.chance;
    if (r < acc) return tier.prizeMicro;
  }
  return 0n;
}

/** Credit the unified balance (faucet, external wins, migrations). */
async function creditBalance(steamId, tariAmount, kind = 'credit') {
  const micro = BigInt(Math.round(Number(tariAmount) * Number(MICRO)));
  if (!(micro > 0n)) throw bad('Enter an amount above 0.', 'bad_game');
  return mutate(() => {
    const state = readAll();
    adjust(state, steamId, micro);
    writeAll(state);
    return { tari: tari(balanceOf(state, steamId)), kind };
  });
}

/** The one balance the whole DApp shows for this user. */
async function unifiedBalance(steamId) {
  if (!steamId) throw bad('Sign in with Steam first.', 'forbidden');
  return mutate(() => {
    const state = readAll();
    settleStale(state, steamId, Date.now());
    writeAll(state);
    return {
      tari: tari(balanceOf(state, steamId)),
      stack: {
        starterTari: tari(STARTER_MICRO),
        refillBelowTari: tari(REFILL_BELOW_MICRO),
        nextRefillAt: nextRefillAt(state, steamId)
      }
    };
  });
}

/** Charge the sandbox arena entry (refunded on abandon). */
async function chargeSandboxEntry(steamId, tariAmount) {
  const micro = BigInt(Math.round(Number(tariAmount) * Number(MICRO)));
  return mutate(() => {
    const state = readAll();
    if (!adjust(state, steamId, -micro)) {
      throw bad(`Not enough tTARI. The dig costs ${tari(micro)} tTARI.`, 'bad_game');
    }
    writeAll(state);
    return { tari: tari(balanceOf(state, steamId)) };
  });
}

async function refundSandboxEntry(steamId, tariAmount) {
  const micro = BigInt(Math.round(Number(tariAmount) * Number(MICRO)));
  return mutate(() => {
    const state = readAll();
    adjust(state, steamId, micro);
    writeAll(state);
    return { tari: tari(balanceOf(state, steamId)) };
  });
}

/** One pretend item from the price-weighted catalog pool. */
async function rollPretendItem() {
  const pool = await lootPool();
  if (!pool.length) return null;
  const r = crypto.randomBytes(8).toString('hex');
  const v = parseInt(r.slice(0, 13), 16) / Math.pow(2, 52);
  const total = pool.reduce((s, item) => s + item.weight, 0);
  let acc = v * total;
  for (const item of pool) {
    acc -= item.weight;
    if (acc <= 0) return item;
  }
  return pool[pool.length - 1];
}

async function sandboxPlay(steamId) {
  if (!steamId) throw bad('Sign in with Steam first.', 'forbidden');
  // the pretend item pool comes from the economy snapshot (cached); load it
  // before taking the store lock
  const pool = await lootPool();
  return mutate(() => {
    const state = readAll();
    if (!adjust(state, steamId, -SANDBOX_COST_MICRO)) {
      throw bad(`Not enough tTARI. The dig costs ${tari(SANDBOX_COST_MICRO)} tTARI.`, 'bad_game');
    }
    const key = String(steamId);
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const clientSeed = 'sandbox';
    const nonce = (state.stackClaims[key] && state.stackClaims[key].nonce || 0) + 1;
    state.stackClaims[key] = { ...(state.stackClaims[key] || {}), nonce };
    const prizeMicro = sandboxPrizeFrom(serverSeed, clientSeed, nonce);
    if (prizeMicro > 0n) adjust(state, steamId, prizeMicro);
    // the pretend item: real catalog entry, odds weighted by market price
    const item = pool.length
      ? pickWeighted(pool, floatFromHex(hmacHex(serverSeed, `${clientSeed}:${nonce}:loot`)))
      : null;
    const row = {
      game: 'sandbox',
      steamId: key,
      betMicro: SANDBOX_COST_MICRO.toString(),
      outcomeMicro: prizeMicro.toString(),
      status: prizeMicro > 0n ? 'cashed' : 'busted',
      serverSeed,
      serverSeedHash: sha256(serverSeed),
      clientSeed,
      nonce,
      multiplier: Number((prizeMicro * 100n) / SANDBOX_COST_MICRO) / 100,
      at: new Date().toISOString()
    };
    pushHistory(state, row);
    writeAll(state);
    return {
      costTari: tari(SANDBOX_COST_MICRO),
      prizeTari: tari(prizeMicro),
      tari: tari(balanceOf(state, steamId)),
      item: item ? {
        name: item.name,
        imageUrl: item.imageUrl,
        priceUsd: item.priceUsd,
        typeLabel: item.typeLabel,
        rarityLabel: item.rarityLabel
      } : null,
      serverSeed,
      serverSeedHash: row.serverSeedHash,
      nonce
    };
  });
}

/**
 * Multiplayer arena ops (crashArena.js): shared-round bets on the same
 * play ledger. The arena tracks the live multipliers; these functions only
 * move balance and record history.
 */
async function placeCrashArenaBet(steamId, betTari, roundId) {
  const betMicro = parseBetTari(betTari);
  if (!betMicro) throw bad('Bet between 0.1 and 10,000 tTARI.', 'bad_game');
  return mutate(() => {
    const state = readAll();
    if (!adjust(state, steamId, -betMicro)) {
      throw bad(`Not enough tTARI. Your stack is ${tari(balanceOf(state, steamId))}. Claim a refill first.`, 'bad_game');
    }
    pushHistory(state, {
      game: 'crash-arena',
      steamId: String(steamId),
      betMicro: betMicro.toString(),
      outcomeMicro: '0',
      status: 'pending',
      roundId: String(roundId || ''),
      multiplier: null,
      serverSeed: null,
      clientSeed: null,
      nonce: null,
      at: new Date().toISOString()
    });
    writeAll(state);
    return { betMicro: betMicro.toString(), betTari: tari(betMicro), tari: tari(balanceOf(state, steamId)) };
  });
}

async function settleCrashArenaCashout(steamId, roundId, multiplier, crashPoint) {
  const m = Number(multiplier) || 0;
  if (!(m >= 1)) throw bad('That cash-out could not be priced.', 'bad_game');
  if (Number(crashPoint) && m >= Number(crashPoint)) {
    throw bad(`Busted at ${Number(crashPoint).toFixed(2)}x before your cash-out landed.`, 'bad_game');
  }
  return mutate(() => {
    const state = readAll();
    const key = String(steamId);
    const row = state.history.find((r) => r.steamId === key && r.roundId === String(roundId) && r.status === 'pending');
    if (!row) throw bad('No live bet found for this round.', 'bad_game');
    const payout = (BigInt(row.betMicro) * BigInt(Math.round(m * 100))) / 100n;
    adjust(state, steamId, payout);
    row.status = 'cashed';
    row.outcomeMicro = payout.toString();
    row.multiplier = Math.round(m * 100) / 100;
    writeAll(state);
    return { multiplier: row.multiplier, outcomeTari: tari(payout), tari: tari(balanceOf(state, steamId)) };
  });
}

async function settleCrashArenaBust(steamIds, roundId) {
  const ids = new Set((steamIds || []).map(String));
  return mutate(() => {
    const state = readAll();
    for (const row of state.history) {
      if (row.status === 'pending' && row.roundId === String(roundId) && ids.has(row.steamId)) {
        row.status = 'busted';
        row.outcomeMicro = '0';
      }
    }
    writeAll(state);
    return { settled: ids.size };
  });
}

/**
 * Shielded vault. Shielding moves tTARI out of the revealed (spendable)
 * balance into one of two instruments:
 *  - stealth: a hidden amount at the wallet's address (any amount, 0.1+)
 *  - voucher: fixed 1/10/100/1,000 bearer vouchers (whole tTARI only; the
 *    deposit into the pool is public, what happens to the vouchers after is
 *    not — they live in this ledger, never on chain)
 * Games and predictions spend the revealed balance only, so shielded value
 * is locked away until unshielded — the whole point of shielding.
 */
function vaultOf(state, steamId) {
  const row = state.vaults[String(steamId)];
  return {
    stealthMicro: BigInt(row && row.stealthMicro || '0'),
    vouchers: { 1000: 0, 100: 0, 10: 0, 1: 0, ...((row && row.vouchers) || {}) },
    events: Array.isArray(row && row.events) ? row.events : []
  };
}

function voucherMicro(vouchers) {
  let micro = 0n;
  for (const denom of VAULT_DENOMS) {
    const count = Number(vouchers[denom] || 0);
    if (!Number.isInteger(count) || count < 0) return null;
    micro += BigInt(denom) * MICRO * BigInt(count);
  }
  return micro;
}

function vaultViewRow(state, steamId) {
  const vault = vaultOf(state, steamId);
  const vMicro = voucherMicro(vault.vouchers) || 0n;
  return {
    stealthTari: tari(vault.stealthMicro),
    voucherTari: tari(vMicro),
    totalTari: tari(vault.stealthMicro + vMicro),
    vouchers: {
      '1000': Number(vault.vouchers[1000] || 0),
      '100': Number(vault.vouchers[100] || 0),
      '10': Number(vault.vouchers[10] || 0),
      '1': Number(vault.vouchers[1] || 0)
    },
    events: vault.events.slice(0, 12)
  };
}

function vaultEvent(direction, instrument, tariAmount, extra = {}) {
  return {
    id: crypto.randomBytes(6).toString('hex'),
    direction,
    instrument,
    tari: tariAmount,
    at: new Date().toISOString(),
    onChain: false,
    txid: null,
    ...extra
  };
}

function parseShieldAmount(raw, { wholeOnly } = {}) {
  const text = String(raw == null ? '' : raw).trim();
  const pattern = wholeOnly ? /^\d+$/ : /^\d+(\.\d{1,6})?$/;
  if (!pattern.test(text)) {
    throw bad(wholeOnly
      ? 'Vouchers come in whole tTARI. Enter an amount like 57.'
      : 'Enter an amount above 0, with up to 6 decimals.', 'bad_game');
  }
  const [whole, frac = ''] = text.split('.');
  const micro = BigInt(whole) * MICRO + BigInt((frac + '000000').slice(0, 6));
  const minMicro = wholeOnly ? MICRO : MICRO / 10n;
  if (micro < minMicro) {
    throw bad(wholeOnly ? 'Shield at least 1 tTARI into vouchers.' : 'Shield at least 0.1 tTARI.', 'bad_game');
  }
  if (micro > MAX_SHIELD_MICRO) throw bad('Shield at most 1,000,000 tTARI at a time.', 'bad_game');
  return { micro, wholeTari: BigInt(whole) };
}

async function shield(steamId, { instrument, amount, address } = {}) {
  if (!steamId) throw bad('Sign in with Steam first.', 'forbidden');
  if (instrument !== 'stealth' && instrument !== 'voucher') {
    throw bad('Choose stealth tTARI or vouchers.', 'bad_game');
  }
  const { micro, wholeTari } = parseShieldAmount(amount, { wholeOnly: instrument === 'voucher' });
  return mutate(() => {
    const state = readAll();
    const key = String(steamId);
    settleStale(state, key, Date.now());
    if (!adjust(state, key, -micro)) {
      throw bad(`Not enough revealed tTARI. Your spendable stack is ${tari(balanceOf(state, key))}.`, 'bad_game');
    }
    const vault = vaultOf(state, key);
    const store = {
      stealthMicro: vault.stealthMicro.toString(),
      vouchers: { ...vault.vouchers },
      events: vault.events
    };
    const event = vaultEvent('shield', instrument, tari(micro), address ? { address: String(address).slice(0, 250) } : {});
    if (instrument === 'stealth') {
      store.stealthMicro = (vault.stealthMicro + micro).toString();
    } else {
      let rest = wholeTari;
      for (const denom of VAULT_DENOMS) {
        const d = BigInt(denom);
        store.vouchers[denom] = Number(vault.vouchers[denom] || 0) + Number(rest / d);
        rest %= d;
      }
    }
    store.events = [event, ...store.events].slice(0, 40);
    state.vaults[key] = store;
    writeAll(state);
    return {
      event: event.id,
      movedTari: tari(micro),
      tari: tari(balanceOf(state, key)),
      vault: vaultViewRow(state, key)
    };
  });
}

async function unshield(steamId, { instrument, amount, vouchers } = {}) {
  if (!steamId) throw bad('Sign in with Steam first.', 'forbidden');
  if (instrument !== 'stealth' && instrument !== 'voucher') {
    throw bad('Choose stealth tTARI or vouchers.', 'bad_game');
  }
  const microIn = instrument === 'stealth' ? parseShieldAmount(amount, { wholeOnly: false }).micro : null;
  return mutate(() => {
    const state = readAll();
    const key = String(steamId);
    const vault = vaultOf(state, key);
    const store = {
      stealthMicro: vault.stealthMicro.toString(),
      vouchers: { ...vault.vouchers },
      events: vault.events
    };
    let micro;
    let event;
    if (instrument === 'stealth') {
      if (microIn > vault.stealthMicro) {
        throw bad(`You have ${tari(vault.stealthMicro)} tTARI shielded as stealth.`, 'bad_game');
      }
      store.stealthMicro = (vault.stealthMicro - microIn).toString();
      micro = microIn;
      event = vaultEvent('unshield', 'stealth', tari(microIn));
    } else {
      const picks = vouchers && typeof vouchers === 'object' ? vouchers : {};
      const clean = {};
      for (const denom of VAULT_DENOMS) {
        const want = Number(picks[String(denom)] || picks[denom] || 0);
        if (!Number.isInteger(want) || want < 0) throw bad('Pick whole vouchers to redeem.', 'bad_game');
        if (want > Number(vault.vouchers[denom] || 0)) {
          throw bad(`You hold ${vault.vouchers[denom] || 0} vouchers of ${denom} tTARI.`, 'bad_game');
        }
        clean[denom] = want;
      }
      micro = voucherMicro(clean);
      if (!micro || micro <= 0n) throw bad('Pick at least one voucher to redeem.', 'bad_game');
      for (const denom of VAULT_DENOMS) {
        store.vouchers[denom] = Number(vault.vouchers[denom] || 0) - clean[denom];
      }
      event = vaultEvent('unshield', 'voucher', tari(micro), { redeemed: clean });
    }
    adjust(state, key, micro);
    store.events = [event, ...store.events].slice(0, 40);
    state.vaults[key] = store;
    writeAll(state);
    return {
      event: event.id,
      movedTari: tari(micro),
      tari: tari(balanceOf(state, key)),
      vault: vaultViewRow(state, key)
    };
  });
}

async function vaultView(steamId) {
  if (!steamId) throw bad('Sign in with Steam first.', 'forbidden');
  return mutate(() => vaultViewRow(readAll(), steamId));
}

/** Attach (or repair) the wallet address on a vault event, for leg retries. */
async function attachEventAddress(steamId, eventId, address) {
  const clean = String(address || '').trim();
  if (!steamId || !eventId || !clean.startsWith('otl_esm_')) return { attached: false };
  return mutate(() => {
    const state = readAll();
    const key = String(steamId);
    const vault = vaultOf(state, key);
    const event = vault.events.find((e) => e && e.id === String(eventId));
    if (!event) return { attached: false };
    event.address = clean.slice(0, 250);
    state.vaults[key] = {
      stealthMicro: vault.stealthMicro.toString(),
      vouchers: { ...vault.vouchers },
      events: vault.events
    };
    writeAll(state);
    return { attached: true };
  });
}

/** Recent shield/unshield events whose on-chain leg never fired (for retries). */
async function pendingLegEvents({ maxAgeMs = 24 * 60 * 60 * 1000, limit = 10 } = {}) {
  return mutate(() => {
    const state = readAll();
    const cutoff = Date.now() - maxAgeMs;
    const out = [];
    for (const [key, row] of Object.entries(state.vaults)) {
      for (const event of (row && row.events) || []) {
        if (out.length >= limit) break;
        if (!event || event.txid || event.legRejected) continue;
        if (event.direction !== 'shield' && event.direction !== 'unshield') continue;
        if (Date.parse(event.at || 0) < cutoff) continue;
        out.push({ steamId: key, event });
      }
    }
    return out;
  });
}

/** Flip vault events whose on-chain leg was REJECTED back to ledger-only. */
async function reconcileVaultEvents(steamId, rejectedTxids) {
  const rejected = new Set((rejectedTxids || []).map(String));
  if (!steamId || !rejected.size) return { reconciled: 0 };
  return mutate(() => {
    const state = readAll();
    const key = String(steamId);
    const vault = vaultOf(state, key);
    let changed = 0;
    for (const event of vault.events) {
      if (event && event.onChain && event.txid && rejected.has(String(event.txid))) {
        // keep the txid — it is still the hash of the submitted transaction;
        // only the on-chain claim flips
        event.onChain = false;
        event.legRejected = true;
        changed += 1;
      }
    }
    if (!changed) return { reconciled: 0 };
    state.vaults[key] = {
      stealthMicro: vault.stealthMicro.toString(),
      vouchers: { ...vault.vouchers },
      events: vault.events
    };
    writeAll(state);
    return { reconciled: changed };
  });
}

/** Stamp an on-chain txid onto a vault event once the escrow leg lands. */
async function markVaultEvent(steamId, eventId, { onChain, txid } = {}) {
  if (!steamId || !eventId) return { marked: false };
  return mutate(() => {
    const state = readAll();
    const vault = vaultOf(state, steamId);
    const event = vault.events.find((e) => e && e.id === String(eventId));
    if (!event) return { marked: false };
    event.onChain = Boolean(onChain);
    event.txid = txid ? String(txid) : null;
    state.vaults[String(steamId)] = {
      stealthMicro: vault.stealthMicro.toString(),
      vouchers: { ...vault.vouchers },
      events: vault.events
    };
    writeAll(state);
    return { marked: true };
  });
}

/** Hold tTARI inside an escrow-demo contract (returned or paid out at settle). */
async function holdEscrow(steamId, tariAmount) {
  const micro = BigInt(Math.round(Number(tariAmount) * Number(MICRO)));
  if (!(micro > 0n)) throw bad('Enter an amount above 0.', 'bad_game');
  return mutate(() => {
    const state = readAll();
    if (!adjust(state, steamId, -micro)) {
      throw bad(`Not enough revealed tTARI. Your stack is ${tari(balanceOf(state, steamId))}.`, 'bad_game');
    }
    writeAll(state);
    return { tari: tari(balanceOf(state, steamId)) };
  });
}

/** Claw back a ledger credit (prediction reopen reversals). */
async function chargeStake(steamId, tariAmount) {
  const micro = BigInt(Math.round(Number(tariAmount) * Number(MICRO)));
  return mutate(() => {
    const state = readAll();
    if (!adjust(state, steamId, -micro)) {
      throw bad(`Not enough revealed tTARI. Your stack is ${tari(balanceOf(state, steamId))}.`, 'bad_game');
    }
    writeAll(state);
    return { tari: tari(balanceOf(state, steamId)) };
  });
}

/** Credit tTARI back out of an escrow-demo contract (refund). */
async function releaseEscrow(steamId, tariAmount) {
  const micro = BigInt(Math.round(Number(tariAmount) * Number(MICRO)));
  return mutate(() => {
    const state = readAll();
    adjust(state, steamId, micro);
    writeAll(state);
    return { tari: tari(balanceOf(state, steamId)) };
  });
}

module.exports = {
  stateView,
  claimStack,
  sandboxPlay,
  crashBet,
  crashCashout,
  crashSettle,
  digStart,
  digCell,
  digCashout,
  multiplierAtMs,
  placeCrashArenaBet,
  settleCrashArenaCashout,
  settleCrashArenaBust,
  chargeSandboxEntry,
  refundSandboxEntry,
  rollPretendItem,
  creditBalance,
  unifiedBalance,
  holdEscrow,
  releaseEscrow,
  chargeStake,
  shield,
  unshield,
  vaultView,
  markVaultEvent,
  reconcileVaultEvents,
  pendingLegEvents,
  attachEventAddress,
  VAULT_DENOMS
};

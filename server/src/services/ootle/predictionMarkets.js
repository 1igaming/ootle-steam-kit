/**
 * Admin-managed prediction markets with real tTARI stakes, Kalshi style.
 * A pick locks a tTARI amount against the user's wallet address; the two
 * sides form a parimutuel pool. When the admin resolves the market, the
 * winning side splits the losing side's tTARI in proportion to stake, and
 * the payouts are paid as real transfers from the Esmeralda escrow account
 * to each winner's otl_esm_ address (same stealth-transfer rail the sealed
 * trades use).
 *
 * Store: data/ootle/prediction-markets.json. Node 18, no native deps.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_DIR = process.env.DAPP_DATA_DIR
  ? path.join(process.env.DAPP_DATA_DIR, 'ootle')
  : path.join(__dirname, '../../../data/ootle');
const STORE_FILE = path.join(STORE_DIR, 'prediction-markets.json');

const MAX_OPEN_MARKETS = 50;
const MAX_QUESTION_LEN = 180;
const VALID_SIDES = new Set(['yes', 'no']);
const VALID_STATUSES = new Set(['open', 'closed', 'resolved']);
const MICRO_PER_TARI = 1000000n;
const MIN_STAKE_MICRO = MICRO_PER_TARI; // 1 tTARI
const MAX_STAKE_MICRO = 100000n * MICRO_PER_TARI; // 100,000 tTARI

/**
 * Seed questions stay away from item price targets on purpose: the item
 * market is thin right now, so a price market is easy to nudge. Community,
 * game, and site milestones make honest yes/no questions instead.
 */
const SEED_MARKETS = [
  { id: 'tari-mainnet-launch', question: 'Will Tari mainnet launch on schedule in November 2026?', category: 'network' },
  { id: 'esmeralda-milestone', question: 'Will the Esmeralda testnet pass 1,000,000 blocks this quarter?', category: 'network' },
  { id: 'steam-stealth-trades', question: 'Will privacy-preserving Steam item escrows expand to CS2?', category: 'gaming' },
  { id: 'sealed-alpha-exit-2027', question: 'Will sealed trades leave testnet alpha before 2027?', category: 'dapp' }
];

let chain = Promise.resolve();

function mutate(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

function readAll() {
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.markets)) return { markets: [] };
    return parsed;
  } catch (err) {
    if (err && err.code === 'ENOENT') return { markets: [] };
    throw err;
  }
}

function writeAll(state) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const tmp = `${STORE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

function seedIfEmpty() {
  return mutate(() => {
    const state = readAll();
    if (state.markets.length > 0) return state;
    const now = Date.now();
    state.markets = SEED_MARKETS.map((row) => ({
      id: row.id,
      question: row.question,
      category: row.category || 'community',
      createdAt: new Date(now).toISOString(),
      createdBy: 'seed',
      closesAt: null,
      status: 'open',
      outcome: null,
      picks: {},
      payouts: []
    }));
    writeAll(state);
    return state;
  });
}

function tari(micro) {
  return Number(BigInt(micro || '0')) / Number(MICRO_PER_TARI);
}

function publicMarket(row, steamId) {
  const picks = Object.entries(row.picks || {});
  let yes = 0;
  let no = 0;
  let yesStake = 0n;
  let noStake = 0n;
  for (const [, pick] of picks) {
    const stake = BigInt(pick && pick.stakeMicro || '0');
    if (pick && pick.side === 'yes') { yes += 1; yesStake += stake; }
    else if (pick && pick.side === 'no') { no += 1; noStake += stake; }
  }
  const mine = steamId ? row.picks && row.picks[String(steamId)] : null;
  const payouts = Array.isArray(row.payouts) ? row.payouts : [];
  // latest pickers first, for the avatar stack on the market cards
  const recentPicks = picks
    .filter(([, pick]) => pick && pick.at)
    .sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at))
    .slice(0, 5)
    .map(([sid, pick]) => ({ steamId: String(sid), side: pick.side === 'yes' ? 'yes' : 'no', at: pick.at }));
  return {
    id: row.id,
    question: row.question,
    category: row.category || '',
    createdAt: row.createdAt,
    closesAt: row.closesAt || null,
    status: row.status,
    outcome: row.outcome || null,
    yes,
    no,
    total: yes + no,
    yesStake: tari(yesStake),
    noStake: tari(noStake),
    pot: tari(yesStake + noStake),
    mySide: mine ? mine.side : null,
    myStake: mine ? tari(mine.stakeMicro) : null,
    myPickedAt: mine ? mine.at || null : null,
    recentPicks,
    payoutsQueued: payouts.filter((p) => p.status === 'queued').length,
    payoutsPaidTari: payouts.filter((p) => p.status === 'paid').reduce((sum, p) => sum + tari(p.payoutMicro), 0)
  };
}

let personaCache = { at: 0, map: new Map() };

/**
 * Resolve Steam personas (avatar + display name) for the market cards'
 * recent-picker stacks. Best-effort: without the users store the stacks
 * fall back to initials, and a 5-minute cache keeps this off the hot path.
 */
async function resolvePersonas(steamIds) {
  const ids = [...new Set(steamIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const now = Date.now();
  if (now - personaCache.at < 5 * 60 * 1000 && ids.every((id) => personaCache.map.has(String(id)))) {
    return personaCache.map;
  }
  const map = new Map(personaCache.map);
  try {
    const { getLocalDb } = require('../../config/database');
    const db = await getLocalDb();
    await Promise.all(ids.map(async (id) => {
      if (map.has(String(id))) return;
      const doc = await db.collection('users').doc(String(id)).get().catch(() => null);
      const user = doc && doc.exists ? doc.data() : null;
      if (user) {
        map.set(String(id), {
          name: user.displayName || user.personaname || user.username || 'Trader',
          avatar: user.avatar || user.avatarMedium || user.avatarFull || ''
        });
      }
    }));
    personaCache = { at: now, map };
  } catch (_) {
    // stacks render with initials; nothing else changes
  }
  return map;
}

function findMarket(state, id) {
  return state.markets.find((row) => row.id === String(id || '')) || null;
}

function validClosesAt(value) {
  if (value == null || value === '') return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return undefined; // invalid
  return new Date(ms).toISOString();
}

/** Parse a tTARI stake into micro; null when invalid. */
function parseStakeMicro(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(text) || Number(text) <= 0) return null;
  const [whole, frac = ''] = text.split('.');
  const micro = BigInt(whole) * MICRO_PER_TARI + BigInt((frac + '000000').slice(0, 6));
  if (micro < MIN_STAKE_MICRO || micro > MAX_STAKE_MICRO) return null;
  return micro;
}

async function listMarkets(steamId) {
  const state = await seedIfEmpty();
  const rows = state.markets.map((row) => publicMarket(row, steamId));
  // attach personas to the recent-picker stacks (best-effort)
  const personas = await resolvePersonas(rows.flatMap((row) => (row.recentPicks || []).map((p) => p.steamId)));
  for (const row of rows) {
    row.recentPickers = (row.recentPicks || []).map((p) => {
      const who = personas.get(String(p.steamId));
      return { ...p, name: who ? who.name : 'Trader', avatar: who ? who.avatar : '' };
    });
    delete row.recentPicks;
  }
  return rows;
}

async function createMarket({ question, category, closesAt, createdBy }) {
  const cleanQuestion = String(question || '').trim().replace(/\s+/g, ' ').slice(0, MAX_QUESTION_LEN);
  if (cleanQuestion.length < 8) {
    const err = new Error('The question needs at least 8 characters.');
    err.code = 'bad_market';
    throw err;
  }
  if (!/\?/.test(cleanQuestion)) {
    const err = new Error('The question needs to be answerable with Yes or No, so end it with a question mark.');
    err.code = 'bad_market';
    throw err;
  }
  const close = validClosesAt(closesAt);
  if (close === undefined) {
    const err = new Error('That close date could not be read.');
    err.code = 'bad_market';
    throw err;
  }
  const cleanCategory = String(category || '').trim().replace(/\s+/g, ' ').slice(0, 40) || 'community';
  return mutate(() => {
    const state = readAll();
    if (state.markets.filter((row) => row.status === 'open').length >= MAX_OPEN_MARKETS) {
      const err = new Error('Close some open markets first; too many are open.');
      err.code = 'bad_market';
      throw err;
    }
    const market = {
      id: crypto.randomBytes(8).toString('hex'),
      question: cleanQuestion,
      category: cleanCategory,
      createdAt: new Date().toISOString(),
      createdBy: String(createdBy || 'admin'),
      closesAt: close,
      status: 'open',
      outcome: null,
      picks: {},
      payouts: []
    };
    state.markets.unshift(market);
    writeAll(state);
    return publicMarket(market);
  });
}

/**
 * Parimutuel settlement: each winner gets the stake back plus a share of
 * the losing pool proportional to their stake. With no losing side the
 * stakes are simply refunded. Runs at resolve time and only writes payout
 * records; real transfers happen in payWinners.
 */
function settlePayouts(row, outcome) {
  const picks = Object.entries(row.picks || {});
  const winners = picks.filter(([, p]) => p && p.side === outcome);
  const losers = picks.filter(([, p]) => p && p.side !== outcome);
  let loserMicro = 0n;
  for (const [, p] of losers) loserMicro += BigInt(p && p.stakeMicro || '0');
  let winnerMicro = 0n;
  for (const [, p] of winners) winnerMicro += BigInt(p && p.stakeMicro || '0');

  const payouts = [];
  for (const [steamId, p] of winners) {
    const stake = BigInt(p.stakeMicro || '0');
    let payout = stake;
    if (winnerMicro > 0n && loserMicro > 0n) {
      payout = stake + (stake * loserMicro) / winnerMicro;
    }
    payouts.push({
      steamId,
      address: p.address || '',
      side: p.side,
      stakeMicro: stake.toString(),
      payoutMicro: payout.toString(),
      status: 'queued',
      txid: null,
      at: new Date().toISOString()
    });
  }
  return payouts;
}

async function setMarketStatus(id, { status, outcome }) {
  const nextStatus = String(status || '').trim();
  if (!VALID_STATUSES.has(nextStatus)) {
    const err = new Error('That status is not one of open, closed, or resolved.');
    err.code = 'bad_market';
    throw err;
  }
  let nextOutcome = null;
  if (nextStatus === 'resolved') {
    nextOutcome = String(outcome || '').trim().toLowerCase();
    if (!VALID_SIDES.has(nextOutcome)) {
      const err = new Error('Resolve with an outcome of yes or no.');
      err.code = 'bad_market';
      throw err;
    }
  }
  return mutate(async () => {
    const state = readAll();
    const row = findMarket(state, id);
    if (!row) {
      const err = new Error('Market not found');
      err.code = 'not_found';
      throw err;
    }
    const games = require('./games');
    if (nextStatus !== 'resolved' && row.status === 'resolved') {
      // reopening a bad resolve: every pick SURVIVES with its stake locked,
      // so the payout run is reversed in full — winners were credited
      // stake + share at resolve time and all of it comes back out. Losers'
      // stakes were debited at pick time and stay locked; nothing to undo.
      for (const payout of row.payouts || []) {
        // only claw back payouts this ledger actually credited (legacy
        // markets paid winners with real transfers, never on the ledger)
        if (!payout.ledgerCredited) continue;
        const payoutMicro = BigInt(payout.payoutMicro || '0');
        if (payoutMicro > 0n) {
          await games.chargeStake(payout.steamId, tari(payoutMicro)).catch(() => {});
        }
      }
      row.payouts = [];
      row.outcome = null;
    }
    row.status = nextStatus;
    row.outcome = nextStatus === 'resolved' ? nextOutcome : null;
    if (nextStatus === 'resolved') {
      row.payouts = settlePayouts(row, nextOutcome);
      // the ledger IS the payout: winners are credited the moment the
      // market resolves; the admin Pay-winners button only adds the real
      // on-chain mirror transfers
      for (const payout of row.payouts) {
        await games.creditBalance(payout.steamId, tari(payout.payoutMicro), 'market-payout').catch(() => {});
        payout.status = 'paid';
        payout.ledgerCredited = true;
      }
    }
    writeAll(state);
    return publicMarket(row);
  });
}

async function deleteMarket(id) {
  return mutate(() => {
    const state = readAll();
    const row = findMarket(state, id);
    if (!row) {
      const err = new Error('Market not found');
      err.code = 'not_found';
      throw err;
    }
    if (Object.keys(row.picks || {}).length > 0) {
      const err = new Error('That market already has locked stakes, so resolve it instead of deleting it.');
      err.code = 'bad_market';
      throw err;
    }
    state.markets = state.markets.filter((m) => m.id !== row.id);
    writeAll(state);
    return { id: row.id, deleted: true };
  });
}

async function pickSide({ marketId, steamId, side, address, stake }) {
  const cleanSide = String(side || '').trim().toLowerCase();
  if (!VALID_SIDES.has(cleanSide)) {
    const err = new Error('Pick Yes or No.');
    err.code = 'bad_pick';
    throw err;
  }
  const stakeMicro = parseStakeMicro(stake);
  if (!stakeMicro) {
    const err = new Error('Lock between 1 and 100,000 tTARI, with up to 6 decimals.');
    err.code = 'bad_pick';
    throw err;
  }
  const cleanAddress = String(address || '').trim().slice(0, 64);
  return mutate(() => {
    const state = readAll();
    const row = findMarket(state, marketId);
    if (!row) {
      const err = new Error('Market not found');
      err.code = 'not_found';
      throw err;
    }
    if (row.status !== 'open') {
      const err = new Error(row.status === 'resolved' ? 'That market is already resolved.' : 'That market is closed.');
      err.code = 'bad_pick';
      throw err;
    }
    if (row.closesAt && Date.parse(row.closesAt) <= Date.now()) {
      const err = new Error('That market has passed its close date.');
      err.code = 'bad_pick';
      throw err;
    }
    const key = String(steamId);
    row.picks = row.picks || {};
    if (row.picks[key]) {
      const err = new Error(`You already locked ${tari(row.picks[key].stakeMicro)} tTARI on ${row.picks[key].side === 'yes' ? 'Yes' : 'No'} here.`);
      err.code = 'bad_pick';
      throw err;
    }
    row.picks[key] = {
      side: cleanSide,
      stakeMicro: stakeMicro.toString(),
      address: cleanAddress || '',
      at: new Date().toISOString()
    };
    writeAll(state);
    return publicMarket(row, steamId);
  });
}

/**
 * Locking a stake must move real tTARI out of the revealed balance, exactly
 * like shielding or an escrow hold — a pick that cannot be covered is not a
 * pick. The hold is rolled back if the market write then fails.
 */
async function pickSideWithStake(args) {
  const { steamId, stake } = args;
  const stakeMicro = parseStakeMicro(stake);
  if (!stakeMicro) {
    const err = new Error('Lock between 1 and 100,000 tTARI, with up to 6 decimals.');
    err.code = 'bad_pick';
    throw err;
  }
  // surface "already picked" before "insufficient balance" when both apply
  const mine = (await listMarkets(steamId)).find((row) => row.id === String(args.marketId || ''));
  if (mine && mine.mySide) {
    const err = new Error(`You already locked ${mine.myStake} tTARI on ${mine.mySide === 'yes' ? 'Yes' : 'No'} here.`);
    err.code = 'bad_pick';
    throw err;
  }
  const games = require('./games');
  await games.holdEscrow(String(steamId), tari(stakeMicro));
  try {
    return await pickSide(args);
  } catch (err) {
    await games.releaseEscrow(String(steamId), tari(stakeMicro)).catch(() => {});
    throw err;
  }
}

/**
 * The on-chain mirror of payouts: winners are already credited on the
 * ledger at resolve time, so this sends the real stealth transfers from the
 * Esmeralda escrow for every winner with an address and stamps the txid.
 * Picks without an address are marked needs_address.
 */
async function payWinners(marketId) {
  const { liveWalletd } = require('./walletdClient');
  const { stealthTransferParams } = require('./withdrawals');
  const walletd = liveWalletd();
  return mutate(async () => {
    const state = readAll();
    const row = findMarket(state, marketId);
    if (!row) {
      const err = new Error('Market not found');
      err.code = 'not_found';
      throw err;
    }
    if (row.status !== 'resolved') {
      const err = new Error('Resolve the market before paying winners.');
      err.code = 'bad_market';
      throw err;
    }
    let paid = 0;
    let failed = 0;
    let skipped = 0;
    for (const payout of row.payouts || []) {
      if (payout.txid) continue; // mirror transfer already sent
      if (!payout.address || !String(payout.address).startsWith('otl_esm_')) {
        payout.status = 'needs_address';
        skipped += 1;
        continue;
      }
      try {
        const params = stealthTransferParams({
          accountName: 'dapp-escrow',
          address: payout.address,
          amount: BigInt(payout.payoutMicro),
          maxFee: 100000n
        });
        const sent = await walletd.stealthTransfer(params);
        const txid = sent && (sent.transaction_id || sent.transactionId);
        if (!txid) throw new Error('walletd did not return a transaction id');
        payout.txid = String(txid);
        payout.status = 'paid';
        payout.paidAt = new Date().toISOString();
        paid += 1;
      } catch (err) {
        payout.status = 'failed';
        payout.error = String((err && err.message) || 'transfer failed').slice(0, 200);
        failed += 1;
      }
      writeAll(state);
    }
    return {
      id: row.id,
      paid,
      failed,
      skipped,
      payouts: (row.payouts || []).map((p) => ({ steamId: p.steamId, status: p.status, txid: p.txid }))
    };
  });
}

module.exports = {
  listMarkets,
  createMarket,
  setMarketStatus,
  deleteMarket,
  pickSide: pickSideWithStake,
  payWinners
};

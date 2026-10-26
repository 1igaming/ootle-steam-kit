/**
 * Multiplayer tTARI crash: everyone rides the same round, bets during the
 * betting phase, the multiplier climbs bustabit-style (max(0.01, m * 0.01)
 * per 100ms tick), and the round busts at a provably fair crash point.
 * Chat rides the same socket namespace.
 *
 * Provably fair: the server seed for the NEXT round is committed (hashed)
 * when that round opens, and revealed when it busts. crash = floor of the
 * classic 1% edge distribution from HMAC(seed, roundId).
 *
 * Balances are the tTARI play stacks from games.js (testnet only). No real
 * items, no on-chain settlement while the alpha runs.
 */

const crypto = require('crypto');
const games = require('./games');

const TICK_MS = 100;
const BETTING_MS = 8000;
const PAUSE_MS = 4000;
const MAX_ROUND_MS = 60000;
const HOUSE_EDGE = 0.01;

let io = null;
let started = false;

const state = {
  phase: 'idle', // betting | flying | busted | paused
  roundId: null,
  serverSeed: null,
  serverSeedHash: null,
  crashPoint: null,
  openedAt: 0,
  startedAt: 0,
  bustedAt: 0,
  multiplier: 1,
  bets: new Map(), // steamId -> { steamId, displayName, avatar, betMicro, cashedAt: multiplier | null, status }
  history: [], // { roundId, crashPoint, serverSeed, at }
  chat: [] // { id, steamId, displayName, avatar, message, at }
};

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function hmacFloat(seed, roundId) {
  const hex = crypto.createHmac('sha256', String(seed)).update(String(roundId)).digest('hex');
  return parseInt(hex.slice(0, 13), 16) / Math.pow(2, 52);
}

function crashPointFor(serverSeed, roundId) {
  const r = hmacFloat(serverSeed, roundId);
  if (r < HOUSE_EDGE) return 1;
  const raw = 1 / (1 - r);
  return Math.min(100, Math.floor(raw * 100) / 100);
}

function tickMultiplier(elapsedMs) {
  // bustabit growth, integrated: with 100ms ticks adding max(0.01, m*0.01)
  // the multiplier follows ~1.0001^(ms) early and compounds later; we
  // replicate the discrete loop cheaply from elapsed ticks.
  let m = 1;
  const ticks = Math.floor(elapsedMs / TICK_MS);
  for (let i = 0; i < ticks; i += 1) {
    m += Math.max(0.01, m * 0.01);
    if (m >= state.crashPoint) return state.crashPoint;
  }
  return Math.round(m * 100) / 100;
}

function emit(event, payload) {
  if (io) io.emit(event, payload);
}

function broadcastState() {
  emit('ootleCrashState', {
    phase: state.phase,
    roundId: state.roundId,
    serverSeedHash: state.serverSeedHash,
    multiplier: state.multiplier,
    crashPoint: state.phase === 'busted' ? state.crashPoint : null,
    serverSeed: state.phase === 'busted' ? state.serverSeed : null,
    openedAt: state.openedAt,
    startedAt: state.startedAt,
    bets: betsView(),
    countdownEndsAt: state.phase === 'betting' ? state.openedAt + BETTING_MS : null,
    history: state.history.slice(0, 12)
  });
}

function betsView() {
  return Array.from(state.bets.values()).map((b) => ({
    steamId: b.steamId,
    displayName: b.displayName,
    avatar: b.avatar,
    betTari: Number(b.betMicro) / 1e6,
    status: b.status, // playing | cashed | busted
    cashedAt: b.cashedAt
  }));
}

function openRound() {
  state.phase = 'betting';
  state.roundId = crypto.randomBytes(8).toString('hex');
  state.serverSeed = crypto.randomBytes(32).toString('hex');
  state.serverSeedHash = sha256(state.serverSeed);
  state.crashPoint = crashPointFor(state.serverSeed, state.roundId);
  state.openedAt = Date.now();
  state.multiplier = 1;
  state.bets = new Map();
  broadcastState();
  setTimeout(() => {
    if (state.phase === 'betting') startFlight();
  }, BETTING_MS);
}

function startFlight() {
  state.phase = 'flying';
  state.startedAt = Date.now();
  broadcastState();
  const timer = setInterval(() => {
    if (state.phase !== 'flying') {
      clearInterval(timer);
      return;
    }
    state.multiplier = tickMultiplier(Date.now() - state.startedAt);
    if (state.multiplier >= state.crashPoint || Date.now() - state.startedAt > MAX_ROUND_MS) {
      clearInterval(timer);
      bust();
      return;
    }
    emit('ootleCrashMultiplier', { multiplier: state.multiplier });
  }, TICK_MS);
}

function bust() {
  state.phase = 'busted';
  state.bustedAt = Date.now();
  state.multiplier = state.crashPoint;
  for (const bet of state.bets.values()) {
    if (bet.status === 'playing') bet.status = 'busted';
  }
  games.settleCrashArenaBust(Array.from(state.bets.values()).filter((b) => b.status === 'busted').map((b) => b.steamId))
    .catch((err) => console.error('[OotleCrash] ledger bust failed:', err.message));
  state.history.unshift({ roundId: state.roundId, crashPoint: state.crashPoint, serverSeed: state.serverSeed, at: new Date().toISOString() });
  state.history = state.history.slice(0, 50);
  broadcastState();
  setTimeout(() => {
    state.phase = 'paused';
    openRound();
  }, PAUSE_MS);
}

async function placeBet(steamId, persona, betTari) {
  if (state.phase !== 'betting') throw new Error('Betting is closed for this round. Wait for the next one.');
  if (state.bets.has(String(steamId))) throw new Error('You already have a bet in this round.');
  const view = await games.placeCrashArenaBet(steamId, betTari, state.roundId);
  state.bets.set(String(steamId), {
    steamId: String(steamId),
    displayName: persona.displayName || 'Player',
    avatar: persona.avatar || '',
    betMicro: view.betMicro,
    status: 'playing',
    cashedAt: null
  });
  broadcastState();
  return { betTari: view.betTari, tari: view.tari };
}

async function cashOut(steamId) {
  const key = String(steamId);
  const bet = state.bets.get(key);
  if (!bet || bet.status !== 'playing') throw new Error('No live bet to cash out.');
  if (state.phase !== 'flying') throw new Error('The round is not flying.');
  const multiplier = state.multiplier;
  const roundId = state.roundId;
  const crashPoint = state.crashPoint;
  bet.status = 'cashing';
  broadcastState();
  try {
    const view = await games.settleCrashArenaCashout(steamId, roundId, multiplier, crashPoint);
    bet.status = 'cashed';
    bet.cashedAt = view.multiplier;
    emit('ootleCrashCashout', { steamId: key, multiplier: view.multiplier, payoutTari: view.outcomeTari, displayName: bet.displayName });
    broadcastState();
    return view;
  } catch (err) {
    if (state.bets.get(key) === bet && bet.status === 'cashing') bet.status = 'playing';
    broadcastState();
    throw err;
  }
}

function pushChat(message) {
  state.chat.push(message);
  state.chat = state.chat.slice(-100);
}

function clearChat() {
  const count = state.chat.length;
  state.chat = [];
  return count;
}

function deleteChatMessage(id) {
  const before = state.chat.length;
  state.chat = state.chat.filter((m) => m.id !== String(id || ''));
  return state.chat.length < before;
}

function recentChat() {
  return state.chat.slice(-60);
}

function start(namespace) {
  if (started) return;
  started = true;
  io = namespace;
  openRound();
}

module.exports = {
  start,
  placeBet,
  cashOut,
  state: () => broadcastStateSafe(),
  recentChat,
  pushChat,
  clearChat,
  deleteChatMessage,
  broadcastState
};

function broadcastStateSafe() {
  return {
    phase: state.phase,
    roundId: state.roundId,
    serverSeedHash: state.serverSeedHash,
    multiplier: state.multiplier,
    crashPoint: state.phase === 'busted' ? state.crashPoint : null,
    serverSeed: state.phase === 'busted' ? state.serverSeed : null,
    openedAt: state.openedAt,
    startedAt: state.startedAt,
    bets: betsView(),
    countdownEndsAt: state.phase === 'betting' ? state.openedAt + BETTING_MS : null,
    history: state.history.slice(0, 12)
  };
}

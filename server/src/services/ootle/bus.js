const EventEmitter = require('events');

/**
 * Tiny in-process bus so any ledger movement (faucet, games, shields,
 * escrow holds and releases, prediction stakes) can notify whoever is
 * listening — the socket bridge in server.js turns touches into
 * 'ootleLedger' pushes so the wallet updates in realtime everywhere.
 */
const bus = new EventEmitter();
bus.setMaxListeners(50);

function touch(steamId) {
  if (!steamId) return;
  bus.emit('touch', String(steamId));
}

module.exports = { bus, touch };

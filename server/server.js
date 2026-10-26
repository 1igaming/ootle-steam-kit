/**
 * Tari DApp server — a standalone template for Steam-authenticated apps
 * with an in-browser Tari (Ootle L2) wallet. Connects to a Tari wallet
 * daemon over JSON-RPC for on-chain operations; nothing here knows about
 * any specific storefront.
 */
require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const http = require('http');

const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: true, credentials: true } });

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  },
  proxy: true
});
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
require('./src/config/passport').initializePassport();

// Steam auth routes (same-host OpenID return)
app.use('/', require('./src/api/auth').router);

// DApp API: wallet ops, faucet, games, predictions, convert
app.use('/api/ootle', require('./src/api/ootle'));

// Steam inventory proxy for the Trade view (game set via env)
app.use('/api/steam', require('./src/api/steamInventory').router);

// Public BTC/USD price for display alongside tTARI amounts
app.use('/api/bitcoin', require('./src/api/bitcoinPrice').router);

// Multiplayer crash arena namespace
new (require('./src/sockets/ootleCrashSocket'))(io);

// Realtime wallet: push 'ootleLedger' to connected sockets on any balance touch
try {
  const { bus } = require('./src/services/ootle/bus');
  const ledgerTimers = new Map();
  bus.on('touch', (steamId) => {
    if (ledgerTimers.has(steamId)) clearTimeout(ledgerTimers.get(steamId));
    ledgerTimers.set(steamId, setTimeout(() => {
      ledgerTimers.delete(steamId);
      for (const [, socket] of io.of('/').sockets) {
        if (socket.data && socket.data.steamId === String(steamId)) {
          socket.emit('ootleLedger', { steamId: String(steamId), at: Date.now() });
        }
      }
    }, 150));
  });
} catch (_) {}

// Testnet escrow top-up watcher (refills tTARI from the network faucet if configured)
try {
  const escrowTopUp = require('./src/services/ootle/escrowTopUp');
  escrowTopUp.start();
} catch (_) {}

app.get('/health', (_req, res) => res.json({ status: 'healthy' }));

if (process.env.SERVE_CLIENT !== 'false') {
  const clientBuild = path.join(__dirname, '../client/build');
  app.use(express.static(clientBuild, { maxAge: '1y' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(clientBuild, 'index.html'));
  });
}

const PORT = process.env.PORT || 3013;
server.listen(PORT, () => console.log(`DApp server listening on :${PORT}`));

/** Attach session + passport to socket.io so handlers see req.user. */
function attachSocketSession(io, sessionMiddleware) {
  io.engine.use((req, res, next) => sessionMiddleware(req, res, next));
  io.engine.use((req, res, next) => require('passport').initialize()(req, res, next));
  io.engine.use((req, res, next) => require('passport').session()(req, res, next));
}

function populateSocketUser(socket) {
  const user = socket.request?.user;
  if (user && (user.steamId || user.id)) {
    socket.data.authenticated = true;
    socket.data.steamId = String(user.steamId || user.id);
    socket.data.username = user.displayName || user.username || 'User';
    socket.data.avatar = user.avatarFull || user.avatarMedium || user.avatar || '';
    socket.data.isAdmin = require('../middleware/adminAuth').isAdmin(user);
  } else {
    socket.data.authenticated = false;
  }
}

function requireSocketAuth(socket) {
  if (!socket.data.authenticated || !socket.data.steamId) {
    return { ok: false, message: 'You must be logged in.' };
  }
  return {
    ok: true,
    steamId: socket.data.steamId,
    username: socket.data.username,
    avatar: socket.data.avatar,
    isAdmin: socket.data.isAdmin
  };
}

module.exports = { attachSocketSession, populateSocketUser, requireSocketAuth };

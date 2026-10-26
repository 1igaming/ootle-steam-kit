/**
 * Socket namespace for the Ootle multiplayer crash arena: state broadcast,
 * bets, cash-outs, and chat.
 */

const { populateSocketUser, requireSocketAuth } = require('./socketSession');
const LinkCheck = /https?:\/\/|www\.|\.com|\.net|\.org|\.xyz|\.ru/i;

class OotleCrashSocket {
  constructor(io) {
    this.crashArena = require('../services/ootle/crashArena');
    this.gamesService = require('../services/ootle/games');
    this.namespace = io.of('/ootle-crash');
    this.namespace.on('connection', (socket) => this.onConnection(socket));
    this.crashArena.start(this.namespace);
    console.log('[OotleCrash] Socket namespace /ootle-crash initialized');
  }

  async onConnection(socket) {
    socket.emit('ootleCrashState', this.crashArena.state());
    socket.emit('ootleCrashHistory', this.crashArena.state().history);
    socket.emit('ootleCrashChat', await this.recentChatResolved());

    socket.on('ootleCrashBet', async (data) => {
      try {
        const auth = this.userOf(socket);
        if (!auth) return socket.emit('ootleCrashError', { message: auth === null ? 'Not authorized' : 'Not authorized' });
        const result = await this.crashArena.placeBet(auth.steamId, {
          displayName: auth.username || 'Player',
          avatar: auth.avatar || ''
        }, data && data.bet);
        socket.emit('ootleCrashBetAccepted', result);
      } catch (error) {
        socket.emit('ootleCrashError', { message: error.message || 'That bet did not place.' });
      }
    });

    socket.on('ootleCrashCashout', async () => {
      try {
        const auth = this.userOf(socket);
        if (!auth) return socket.emit('ootleCrashError', { message: 'Not authorized' });
        const result = await this.crashArena.cashOut(auth.steamId);
        socket.emit('ootleCrashCashoutAccepted', result);
      } catch (error) {
        socket.emit('ootleCrashError', { message: error.message || 'That cash-out did not complete.' });
      }
    });

    socket.on('ootleCrashClearChat', async () => {
      const auth = requireSocketAuth(socket);
      if (!auth.ok || !auth.isAdmin) {
        return socket.emit('ootleCrashChatError', { message: 'Not authorized' });
      }
      try {
        const count = this.crashArena.clearChat();
        this.namespace.emit('ootleCrashChatCleared');
        socket.emit('ootleCrashAdminResult', {
          success: true,
          message: `Chat cleared (${count} message${count === 1 ? '' : 's'} removed)`
        });
        console.log(`[OotleCrash] Admin ${auth.steamId} cleared chat (${count} messages)`);
      } catch (error) {
        console.error('[OotleCrash] Error clearing chat:', error.message);
        socket.emit('ootleCrashChatError', { message: 'Failed to clear chat' });
      }
    });

    socket.on('ootleCrashDeleteMessage', async (data) => {
      const auth = requireSocketAuth(socket);
      if (!auth.ok || !auth.isAdmin) {
        return socket.emit('ootleCrashChatError', { message: 'Not authorized' });
      }
      const id = data && data.id;
      if (!id || typeof id !== 'string') {
        return socket.emit('ootleCrashChatError', { message: 'Invalid message' });
      }
      try {
        const removed = this.crashArena.deleteChatMessage(id);
        if (removed) this.namespace.emit('ootleCrashChatMessageDeleted', { id });
      } catch (error) {
        socket.emit('ootleCrashChatError', { message: 'Failed to delete message' });
      }
    });

    socket.on('ootleCrashChatMessage', async (data) => {
      try {
        const auth = this.userOf(socket);
        if (!auth) return socket.emit('ootleCrashChatError', { message: 'Not authorized' });
        const message = String((data && data.message) || '').trim().slice(0, 240);
        if (!message) return;
        if (LinkCheck.test(message)) {
          return socket.emit('ootleCrashChatError', { message: 'Links are not allowed in chat' });
        }
        const fresh = await this.personaOf(auth.steamId) || {};
        const chatMessage = {
          id: require('crypto').randomBytes(6).toString('hex'),
          steamId: String(auth.steamId),
          displayName: fresh.displayName || auth.username || 'Player',
          avatar: fresh.avatar || auth.avatar || '',
          isAdmin: Boolean(auth.isAdmin),
          message,
          at: new Date().toISOString()
        };
        this.crashArena.pushChat(chatMessage);
        this.namespace.emit('ootleCrashChatMessage', chatMessage);
      } catch (error) {
        socket.emit('ootleCrashChatError', { message: 'That message did not send.' });
      }
    });
  }

  userOf(socket) {
    try {
      const user = socket.request && socket.request.user;
      if (!user || !user.steamId) return null;
      return user;
    } catch (_) {
      return null;
    }
  }

  personaOf(_steamId) {
    // persona lives in the session; nothing to re-resolve
    return null;
  }

  async recentChatResolved() {
    const messages = this.crashArena.recentChat();
    const ids = [...new Set(messages.map((m) => m.steamId))];
    const personas = {};
    await Promise.all(ids.map(async (id) => {
      personas[id] = (await this.personaOf(id)) || {};
    }));
    return messages.map((m) => ({
      ...m,
      displayName: personas[m.steamId].displayName || m.displayName,
      avatar: personas[m.steamId].avatar || m.avatar
    }));
  }
}

module.exports = OotleCrashSocket;

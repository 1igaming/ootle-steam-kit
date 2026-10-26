import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Avatar from '@mui/material/Avatar';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import InsertEmoticonIcon from '@mui/icons-material/InsertEmoticon';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import { io } from 'socket.io-client';
import CrashGraph from '../CrashGraph';
import { useAuth } from '../../context/AuthContext';
import { isSiteAdminUser } from '../../siteAdminClient';
const emoticonMap = {
  ';-)': 'winking.png', ';)': 'winking.png', ':-!': 'gross.png', ':-(': 'sad.png', ':(': 'sad.png',
  ':-)': 'smile.png', ':)': 'smile.png', ':-[': 'embarrassed.png', ':-{}': 'kiss.png', ':-@': 'screaming.png',
  ':-*': 'kiss.png', ':-/': 'hmmm.png', ':-\\': 'mad.png', ':-$': 'confused.png', ':-D': 'big_grin.png',
  ':D': 'big_grin.png', ':-P': 'sticking_tongue_out.png', ':P': 'sticking_tongue_out.png', ':-X': 'lips_are_sealed.png',
  ':X': 'lips_are_sealed.png', ':\'(': 'crying.png', '[:-}': 'dj.png', ']:->': 'devil.png', '=-O': 'uh-oh.png',
  '>:O': 'yelling.png', 'O:-)': 'angel.png', 'O-)': 'angel.png', '@}->--': 'rose.png', '@=': 'bomb.png',
  '*DRINK*': 'drink.png', '*IN LOVE*': 'in_love.png', '*JOKINGLY*': 'jokingly.png', '*KISSED*': 'kissed.png',
  '*KISSING*': 'kissing.png', '*STOP*': 'stop.png', '*THUMBS UP*': 'thumbs_up.png', '*TIRED*': 'tired.png'
};

/**
 * The multiplayer tTARI crash arena: a board grid (Recent / chat / graph
 * with the surfing emoji / Stake + Active bets), frosted panels, wells,
 * chips, and chat with avatars and timestamps, running on the tTARI
 * testnet play ledger.
 */

const BRAND_BLUE = '#2563eb';
const PANEL_INK = '#0f172a';
const PANEL_MUTED = '#64748b';
const CRASH_RULE = '1px solid #e2e8f0';

const boardSx = {
  borderRadius: 3,
  bgcolor: 'rgba(255, 255, 255, 0.95)',
  backdropFilter: 'blur(20px)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.15)',
  overflow: 'hidden'
};

const wellSx = {
  bgcolor: '#f8fafc',
  border: CRASH_RULE,
  borderRadius: 2
};

const cellSx = ({ rightAt, bottomAt } = {}) => ({
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  borderRight: rightAt ? { [rightAt]: CRASH_RULE } : undefined,
  borderBottom: bottomAt ? { [bottomAt]: CRASH_RULE } : undefined
});

function Section({ title, meta = null, flush = false, compact = false, children }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', width: '100%' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          px: { xs: 1.5, sm: 2 },
          height: 42,
          minHeight: 42,
          boxSizing: 'border-box',
          borderBottom: CRASH_RULE,
          flexShrink: 0
        }}
      >
        <Typography sx={{ fontWeight: 800, fontSize: '0.82rem', color: PANEL_INK, lineHeight: 1.2 }}>{title}</Typography>
        {meta ? (
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: PANEL_MUTED, lineHeight: 1.2 }}>
            {meta}
          </Typography>
        ) : null}
      </Box>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          p: flush ? 0 : compact ? 1.5 : 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

function escapeHtml(text) {
  // Element-content context: & < > are the dangerous ones. Quotes stay
  // literal so quote-bearing emote codes (:'( ) still match afterwards.
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function convertEmoticons(text) {
  // Single pass over the longest codes first, then substitute through
  // placeholders so a replaced emote can never be matched again by a
  // shorter code (the chained split/join produced doubled images).
  const entries = Object.entries(emoticonMap || {}).sort((a, b) => b[0].length - a[0].length);
  let out = String(text || '');
  const slots = [];
  for (const [code, file] of entries) {
    if (!out.includes(code)) continue;
    const token = `\u0000${slots.length}\u0000`;
    out = out.split(code).join(token);
    slots.push(`<img src="/emoticons/${file}" alt="emoticon" />`);
  }
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

export default function OotleCrashGame({ balance, onBalance }) {
  const { user, authenticated, login } = useAuth();
  const [connected, setConnected] = useState(false);
  const [gameState, setGameState] = useState(null);
  const [chat, setChat] = useState([]);
  const [chatError, setChatError] = useState('');
  const [bet, setBet] = useState('10');
  const [betNote, setBetNote] = useState('');
  const [busy, setBusy] = useState(false);
  const socketRef = useRef(null);
  const chatEndRef = useRef(null);
  const [emoticonPickerOpen, setEmoticonPickerOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');

  const chatListRef = useRef(null);
  useEffect(() => {
    // scroll only the chat well, never the page
    const list = chatListRef.current;
    const end = chatEndRef.current;
    if (list && end) list.scrollTop = end.offsetTop - list.offsetTop - list.clientHeight + 24;
  }, [chat.length]);

  useEffect(() => {
    const socket = io('/ootle-crash', { transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('ootleCrashState', (data) => setGameState(data));
    socket.on('ootleCrashMultiplier', ({ multiplier }) => setGameState((prev) => (prev ? { ...prev, multiplier } : prev)));
    socket.on('ootleCrashBetAccepted', () => onBalance && onBalance());
    socket.on('ootleCrashCashout', () => onBalance && onBalance());
    socket.on('ootleCrashError', (data) => setBetNote(String((data && data.message) || '')));
    socket.on('ootleCrashChat', (messages) => setChat(Array.isArray(messages) ? messages : []));
    socket.on('ootleCrashChatMessage', (message) => setChat((prev) => [...prev.slice(-80), message]));
    socket.on('ootleCrashChatError', (data) => setChatError(String((data && data.message) || '')));
    socket.on('ootleCrashChatCleared', () => setChat([]));
    socket.on('ootleCrashChatMessageDeleted', ({ id }) => setChat((prev) => prev.filter((m) => m.id !== id)));
    return () => { socket.disconnect(); };
  }, [onBalance]);

  const phase = gameState ? gameState.phase : 'loading';
  const multiplier = gameState ? gameState.multiplier : 1;
  const crashPoint = gameState && gameState.phase === 'busted' ? gameState.crashPoint : null;
  const mySteamId = user && user.steamId ? String(user.steamId) : '';
  const bets = gameState && Array.isArray(gameState.bets) ? gameState.bets : [];
  const myBet = bets.find((b) => b.steamId === mySteamId);
  const hasBet = Boolean(myBet);
  const history = gameState && Array.isArray(gameState.history) ? gameState.history : [];

  // Map the arena phases onto the main game's states for CrashGraph
  const graphState = phase === 'flying' ? 'running' : phase === 'busted' ? 'crashed' : phase === 'betting' ? 'betting' : 'countdown';
  const [countdownLeft, setCountdownLeft] = useState(0);
  useEffect(() => {
    if (phase !== 'betting' || !gameState || !gameState.countdownEndsAt) {
      setCountdownLeft(0);
      return undefined;
    }
    const tick = () => setCountdownLeft(Math.max(0, gameState.countdownEndsAt - Date.now()));
    tick();
    const t = setInterval(tick, 200);
    return () => clearInterval(t);
  }, [phase, gameState && gameState.countdownEndsAt]);

  const betOk = /^\d+(\.\d{1,6})?$/.test(bet.trim()) && Number(bet) >= 0.1 && Number(bet) <= 10000;

  const placeBet = async () => {
    setBetNote('');
    setBusy(true);
    try {
      const res = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ error: 'The bet did not place in time.' }), 8000);
        socketRef.current.once('ootleCrashBetAccepted', (data) => { clearTimeout(timeout); resolve(data); });
        socketRef.current.once('ootleCrashError', (data) => { clearTimeout(timeout); resolve({ error: data && data.message }); });
        socketRef.current.emit('ootleCrashBet', { bet: bet.trim() });
      });
      if (res && res.error) setBetNote(res.error);
    } finally {
      setBusy(false);
    }
  };

  const cashOut = async () => {
    if (socketRef.current) socketRef.current.emit('ootleCrashCashout');
  };

  const sendChat = () => {
    const t = chatInput.trim();
    if (t && socketRef.current) {
      socketRef.current.emit('ootleCrashChatMessage', { message: t });
      setChatInput('');
      setChatError('');
    }
  };

  const clearChat = () => {
    if (socketRef.current) socketRef.current.emit('ootleCrashClearChat');
  };

  const deleteMessage = (id) => {
    if (socketRef.current) socketRef.current.emit('ootleCrashDeleteMessage', { id });
  };

  const isAdminHere = Boolean(user && isSiteAdminUser(user));

  const statusLabel = phase === 'betting' ? 'Place your bets'
    : phase === 'flying' ? 'Cash out now'
      : phase === 'busted' ? 'Crashed'
        : countdownLeft > 0 ? `Next in ${Math.ceil(countdownLeft / 1000)}s` : 'Get ready';

  const players = useMemo(() => [...bets].sort((a, b) => b.betTari - a.betTari), [bets]);

  return (
    <Box
      sx={{
        ...boardSx,
        display: 'grid',
        gap: 0,
        gridTemplateColumns: { xs: '1fr', md: 'minmax(280px, 340px) minmax(0, 1fr)' },
        gridTemplateRows: { xs: 'auto', md: 'auto minmax(380px, 1fr) minmax(260px, auto)' },
        gridTemplateAreas: {
          xs: '"recent" "graph" "bottom" "chat"',
          md: '"recent recent" "chat graph" "chat bottom"'
        }
      }}
    >
      {/* Recent */}
      <Box sx={{ gridArea: 'recent', ...cellSx({ bottomAt: 'md' }) }}>
        <Section title="Recent">
          {history.length === 0 ? (
            <Typography variant="body2" sx={{ color: PANEL_MUTED }}>No rounds recorded yet.</Typography>
          ) : (
            <Box sx={{ display: 'flex', gap: 0.75, overflowX: 'auto', pb: 0.25, '&::-webkit-scrollbar': { height: 0 } }}>
              {history.map((game, index) => (
                <Chip
                  key={`${game.roundId || index}-${game.crashPoint}`}
                  label={`${(Number(game.crashPoint) || 0).toFixed(2)}x`}
                  size="small"
                  sx={{
                    flexShrink: 0,
                    height: 24,
                    fontWeight: 800,
                    fontSize: '0.7rem',
                    bgcolor: game.crashPoint >= 2 ? '#dcfce7' : '#fee2e2',
                    color: game.crashPoint >= 2 ? '#166534' : '#991b1b',
                    border: index === 0 ? '1px solid #93c5fd' : '1px solid transparent'
                  }}
                />
              ))}
            </Box>
          )}
        </Section>
      </Box>

      {/* Graph — the same surfboard graph as the main game */}
      <Box sx={{ gridArea: 'graph', ...cellSx(), minHeight: { xs: 280, md: 380 } }}>
        <Section title="Round" flush>
          <Box
            sx={{
              position: 'relative',
              width: '100%',
              minHeight: { xs: 260, sm: 320, md: 0 },
              height: { xs: 'min(52vh, 360px)', sm: 'min(48vh, 400px)', md: '100%' },
              background: 'linear-gradient(155deg, #eff6ff 0%, #dbeafe 42%, #bfdbfe 100%)',
              overflow: 'hidden',
              flex: 1
            }}
          >
            <CrashGraph multiplier={multiplier} gameState={graphState} crashPoint={crashPoint} maxMultiplier={20} />
            <Box
              sx={{
                position: 'absolute',
                top: { xs: 12, sm: 16 },
                left: { xs: 12, sm: 16 },
                right: { xs: 12, sm: 16 },
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 1,
                pointerEvents: 'none',
                zIndex: 10
              }}
            >
              <Box
                sx={{
                  px: 1.25,
                  py: 0.6,
                  borderRadius: 999,
                  bgcolor: 'rgba(255,255,255,0.88)',
                  border: '1px solid rgba(148, 163, 184, 0.35)',
                  boxShadow: '0 8px 20px rgba(15, 23, 42, 0.08)'
                }}
              >
                <Typography sx={{
                  color: phase === 'busted' ? '#dc2626' : '#1e40af',
                  fontWeight: 800,
                  fontSize: { xs: '0.72rem', sm: '0.8rem' },
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase'
                }}>
                  {statusLabel}
                </Typography>
              </Box>
              <Typography sx={{
                fontWeight: 800,
                fontSize: { xs: '2.1rem', sm: '2.75rem', md: '3.25rem' },
                lineHeight: 1,
                letterSpacing: '-0.04em',
                color: phase === 'busted' ? '#dc2626' : '#0f172a',
                textShadow: '0 1px 0 rgba(255,255,255,0.7)'
              }}>
                {phase === 'betting' ? (countdownLeft / 1000).toFixed(1) : (crashPoint || multiplier).toFixed(2)}
                {phase === 'betting' ? '' : 'x'}
              </Typography>
            </Box>
          </Box>
        </Section>
      </Box>

      {/* Stake + Active bets */}
      <Box
        sx={{
          gridArea: 'bottom',
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'minmax(240px, 0.92fr) minmax(0, 1.18fr)' },
          minHeight: { xs: 0, md: 260 },
          minWidth: 0
        }}
      >
        <Box sx={{ ...cellSx({ rightAt: 'sm', bottomAt: 'xs' }) }}>
          <Section title="Stake" compact>
            <Box sx={{ ...wellSx, p: 1.1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <AccountBalanceWalletIcon sx={{ color: BRAND_BLUE, fontSize: 22, flexShrink: 0 }} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ color: PANEL_MUTED, display: 'block', fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    tTARI stack
                  </Typography>
                  <Typography sx={{ color: PANEL_INK, fontWeight: 800, fontSize: '0.82rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {Math.round(Number(balance) || 0).toLocaleString('en-US')} tTARI
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ textAlign: 'right', minWidth: 0 }}>
                <Typography sx={{ color: PANEL_MUTED, display: 'block', fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Testnet
                </Typography>
                <Typography sx={{ color: PANEL_INK, fontWeight: 800, fontSize: '0.82rem' }}>
                  Esmeralda play money
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 1, alignItems: 'stretch' }}>
              <TextField
                label="Bet (tTARI)"
                value={bet}
                onChange={(event) => { setBet(event.target.value); setBetNote(''); }}
                disabled={hasBet || busy}
                size="small"
                type="text"
                sx={{
                  flex: 1,
                  '& .MuiOutlinedInput-root': {
                    bgcolor: '#ffffff',
                    '& fieldset': { borderColor: '#cbd5e1' },
                    '&:hover fieldset': { borderColor: '#3b82f6' },
                    '&.Mui-focused fieldset': { borderColor: '#3b82f6' }
                  },
                  '& .MuiInputLabel-root': { color: '#64748b' },
                  '& .MuiInputLabel-root.Mui-focused': { color: '#3b82f6' },
                  '& .MuiInputBase-input': { color: '#1e293b' }
                }}
              />
              <Button
                variant="contained"
                onClick={placeBet}
                disabled={hasBet || busy || !betOk || !connected || phase !== 'betting'}
                sx={{
                  height: 40,
                  minWidth: 104,
                  px: 1.5,
                  bgcolor: hasBet ? '#10b981' : BRAND_BLUE,
                  color: '#ffffff',
                  fontWeight: 800,
                  textTransform: 'none',
                  boxShadow: 'none',
                  '&:hover': { bgcolor: hasBet ? '#059669' : '#1d4ed8', boxShadow: 'none' },
                  '&:disabled': { bgcolor: '#cbd5e1', color: '#94a3b8' }
                }}
              >
                {busy ? 'Placing…' : hasBet ? 'Placed' : 'Place bet'}
              </Button>
            </Box>

            {hasBet && myBet.status === 'playing' && phase === 'flying' ? (
              <Button
                fullWidth
                variant="contained"
                onClick={cashOut}
                sx={{
                  height: 44,
                  bgcolor: '#f59e0b',
                  color: '#ffffff',
                  fontWeight: 800,
                  fontSize: '1.05rem',
                  textTransform: 'none',
                  boxShadow: 'none',
                  '&:hover': { bgcolor: '#d97706', boxShadow: 'none' }
                }}
              >
                {`Cash out at ${multiplier.toFixed(2)}x`}
              </Button>
            ) : null}

            {betNote ? (
              <Typography sx={{ color: '#b45309', fontSize: '0.8rem', fontWeight: 600 }}>{betNote}</Typography>
            ) : null}
          </Section>
        </Box>

        <Box sx={{ ...cellSx({ bottomAt: false }), minHeight: { xs: 200, sm: 0 }, minWidth: 0 }}>
          <Section title="Active bets" compact meta={`${players.length} ${players.length === 1 ? 'bet' : 'bets'}`}>
            {players.length === 0 ? (
              <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
                <Typography variant="body2" sx={{ color: '#64748b', textAlign: 'center' }}>
                  No active bets this round
                </Typography>
              </Box>
            ) : (
              <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                {players.slice(0, 10).map((player, index) => (
                  <Box key={player.steamId || index} sx={{ ...wellSx, display: 'flex', alignItems: 'center', gap: 1, px: 1.1, py: 0.85 }}>
                    <Avatar
                      src={player.avatar || undefined}
                      sx={{ width: 28, height: 28, flexShrink: 0, fontSize: '0.75rem', bgcolor: player.status === 'cashed' ? '#10b981' : BRAND_BLUE }}
                    >
                      {player.status === 'cashed' ? '✓' : index + 1}
                    </Avatar>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography noWrap sx={{ color: PANEL_INK, fontWeight: 700, fontSize: '0.8rem', lineHeight: 1.2 }}>
                        {player.displayName}{player.steamId === mySteamId ? ' (you)' : ''}
                      </Typography>
                      <Typography sx={{ color: PANEL_MUTED, fontSize: '0.7rem', mt: 0.15 }}>
                        {Math.round(player.betTari * 100) / 100} tTARI
                      </Typography>
                    </Box>
                    <Typography sx={{ flexShrink: 0, fontWeight: 800, fontSize: '0.72rem', color: player.status === 'cashed' ? '#16a34a' : PANEL_MUTED }}>
                      {player.status === 'cashed' ? `${player.cashedAt.toFixed(2)}x` : player.status === 'busted' ? 'Bust' : 'In game'}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Section>
        </Box>
      </Box>

      {/* Chat — same well, avatars, timestamps, emoticons */}
      <Box sx={{ gridArea: 'chat', ...cellSx({ rightAt: 'md', bottomAt: 'xs' }), minHeight: { xs: 360, md: 0 } }}>
        <Section title="Live chat">
          {chatError ? (
            <Alert severity="error" sx={{ mb: 1 }} onClose={() => setChatError('')}>{chatError}</Alert>
          ) : null}
          <Box ref={chatListRef} sx={{ ...wellSx, flex: 1, minHeight: { xs: 220, md: 0 }, overflowY: 'auto', mb: 1.5, p: 1.25 }}>
            {chat.length === 0 ? (
              <Typography variant="body2" sx={{ color: '#64748b', textAlign: 'center', py: 3 }}>
                No messages yet. Start chatting!
              </Typography>
            ) : (
              chat.map((msg, index) => (
                <Box key={msg.id || index} sx={{ mb: 1.5, display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                  <Avatar src={msg.avatar || undefined} sx={{ width: 28, height: 28 }}>
                    {(msg.displayName || 'P').charAt(0)}
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 'bold', color: '#1e293b', fontSize: '0.75rem' }}>
                        {msg.displayName}
                      </Typography>
                      <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.65rem' }}>
                        {msg.at ? new Date(msg.at).toLocaleTimeString() : ''}
                      </Typography>
                      {isAdminHere && msg.id ? (
                        <Button
                          size="small"
                          onClick={() => deleteMessage(msg.id)}
                          sx={{ minWidth: 'auto', p: 0.25, color: '#ef4444', fontSize: '0.65rem' }}
                        >
                          ✕
                        </Button>
                      ) : null}
                    </Box>
                    <Box
                      sx={{
                        color: '#1e293b',
                        fontSize: '0.75rem',
                        wordBreak: 'break-word',
                        '& img': { width: 16, height: 16, verticalAlign: 'middle' },
                        whiteSpace: 'pre-wrap'
                      }}
                      dangerouslySetInnerHTML={{ __html: convertEmoticons(escapeHtml(msg.message || '')) }}
                    />
                  </Box>
                </Box>
              ))
            )}
            <div ref={chatEndRef} />
          </Box>

          {authenticated ? (
            <Box>
              {isAdminHere ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', mb: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    onClick={clearChat}
                    disabled={!connected}
                    sx={{ fontSize: '0.65rem', py: 0.25, minWidth: 'auto', textTransform: 'none' }}
                  >
                    Clear chat
                  </Button>
                </Box>
              ) : null}
              {emoticonPickerOpen ? (
                <Box sx={{ ...wellSx, p: 1, mb: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5, maxHeight: 110, overflowY: 'auto' }}>
                  {Object.entries(emoticonMap || {}).map(([code, file]) => (
                    <Box
                      key={code}
                      component="button"
                      type="button"
                      title={code}
                      onClick={() => { setChatInput((prev) => `${prev}${code} `); setEmoticonPickerOpen(false); }}
                      sx={{ border: 'none', background: 'transparent', cursor: 'pointer', p: 0.25, borderRadius: 1, '&:hover': { background: '#e2e8f0' } }}
                    >
                      <Box component="img" src={`/emoticons/${file}`} alt={code} sx={{ width: 20, height: 20, display: 'block' }} />
                    </Box>
                  ))}
                </Box>
              ) : null}
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Tooltip title="Insert Emoticon">
                  <IconButton size="small" onClick={() => setEmoticonPickerOpen((v) => !v)} sx={{ color: PANEL_MUTED, '&:hover': { color: BRAND_BLUE } }}>
                    <InsertEmoticonIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <TextField
                  size="small"
                  placeholder="Message"
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); sendChat(); } }}
                  sx={{
                    flex: 1,
                    '& .MuiOutlinedInput-root': {
                      bgcolor: '#ffffff',
                      '& fieldset': { borderColor: '#cbd5e1' },
                      '&:hover fieldset': { borderColor: '#3b82f6' },
                      '&.Mui-focused fieldset': { borderColor: '#3b82f6' }
                    },
                    '& .MuiInputBase-input': { color: '#1e293b', fontSize: '0.85rem' }
                  }}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <Button size="small" onClick={sendChat} disabled={!connected} sx={{ minWidth: 'auto', color: BRAND_BLUE, fontWeight: 800, textTransform: 'none' }}>
                          Send
                        </Button>
                      </InputAdornment>
                    )
                  }}
                />
              </Box>
            </Box>
          ) : (
            <Box
              component="button"
              type="button"
              onClick={login}
              sx={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', lineHeight: 0, justifySelf: 'start' }}
            >
              <Box component="img" src="/images/steamsignin.png" alt="Sign in through Steam" sx={{ height: 30, width: 'auto', objectFit: 'contain', display: 'block' }} />
            </Box>
          )}
        </Section>
      </Box>
    </Box>
  );
}

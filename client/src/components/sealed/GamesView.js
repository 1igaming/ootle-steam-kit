import React, { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ShowChartRoundedIcon from '@mui/icons-material/ShowChartRounded';
import LandscapeRoundedIcon from '@mui/icons-material/LandscapeRounded';
import OotleCrashGame from './OotleCrashGame';
import OotleSandboxGame from './OotleSandboxGame';
import DiamondRoundedIcon from '@mui/icons-material/DiamondRounded';
import { useAuth } from '../../context/AuthContext';
import { readWalletState } from '../../utils/localOotleWallet';
import { csrfHeaders } from '../../utils/csrfHeaders';
import SectionHeader from './SectionHeader';
import ViewBoard, { inlaidSx } from './ViewBoard';

/**
 * Testnet games for the Ootle DApp: Crash and Dig, played with tTARI play
 * stacks. Server-authoritative and provably fair: the server commits a
 * hash of its seed when a round starts and reveals the seed when it
 * settles, so every outcome can be recomputed. The multiplier curve is the
 * same formula on both sides: floor(e^(0.00012 * elapsedMs) * 100) / 100.
 */

const cardSx = {
  background: '#ffffff',
  borderRadius: 3,
  border: '1px solid rgba(255, 255, 255, 0.5)',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.15)',
  color: '#0f172a',
  p: { xs: 2, sm: 2.5 },
  minWidth: 0
};

const lightBoardSx = {
  borderRadius: 3,
  bgcolor: 'rgba(255, 255, 255, 0.95)',
  backdropFilter: 'blur(20px)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.15)',
  color: '#0f172a',
  p: { xs: 2, sm: 2.5 },
  minWidth: 0,
  overflow: 'hidden'
};

const lightWellSx = {
  bgcolor: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 2
};

const ink = '#0f172a';
const muted = '#64748b';

const multiplierAtMs = (ms) => Math.floor(Math.pow(Math.E, 0.00012 * Math.max(0, ms)) * 100) / 100;

function pillSx(active) {
  return {
    minHeight: 44,
    px: 2.25,
    borderRadius: 999,
    border: '1px solid',
    borderColor: active ? '#2563eb' : 'transparent',
    background: active ? '#2563eb' : 'transparent',
    color: active ? '#ffffff' : '#334155',
    fontWeight: 800,
    fontSize: '0.88rem',
    fontFamily: 'inherit',
    cursor: 'pointer',
    '&:hover': { background: active ? '#1d4ed8' : '#eff6ff' }
  };
}

function actionSx(disabled) {
  return {
    minHeight: 48,
    px: 3,
    borderRadius: 999,
    border: 'none',
    background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
    color: '#fff',
    fontWeight: 800,
    fontSize: '0.92rem',
    fontFamily: 'inherit',
    cursor: disabled ? 'default' : 'pointer',
    boxShadow: '0 8px 20px rgba(37, 99, 235, 0.3)',
    '&:hover': disabled ? {} : { filter: 'brightness(1.07)' },
    '&:disabled': { opacity: 0.55 }
  };
}

const inputSx = {
  width: 140,
  minHeight: 46,
  px: 1.5,
  borderRadius: 2,
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  color: '#1e293b',
  fontWeight: 700,
  fontSize: '0.95rem',
  fontFamily: 'inherit',
  outline: 'none',
  '&:focus': { borderColor: '#3b82f6', boxShadow: '0 0 0 3px rgba(59,130,246,0.15)' }
};

const BRAND_BLUE = '#2563eb';

function BetInput({ value, onChange, disabled }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
      <Box
        component="input"
        aria-label="Bet in tTARI"
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        sx={{ ...inputSx, '&:disabled': { opacity: 0.6 } }}
      />
      <Typography sx={{ color: muted, fontWeight: 800, fontSize: '0.85rem' }}>tTARI</Typography>
    </Box>
  );
}

function SeedNote({ hash, seed }) {
  if (!hash && !seed) return null;
  return (
    <Typography sx={{ color: muted, fontSize: '0.72rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', overflowWrap: 'anywhere', mt: 1 }}>
      {seed ? `seed ${seed}` : `commit ${hash}`}
    </Typography>
  );
}

function CrashGame({ balance, onBalance }) {
  const [bet, setBet] = useState('10');
  const [round, setRound] = useState(null); // { roundId, startedAt, serverSeedHash }
  const [multiplier, setMultiplier] = useState(1);
  const [result, setResult] = useState(null); // settled view or bust info
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const rafRef = useRef(0);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  useEffect(() => {
    if (!round) {
      setMultiplier(1);
      return undefined;
    }
    const startMs = Date.parse(round.startedAt);
    const tick = () => {
      const m = multiplierAtMs(Date.now() - startMs);
      setMultiplier(m);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(rafRef.current);
  }, [round]);

  const post = async (path, body) => {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error((data && data.error) || 'That call did not complete.');
    return data.data;
  };

  const start = async () => {
    setNote('');
    setResult(null);
    setBusy(true);
    try {
      const view = await post('/api/ootle/games/crash/bet', { bet: bet.trim() });
      setRound({ roundId: view.roundId, startedAt: view.startedAt, serverSeedHash: view.serverSeedHash });
    } catch (e) {
      setNote(e.message);
    } finally {
      setBusy(false);
    }
  };

  const cashout = async () => {
    if (!round) return;
    setBusy(true);
    try {
      const view = await post('/api/ootle/games/crash/cashout', { roundId: round.roundId });
      setRound(null);
      setResult({ kind: 'cashed', ...view });
      onBalance();
    } catch (e) {
      // either bust-before-cashout or network: settle the round
      setRound(null);
      setNote(e.message);
      onBalance();
    } finally {
      setBusy(false);
    }
  };

  const settleBust = async () => {
    if (!round) return;
    setBusy(true);
    try {
      const view = await post('/api/ootle/games/crash/settle', { roundId: round.roundId });
      setRound(null);
      setResult({ kind: 'busted', ...view });
      onBalance();
    } catch (e) {
      setNote(e.message);
    } finally {
      setBusy(false);
    }
  };

  const running = Boolean(round);
  const display = running ? multiplier.toFixed(2) : (result ? (result.crashPoint != null ? result.crashPoint.toFixed(2) : multiplier.toFixed(2)) : '1.00');

  return (
    <Box sx={{ ...cardSx, display: 'grid', gap: 2 }}>
      <SectionHeader
        eyebrow="Crash"
        title="Ride the multiplier"
        copy="The curve climbs from 1.00x and busts at a hidden point. Cash out before the bust. Every round commits a seed hash up front and reveals the seed after."
      />
      <Box
        sx={{
          display: 'grid',
          placeItems: 'center',
          minHeight: 180,
          borderRadius: 3,
          background: running
            ? 'linear-gradient(160deg, #1e3a8a 0%, #0f172a 100%)'
            : result && result.kind === 'busted'
              ? 'linear-gradient(160deg, #7f1d1d 0%, #0f172a 100%)'
              : result && result.kind === 'cashed'
                ? 'linear-gradient(160deg, #065f46 0%, #0f172a 100%)'
                : '#f8fafc',
          border: '1px solid #e2e8f0'
        }}
      >
        <Typography
          sx={{
            fontWeight: 800,
            fontSize: { xs: '3rem', sm: '4rem' },
            letterSpacing: '-0.03em',
            color: '#fff',
            lineHeight: 1,
            textShadow: '0 4px 24px rgba(0,0,0,0.35)'
          }}
        >
          {display}x
        </Typography>
        {result && result.kind === 'cashed' ? (
          <Typography sx={{ color: '#a7f3d0', fontWeight: 800, mt: 1 }}>
            Cashed {result.outcomeTari} tTARI
          </Typography>
        ) : null}
        {result && result.kind === 'busted' ? (
          <Typography sx={{ color: '#fecaca', fontWeight: 800, mt: 1 }}>Busted</Typography>
        ) : null}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <BetInput value={bet} onChange={setBet} disabled={running} />
        {running ? (
          <>
            <Box component="button" type="button" onClick={cashout} disabled={busy} sx={actionSx(busy)}>
              {busy ? 'Cashing…' : `Cash out ${multiplier.toFixed(2)}x`}
            </Box>
            <Box
              component="button"
              type="button"
              onClick={settleBust}
              disabled={busy}
              sx={{ ...pillSx(false), border: '1px solid #c7d2e3' }}
            >
              I busted
            </Box>
          </>
        ) : (
          <Box component="button" type="button" onClick={start} disabled={busy} sx={actionSx(busy)}>
            {busy ? 'Starting…' : 'Start round'}
          </Box>
        )}
      </Box>
      <SeedNote hash={round && round.serverSeedHash} seed={result && result.serverSeed} />
      {note ? (
        <Typography sx={{ color: '#b45309', fontSize: '0.84rem', fontWeight: 600 }} aria-live="polite">{note}</Typography>
      ) : null}
    </Box>
  );
}

function DigGame({ onBalance }) {
  const [bet, setBet] = useState('10');
  const [round, setRound] = useState(null); // { roundId, serverSeedHash, picked, multiplier }
  const [cells, setCells] = useState(Array.from({ length: 25 }, (_, i) => ({ i, state: 'hidden' })));
  const [result, setResult] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const post = async (path, body) => {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error((data && data.error) || 'That call did not complete.');
    return data.data;
  };

  const start = async () => {
    setNote('');
    setResult(null);
    setCells(Array.from({ length: 25 }, (_, i) => ({ i, state: 'hidden' })));
    setBusy(true);
    try {
      const view = await post('/api/ootle/games/dig/start', { bet: bet.trim() });
      setRound({ roundId: view.roundId, serverSeedHash: view.serverSeedHash, picked: view.picked || [] });
      if (view.resumed) {
        setNote('Resumed your live round from an earlier session.');
      }
    } catch (e) {
      setNote(e.message);
    } finally {
      setBusy(false);
    }
  };

  const dig = async (index) => {
    if (!round || busy || cells[index].state !== 'hidden') return;
    setBusy(true);
    try {
      const view = await post('/api/ootle/games/dig/dig', { roundId: round.roundId, cell: index });
      if (view.hit != null) {
        // bust: reveal mines, mark the hit
        setCells((prev) => prev.map((c) => {
          if ((view.mines || []).includes(c.i)) return { ...c, state: 'mine' };
          if (c.i === index) return { ...c, state: 'hit' };
          if ((view.picked || []).includes(c.i)) return { ...c, state: 'safe' };
          return c;
        }));
        setRound(null);
        setResult({ kind: 'busted', ...view });
      } else {
        setCells((prev) => prev.map((c) => (c.i === index ? { ...c, state: 'safe' } : c)));
        // keep the roundId we started with: the dig response identifies the
        // round as `id`, and replacing it here used to void the local round
        // after the first safe dig
        setRound((prev) => ({ ...prev, picked: view.picked, multiplier: view.multiplier }));
      }
      onBalance();
    } catch (e) {
      if (/already ended|not found|refunded/i.test(e.message)) {
        // this tab held a round the server no longer has (expired elsewhere):
        // drop it so the game offers a fresh start instead of erroring again
        setRound(null);
        setCells(Array.from({ length: 25 }, (_, i) => ({ i, state: 'hidden' })));
      }
      setNote(e.message);
    } finally {
      setBusy(false);
    }
  };

  const cashout = async () => {
    if (!round) return;
    setBusy(true);
    try {
      const view = await post('/api/ootle/games/dig/cashout', { roundId: round.roundId });
      setCells((prev) => prev.map((c) => {
        if ((view.mines || []).includes(c.i)) return { ...c, state: 'mine' };
        return c;
      }));
      setRound(null);
      setResult({ kind: 'cashed', ...view });
      onBalance();
    } catch (e) {
      if (/already ended|not found|refunded/i.test(e.message)) {
        setRound(null);
        setCells(Array.from({ length: 25 }, (_, i) => ({ i, state: 'hidden' })));
      }
      setNote(e.message);
    } finally {
      setBusy(false);
    }
  };

  const picks = round ? (round.picked || []).length : 0;

  return (
    <Box sx={{ ...lightBoardSx, display: 'grid', gap: 2 }}>
      <SectionHeader
        eyebrow="Dig"
        title="Dig the safe cells"
        copy="A 5 by 5 grid hides 3 mines. Each safe dig raises the multiplier; one mine ends the round. Cash out whenever you like after the first dig."
      />
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: 1,
          maxWidth: 380,
          mx: 'auto',
          width: '100%'
        }}
      >
        {cells.map((cell) => {
          const state = cell.state;
          return (
            <Box
              key={cell.i}
              component="button"
              type="button"
              disabled={!round || busy || state !== 'hidden'}
              onClick={() => dig(cell.i)}
              aria-label={`Cell ${cell.i + 1}`}
              sx={{
                aspectRatio: '1 / 1',
                borderRadius: 2,
                border: '1px solid',
                borderColor: state === 'safe' ? '#a7f3d0' : state === 'mine' || state === 'hit' ? '#fca5a5' : '#c7d2e3',
                background: state === 'safe' ? '#f0fdf4' : state === 'mine' ? '#fef2f2' : state === 'hit' ? '#dc2626' : '#ffffff',
                color: state === 'hit' ? '#fff' : state === 'safe' ? '#15803d' : state === 'mine' ? '#b91c1c' : '#0f172a',
                fontSize: { xs: '0.9rem', sm: '1.05rem' },
                fontWeight: 800,
                cursor: round && state === 'hidden' && !busy ? 'pointer' : 'default',
                transition: 'all .12s',
                '&:hover': round && state === 'hidden' && !busy ? { borderColor: BRAND_BLUE, background: '#eff6ff' } : {}
              }}
            >
              {state === 'safe' ? '✓' : state === 'mine' ? '✕' : state === 'hit' ? '✕' : ''}
            </Box>
          );
        })}
      </Box>
      {round ? (
        <Typography sx={{ textAlign: 'center', color: '#0f172a', fontWeight: 800, fontSize: '0.95rem' }}>
          {round.multiplier ? `${round.multiplier.toFixed(2)}x · next dig ${picks}` : `${picks} safe dig${picks === 1 ? '' : 's'}`}
        </Typography>
      ) : null}
      {result ? (
        <Typography sx={{ textAlign: 'center', fontWeight: 800, color: result.kind === 'cashed' ? '#047857' : '#b91c1c' }}>
          {result.kind === 'cashed' ? `Cashed ${result.outcomeTari} tTARI` : 'Busted'}
        </Typography>
      ) : null}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <BetInput value={bet} onChange={setBet} disabled={Boolean(round)} />
        {round ? (
          <Box component="button" type="button" onClick={cashout} disabled={busy || picks === 0} sx={actionSx(busy || picks === 0)}>
            {busy ? 'Cashing…' : (picks === 0 ? 'Dig a cell first' : `Cash out ${round.multiplier.toFixed(2)}x`)}
          </Box>
        ) : (
          <Box component="button" type="button" onClick={start} disabled={busy} sx={actionSx(busy)}>
            {busy ? 'Starting…' : 'Start dig'}
          </Box>
        )}
      </Box>
      <SeedNote hash={round && round.serverSeedHash} seed={result && result.serverSeed} />
      {note ? (
        <Typography sx={{ color: '#b45309', fontSize: '0.84rem', fontWeight: 600 }} aria-live="polite">{note}</Typography>
      ) : null}
    </Box>
  );
}

function SandboxGame({ onBalance }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [reveal, setReveal] = useState(false);

  const dig = async () => {
    setBusy(true);
    setNote('');
    setResult(null);
    setReveal(false);
    try {
      const res = await fetch('/api/ootle/games/sandbox/play', {
        method: 'POST',
        credentials: 'include',
        headers: csrfHeaders({ 'Content-Type': 'application/json' })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        setNote(String((data && data.error) || 'The dig did not happen.'));
        return;
      }
      setResult(data.data);
      onBalance && onBalance();
      setTimeout(() => setReveal(true), 650);
    } catch (_) {
      setNote('The dig did not happen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ ...lightBoardSx, display: 'grid', gap: 2 }}>
      <SectionHeader
        eyebrow="Sandbox"
        title="Dig the mounds"
        copy="The testnet mirror of the site sandbox game: pay 25 tTARI per dig and the mound pays out tTARI instead of items. Same flow the live game will run when Ootle launches."
      />
      <Box
        sx={{
          position: 'relative',
          display: 'grid',
          placeItems: 'center',
          minHeight: 220,
          borderRadius: 3,
          overflow: 'hidden',
          background: 'linear-gradient(180deg, #1d4ed8 0%, #3b82f6 45%, #93c5fd 100%)',
          border: '1px solid #e2e8f0'
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            right: '18%',
            top: '14%',
            width: 90,
            height: 90,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,248,220,0.95) 0%, rgba(255,235,180,0.35) 45%, rgba(255,235,180,0) 70%)',
            pointerEvents: 'none'
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: '34%',
            background: 'linear-gradient(180deg, #e6d6b8 0%, #d4c4a2 100%)',
            borderTopLeftRadius: '50% 24%',
            borderTopRightRadius: '50% 24%',
            pointerEvents: 'none'
          }}
        />
        {result ? (
          <Box sx={{ textAlign: 'center', position: 'relative', zIndex: 1, opacity: reveal ? 1 : 0, transform: reveal ? 'scale(1)' : 'scale(0.7)', transition: 'all .45s cubic-bezier(.34,1.56,.64,1)', display: 'grid', justifyItems: 'center', gap: 0.5 }}>
            {result.item && result.item.imageUrl ? (
              <Box
                component="img"
                src={result.item.imageUrl}
                alt={result.item.name}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                sx={{
                  width: 84,
                  height: 84,
                  objectFit: 'contain',
                  borderRadius: 2,
                  background: 'rgba(255,255,255,0.92)',
                  border: '2px solid rgba(255,255,255,0.9)',
                  boxShadow: '0 8px 28px rgba(0,0,0,0.35)'
                }}
              />
            ) : (
              <DiamondRoundedIcon sx={{ fontSize: 42, color: result.prizeTari > 0 ? '#fde047' : '#fcd34d' }} />
            )}
            {result.item ? (
              <Box>
                <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.05rem', sm: '1.25rem' }, color: '#ffffff', lineHeight: 1.2, textShadow: '0 2px 12px rgba(0,0,0,0.35)' }}>
                  {result.item.name}
                </Typography>
                <Typography sx={{ color: '#dbeafe', fontWeight: 700, fontSize: '0.8rem' }}>
                  {result.item.priceUsd != null ? `Market $${Number(result.item.priceUsd).toFixed(2)}` : 'Market price unknown'} · pretend drop, nothing delivered
                </Typography>
              </Box>
            ) : null}
            <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.6rem', sm: '2.1rem' }, color: '#ffffff', lineHeight: 1.1, textShadow: '0 2px 12px rgba(0,0,0,0.35)' }}>
              {result.prizeTari > 0 ? `+${result.prizeTari} tTARI` : 'Empty'}
            </Typography>
            <Typography sx={{ color: '#fef9c3', fontWeight: 700, fontSize: '0.85rem' }}>
              {result.prizeTari > 0 ? 'The mound pays out' : 'Nothing but sand this time'}
            </Typography>
          </Box>
        ) : (
          <Typography sx={{ color: 'rgba(255,255,255,0.85)', fontWeight: 700, fontSize: '0.95rem', textShadow: '0 1px 6px rgba(0,0,0,0.3)', zIndex: 1, position: 'relative' }}>
            {busy ? 'Digging…' : 'Pick a mound and dig'}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <Box component="button" type="button" onClick={dig} disabled={busy} sx={actionSx(busy)}>
          {busy ? 'Digging…' : 'Dig for 25 tTARI'}
        </Box>
        <Typography sx={{ color: '#64748b', fontSize: '0.78rem', fontWeight: 600 }}>
          Prizes 0 to 500 tTARI · provably fair · seed revealed each dig
        </Typography>
      </Box>
      {result ? (
        <Typography sx={{ color: '#94a3b8', fontSize: '0.7rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', overflowWrap: 'anywhere' }}>
          {`seed ${result.serverSeed}`}
        </Typography>
      ) : null}
      {note ? (
        <Typography sx={{ color: '#b45309', fontSize: '0.84rem', fontWeight: 600 }} aria-live="polite">{note}</Typography>
      ) : null}
    </Box>
  );
}

export default function GamesView() {
  const { user, authenticated, login } = useAuth();
  const [tab, setTab] = useState('crash');
  const [state, setState] = useState(null);
  const [stackNote, setStackNote] = useState('');

  // Hooks stay above the sign-in early return: the hook order must be
  // identical for anonymous and signed-in renders, or React unmounts the
  // whole app with "Rendered more hooks than during the previous render"
  // the moment the auth state changes on this page (white screen).
  const refresh = useCallback(() => {
    if (!authenticated) return;
    fetch('/api/ootle/games/state', { credentials: 'include', cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setState(data && data.data ? data.data : null))
      .catch(() => {});
  }, [authenticated]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!authenticated) {
    return (
      <ViewBoard id="ootle-games-board" crumb="Games">
      <Box sx={{ ...inlaidSx, background: '#ffffff', textAlign: 'center', py: { xs: 4, sm: 6 }, px: { xs: 2, sm: 4 } }}>
        <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.3rem', sm: '1.5rem' }, color: '#0f172a' }}>
          Testnet games
        </Typography>
        <Typography sx={{ color: '#64748b', fontSize: '0.92rem', lineHeight: 1.6, mt: 1.25, maxWidth: 460, mx: 'auto' }}>
          Crash arena, Sandbox, and Dig with tTARI play stacks. Sign in with Steam to claim 1,000 testnet tTARI and play.
        </Typography>
        <Box
          component="button"
          type="button"
          aria-label="Sign in through Steam"
          onClick={login}
          sx={{
            mt: 2.5, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', lineHeight: 0,
            transition: 'transform 0.2s ease, opacity 0.2s ease',
            '&:hover': { transform: 'scale(1.05)', opacity: 0.9 }
          }}
        >
          <Box component="img" src="/images/steamsignin.png" alt="Sign in through Steam" sx={{ height: { xs: 30, sm: 40 }, width: 'auto', maxWidth: '100%', objectFit: 'contain', display: 'block' }} />
        </Box>
      </Box>
      </ViewBoard>
    );
  }

  const claim = async () => {
    setStackNote('');
    const walletAddress = readWalletState(steamId).address || '';
    if (!walletAddress) {
      setStackNote('Create your Ootle wallet in the Wallet tab first.');
      return;
    }
    try {
      const res = await fetch('/api/ootle/local-wallet/faucet', {
        method: 'POST',
        credentials: 'include',
        headers: csrfHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ address: walletAddress })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        setStackNote(String((data && data.error) || 'The faucet did not send.'));
        return;
      }
      setStackNote('Receiving 333 tTARI…');
      setTimeout(() => setStackNote(''), 3500);
      refresh();
    } catch (_) {
      setStackNote('The faucet did not send.');
    }
  };

  return (
    <ViewBoard id="ootle-games-board" crumb="Games" sx={{ display: 'grid', gap: { xs: 2, sm: 2.5 } }}>
      <Box sx={inlaidSx}>
        <SectionHeader
          eyebrow="Games"
          title="Testnet tTARI games"
          copy="Play balances are testnet tTARI. The same routes settle on chain once Ootle goes live."
          action={(
            <Box
              component="span"
              sx={{ px: 1.75, py: 0.75, borderRadius: 999, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', fontWeight: 800, fontSize: '0.95rem', whiteSpace: 'nowrap' }}
            >
              {state ? `${Math.round(state.tari).toLocaleString('en-US')} tTARI` : '…'}
            </Box>
          )}
        />
        {stackNote ? (
          <Typography sx={{ color: '#334155', fontSize: '0.84rem', fontWeight: 600, mt: 2 }} aria-live="polite">{stackNote}</Typography>
        ) : null}
      </Box>

      <Box
        role="tablist"
        aria-label="Games"
        sx={{
          display: 'inline-flex',
          gap: 0.4,
          p: 0.4,
          borderRadius: 999,
          background: 'rgba(37, 99, 235, 0.08)',
          boxShadow: 'inset 0 1px 4px rgba(37, 99, 235, 0.18), inset 0 -1px 2px rgba(255, 255, 255, 0.7)',
          border: '1px solid rgba(37, 99, 235, 0.14)',
          width: 'fit-content',
          maxWidth: '100%'
        }}
      >
        {[
          { key: 'crash', label: 'Crash arena', Icon: ShowChartRoundedIcon },
          { key: 'sandbox', label: 'Sandbox', Icon: DiamondRoundedIcon },
          { key: 'dig', label: 'Dig', Icon: LandscapeRoundedIcon }
        ].map(({ key, label, Icon }) => {
          const active = tab === key;
          return (
            <Box
              key={key}
              component="button"
              type="button"
              role="tab"
              aria-pressed={active}
              onClick={() => setTab(key)}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.65,
                minHeight: 38,
                px: 2,
                borderRadius: 999,
                border: '1px solid',
                borderColor: active ? 'rgba(37, 99, 235, 0.5)' : 'transparent',
                background: active
                  ? 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)'
                  : 'transparent',
                color: active ? '#ffffff' : '#334155',
                fontWeight: 800,
                fontSize: '0.84rem',
                fontFamily: 'inherit',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all .15s',
                boxShadow: active
                  ? '0 4px 14px rgba(37, 99, 235, 0.35), inset 0 1px 0 rgba(255,255,255,0.28)'
                  : 'none',
                '&:hover': { color: active ? '#ffffff' : '#1d4ed8' }
              }}
            >
              <Icon sx={{ fontSize: 17 }} />
              {label}
            </Box>
          );
        })}
      </Box>

      {tab === 'crash' ? (
        <OotleCrashGame balance={state && state.tari} onBalance={refresh} />
      ) : null}
      {tab === 'sandbox' ? (
        <OotleSandboxGame user={user} />
      ) : null}
      {tab === 'dig' ? (
      <Box
        sx={{
          display: 'grid',
          gap: { xs: 2, sm: 2.5 },
          gridTemplateColumns: { md: 'minmax(0, 1.2fr) minmax(0, 1fr)' },
          alignItems: 'start'
        }}
      >
          <DigGame onBalance={refresh} />

        <Box sx={{ ...lightBoardSx, display: 'grid', gap: 1.25, alignContent: 'start', height: '100%', maxHeight: { xs: 300, md: 620 }, overflowY: 'auto' }}>
          <Typography component="h3" sx={{ fontWeight: 800, fontSize: '1rem', color: '#0f172a', position: 'sticky', top: 0, background: 'rgba(255,255,255,0.95)', zIndex: 1, py: 0.25 }}>Recent rounds</Typography>
          {state && state.history.length === 0 ? (
            <Typography sx={{ color: '#64748b', fontSize: '0.86rem', lineHeight: 1.5 }}>Your recent rounds will appear here.</Typography>
          ) : null}
          {(state ? state.history : []).map((row, index) => (
            <Box key={index} sx={{ display: 'grid', gridTemplateColumns: 'repeat(1, minmax(0, 1fr))', gap: 0.75, p: 1.25, borderRadius: 2, border: '1px solid #c7d2e3', background: '#f8fafc', minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
              <Typography sx={{ fontWeight: 800, fontSize: '0.8rem', color: '#475569', minWidth: 42 }}>{row.game === 'crash-arena' ? 'Arena' : row.game === 'sandbox' ? 'Sand' : row.game === 'crash' ? 'Crash' : 'Dig'}</Typography>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.84rem', color: '#0f172a', noWrap: true }}>
                  {row.betTari} tTARI → {row.outcomeTari} tTARI
                </Typography>
                <Typography sx={{ color: '#64748b', fontSize: '0.74rem' }}>
                  {row.game === 'crash' && row.crashPoint != null ? `bust ${row.crashPoint}x` : (row.multiplier ? `${row.multiplier}x` : '')}
                </Typography>
              </Box>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
      ) : null}
    </ViewBoard>
  );
}

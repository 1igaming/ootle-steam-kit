import React, { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import PollOutlinedIcon from '@mui/icons-material/PollOutlined';
import WhatshotRoundedIcon from '@mui/icons-material/WhatshotRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { useAuth } from '../../context/AuthContext';
import { csrfHeaders } from '../../utils/csrfHeaders';
import { readLocalOotleAddress, readWalletState } from '../../utils/localOotleWallet';
import SectionHeader from './SectionHeader';
import ViewBoard, { inlaidSx, raisedSx } from './ViewBoard';

/**
 * The Predict view of the Ootle hub — parimutuel market cards: live
 * countdowns, parimutuel Yes/No odds in color, pots, and the avatars of the
 * people who just picked. Picking a side arms the stake + lock flow; when
 * the market settles the winning side splits the losing pool.
 */

const POLL_MS = 12000;
const YES_COLOR = '#2563eb';
const NO_COLOR = '#0f172a';
const ink = '#0f172a';
const muted = '#64748b';

const FILTERS = [
  { key: 'trending', label: 'Trending' },
  { key: 'new', label: 'New' },
  { key: 'ending', label: 'Ending soon' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'all', label: 'All markets' },
  { key: 'mine', label: 'My picks' }
];

function marketState(row) {
  if (row.status === 'resolved') return 'resolved';
  if (row.status === 'closed') return 'closed';
  if (row.closesAt && Date.parse(row.closesAt) <= Date.now()) return 'closed';
  return 'open';
}

function formatStake(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return n >= 100 ? Math.round(n).toLocaleString('en-US') : String(Math.round(n * 100) / 100);
}

function trimStake(text) {
  return String(text || '').trim().replace(/\.?0+$/, (m) => (m.includes('.') ? '' : m));
}

function timeAgo(value) {
  const ms = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) return 'recently';
  const mins = Math.max(1, Math.round((Date.now() - ms) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/** Live countdown text from a shared ticking clock. */
function countdownText(msLeft) {
  if (!Number.isFinite(msLeft) || msLeft <= 0) return 'closing';
  const s = Math.floor(msLeft / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m left`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s left`;
  return `${m}m ${String(sec).padStart(2, '0')}s left`;
}

function Chip({ children, bg, border, color, sx }) {
  return (
    <Box component="span" sx={{ px: 1.25, py: 0.4, borderRadius: 999, background: bg, border: `1px solid ${border}`, color, fontSize: '0.72rem', fontWeight: 800, whiteSpace: 'nowrap', letterSpacing: '0.01em', ...(sx || {}) }}>
      {children}
    </Box>
  );
}

/** Big parimutuel price: Yes / No shares of the pot, in color. Markets
 *  picked before stakes existed (or with nothing locked yet) fall back to
 *  the split of pick counts, so an old market still shows a lean. */
function OddsRow({ row }) {
  const pot = Number(row.pot || 0);
  const yesStake = Number(row.yesStake || 0);
  const total = Number(row.total || 0);
  const yes = Number(row.yes || 0);
  let yesPct = null;
  let basis = '';
  if (pot > 0) {
    yesPct = Math.round((yesStake / pot) * 100);
    basis = 'tTARI';
  } else if (total > 0) {
    yesPct = Math.round((yes / total) * 100);
    basis = 'picks';
  }
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 1 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.7rem', sm: '1.95rem' }, lineHeight: 1, color: YES_COLOR, letterSpacing: '-0.02em' }}>
          Yes {yesPct == null ? '–' : `${yesPct}%`}
        </Typography>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: muted, mt: 0.4 }}>
          {basis === 'tTARI' ? `${formatStake(row.yesStake)} tTARI` : basis === 'picks' ? `${yes} pick${yes === 1 ? '' : 's'}` : 'no tTARI yet'}
        </Typography>
      </Box>
      <Box sx={{ minWidth: 0, textAlign: 'right' }}>
        <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.7rem', sm: '1.95rem' }, lineHeight: 1, color: NO_COLOR, letterSpacing: '-0.02em' }}>
          No {yesPct == null ? '–' : `${100 - yesPct}%`}
        </Typography>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: muted, mt: 0.4 }}>
          {basis === 'tTARI' ? `${formatStake(row.noStake)} tTARI` : basis === 'picks' ? `${total - yes} pick${total - yes === 1 ? '' : 's'}` : 'no tTARI yet'}
        </Typography>
      </Box>
    </Box>
  );
}

/** Animated Yes/No split; each half is clickable to arm that side. */
function SplitPickBar({ yes, no, selected, onPick, disabled }) {
  const total = yes + no;
  const yesPct = total > 0 ? Math.round((yes / total) * 100) : 50;
  const yesLabel = total > 0 ? `Yes ${yesPct}%` : 'Yes';
  const noLabel = total > 0 ? `No ${100 - yesPct}%` : 'No';
  return (
    <Box sx={{ display: 'flex', borderRadius: 999, overflow: 'hidden', border: '1px solid', borderColor: '#c7d2e3', minHeight: 46 }}>
      <Box
        component="button"
        type="button"
        disabled={disabled}
        onClick={() => onPick && onPick('yes')}
        aria-pressed={selected === 'yes'}
        sx={{
          flex: `${Math.max(yesPct, 28)} 1 0`,
          minWidth: 0,
          border: 'none',
          borderRight: '1px solid #ffffff',
          background: selected === 'yes'
            ? 'linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%)'
            : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
          color: '#ffffff',
          fontWeight: 800,
          fontSize: '0.95rem',
          fontFamily: 'inherit',
          cursor: disabled ? 'default' : 'pointer',
          transition: 'flex .6s cubic-bezier(.22,1,.36,1), background .15s',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          px: 1.5
        }}
      >
        {yesLabel}
      </Box>
      <Box
        component="button"
        type="button"
        disabled={disabled}
        onClick={() => onPick && onPick('no')}
        aria-pressed={selected === 'no'}
        sx={{
          flex: `${Math.max(100 - yesPct, 28)} 1 0`,
          minWidth: 0,
          border: 'none',
          background: selected === 'no'
            ? 'linear-gradient(135deg, #0f172a 0%, #020617 100%)'
            : 'linear-gradient(135deg, #334155 0%, #0f172a 100%)',
          color: '#ffffff',
          fontWeight: 800,
          fontSize: '0.95rem',
          fontFamily: 'inherit',
          cursor: disabled ? 'default' : 'pointer',
          transition: 'flex .6s cubic-bezier(.22,1,.36,1), background .15s',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          px: 1.5
        }}
      >
        {noLabel}
      </Box>
    </Box>
  );
}

/** The people who just picked, stacked avatars ringed with their side. */
function PickerStack({ pickers, total }) {
  if (!pickers.length) return null;
  const shown = pickers.slice(0, 5);
  const more = Math.max(0, total - shown.length);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
      <Box sx={{ display: 'flex' }}>
        {shown.map((p, i) => {
          const ring = p.side === 'yes' ? YES_COLOR : NO_COLOR;
          const label = `${p.name} · ${p.side === 'yes' ? 'Yes' : 'No'}`;
          return (
            <Box
              key={`${p.steamId}-${p.at}`}
              title={label}
              sx={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                border: `2px solid ${ring}`,
                background: '#ffffff',
                display: 'grid',
                placeItems: 'center',
                overflow: 'hidden',
                ml: i === 0 ? 0 : -1,
                boxShadow: '0 1px 3px rgba(15, 23, 42, 0.15)',
                flexShrink: 0
              }}
            >
              {p.avatar ? (
                <Box component="img" src={p.avatar} alt={p.name} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              ) : (
                <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, color: muted }}>
                  {String(p.name || '?').slice(0, 1).toUpperCase()}
                </Typography>
              )}
            </Box>
          );
        })}
      </Box>
      {more > 0 ? (
        <Typography sx={{ ml: 0.75, fontSize: '0.74rem', fontWeight: 800, color: muted, whiteSpace: 'nowrap' }}>
          +{more} more
        </Typography>
      ) : null}
    </Box>
  );
}

/** Floating confirmation pill — actions answer at the bottom of the
 *  viewport instead of a stray line under the cards. */
function Toast({ text }) {
  if (!text) return null;
  return (
    <Typography
      id="prediction-note"
      sx={{
        position: 'fixed',
        left: '50%',
        bottom: 28,
        transform: 'translateX(-50%)',
        zIndex: 1400,
        maxWidth: 'min(92vw, 520px)',
        px: 2.25,
        py: 1.25,
        borderRadius: 999,
        background: '#0f172a',
        color: '#ffffff',
        fontWeight: 700,
        fontSize: '0.88rem',
        lineHeight: 1.4,
        textAlign: 'center',
        boxShadow: '0 12px 32px rgba(15, 23, 42, 0.35)',
        animation: 'ootleToastIn .25s ease',
        pointerEvents: 'none'
      }}
      aria-live="polite"
    >
      {text}
    </Typography>
  );
}

/** One quiet editorial line instead of stat tiles: the numbers tell the
 *  story inline, the way a market desk reads a ticker. */
function PulseLine({ open, locked, picks, mine, myLocked }) {
  const items = [
    { value: String(open), label: open === 1 ? 'market open' : 'markets open' },
    { value: `${Math.round(locked).toLocaleString('en-US')} tTARI`, label: 'locked by the crowd' },
    { value: String(picks), label: picks === 1 ? 'pick placed' : 'picks placed' }
  ];
  if (mine > 0) {
    items.push({
      value: myLocked > 0 ? `${Math.round(myLocked).toLocaleString('en-US')} tTARI` : String(mine),
      label: myLocked > 0 ? 'of it yours' : (mine === 1 ? 'pick of yours' : 'picks of yours')
    });
  }
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 0.75, columnGap: 1.25, mt: 2 }}>
      {items.map((item, i) => (
        <React.Fragment key={item.label}>
          {i > 0 ? (
            <Box component="span" sx={{ color: '#cbd5e1', fontSize: '0.9rem', fontWeight: 800 }}>·</Box>
          ) : null}
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.5, minWidth: 0 }}>
            <Typography component="span" sx={{ fontWeight: 800, fontSize: '1.02rem', color: '#1d4ed8', whiteSpace: 'nowrap' }}>
              {item.value}
            </Typography>
            <Typography component="span" sx={{ fontWeight: 600, fontSize: '0.8rem', color: muted, whiteSpace: 'nowrap' }}>
              {item.label}
            </Typography>
          </Box>
        </React.Fragment>
      ))}
    </Box>
  );
}

function MarketCardSkeleton() {
  return (
    <Box sx={{ ...raisedSx, p: 2.25, display: 'grid', gap: 1.25 }}>
      <Box sx={{ height: 16, width: '65%', borderRadius: 1, background: '#eef2f7' }} />
      <Box sx={{ height: 40, borderRadius: 1, background: '#eef2f7' }} />
      <Box sx={{ height: 46, borderRadius: 999, background: '#eef2f7' }} />
      <Box sx={{ height: 10, width: '40%', borderRadius: 1, background: '#eef2f7' }} />
    </Box>
  );
}

function MarketCard({ row, rank, now, armed, busy, stake, stakeOk, authenticated, hasWallet, onArm, onCreateWallet, onConfirm, onStakeChange }) {
  const state = marketState(row);
  const closable = row.status === 'open' && state === 'open';
  const mineArmed = armed.startsWith(`${row.id}:`);
  const armedSide = mineArmed ? armed.split(':')[1] : '';
  const msLeft = row.closesAt ? Date.parse(row.closesAt) - now : NaN;
  const urgent = Number.isFinite(msLeft) && msLeft < 60 * 60 * 1000;
  const soon = Number.isFinite(msLeft) && msLeft < 24 * 60 * 60 * 1000;
  const resolved = state === 'resolved';
  const pickers = Array.isArray(row.recentPickers) ? row.recentPickers : [];

  return (
    <Box
      sx={{
        ...raisedSx,
        p: { xs: 1.75, sm: 2.25 },
        display: 'grid',
        gap: 1.25,
        alignContent: 'start',
        height: '100%',
        boxShadow: '0 2px 10px rgba(15, 23, 42, 0.06)'
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {row.category ? (
          <Chip bg="#eff6ff" border="#bfdbfe" color="#1d4ed8" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {row.category}
          </Chip>
        ) : null}
        {rank === 1 && closable ? (
          <Chip bg="#fff7ed" border="#fed7aa" color="#c2410c">
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
              <WhatshotRoundedIcon sx={{ fontSize: 13 }} /> Trending
            </Box>
          </Chip>
        ) : null}
        <Box sx={{ marginLeft: 'auto', display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {row.pot > 0 ? (
            <Chip bg="#eff6ff" border="#bfdbfe" color="#1d4ed8">Pot {Math.round(row.pot).toLocaleString('en-US')} tTARI</Chip>
          ) : null}
          {row.createdAt ? (
            <Chip bg="#f1f5f9" border="#e2e8f0" color="#64748b">{timeAgo(row.createdAt)}</Chip>
          ) : null}
        </Box>
      </Box>

      <Typography component="h3" sx={{ fontWeight: 800, fontSize: { xs: '1.02rem', sm: '1.12rem' }, lineHeight: 1.4, color: ink, minWidth: 0 }}>
        {row.question}
      </Typography>

      {resolved ? (
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1, p: 1.25, borderRadius: 2,
          background: row.outcome === 'yes' ? '#eff6ff' : '#f1f5f9',
          border: `1px solid ${row.outcome === 'yes' ? '#bfdbfe' : '#e2e8f0'}`
        }}>
          <CheckRoundedIcon sx={{ fontSize: 18, color: row.outcome === 'yes' ? '#2563eb' : '#334155' }} />
          <Typography sx={{ fontWeight: 800, fontSize: '0.88rem', color: row.outcome === 'yes' ? '#1d4ed8' : '#334155' }}>
            Paid out {row.outcome === 'yes' ? 'Yes' : 'No'}
            {row.payoutsPaidTari > 0 ? ` · ${formatStake(row.payoutsPaidTari)} tTARI to winners` : ''}
          </Typography>
        </Box>
      ) : (
        <OddsRow row={row} />
      )}

      {row.mySide && !mineArmed ? (
        <Box sx={{ display: 'grid', gap: 1 }}>
          <SplitPickBar yes={row.yes} no={row.no} selected={row.mySide} disabled />
          <Typography sx={{ color: '#1d4ed8', fontSize: '0.84rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <CheckRoundedIcon sx={{ fontSize: 16 }} />
            {row.myStake != null
              ? `You locked ${formatStake(row.myStake)} tTARI on ${row.mySide === 'yes' ? 'Yes' : 'No'}`
              : `You picked ${row.mySide === 'yes' ? 'Yes' : 'No'}`}
          </Typography>
        </Box>
      ) : !resolved ? (
        <Box sx={{ display: 'grid', gap: 1 }}>
          <SplitPickBar
            yes={row.yes}
            no={row.no}
            selected={armedSide}
            onPick={closable ? (side) => onArm(row.id, side) : undefined}
            disabled={!closable}
          />
          {mineArmed && authenticated && !hasWallet ? (
            <Box sx={{ display: 'grid', gap: 1, p: 1.25, borderRadius: 2, border: '1px solid #fde68a', background: '#fffbeb' }}>
              <Typography sx={{ color: '#92400e', fontSize: '0.84rem', fontWeight: 700, lineHeight: 1.5 }}>
                You need an Ootle wallet to lock tTARI on this market.
              </Typography>
              <Box
                component="button"
                type="button"
                id="prediction-create-wallet"
                onClick={onCreateWallet}
                sx={{
                  minHeight: 42, px: 2.5, borderRadius: 999, border: 'none', justifySelf: 'start',
                  background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                  color: '#fff', fontWeight: 800, fontSize: '0.88rem', fontFamily: 'inherit', cursor: 'pointer',
                  boxShadow: '0 6px 18px rgba(37, 99, 235, 0.3)',
                  '&:hover': { filter: 'brightness(1.07)' }
                }}
              >
                Create a wallet
              </Box>
            </Box>
          ) : null}
          {mineArmed && authenticated && hasWallet ? (
            <Box sx={{ display: 'grid', gap: 1 }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Box
                  component="input"
                  id="prediction-stake"
                  aria-label="Stake in tTARI"
                  inputMode="decimal"
                  value={stake}
                  onChange={(event) => onStakeChange(event.target.value)}
                  sx={{
                    width: 130,
                    minHeight: 42,
                    px: 1.5,
                    borderRadius: 999,
                    border: '1px solid',
                    borderColor: stakeOk ? '#c7d2e3' : '#dc2626',
                    background: '#ffffff',
                    color: ink,
                    fontWeight: 700,
                    fontSize: '0.9rem',
                    fontFamily: 'inherit',
                    outline: 'none',
                    '&:focus': { borderColor: '#2563eb', boxShadow: '0 0 0 3px rgba(37, 99, 235, 0.12)' }
                  }}
                />
                <Typography sx={{ color: muted, fontWeight: 800, fontSize: '0.82rem' }}>tTARI</Typography>
                <Box
                  component="button"
                  type="button"
                  id="prediction-confirm"
                  disabled={Boolean(busy) || !stakeOk}
                  onClick={() => onConfirm(row.id, armedSide)}
                  sx={{
                    minHeight: 42,
                    px: 2.5,
                    borderRadius: 999,
                    border: 'none',
                    background: armedSide === 'yes'
                      ? 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)'
                      : 'linear-gradient(135deg, #334155 0%, #0f172a 100%)',
                    color: '#ffffff',
                    fontWeight: 800,
                    fontSize: '0.88rem',
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    boxShadow: '0 6px 18px rgba(15, 23, 42, 0.2)',
                    '&:hover': { filter: 'brightness(1.07)' },
                    '&:disabled': { opacity: 0.6, cursor: 'default' }
                  }}
                >
                  {busy ? 'Locking…' : `Lock ${stakeOk ? `${trimStake(stake)} tTARI on ` : ''}${armedSide === 'yes' ? 'Yes' : 'No'}`}
                </Box>
              </Box>
              <Typography sx={{ color: stakeOk ? muted : '#dc2626', fontSize: '0.78rem', fontWeight: 600, lineHeight: 1.5 }}>
                {stakeOk
                  ? 'Winners split the losing pool at settlement, and payouts arrive in your browser wallet.'
                  : 'Enter a stake between 1 and 100,000 tTARI.'}
              </Typography>
            </Box>
          ) : null}
          {!authenticated && closable ? (
            <Typography sx={{ color: muted, fontSize: '0.8rem', lineHeight: 1.5 }}>
              Sign in with Steam to lock tTARI on this market.
            </Typography>
          ) : null}
        </Box>
      ) : null}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap', justifyContent: 'space-between', pt: 0.25, minHeight: 30 }}>
        <PickerStack pickers={pickers} total={row.total} />
        {state === 'open' && row.closesAt ? (
          <Chip
            bg={urgent ? '#fef2f2' : soon ? '#fffbeb' : '#f1f5f9'}
            border={urgent ? '#fecaca' : soon ? '#fde68a' : '#e2e8f0'}
            color={urgent ? '#b91c1c' : soon ? '#92400e' : '#475569'}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}
          >
            <ScheduleRoundedIcon sx={{ fontSize: 13 }} />
            {countdownText(msLeft)}
          </Chip>
        ) : state === 'closed' ? (
          <Chip bg="#f1f5f9" border="#e2e8f0" color="#475569">Closed</Chip>
        ) : null}
      </Box>
    </Box>
  );
}

export default function PredictionsSection({ onCreateWallet }) {
  const { user, authenticated } = useAuth();
  const steamId = user && user.steamId ? String(user.steamId) : '';
  const [markets, setMarkets] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('trending');
  const [armed, setArmed] = useState('');
  const [stake, setStake] = useState('100');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [now, setNow] = useState(Date.now());
  const noteTimer = useRef(null);

  const say = (text) => {
    setNote(text);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(''), 3800);
  };

  useEffect(() => () => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
  }, []);

  const refresh = () => {
    fetch('/api/ootle/predictions', { credentials: 'include', cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((data) => {
        setMarkets(Array.isArray(data.data) ? data.data : []);
        setLoaded(true);
      })
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  // one shared ticking clock drives every countdown on the board
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    setArmed('');
    setNote('');
  }, [authenticated]);

  const stats = useMemo(() => {
    const open = markets.filter((row) => marketState(row) === 'open');
    const picks = markets.reduce((sum, row) => sum + (row.total || 0), 0);
    const locked = markets.reduce((sum, row) => sum + (row.pot || 0), 0);
    const mine = markets.filter((row) => row.mySide).length;
    const myLocked = markets.reduce((sum, row) => sum + (row.myStake || 0), 0);
    return { open: open.length, picks, mine, locked, myLocked };
  }, [markets]);

  const HOURS_TRENDY = 72;
  const trendingScore = (row) => (row.total || 0) * 2 + (row.pot || 0) / 100 + Math.max(0, HOURS_TRENDY - (Date.now() - Date.parse(row.createdAt || 0)) / 3600000) / 24;
  const visible = useMemo(() => {
    const ageH = (row) => (Date.now() - Date.parse(row.createdAt || 0)) / 3600000;
    const closesInH = (row) => (row.closesAt ? (Date.parse(row.closesAt) - Date.now()) / 3600000 : Infinity);
    switch (filter) {
      case 'trending':
        return markets
          .filter((row) => marketState(row) === 'open')
          .sort((a, b) => trendingScore(b) - trendingScore(a));
      case 'new':
        return markets
          .filter((row) => marketState(row) === 'open')
          .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
      case 'ending':
        return markets
          .filter((row) => marketState(row) === 'open' && row.closesAt)
          .sort((a, b) => closesInH(a) - closesInH(b));
      case 'mine':
        return markets.filter((row) => row.mySide);
      case 'resolved':
        return markets
          .filter((row) => marketState(row) !== 'open')
          .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
      case 'all':
      default:
        return markets
          .filter((row) => marketState(row) === 'open')
          .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    }
  }, [markets, filter]);

  const armSide = (id, side) => {
    setNote('');
    setArmed((current) => (current === `${id}:${side}` ? '' : `${id}:${side}`));
  };

  const stakeOk = /^\d+(\.\d{1,6})?$/.test(stake.trim()) && Number(stake) >= 1 && Number(stake) <= 100000;

  const confirmPick = async (id, side) => {
    if (!authenticated) return;
    setBusy(`${id}:${side}`);
    setNote('');
    try {
      const address = readWalletState(steamId).address || readLocalOotleAddress(steamId) || '';
      const res = await fetch(`/api/ootle/predictions/${encodeURIComponent(id)}/pick`, {
        method: 'POST',
        credentials: 'include',
        headers: csrfHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ side, stake, address })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        say(String((data && data.error) || 'We could not record that pick. Please try again.'));
        return;
      }
      say(`Locked — ${side === 'yes' ? 'Yes' : 'No'} with ${trimStake(stake)} tTARI on the line.`);
      setArmed('');
      setMarkets((rows) => rows.map((row) => (row.id === id ? (data.data || row) : row)));
    } catch (_) {
      say('We could not record that pick. Please try again.');
    } finally {
      setBusy('');
    }
  };

  const walletState = readWalletState(steamId);
  const hasWallet = Boolean(walletState.address);

  return (
    <ViewBoard id="ootle-predict-board" crumb="Predict" sx={{ display: 'grid', gap: { xs: 1.75, sm: 2.25 } }}>

      <Box sx={inlaidSx}>
        <SectionHeader
          eyebrow="Predict"
          title="Community prediction markets"
          copy="Take a side on questions about the network, gaming, and the community. When a market settles, the winning side splits the losing pool."
          action={loaded ? (
            <Chip bg="#ffffff" border="#bfdbfe" color="#1d4ed8">
              {stats.open === 0 ? 'No open markets' : `${stats.open} open`}
            </Chip>
          ) : null}
        />
        <PulseLine open={stats.open} locked={stats.locked} picks={stats.picks} mine={stats.mine} myLocked={stats.myLocked} />
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center', mt: 2 }}>
          {FILTERS.map((item) => {
            const active = item.key === filter;
            return (
              <Box
                key={item.key}
                component="button"
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(item.key)}
                sx={{
                  minHeight: 38,
                  px: 2,
                  borderRadius: 999,
                  border: '1px solid',
                  borderColor: active ? '#2563eb' : '#e2e8f0',
                  background: active ? '#2563eb' : '#ffffff',
                  color: active ? '#ffffff' : '#475569',
                  fontWeight: 800,
                  fontSize: '0.82rem',
                  fontFamily: 'inherit',
                  cursor: 'pointer'
                }}
              >
                {item.label}
              </Box>
            );
          })}
          {filter === 'mine' && authenticated ? (
            <Typography sx={{ color: muted, fontSize: '0.8rem', fontWeight: 600, ml: 0.5 }}>
              {stats.mine === 0 ? 'You have not picked a side yet.' : `${stats.mine} pick${stats.mine === 1 ? '' : 's'} recorded.`}
            </Typography>
          ) : null}
        </Box>
      </Box>

      {!loaded ? (
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' } }}>
          <MarketCardSkeleton />
          <MarketCardSkeleton />
        </Box>
      ) : null}

      {loaded && visible.length === 0 ? (
        <Box sx={{ ...inlaidSx, textAlign: 'center', py: { xs: 3.5, sm: 5 }, px: 2, background: '#ffffff', boxShadow: 'none' }}>
          <PollOutlinedIcon sx={{ fontSize: 34, color: '#93c5fd', mb: 1 }} />
          <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: ink }}>
            {filter === 'mine' ? 'Nothing picked yet' : filter === 'resolved' ? 'Nothing has closed yet' : 'No open markets right now'}
          </Typography>
          <Typography sx={{ color: muted, fontSize: '0.88rem', lineHeight: 1.55, mt: 0.75, maxWidth: 420, mx: 'auto' }}>
            {filter === 'mine'
              ? 'Pick a side on any open market and it will appear here.'
              : 'New questions are posted regularly. Check back soon.'}
          </Typography>
        </Box>
      ) : null}

      {loaded && visible.length > 0 ? (
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' }, alignItems: 'stretch' }}>
          {visible.map((row, index) => (
            <MarketCard
              key={row.id}
              row={row}
              rank={index + 1}
              now={now}
              armed={armed}
              busy={busy}
              stake={stake}
              stakeOk={stakeOk}
              authenticated={authenticated}
              hasWallet={hasWallet}
              onArm={armSide}
              onCreateWallet={onCreateWallet}
              onConfirm={confirmPick}
              onStakeChange={setStake}
            />
          ))}
        </Box>
      ) : null}

      <Toast text={note} />
    </ViewBoard>
  );
}

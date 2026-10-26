import React, { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import SwapHorizOutlinedIcon from '@mui/icons-material/SwapHorizOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import HistoryEduRoundedIcon from '@mui/icons-material/HistoryEduRounded';
import { io } from 'socket.io-client';
import { useAuth } from '../../context/AuthContext';
import { csrfHeaders } from '../../utils/csrfHeaders';
import {
  forgetLocalOotleWallet,
  lockLocalOotleWallet,
  preloadOotleWalletModule,
  readStoragePersistence,
  requestPersistentStorage,
  readLocalOotleSecret,
  readUnlockedOotleSecret,
  readWalletState,
  subscribeLocalOotleWallet,
  unlockLocalOotleWallet
} from '../../utils/localOotleWallet';
import { KeypadPad, PinDots, PIN_KEYFRAMES } from './PinPad';
import SectionHeader from './SectionHeader';
import ShieldSection from './ShieldSection';
import ViewBoard, { raisedSx } from './ViewBoard';

/**
 * The Wallet view of the Ootle hub: one board card, three inlaid sections —
 * the balance hero, shield tTARI, and privacy & security. A locked wallet
 * shows the PIN pad instead; no wallet shows the welcome panel. The setup
 * dialog is mounted at the root of this view so it survives the moment a
 * wallet is created (the sections swap in behind it while the user is still
 * reading the recovery phrase).
 */

const cardSx = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 2.5,
  boxShadow: 'inset 0 1px 2px rgba(15, 23, 42, 0.05)',
  color: '#0f172a',
  p: { xs: 2, sm: 2.5 },
  minWidth: 0
};

const ink = '#0f172a';
const muted = '#64748b';
const BALANCE_TIMEOUT_MS = 8000;

function pillButtonSx(filled) {
  return {
    minHeight: 44,
    px: 1.75,
    borderRadius: 999,
    border: filled ? 'none' : '1px solid #c7d2e3',
    background: filled ? '#2563eb' : '#ffffff',
    color: filled ? '#ffffff' : '#0f172a',
    fontWeight: 800,
    fontSize: '0.88rem',
    fontFamily: 'inherit',
    cursor: 'pointer',
    '&:disabled': { opacity: 0.55, cursor: 'default' },
    '&:focus-visible': { outline: '2px solid #2563eb', outlineOffset: 2 }
  };
}

function formatTari(micro) {
  if (micro == null || micro === '') return '0';
  let n;
  try { n = BigInt(micro); } catch (_) { return '0'; }
  const neg = n < 0n;
  const v = neg ? -n : n;
  const whole = v / 1000000n;
  const frac = (v % 1000000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole.toString()}${frac ? `.${frac}` : ''}`;
}

function shortAddress(address) {
  return address && address.length > 26 ? `${address.slice(0, 18)}…${address.slice(-6)}` : address;
}

function BalanceTile({ label, value }) {
  return (
    <Box sx={{ ...raisedSx, flex: '1 1 190px', p: { xs: 1.75, sm: 2.25 } }}>
      <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: muted }}>
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.5rem', sm: '1.8rem' }, letterSpacing: '-0.02em', color: ink, lineHeight: 1.15, mt: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </Typography>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: muted }}>tTARI</Typography>
    </Box>
  );
}

/**
 * privacy-first shielded balance: the amount stays behind a closed lock
 * until the person at the keyboard chooses to reveal it (and hides again on
 * lock or navigation). Zero shielded shows a plain 0 — nothing to hide.
 */
function ShieldedTile({ total, stealthTari, voucherTari, shown, onToggle }) {
  const totalNum = Number(total || 0);
  const hidden = totalNum > 0 && !shown;
  const fmt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return (
    <Box sx={{ ...raisedSx, flex: '1 1 190px', p: { xs: 1.75, sm: 2.25 }, border: '1px solid #dbeafe', background: 'linear-gradient(160deg, #eff6ff 0%, #ffffff 70%)' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#1d4ed8' }}>
          Shielded · locked
        </Typography>
        {totalNum > 0 ? (
          <Box
            component="button"
            type="button"
            onClick={onToggle}
            aria-label={shown ? 'Hide the shielded balance' : 'Reveal the shielded balance'}
            title={shown ? 'Hide the shielded balance' : 'Reveal the shielded balance'}
            sx={{
              width: 26, height: 26, borderRadius: 999, display: 'grid', placeItems: 'center',
              border: '1px solid #bfdbfe', background: '#ffffff', color: '#2563eb',
              cursor: 'pointer', flexShrink: 0,
              '&:hover': { background: '#dbeafe' }
            }}
          >
            {shown ? <VisibilityOffOutlinedIcon sx={{ fontSize: 14 }} /> : <VisibilityOutlinedIcon sx={{ fontSize: 14 }} />}
          </Box>
        ) : null}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.5, minHeight: { xs: 29, sm: 34 } }}>
        {hidden ? <LockOutlinedIcon sx={{ fontSize: 20, color: '#2563eb' }} /> : null}
        <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.5rem', sm: '1.8rem' }, letterSpacing: '-0.02em', color: ink, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {hidden ? '•••••' : fmt(totalNum)}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: shown && totalNum > 0 ? '#1d4ed8' : muted }}>
        {shown && totalNum > 0
          ? `${fmt(stealthTari)} stealth · ${fmt(voucherTari)} vouchers`
          : (hidden ? 'Hidden — press the eye to reveal' : 'tTARI')}
      </Typography>
    </Box>
  );
}

const WALLET_FEATURES = [
  {
    Icon: ShieldOutlinedIcon,
    title: 'Locked with a PIN',
    copy: 'A 7-digit PIN scrambles the keys inside this browser. The 24-word phrase brings the wallet back on any device.'
  },
  {
    Icon: VisibilityOutlinedIcon,
    title: 'Amounts can hide on chain',
    copy: 'Ootle hides amounts behind cryptographic commitments and stealth outputs, so what you hold stays off the public graph.'
  },
  {
    Icon: SwapHorizOutlinedIcon,
    title: 'Both Tari layers',
    copy: 'Move between Minotari and Ootle tTARI without leaving the app.'
  }
];

function FeatureTiles() {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 1.5,
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' }
      }}
    >
      {WALLET_FEATURES.map(({ Icon, title, copy }) => (
        <Box key={title} sx={{ ...raisedSx, display: 'flex', gap: 1.5, alignItems: 'flex-start', minWidth: 0, p: { xs: 1.75, sm: 2 } }}>
          <Box sx={{ width: 40, height: 40, borderRadius: 2, flexShrink: 0, display: 'grid', placeItems: 'center', background: '#eff6ff', border: '1px solid #bfdbfe', color: '#2563eb' }}>
            <Icon sx={{ fontSize: 21 }} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '0.92rem', lineHeight: 1.3, mb: 0.35 }}>{title}</Typography>
            <Typography sx={{ color: muted, fontSize: '0.82rem', lineHeight: 1.5 }}>{copy}</Typography>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/** Safari (and all iOS browsers) clear a site's storage after 7 days without a visit. */
function isSafariLike() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const safari = /^((?!chrome|android|crios|fxios|edg\/).)*safari/i.test(ua);
  return ios || safari;
}

function StepUpDialog({ stepUp, onDigit, onBackspace, onCancel }) {
  if (!stepUp) return null;
  const titles = {
    keys: 'Enter your PIN to show keys',
    seed: 'Enter your PIN to show the recovery phrase',
    forget: 'Enter your PIN to forget this wallet'
  };
  return (
    <Dialog
      open
      onClose={stepUp.busy ? undefined : onCancel}
      fullWidth
      maxWidth="xs"
      disableEscapeKeyDown={stepUp.busy}
      PaperProps={{ sx: { borderRadius: 3, background: '#ffffff' } }}
    >
      <DialogContent sx={{ textAlign: 'center', p: { xs: 2, sm: 3 } }}>
        <style>{PIN_KEYFRAMES}</style>
        <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: '#0f172a', mb: 0.5 }}>
          {titles[stepUp.action] || 'Enter your PIN'}
        </Typography>
        <Typography sx={{ color: '#64748b', fontSize: '0.82rem', mb: 1 }}>
          This action asks for the PIN again even while the wallet is unlocked.
        </Typography>
        <PinDots filled={stepUp.entry.length} error={Boolean(stepUp.error)} />
        <Typography sx={{ color: stepUp.error ? '#dc2626' : '#64748b', fontSize: '0.8rem', minHeight: 20, fontWeight: stepUp.error ? 700 : 400 }}>
          {stepUp.error || 'Enter your 7-digit PIN'}
        </Typography>
        <KeypadPad
          disabled={stepUp.busy}
          onDigit={onDigit}
          onBackspace={onBackspace}
        />
        <Box
          component="button"
          type="button"
          onClick={onCancel}
          sx={{ mt: 1.5, minHeight: 36, px: 2, borderRadius: 999, border: '1px solid #c7d2e3', background: '#ffffff', color: '#475569', fontWeight: 700, fontSize: '0.8rem', fontFamily: 'inherit', cursor: 'pointer' }}
        >
          Cancel
        </Box>
      </DialogContent>
    </Dialog>
  );
}

/**
 * privacy-focused explainer: the two privacy instruments on Ootle. Lives
 * in the How it works view now (PrivacyOnOotleCard there) — the wallet keeps
 * the operating Shield section only.
 */
function SafariStorageWarning({ sx }) {
  if (!isSafariLike()) return null;
  return (
    <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', p: 1.5, borderRadius: 2, background: '#fffbeb', border: '1px solid #fde68a', ...sx }}>
      <HistoryEduRoundedIcon sx={{ fontSize: 20, color: '#b45309', mt: 0.25 }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 800, fontSize: '0.86rem', color: '#92400e' }}>
          Safari can clear this wallet
        </Typography>
        <Typography sx={{ color: '#92400e', fontSize: '0.8rem', lineHeight: 1.5, mt: 0.25 }}>
          Safari removes a site&apos;s stored data after seven days without a visit, and this wallet lives in that
          data. Keep your recovery phrase somewhere safe, or add this app to your Dock or Home Screen, where
          it is not cleared.
        </Typography>
      </Box>
    </Box>
  );
}

export default function WalletView({ onCreateWallet }) {
  const { user, authenticated, login } = useAuth();
  const steamId = user && user.steamId ? String(user.steamId) : '';
  const [state, setState] = useState({ status: 'none', address: '' });
  const [unlockEntry, setUnlockEntry] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [publicMicro, setPublicMicro] = useState(null);
  const [privateMicro, setPrivateMicro] = useState(null);
  const [vault, setVault] = useState(null);
  const [escrowCapacity, setEscrowCapacity] = useState(null);
  const [shieldShown, setShieldShown] = useState(false);
  const [balanceNote, setBalanceNote] = useState('');
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [revealed, setRevealed] = useState(null);
  const [seedRevealed, setSeedRevealed] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const [copied, setCopied] = useState('');
  const [storageState, setStorageState] = useState('checking');
  const [stepUp, setStepUp] = useState(null); // { action, entry, error, busy }
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [faucetNote, setFaucetNote] = useState('');
  const [balanceNonce, setBalanceNonce] = useState(0);

  const syncState = useCallback(() => setState(readWalletState(steamId)), [steamId]);

  useEffect(() => {
    syncState();
    const off = subscribeLocalOotleWallet(syncState);
    return off;
  }, [syncState]);

  useEffect(() => {
    if (!authenticated) return undefined;
    let closed = false;
    readStoragePersistence().then((state) => {
      if (!closed) setStorageState(state);
    });
    return () => { closed = true; };
  }, [authenticated, state.status]);

  // Warm the key module as soon as the wallet UI is on screen so the create
  // flow never waits on a cold download.
  useEffect(() => {
    preloadOotleWalletModule();
  }, []);

  useEffect(() => {
    if (!authenticated || !steamId) {
      setPublicMicro(null);
      setPrivateMicro(null);
      setVault(null);
      setShieldShown(false);
      setRevealed(null);
      setSeedRevealed(false);
      setConfirmForget(false);
      return undefined;
    }
    return undefined;
  }, [authenticated, steamId]);

  // the shielded amount hides again whenever the wallet leaves the unlocked
  // view, so a stray reveal never outlives the session at the keyboard
  useEffect(() => {
    if (state.status !== 'unlocked' && state.status !== 'legacy') setShieldShown(false);
  }, [state.status]);

  const address = state.address;

  // last-good balances survive transient read errors, so the tiles never
  // blip to '…' mid-session (that flicker read as the app twitching)
  const loadedOnceRef = useRef(false);

  useEffect(() => {
    if (!address) return undefined;
    let closed = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BALANCE_TIMEOUT_MS);
    if (!loadedOnceRef.current) setBalanceLoading(true);
    fetch('/api/ootle/local-wallet/balances', {
      method: 'POST',
      credentials: 'include',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ address }),
      signal: controller.signal
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (closed) return;
      const row = data.data || {};
      if (row.publicMicrotari != null && row.privateMicrotari != null) {
        loadedOnceRef.current = true;
        setPublicMicro(String(row.publicMicrotari));
        setPrivateMicro(String(row.privateMicrotari));
        setVault(row.vault && typeof row.vault === 'object' ? row.vault : null);
        setEscrowCapacity(row.escrowCapacityTari != null ? Number(row.escrowCapacityTari) : null);
        if (row.error) {
          setBalanceNote(row.error);
        } else if (row.pending > 0) {
          setBalanceNote(`${row.pending} transfer${row.pending === 1 ? '' : 's'} confirming on chain.`);
        } else if (row.fresh) {
          setBalanceNote('This wallet is new and holds no tTARI yet.');
        } else {
          setBalanceNote('');
        }
        return;
      }
      if (!loadedOnceRef.current) {
        setPublicMicro(null);
        setPrivateMicro(null);
        setVault(null);
        setBalanceNote(row.error || data.error || 'We could not read your balance just now. It will refresh shortly.');
      }
    }).catch(() => {
      if (closed) return;
      // transient failure (timeout, hiccup): keep the last good numbers on
      // screen and try again on the next tick — no flicker
      if (!loadedOnceRef.current) {
        setPublicMicro(null);
        setPrivateMicro(null);
        setVault(null);
        setBalanceNote('We could not read your balance just now. It will refresh shortly.');
      }
    }).finally(() => {
      if (!closed) setBalanceLoading(false);
      clearTimeout(timer);
    });
    return () => {
      closed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [address, balanceNonce]);

  // steady refresh cadence, independent of nonce-driven refetches
  useEffect(() => {
    if (!address) return undefined;
    const auto = setInterval(() => setBalanceNonce((n) => n + 1), 10000);
    return () => clearInterval(auto);
  }, [address]);

  // realtime: the server pushes 'ootleLedger' the moment anything moves the
  // balance (faucet, games, shields, escrows, stakes) — and the tab
  // refetches when it comes back into view
  useEffect(() => {
    let socket = null;
    try {
      socket = io('/', { transports: ['websocket', 'polling'] });
      socket.on('ootleLedger', () => setBalanceNonce((n) => n + 1));
    } catch (_) { /* polling still covers us */ }
    const onFocus = () => setBalanceNonce((n) => n + 1);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      if (socket) {
        socket.removeAllListeners('ootleLedger');
        socket.disconnect();
      }
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);

  const submitUnlock = async (pin) => {
    setUnlocking(true);
    setUnlockError('');
    try {
      await unlockLocalOotleWallet(steamId, pin);
      setUnlockEntry('');
    } catch (err) {
      setUnlockError(err && err.message ? err.message : 'That PIN does not match this wallet.');
    } finally {
      setUnlocking(false);
    }
  };

  const handleUnlockDigit = (digit) => {
    if (unlocking) return;
    setUnlockError('');
    if (unlockEntry.length >= 7) return;
    const next = unlockEntry + digit;
    setUnlockEntry(next);
    if (next.length === 7) {
      setTimeout(() => {
        submitUnlock(next);
        setUnlockEntry('');
      }, 220);
    }
  };

  // Physical keyboard support on the unlock pad, numeric pad style: number
  // keys type, Backspace deletes.
  useEffect(() => {
    if (state.status !== 'locked' || unlocking) return undefined;
    const onKey = (event) => {
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        handleUnlockDigit(event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        setUnlockError('');
        setUnlockEntry((current) => current.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const requestFaucet = async () => {
    if (!address || faucetBusy) return;
    setFaucetBusy(true);
    setFaucetNote('');
    try {
      const res = await fetch('/api/ootle/local-wallet/faucet', {
        method: 'POST',
        credentials: 'include',
        headers: csrfHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ address })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        setFaucetNote(String((data && data.error) || 'The faucet could not send right now. Please try again.'));
        return;
      }
      setFaucetNote('333 tTARI on the way…');
      const fadeAfter = Date.now() + 3500;
      const fade = setInterval(() => {
        if (Date.now() >= fadeAfter) {
          setFaucetNote('');
          clearInterval(fade);
        }
      }, 500);
      setTimeout(() => clearInterval(fade), 6000);
      // the transfer takes a moment to confirm; poll the balance every few
      // seconds so the number updates the moment it lands
      const startedAt = Date.now();
      const poll = setInterval(() => {
        setBalanceNonce((n) => n + 1);
        if (Date.now() - startedAt > 45000) clearInterval(poll);
      }, 3000);
      setTimeout(() => clearInterval(poll), 46000);
    } catch (_) {
      setFaucetNote('The faucet could not send right now. Please try again.');
    } finally {
      setFaucetBusy(false);
    }
  };

  const showKeys = () => {
    const row = readUnlockedOotleSecret(steamId) || readLocalOotleSecret(steamId);
    setRevealed(row ? { owner: row.secretKey, view: row.viewKey || '' } : { owner: '', view: '' });
  };

  /**
   * Step-up for sensitive actions: keys, the recovery phrase, and forgetting
   * the wallet all ask for the PIN again even while the wallet is unlocked,
   * the way hardware and mobile wallets do. The PIN is verified against the
   * sealed record; a wrong entry shakes and stays.
   */
  const beginStepUp = (action) => {
    setRevealed(null);
    setSeedRevealed(false);
    setStepUp({ action, entry: '', error: '', busy: false });
  };

  const doForget = () => {
    forgetLocalOotleWallet(steamId);
    setConfirmForget(false);
    setRevealed(null);
    setSeedRevealed(false);
  };

  const verifyStepUp = async (pin) => {
    const action = stepUp && stepUp.action;
    setStepUp((s) => (s ? { ...s, busy: true, error: '' } : s));
    try {
      // verifies the PIN against the sealed record; the wallet is already
      // unlocked, so this only confirms the person at the keyboard
      await unlockLocalOotleWallet(steamId, pin);
      setStepUp(null);
      if (action === 'keys') showKeys();
      else if (action === 'seed') setSeedRevealed(true);
      else if (action === 'forget') doForget();
    } catch (err) {
      setStepUp({ action, entry: '', error: (err && err.message) || 'That PIN is not right.', busy: false });
    }
  };

  const stepUpDigit = (digit) => {
    if (!stepUp || stepUp.busy) return;
    setStepUp((s) => (s ? { ...s, error: '' } : s));
    if (stepUp.entry.length >= 7) return;
    const next = stepUp.entry + digit;
    setStepUp((s) => (s ? { ...s, entry: next } : s));
    if (next.length === 7) {
      setTimeout(() => verifyStepUp(next), 220);
    }
  };

  // Physical keyboard support inside the step-up PIN modal too.
  useEffect(() => {
    if (!stepUp || stepUp.busy) return undefined;
    const onKey = (event) => {
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        stepUpDigit(event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        setStepUp((s) => (s ? { ...s, error: '', entry: s.entry.slice(0, -1) } : s));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const seedRow = state.status === 'unlocked' ? readUnlockedOotleSecret(steamId) : null;
  const keysAvailable = state.status === 'unlocked' || state.status === 'legacy';

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied('address');
      setTimeout(() => setCopied(''), 2200);
    } catch (_) { /* clipboard is optional */ }
  };

  let content = null;
  if (!authenticated) {
    content = (
      <ViewBoard id="ootle-wallet-board" crumb="Wallet" sx={{ display: 'grid', gap: { xs: 2, sm: 2.5 } }}>
        <Box sx={{ ...cardSx, textAlign: 'center', py: { xs: 4, sm: 5 }, px: { xs: 2, sm: 4 } }}>
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: 2.5,
              display: 'grid',
              placeItems: 'center',
              mx: 'auto',
              mb: 2,
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              color: '#2563eb'
            }}
          >
            <ShieldOutlinedIcon sx={{ fontSize: 28 }} />
          </Box>
          <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.4rem', sm: '1.6rem' }, letterSpacing: '-0.02em', color: ink, lineHeight: 1.15 }}>
            A private Tari wallet inside your browser
          </Typography>
          <Typography sx={{ color: muted, fontSize: '0.92rem', lineHeight: 1.6, mt: 1.25, maxWidth: 460, mx: 'auto' }}>
            Sign in with Steam to create one. You will receive a 24-word recovery phrase and a 7-digit PIN, and your keys
            never leave this browser.
          </Typography>
          <Box
            component="button"
            type="button"
            id="ootle-signin-start"
            aria-label="Sign in through Steam"
            onClick={login}
            sx={{
              mt: 2.5,
              border: 'none',
              background: 'transparent',
              padding: 0,
              cursor: 'pointer',
              lineHeight: 0,
              transition: 'transform 0.2s ease, opacity 0.2s ease',
              '&:hover': { transform: 'scale(1.05)', opacity: 0.9 },
              '&:active': { transform: 'scale(0.95)' },
              '&:focus-visible': { outline: '2px solid #2563eb', outlineOffset: 4, borderRadius: 1 }
            }}
          >
            <Box
              component="img"
              src="/images/steamsignin.png"
              alt="Sign in through Steam"
              sx={{ height: { xs: 30, sm: 40 }, width: 'auto', maxWidth: '100%', objectFit: 'contain', display: 'block' }}
            />
          </Box>
        </Box>
        <SafariStorageWarning />
        <FeatureTiles />
      </ViewBoard>
    );
  }

  else if (state.status === 'none') {
    content = (
      <ViewBoard id="ootle-wallet-board" crumb="Wallet" sx={{ display: 'grid', gap: { xs: 2, sm: 2.5 } }}>
        <style>{PIN_KEYFRAMES}</style>
        <Box sx={{ ...cardSx, textAlign: 'center', py: { xs: 4, sm: 6 }, px: { xs: 2, sm: 4 } }}>
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: 2.5,
              display: 'grid',
              placeItems: 'center',
              mx: 'auto',
              mb: 2,
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              color: '#2563eb'
            }}
          >
            <ShieldOutlinedIcon sx={{ fontSize: 28 }} />
          </Box>
          <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.4rem', sm: '1.6rem' }, letterSpacing: '-0.02em', color: ink, lineHeight: 1.15 }}>
            Set up your Ootle wallet
          </Typography>
          <Typography sx={{ color: muted, fontSize: '0.92rem', lineHeight: 1.6, mt: 1.25, maxWidth: 450, mx: 'auto' }}>
            It takes about a minute. Write down your 24-word recovery phrase and choose a 7-digit PIN to lock the keys
            inside this browser.
          </Typography>
          <Button
            id="ootle-create-wallet"
            variant="contained"
            onClick={() => { if (onCreateWallet) onCreateWallet(); }}
            sx={{
              textTransform: 'none', fontWeight: 800, borderRadius: 999, px: 3.5, py: 1.25, mt: 2.5,
              fontSize: '0.95rem', bgcolor: '#2563eb', color: '#fff',
              boxShadow: '0 8px 24px rgba(37, 99, 235, 0.3)',
              '&:hover': { bgcolor: '#1d4ed8' }
            }}
          >
            Create wallet
          </Button>
        </Box>
        <SafariStorageWarning />
        <FeatureTiles />
      </ViewBoard>
    );
  }

  else if (state.status === 'locked') {
    content = (
      <ViewBoard id="ootle-wallet-board" crumb="Wallet" sx={{ display: 'grid', gap: 2.5 }}>
        <style>{PIN_KEYFRAMES}</style>
        <Box sx={{ ...cardSx, background: '#ffffff', textAlign: 'center', py: { xs: 3, sm: 4 } }}>
          <SectionHeader
            eyebrow="Privacy & security"
            title="Enter your PIN"
            copy="The PIN unscrambles the keys stored in this browser."
            sx={{ textAlign: 'left' }}
          />
          <PinDots filled={unlockEntry.length} error={Boolean(unlockError)} />
          <Typography sx={{ color: unlockError ? '#dc2626' : muted, fontSize: '0.82rem', minHeight: 20, fontWeight: unlockError ? 700 : 400 }}>
            {unlockError || 'Enter your 7-digit PIN'}
          </Typography>
          <KeypadPad
            disabled={unlocking}
            onDigit={handleUnlockDigit}
            onBackspace={() => { setUnlockError(''); setUnlockEntry((c) => c.slice(0, -1)); }}
          />
        </Box>
      </ViewBoard>
    );
  }

  else {
    content = (
    <ViewBoard id="ootle-wallet-board" crumb="Wallet" sx={{ display: 'grid', gap: { xs: 2, sm: 2.5 } }}>
      <style>{PIN_KEYFRAMES}</style>

      <Box sx={cardSx} id="ootle-balance-section">
        <SectionHeader
          eyebrow="Your balance"
          title="Revealed and shielded tTARI"
          action={(
            <Box
              component="button"
              type="button"
              id="ootle-copy-address"
              onClick={copyAddress}
              title={address}
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.75, minHeight: 36, px: 1.5,
                borderRadius: 999, border: '1px solid #e2e8f0', background: '#ffffff',
                color: copied === 'address' ? '#15803d' : '#475569',
                fontWeight: 700, fontSize: '0.78rem', fontFamily: 'inherit',
                cursor: 'pointer', whiteSpace: 'nowrap'
              }}
            >
              <ContentCopyOutlinedIcon sx={{ fontSize: 14 }} />
              {copied === 'address' ? 'Copied' : shortAddress(address)}
            </Box>
          )}
        />
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 2 }}>
          <BalanceTile label="Revealed · spendable" value={balanceLoading && publicMicro == null ? '…' : formatTari(publicMicro)} />
          <ShieldedTile
            total={vault ? vault.totalTari : 0}
            stealthTari={vault ? vault.stealthTari : 0}
            voucherTari={vault ? vault.voucherTari : 0}
            shown={shieldShown}
            onToggle={() => setShieldShown((v) => !v)}
          />
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', mt: 2 }}>
          <Box
            component="button"
            type="button"
            id="ootle-faucet"
            disabled={faucetBusy || !address}
            onClick={requestFaucet}
            sx={{
              minHeight: 44,
              px: 2.25,
              borderRadius: 999,
              border: 'none',
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
              color: '#fff',
              fontWeight: 800,
              fontSize: '0.88rem',
              fontFamily: 'inherit',
              cursor: 'pointer',
              boxShadow: '0 8px 20px rgba(37, 99, 235, 0.3)',
              '&:hover': { filter: 'brightness(1.07)' },
              '&:active': { transform: 'translateY(1px)' },
              '&:disabled': { opacity: 0.55, cursor: 'default' }
            }}
          >
            {faucetBusy ? 'Sending…' : 'Get 333 tTARI'}
          </Box>
        </Box>
        {faucetNote ? (
          <Typography sx={{ color: '#0f172a', fontSize: '0.84rem', lineHeight: 1.5, mt: 1, fontWeight: 600 }} aria-live="polite">
            {faucetNote}
          </Typography>
        ) : null}
        {balanceNote ? (
          <Typography sx={{ color: '#334155', fontSize: '0.84rem', lineHeight: 1.5, mt: 1.5 }}>{balanceNote}</Typography>
        ) : null}
      </Box>

      <ShieldSection
        address={address}
        spendableTari={publicMicro != null ? Number(formatTari(publicMicro)) : 0}
        escrowCapacityTari={escrowCapacity}
        vault={vault}
        onVault={(next) => {
          if (next) setVault(next);
          setBalanceNonce((n) => n + 1);
        }}
      />

      <Box sx={cardSx} id="ootle-security-section">
        <SectionHeader
          eyebrow="Privacy & security"
          title={state.status === 'legacy' ? 'Privacy & security' : 'Lock, recover, or wipe'}
          copy={state.status === 'legacy'
            ? 'This wallet was created before the setup flow, so it has no recovery phrase. Forget it and create a new one for the full kit.'
            : 'Your PIN encrypts the keys in this browser, and the recovery phrase restores the wallet on any device. Lock it whenever you step away.'}
        />
        <StepUpDialog
          stepUp={stepUp}
          onDigit={stepUpDigit}
          onBackspace={() => setStepUp((s) => (s ? { ...s, error: '', entry: s.entry.slice(0, -1) } : s))}
          onCancel={() => setStepUp(null)}
        />

        <SafariStorageWarning sx={{ mt: 2 }} />

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }}>
          <Box
            component="button"
            id="ootle-show-keys"
            type="button"
            disabled={!keysAvailable || Boolean(stepUp)}
            onClick={revealed
              ? () => setRevealed(null)
              : (state.status === 'legacy' ? showKeys : () => beginStepUp('keys'))}
            sx={pillButtonSx(false)}
          >
            {revealed ? 'Hide keys' : 'Show keys'}
          </Box>
          {state.status === 'unlocked' ? (
            <Box
              component="button"
              id="ootle-recovery-phrase"
              type="button"
              disabled={!seedRow}
              title={seedRow ? 'Show the 24-word recovery phrase' : 'This wallet has no recovery phrase'}
              onClick={() => (seedRevealed ? setSeedRevealed(false) : beginStepUp('seed'))}
              disabled={Boolean(stepUp)}
              sx={pillButtonSx(false)}
            >
              {seedRevealed ? 'Hide phrase' : 'Recovery phrase'}
            </Box>
          ) : null}
          {state.status === 'unlocked' ? (
            <Box
              component="button"
              id="ootle-lock"
              type="button"
              onClick={() => { lockLocalOotleWallet(steamId); setRevealed(null); setSeedRevealed(false); }}
              sx={pillButtonSx(false)}
            >
              Lock
            </Box>
          ) : null}
          {confirmForget ? (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: '#b91c1c' }}>Remove this wallet from this browser?</Typography>
              <Box
                component="button"
                id="ootle-forget-confirm"
                type="button"
                onClick={() => { forgetLocalOotleWallet(steamId); setConfirmForget(false); setRevealed(null); setSeedRevealed(false); }}
                sx={{ ...pillButtonSx(false), border: '1px solid #fca5a5', color: '#b91c1c' }}
              >
                Yes, forget it
              </Box>
              <Box component="button" type="button" onClick={() => setConfirmForget(false)} sx={pillButtonSx(false)}>
                Keep it
              </Box>
            </Box>
          ) : (
            <Box
              component="button"
              id="ootle-forget"
              type="button"
              disabled={Boolean(stepUp)}
              onClick={() => (state.status === 'legacy' ? setConfirmForget(true) : beginStepUp('forget'))}
              sx={{ ...pillButtonSx(false), color: '#b91c1c' }}
            >
              Forget wallet
            </Box>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap', mt: 1.75, p: 1.25, borderRadius: 2, border: '1px solid #e2e8f0', background: '#ffffff', boxShadow: '0 1px 3px rgba(15, 23, 42, 0.07)' }}>
          <Box sx={{ minWidth: 0, flex: '1 1 220px' }}>
            <Typography sx={{ fontWeight: 800, fontSize: '0.84rem', color: '#0f172a' }}>Device storage</Typography>
            <Typography sx={{ color: '#64748b', fontSize: '0.78rem', lineHeight: 1.45 }}>
              {storageState === 'persistent'
                ? 'This browser keeps the wallet even under disk pressure.'
                : storageState === 'best-effort'
                  ? 'The browser may clear site data to free space. Persistent storage keeps the wallet safe.'
                  : storageState === 'checking'
                    ? 'Checking how this browser stores the wallet…'
                    : 'This browser does not report storage persistence.'}
            </Typography>
          </Box>
          {storageState === 'persistent' ? (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.4, borderRadius: 999, background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#047857', fontSize: '0.72rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
              Persistent
            </Box>
          ) : (storageState === 'best-effort' ? (
            <Box
              component="button"
              type="button"
              id="ootle-keep-storage"
              onClick={async () => {
                const granted = await requestPersistentStorage();
                setStorageState(granted ? 'persistent' : 'best-effort');
              }}
              sx={{ ...pillButtonSx(false), minHeight: 38, fontSize: '0.8rem' }}
            >
              Keep wallet on this device
            </Box>
          ) : null)}
        </Box>

        {revealed ? (
          <Box sx={{ p: 1.5, borderRadius: 2, background: '#ffffff', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(15, 23, 42, 0.07)', mt: 1.5 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '0.8rem', mb: 0.75 }}>Owner secret</Typography>
            <Typography component="code" sx={{ display: 'block', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '0.75rem', lineHeight: 1.45, overflowWrap: 'anywhere', wordBreak: 'break-all' }}>
              {revealed.owner || 'No key is stored in this browser.'}
            </Typography>
            {revealed.view ? (
              <>
                <Typography sx={{ fontWeight: 800, fontSize: '0.8rem', mt: 1, mb: 0.75 }}>View secret</Typography>
                <Typography component="code" sx={{ display: 'block', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '0.75rem', lineHeight: 1.45, overflowWrap: 'anywhere', wordBreak: 'break-all' }}>
                  {revealed.view}
                </Typography>
              </>
            ) : null}
            <Typography sx={{ color: muted, fontSize: '0.78rem', lineHeight: 1.45, mt: 0.75 }}>
              Read from this browser only. It is not sent to the site.
            </Typography>
          </Box>
        ) : null}

        {seedRevealed && seedRow && Array.isArray(seedRow.mnemonic) ? (
          <Box sx={{ p: 1.5, borderRadius: 2, background: '#fffbeb', border: '1px solid #fde68a', mt: 1.5 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '0.8rem', color: '#92400e', mb: 0.75 }}>24-word recovery phrase</Typography>
            <Typography component="code" sx={{ display: 'block', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '0.78rem', lineHeight: 1.7, color: '#0f172a', overflowWrap: 'anywhere' }}>
              {seedRow.mnemonic.join(' ')}
            </Typography>
            <Typography sx={{ color: '#92400e', fontSize: '0.78rem', lineHeight: 1.45, mt: 0.75 }}>
              Anyone who reads these words can spend from this wallet. Keep them on paper, not on this device.
            </Typography>
          </Box>
        ) : null}
      </Box>

    </ViewBoard>
    );
  }

  return content;
}

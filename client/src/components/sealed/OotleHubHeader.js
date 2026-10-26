import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined';
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import { useAuth } from '../../context/AuthContext';
import { readWalletState, subscribeLocalOotleWallet } from '../../utils/localOotleWallet';
import { readKeepHeaderVisible } from '../../utils/headerSticky';

/**
 * The Ootle hub chrome: brand + network badge on one row, view tabs below
 * it, and the wallet status chip that is always reachable. The tabs stick
 * to the viewport top while the page scrolls.
 */

export const OOTLE_VIEWS = [
  { key: 'wallet', label: 'Wallet' },
  // Convert stays in the code but is hidden for the testnet alpha; the
  // swap routes open with the Ootle launch. Re-add when that ships.
  // { key: 'convert', label: 'Convert' },
  { key: 'games', label: 'Games' },
  { key: 'trade', label: 'Trade' },
  { key: 'predict', label: 'Predict' },
  { key: 'how', label: 'How it works' }
].filter(Boolean);

const barSx = {
  background: 'rgba(255, 255, 255, 0.92)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  borderRadius: 3,
  border: '1px solid rgba(255, 255, 255, 0.6)',
  boxShadow: '0 8px 28px rgba(15, 23, 42, 0.12)',
  px: { xs: 1.25, sm: 2 },
  py: { xs: 1.1, sm: 1.4 },
  position: 'sticky',
  zIndex: 20,
  minWidth: 0
};

const networkChipSx = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0.75,
  px: 1.25,
  py: 0.4,
  borderRadius: 1,
  background: '#fffbeb',
  border: '1px solid #fde68a',
  color: '#92400e',
  fontSize: { xs: '0.62rem', sm: '0.68rem' },
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  whiteSpace: 'nowrap'
};

export default function OotleHubHeader({ view, onViewChange, onCreateWallet, gate }) {
  const { user, authenticated, login } = useAuth();
  const steamId = user && user.steamId ? String(user.steamId) : '';
  const [walletState, setWalletState] = useState({ status: 'none', address: '' });
  const [keepHeader, setKeepHeader] = useState(false);

  useEffect(() => {
    const sync = () => setKeepHeader(readKeepHeaderVisible());
    sync();
    window.addEventListener('dapp-header-sticky', sync);
    return () => window.removeEventListener('dapp-header-sticky', sync);
  }, []);

  useEffect(() => {
    const sync = () => setWalletState(readWalletState(steamId));
    sync();
    const off = subscribeLocalOotleWallet(sync);
    return off;
  }, [steamId]);

  const shortAddress = walletState.address && walletState.address.length > 26
    ? `${walletState.address.slice(0, 12)}…${walletState.address.slice(-4)}`
    : walletState.address;

  const walletChip = () => {
    // Signed-out visitors can sign in from the wallet view; a second
    // sign-in pill up here is noise.
    if (!authenticated) return null;
    if (walletState.status === 'none') {
      return (
        <Box
          component="button"
          type="button"
          id="ootle-chip-create"
          onClick={() => { if (authenticated) { if (onCreateWallet) onCreateWallet(); } else if (login) { login(); } }}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            minHeight: 34,
            px: 1.5,
            borderRadius: 999,
            border: '1px solid #2563eb',
            background: '#2563eb',
            color: '#ffffff',
            fontWeight: 800,
            fontSize: '0.78rem',
            fontFamily: 'inherit',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            '&:hover': { background: '#1d4ed8' }
          }}
        >
          <AccountBalanceWalletOutlinedIcon sx={{ fontSize: 16 }} />
          {authenticated ? 'Create wallet' : 'Sign in to start'}
        </Box>
      );
    }
    if (walletState.status === 'locked') {
      return (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.5, minHeight: 34, borderRadius: 999, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#475569', fontWeight: 800, fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
          <LockOutlinedIcon sx={{ fontSize: 15 }} />
          Locked
        </Box>
      );
    }
    return (
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.5, minHeight: 34, borderRadius: 999, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', fontWeight: 800, fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
        <LockOpenOutlinedIcon sx={{ fontSize: 15 }} />
        {shortAddress}
      </Box>
    );
  };

  return (
    <Box sx={{ ...barSx, top: keepHeader ? { xs: 104, md: 76 } : { xs: 8, md: 10 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 1.5 }, flexWrap: 'wrap', minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
          <Box component="h2" sx={{ fontWeight: 800, fontSize: { xs: '1.1rem', sm: '1.25rem' }, letterSpacing: '-0.02em', color: '#0f172a', lineHeight: 1.1 }}>
            Ootle
          </Box>
          <Typography sx={{ color: '#2563eb', fontWeight: 800, fontSize: '0.7rem', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Tari L2
          </Typography>
        </Box>
        <Box component="span" sx={networkChipSx}>Esmeralda testnet</Box>
        <Box
          component="a"
          id="ootle-back-to-site"
          href={process.env.REACT_APP_HOME_URL || "/"}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            minHeight: 34,
            px: 1.5,
            borderRadius: 999,
            border: '1px solid #e2e8f0',
            background: '#f8fafc',
            color: '#475569',
            fontWeight: 800,
            fontSize: '0.78rem',
            fontFamily: 'inherit',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            transition: 'all .15s',
            '&:hover': { borderColor: '#93c5fd', color: '#1d4ed8', background: '#eff6ff' }
          }}
        >
          <ArrowBackRoundedIcon sx={{ fontSize: 15 }} />
          Home
        </Box>
        <Box sx={{ ml: 'auto', minWidth: 0 }}>{walletChip()}</Box>
      </Box>

      <Box
        role="tablist"
        aria-label="Ootle sections"
        sx={{
          display: 'inline-flex',
          gap: 0.4,
          p: 0.4,
          mt: 1.25,
          borderRadius: 999,
          background: 'rgba(37, 99, 235, 0.08)',
          boxShadow: 'inset 0 1px 4px rgba(37, 99, 235, 0.18), inset 0 -1px 2px rgba(255, 255, 255, 0.7)',
          border: '1px solid rgba(37, 99, 235, 0.14)',
          maxWidth: '100%',
          overflowX: 'auto'
        }}
      >
        {OOTLE_VIEWS.map((item) => {
          const active = item.key === view;
          const blocked = gate && item.key !== 'wallet' && item.key !== 'how';
          return (
            <Box
              key={item.key}
              component="button"
              type="button"
              role="tab"
              aria-selected={active}
              aria-disabled={blocked || undefined}
              onClick={() => { if (!blocked) onViewChange(item.key); }}
              sx={{
                minHeight: 38,
                px: 2,
                borderRadius: 999,
                border: '1px solid',
                borderColor: active ? 'rgba(37, 99, 235, 0.5)' : 'transparent',
                background: active
                  ? 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)'
                  : 'transparent',
                color: active ? '#ffffff' : blocked ? 'rgba(100, 116, 139, 0.55)' : '#334155',
                fontWeight: 800,
                fontSize: '0.84rem',
                fontFamily: 'inherit',
                cursor: blocked ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all .15s',
                boxShadow: active
                  ? '0 4px 14px rgba(37, 99, 235, 0.35), inset 0 1px 0 rgba(255,255,255,0.28)'
                  : 'none',
                '&:hover': blocked ? {} : { color: '#ffffff' }
              }}
            >
              {item.label}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

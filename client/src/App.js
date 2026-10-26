import React, { useEffect, useState } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import { AuthProvider, useAuth } from './context/AuthContext';
import OotleHubHeader, { OOTLE_VIEWS } from './components/sealed/OotleHubHeader';
import WalletView from './components/sealed/WalletView';
import WalletSetupDialog from './components/sealed/WalletSetupDialog';
import GamesView from './components/sealed/GamesView';
import PredictionsSection from './components/sealed/PredictionsSection';
import EscrowDemoView from './components/sealed/EscrowDemoView';
import ViewBoard from './components/sealed/ViewBoard';
import HowItWorksView from './components/sealed/HowItWorksView';

const theme = createTheme({
  palette: { primary: { main: '#2563eb' }, background: { default: '#eff6ff' } },
  shape: { borderRadius: 12 }
});

const VIEW_KEYS = OOTLE_VIEWS.map((v) => v.key);

function readViewFromHash() {
  const raw = String(window.location.hash || '').replace(/^#\/?/, '');
  return VIEW_KEYS.includes(raw) ? raw : 'wallet';
}

function DApp() {
  const { user, authenticated } = useAuth();
  const [view, setView] = useState(readViewFromHash());
  const [setupOpen, setSetupOpen] = useState(false);
  const [loginNote, setLoginNote] = useState('');
  const steamId = user && user.steamId ? String(user.steamId) : '';

  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get('login');
    if (flag === 'notconfigured' || flag === 'error') {
      setLoginNote(flag);
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    }
  }, []);

  useEffect(() => {
    const onHash = () => setView(readViewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const changeView = (next) => {
    setView(next);
    window.history.replaceState(null, '', `#/${next}`);
  };

  return (
    <Box sx={{ minHeight: '100vh', background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', p: { xs: 1.5, sm: 3 } }}>
      <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
        <OotleHubHeader
          view={view}
          onViewChange={changeView}
          onCreateWallet={() => { changeView('wallet'); setSetupOpen(true); }}
        />
        {loginNote ? (
          <Alert
            severity={loginNote === 'error' ? 'error' : 'warning'}
            onClose={() => setLoginNote('')}
            sx={{ mt: 2 }}
          >
            {loginNote === 'notconfigured'
              ? 'Steam sign-in is not configured on this server. Set STEAM_API_KEY in server/.env — see the README for where to get one.'
              : 'Steam sign-in failed. Try again.'}
          </Alert>
        ) : null}
        <Box sx={{ mt: 2.5, minWidth: 0 }}>
          {view === 'wallet' ? <WalletView onCreateWallet={() => setSetupOpen(true)} /> : null}
          {view === 'games' ? <GamesView /> : null}
          {view === 'trade' ? (
            <ViewBoard id="ootle-trade-board" crumb="Trade" sx={{ display: 'grid', gap: { xs: 1.75, sm: 2.25 } }}>
              <EscrowDemoView />
            </ViewBoard>
          ) : null}
          {view === 'predict' ? <PredictionsSection onCreateWallet={() => { changeView('wallet'); setSetupOpen(true); }} /> : null}
          {view === 'how' ? <HowItWorksView /> : null}
        </Box>
      </Box>
      <WalletSetupDialog
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        steamId={steamId}
      />
    </Box>
  );
}

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <DApp />
      </AuthProvider>
    </ThemeProvider>
  );
}

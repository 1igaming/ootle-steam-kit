export const BRAND_BLUE = '#2563eb';
export const PANEL_INK = '#0f172a';
export const PANEL_MUTED = '#64748b';
export const MARKET_GRADIENT = 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)';
export const marketPageShellSx = { minHeight: '100vh', p: { xs: 2, sm: 3 } };
export const marketContentSx = { maxWidth: 1200, mx: 'auto', width: '100%' };
export const lightPanelPaperSx = {
  borderRadius: 3, bgcolor: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(20px)',
  border: '1px solid rgba(255,255,255,0.3)', boxShadow: '0 8px 32px rgba(0,0,0,0.15)'
};
export const heroTitleSx = { fontWeight: 800, fontSize: '2rem', color: '#0f172a' };
export const heroSubtitleSx = { color: '#64748b' };
export const heroOutlineButtonSx = { border: '1px solid #c7d2e3', color: '#0f172a' };

export const glassSearchFieldSx = {
  width: '100%',
  '& .MuiOutlinedInput-root': {
    borderRadius: '999px',
    backgroundColor: '#ffffff',
    '& fieldset': { borderColor: '#c7d2e3' },
    '&:hover fieldset': { borderColor: '#93c5fd' },
    '&.Mui-focused fieldset': { borderColor: '#2563eb' }
  }
};

export const glassCard = {
  background: 'linear-gradient(160deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.06) 100%)',
  backdropFilter: 'blur(24px) saturate(150%)',
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: 4
};

import Box from '@mui/material/Box';

/**
 * One board per tab: every view (Wallet, Games, Trade, Predict, How it
 * works) renders its whole content inside a single outer card, and the
 * sections inside it are inlaid panels — recessed wells with a hairline
 * border — so a tab reads as one composed surface instead of a stack of
 * floating cards. Elements inside an inlaid panel that need separation
 * become raised cards again (white, soft shadow).
 */

export const boardSx = {
  background: '#ffffff',
  borderRadius: 3.5,
  border: '1px solid rgba(255, 255, 255, 0.5)',
  boxShadow: '0 12px 40px rgba(15, 23, 42, 0.12)',
  color: '#0f172a',
  p: { xs: 1.75, sm: 2.5 },
  minWidth: 0
};

/** A section inside the board: recessed, hairline border, inset shadow. */
export const inlaidSx = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 2.5,
  boxShadow: 'inset 0 1px 2px rgba(15, 23, 42, 0.05)',
  p: { xs: 1.75, sm: 2.25 },
  minWidth: 0
};

/** A card inside an inlaid panel: white again, softly raised. */
export const raisedSx = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: 2,
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.07)'
};

/** Shared keyframes for the floating toasts used across the views. */
export const TOAST_KEYFRAMES = '@keyframes ootleToastIn{from{opacity:0;transform:translate(-50%,14px)}to{opacity:1;transform:translate(-50%,0)}}';

const CRUMB_SX = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0.5,
  px: 1.25,
  py: 0.4,
  borderRadius: 999,
  background: '#f1f5f9',
  border: '1px solid #e2e8f0',
  color: '#64748b',
  fontSize: '0.68rem',
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  mb: { xs: 1.25, sm: 1.75 }
};

/**
 * One board per tab with an optional msu-style breadcrumb pill
 * ("DApp / Wallet") anchoring where you are.
 */
export default function ViewBoard({ id, children, sx, crumb }) {
  return (
    <Box id={id} sx={{ ...boardSx, ...(sx || {}) }}>
      <style>{TOAST_KEYFRAMES}</style>
      {crumb ? (
        <Box component="span" sx={CRUMB_SX}>
          DApp
          <Box component="span" sx={{ color: '#cbd5e1' }}>/</Box>
          <Box component="span" sx={{ color: '#1d4ed8' }}>{crumb}</Box>
        </Box>
      ) : null}
      {children}
    </Box>
  );
}

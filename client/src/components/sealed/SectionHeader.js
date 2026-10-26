import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

/**
 * Section headers in the Ootle hub follow one pattern, like classic
 * MARKET / HOLDINGS / HISTORY labels: a small uppercase mono eyebrow above a
 * bold ink title and one line of muted copy. tone="glass" flips the palette
 * for headers that sit on the dark gradient cards.
 */
export default function SectionHeader({ eyebrow, title, copy, action, tone = 'paper', sx }) {
  const onGlass = tone === 'glass';
  const eyebrowColor = onGlass ? '#93c5fd' : '#2563eb';
  const titleColor = onGlass ? '#ffffff' : '#0f172a';
  const copyColor = onGlass ? 'rgba(255,255,255,0.82)' : '#64748b';
  return (
    <Box sx={{ minWidth: 0, ...sx }}>
      {eyebrow ? (
        <Typography
          sx={{
            fontSize: '0.66rem',
            fontWeight: 800,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: eyebrowColor,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            mb: 0.4
          }}
        >
          {eyebrow}
        </Typography>
      ) : null}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', minWidth: 0 }}>
        <Typography component="h2" sx={{ fontWeight: 800, fontSize: { xs: '1.05rem', sm: '1.15rem' }, letterSpacing: '-0.01em', color: titleColor, lineHeight: 1.2, flex: '1 1 auto', minWidth: 0 }}>
          {title}
        </Typography>
        {action ? <Box sx={{ flexShrink: 0 }}>{action}</Box> : null}
      </Box>
      {copy ? (
        <Typography sx={{ color: copyColor, fontSize: '0.88rem', lineHeight: 1.55, mt: 0.5, maxWidth: 640 }}>
          {copy}
        </Typography>
      ) : null}
    </Box>
  );
}

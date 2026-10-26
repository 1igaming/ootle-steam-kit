import React from 'react';
import Box from '@mui/material/Box';
import { PIN_DIGITS } from '../../utils/localOotleWallet';

export { PIN_DIGITS };

/** On-screen numeric pad: 1-9, blank, 0, backspace. */
export const KEYPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export function KeypadPad({ onDigit, onBackspace, disabled }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.5, maxWidth: 288, mx: 'auto', mt: 2 }}>
      {KEYPAD_KEYS.map((key, index) => (key === '' ? (
        <Box key={`blank-${index}`} />
      ) : (
        <Box
          key={key}
          component="button"
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label={key === '⌫' ? 'Delete digit' : key}
          onClick={() => (key === '⌫' ? onBackspace() : onDigit(key))}
          sx={{
            height: 58,
            borderRadius: 2.5,
            border: '1px solid #e2e8f0',
            background: '#f8fafc',
            color: '#0f172a',
            fontSize: '1.4rem',
            fontWeight: 700,
            fontFamily: 'inherit',
            cursor: 'pointer',
            transition: 'all .1s',
            '&:hover': { borderColor: '#93c5fd', background: '#eff6ff' },
            '&:active': { background: '#dbeafe', borderColor: '#2563eb', transform: 'scale(0.96)' },
            '&:disabled': { opacity: 0.5, cursor: 'default' }
          }}
        >
          {key}
        </Box>
      )))}
    </Box>
  );
}

export function PinDots({ filled, error }) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        gap: 1.4,
        my: 2.5,
        ...(error ? { animation: 'dappPinShake .4s' } : {})
      }}
    >
      {Array.from({ length: PIN_DIGITS }, (_, i) => (
        <Box
          key={i}
          sx={{
            width: 13,
            height: 13,
            borderRadius: '50%',
            border: '1.5px solid',
            borderColor: i < filled ? '#2563eb' : '#cbd5e1',
            background: i < filled ? '#2563eb' : 'transparent',
            boxShadow: i < filled ? '0 0 8px rgba(37, 99, 235, 0.45)' : 'none'
          }}
        />
      ))}
    </Box>
  );
}

export const PIN_KEYFRAMES = '@keyframes dappPinShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-7px)}40%{transform:translateX(7px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}@keyframes dappSpin{to{transform:rotate(360deg)}}';

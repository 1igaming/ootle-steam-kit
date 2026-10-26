import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  IconButton,
  Typography
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import { KeypadPad, PinDots, PIN_KEYFRAMES, PIN_DIGITS } from './PinPad';

/**
 * First-run wallet flow: a splash screen, a 7-digit PIN keyed
 * on an on-screen pad (entered twice), then the 24-word recovery phrase the
 * user must acknowledge before the wallet opens. The restore path takes the
 * phrase instead. Nothing is written to storage until the final step.
 */

const inkColor = '#0f172a';
const mutedColor = '#64748b';

const dialogPaperSx = {
  borderRadius: 3,
  backgroundImage: 'none',
  backgroundColor: '#ffffff',
  boxShadow: '0 24px 64px rgba(15, 23, 42, 0.25)',
  maxWidth: 460,
  width: '100%'
};

const stepTitleSx = {
  fontWeight: 800,
  fontSize: '1.45rem',
  letterSpacing: '-0.02em',
  color: inkColor,
  lineHeight: 1.15,
  textAlign: 'center'
};

const stepCopySx = {
  color: mutedColor,
  fontSize: '0.9rem',
  lineHeight: 1.55,
  textAlign: 'center'
};

const primaryButtonSx = {
  textTransform: 'none',
  fontWeight: 800,
  borderRadius: 999,
  px: 3,
  py: 1.15,
  fontSize: '0.95rem',
  bgcolor: '#2563eb',
  color: '#fff',
  boxShadow: '0 8px 24px rgba(37, 99, 235, 0.3)',
  '&:hover': { bgcolor: '#1d4ed8', boxShadow: '0 10px 28px rgba(37, 99, 235, 0.35)' },
  '&.Mui-disabled': { bgcolor: '#bfdbfe', color: '#1e3a8a' }
};

const secondaryButtonSx = {
  textTransform: 'none',
  fontWeight: 700,
  borderRadius: 999,
  px: 3,
  py: 1.15,
  fontSize: '0.95rem',
  bgcolor: '#ffffff',
  color: '#0f172a',
  border: '1px solid #c7d2e3',
  '&:hover': { bgcolor: '#f8fafc', borderColor: '#93c5fd' }
};

export default function WalletSetupDialog({ open, onClose, steamId, onWalletReady }) {
  const [step, setStep] = useState('splash'); // splash | pin | confirm | seed | restore | working
  const [firstPin, setFirstPin] = useState('');
  const [entry, setEntry] = useState('');
  const [pinError, setPinError] = useState('');
  const [seedWords, setSeedWords] = useState([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);
  const [restoreText, setRestoreText] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [workingNote, setWorkingNote] = useState('');
  const [fatal, setFatal] = useState('');
  const timersRef = useRef([]);

  useEffect(() => {
    if (!open) return undefined;
    setStep('splash');
    setFirstPin('');
    setEntry('');
    setPinError('');
    setSeedWords([]);
    setAcknowledged(false);
    setCopied(false);
    setRestoreText('');
    setRestoreError('');
    setFatal('');
    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [open]);

  const later = (fn, ms) => {
    timersRef.current.push(setTimeout(fn, ms));
  };

  const handleDigit = (digit) => {
    setPinError('');
    setRestoreError('');
    if (entry.length >= PIN_DIGITS) return;
    const next = entry + digit;
    setEntry(next);
    if (next.length === PIN_DIGITS) {
      // small pause so the last dot is visible before the step changes
      later(() => advancePin(next), 220);
    }
  };

  const advancePin = async (pin) => {
    if (step === 'pin') {
      setFirstPin(pin);
      setEntry('');
      setStep('confirm');
      return;
    }
    if (step === 'confirm') {
      if (pin !== firstPin) {
        setPinError('Those PINs do not match. Enter the first one again.');
        setEntry('');
        setStep('pin');
        return;
      }
      if (restorePendingRef.current) {
        finishRestore(pin);
        return;
      }
      beginCreate(pin);
    }
  };

  const restorePendingRef = useRef(false);

  const beginCreate = async (pin) => {
    setStep('working');
    setWorkingNote('Generating your keys in this browser…');
    try {
      const { createLocalOotleWallet } = await import('../../utils/localOotleWallet');
      const result = await createLocalOotleWallet(steamId, pin);
      setSeedWords(result.mnemonic || []);
      setEntry('');
      setStep('seed');
    } catch (err) {
      setFatal(err && err.message ? err.message : 'The wallet could not be created.');
      setStep('splash');
    }
  };

  const finishRestore = async (pin) => {
    setStep('working');
    setWorkingNote('Restoring your wallet from the recovery phrase…');
    try {
      const { restoreLocalOotleWallet } = await import('../../utils/localOotleWallet');
      await restoreLocalOotleWallet(steamId, pin, restoreText);
      restorePendingRef.current = false;
      setEntry('');
      if (onWalletReady) onWalletReady();
      onClose();
    } catch (err) {
      restorePendingRef.current = false;
      setRestoreError(err && err.message ? err.message : 'The wallet could not be restored.');
      setStep('restore');
    }
  };

  const startCreate = () => {
    restorePendingRef.current = false;
    setEntry('');
    setFirstPin('');
    setStep('pin');
  };

  const startRestore = () => {
    restorePendingRef.current = true;
    setEntry('');
    setFirstPin('');
    setStep('restore');
  };

  const submitRestore = () => {
    setRestoreError('');
    const words = restoreText.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length !== 24) {
      setRestoreError(`The recovery phrase needs exactly 24 words. You entered ${words.length}.`);
      return;
    }
    setStep('pin');
  };

  const openWallet = () => {
    if (onWalletReady) onWalletReady();
    onClose();
  };

  const copySeed = async () => {
    try {
      await navigator.clipboard.writeText(seedWords.join(' '));
      setCopied(true);
      later(() => setCopied(false), 2500);
    } catch (_) {
      setCopied(false);
    }
  };

  // Physical keyboard support while a PIN step is showing.
  useEffect(() => {
    if (!open || (step !== 'pin' && step !== 'confirm')) return undefined;
    const onKey = (event) => {
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        handleDigit(event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        setPinError('');
        setEntry((current) => current.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pinTitle = step === 'confirm' ? 'Confirm your PIN' : 'Choose a PIN';
  const pinCopy = step === 'confirm'
    ? 'Enter the same 7 digits again.'
    : `Choose ${PIN_DIGITS} digits. The PIN locks the keys inside this browser. Nobody can reset it, including us. If you forget it, the recovery phrase is the only way back in.`;

  const renderStep = () => {
    switch (step) {
      case 'splash':
        return (
          <Box sx={{ display: 'grid', gap: 1.25, textAlign: 'center', py: 2 }}>
            <Typography sx={{ ...stepTitleSx, fontSize: '1.7rem' }}>
              Create your
              <br />
              Ootle wallet
            </Typography>
            <Typography sx={stepCopySx}>
              The wallet lives in this browser only. You get a 24-word recovery phrase for emergencies and a 7-digit
              PIN that locks the keys on this device. Nothing is stored on our servers.
            </Typography>
            <Box sx={{ display: 'grid', gap: 1.25, maxWidth: 320, mx: 'auto', width: '100%', mt: 2.5 }}>
              <Button variant="contained" onClick={startCreate} sx={primaryButtonSx}>
                Create new wallet
              </Button>
              <Button variant="outlined" onClick={startRestore} sx={secondaryButtonSx}>
                I have a recovery phrase
              </Button>
            </Box>
            {fatal ? (
              <Typography sx={{ color: '#b45309', fontSize: '0.85rem', fontWeight: 600, mt: 1 }}>{fatal}</Typography>
            ) : null}
          </Box>
        );
      case 'pin':
      case 'confirm':
        return (
          <Box sx={{ textAlign: 'center', py: 1 }}>
            <Typography sx={stepTitleSx}>{pinTitle}</Typography>
            <PinDots filled={entry.length} error={Boolean(pinError)} />
            <Typography sx={{ color: pinError ? '#dc2626' : mutedColor, fontSize: '0.82rem', lineHeight: 1.5, minHeight: 20, fontWeight: pinError ? 700 : 400, px: 2 }}>
              {pinError || (step === 'confirm' ? 'Enter the same 7 digits again.' : 'Enter 7 digits')}
            </Typography>
            <KeypadPad
              onDigit={handleDigit}
              onBackspace={() => { setPinError(''); setEntry((current) => current.slice(0, -1)); }}
            />
            <Button
              onClick={() => setStep('splash')}
              sx={{ mt: 2.5, textTransform: 'none', fontWeight: 700, color: mutedColor }}
            >
              Back
            </Button>
          </Box>
        );
      case 'seed':
        return (
          <Box sx={{ py: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, color: '#b45309', mb: 1 }}>
              <WarningAmberOutlinedIcon sx={{ fontSize: 22 }} />
              <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', color: '#92400e', letterSpacing: '-0.01em' }}>
                Save these 24 words
              </Typography>
            </Box>
            <Typography sx={{ ...stepCopySx, mb: 2 }}>
              Write them down in order and keep the paper somewhere safe. This phrase is the only way to rebuild the
              wallet on another device, and anyone who reads it can spend from this wallet.
            </Typography>
            <Box
              component="ol"
              sx={{
                m: 0,
                p: 0,
                listStyle: 'none',
                display: 'grid',
                gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' },
                gap: 0.75,
                counterReset: 'word',
                mb: 1.5
              }}
            >
              {seedWords.map((word, i) => (
                <Box
                  key={`${i}-${word}`}
                  component="li"
                  sx={{
                    counterIncrement: 'word',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.75,
                    minWidth: 0,
                    minHeight: 38,
                    px: 1.1,
                    borderRadius: 1.25,
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    fontSize: '0.78rem',
                    color: '#0f172a',
                    '&:before': {
                      content: 'counter(word)',
                      color: mutedColor,
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      minWidth: 16,
                      textAlign: 'right',
                      flexShrink: 0
                    }
                  }}
                >
                  <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{word}</Box>
                </Box>
              ))}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1.5 }}>
              <Typography sx={{ color: mutedColor, fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Recovery phrase
              </Typography>
              <Button
                size="small"
                startIcon={<ContentCopyOutlinedIcon />}
                onClick={copySeed}
                sx={{ textTransform: 'none', fontWeight: 700, color: copied ? '#15803d' : '#2563eb' }}
              >
                {copied ? 'Copied' : 'Copy to clipboard'}
              </Button>
            </Box>
            <Box
              onClick={() => setAcknowledged(!acknowledged)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                p: 1.25,
                borderRadius: 1.5,
                border: '1px solid',
                borderColor: acknowledged ? '#2563eb' : '#e2e8f0',
                background: acknowledged ? '#eff6ff' : '#ffffff',
                cursor: 'pointer',
                mb: 1
              }}
            >
              <Checkbox
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                sx={{ p: 0.5, color: '#2563eb', '&.Mui-checked': { color: '#2563eb' } }}
              />
              <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: '#0f172a', lineHeight: 1.4 }}>
                I saved all 24 words in order
              </Typography>
            </Box>
            <Button variant="contained" fullWidth disabled={!acknowledged} onClick={openWallet} sx={primaryButtonSx}>
              Open my wallet
            </Button>
          </Box>
        );
      case 'restore':
        return (
          <Box sx={{ display: 'grid', gap: 1.25, py: 1 }}>
            <Typography sx={stepTitleSx}>Restore your wallet</Typography>
            <Typography sx={stepCopySx}>
              Type or paste the 24 words, in order. The phrase is checked in this browser and never sent anywhere.
            </Typography>
            <Box
              component="textarea"
              value={restoreText}
              onChange={(event) => { setRestoreText(event.target.value); setRestoreError(''); }}
              rows={4}
              placeholder="cake code animal tip slice ..."
              aria-label="24-word recovery phrase"
              spellCheck={false}
              sx={{
                width: '100%',
                p: 1.5,
                borderRadius: 1.5,
                border: '1px solid',
                borderColor: restoreError ? '#dc2626' : '#c7d2e3',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                fontSize: '0.82rem',
                lineHeight: 1.6,
                color: '#0f172a',
                resize: 'vertical',
                outline: 'none',
                '&:focus': { borderColor: '#2563eb', boxShadow: '0 0 0 3px rgba(37, 99, 235, 0.12)' }
              }}
            />
            {restoreError ? (
              <Typography sx={{ color: '#dc2626', fontSize: '0.85rem', fontWeight: 600 }}>{restoreError}</Typography>
            ) : null}
            <Button variant="contained" onClick={submitRestore} sx={primaryButtonSx}>
              Continue
            </Button>
            <Button onClick={() => setStep('splash')} sx={{ ...secondaryButtonSx, border: 'none', color: mutedColor }}>
              Back
            </Button>
          </Box>
        );
      case 'working':
        return (
          <Box sx={{ display: 'grid', gap: 1.5, py: 6, textAlign: 'center', justifyItems: 'center' }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: '3px solid #dbeafe',
                borderTopColor: '#2563eb',
                animation: 'dappSpin .8s linear infinite'
              }}
            />
            <Typography sx={{ color: '#0f172a', fontWeight: 700, fontSize: '0.95rem' }}>{workingNote}</Typography>
          </Box>
        );
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onClose={step === 'working' ? undefined : onClose} fullWidth maxWidth="sm" scroll="body" disableEscapeKeyDown={step === 'working'} PaperProps={{ sx: dialogPaperSx }}>
      <style>
        {PIN_KEYFRAMES}
      </style>
      <DialogContent sx={{ p: { xs: 2, sm: 3 }, position: 'relative' }}>
        {step !== 'splash' && step !== 'working' ? (
          <IconButton
            aria-label="Back to start"
            size="small"
            onClick={() => setStep('splash')}
            sx={{ position: 'absolute', top: 12, left: 12, color: mutedColor }}
          >
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        ) : null}
        {renderStep()}
      </DialogContent>
    </Dialog>
  );
}

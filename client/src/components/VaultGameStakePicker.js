import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  Typography
} from '@mui/material';
import { csrfHeaders } from '../utils/csrfHeaders';
import { BRAND_BLUE, PANEL_INK, PANEL_MUTED } from '../styles/marketShellSx';

const paymentRadioSx = {
  p: 0.375,
  color: '#94a3b8',
  '&.Mui-checked': {
    color: BRAND_BLUE,
    boxShadow: 'none'
  },
  '&:hover': {
    bgcolor: 'rgba(148, 163, 184, 0.1)'
  },
  '&.Mui-focusVisible, &:focus-visible': {
    outline: 'none',
    boxShadow: 'none'
  },
  '& .MuiSvgIcon-root': {
    fontSize: 18
  },
  '& .MuiTouchRipple-root': {
    display: 'none'
  }
};

const paymentMethodLabelSx = {
  m: 0,
  mr: 2.5,
  gap: 0.75,
  alignItems: 'center',
  display: 'inline-flex',
  '& .MuiFormControlLabel-label': {
    color: PANEL_INK,
    fontWeight: 600,
    fontSize: '0.8125rem',
    lineHeight: 1.2,
    whiteSpace: 'nowrap'
  }
};

function isStakeableVaultRow(item) {
  if (!item || String(item.location || '') !== 'bot') return false;
  const id = String(item.id || item.vaultItemId || '');
  if (id.startsWith('vault_p2p_')) return false;
  const status = String(item.collateralStatus || 'free').toLowerCase();
  if (status === 'game_stake' || status === 'game_forfeited') return false;
  if (status !== 'free') return false;
  const rental = String(item.rentalStatus || '').toLowerCase();
  if (rental && rental !== 'available') return false;
  if (item.workJobId) return false;
  if (item.holdActive || item.deliveryBlocked) return false;
  const until = item.tradeProtectUntil ? Date.parse(item.tradeProtectUntil) : 0;
  if (Number.isFinite(until) && until > Date.now() && item.outboundBlocked !== false) return false;
  return true;
}

/**
 * Shared wallet vs vault payment UI for Crash and Sandbox.
 */
export default function VaultGameStakePicker({
  vaultEnabled = false,
  paymentMethod = 'wallet',
  onPaymentMethodChange,
  selectedVaultItemId = '',
  onSelectVaultItem,
  btcPrice = 0,
  minOfferUsd = null,
  entryPriceUsd = null,
  gameLabel = 'game'
}) {
  const [loading, setLoading] = useState(false);
  const [vaultItems, setVaultItems] = useState([]);
  const [fetchError, setFetchError] = useState('');
  const [gameCreditBtc, setGameCreditBtc] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/wallet/game-credit', { credentials: 'include' });
        const data = await res.json();
        if (!cancelled && data?.success) {
          setGameCreditBtc(Number(data.data?.gameCreditBalance || 0));
        }
      } catch (_) {
        /* game-credit balance is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paymentMethod]);

  useEffect(() => {
    if (!vaultEnabled || paymentMethod !== 'vault') return undefined;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setFetchError('');
      try {
        const res = await fetch('/api/rentals/vault', { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load vault');
        const rows = Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : [];
        if (!cancelled) setVaultItems(rows);
      } catch (err) {
        if (!cancelled) setFetchError(err.message || 'Failed to load vault items');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [vaultEnabled, paymentMethod]);

  const stakeable = useMemo(() => {
    return vaultItems
      .filter(isStakeableVaultRow)
      .map((item) => {
        const offerUsd = Number(item.catalogOfferUsd) || Number(item.offerPriceUsd) || 0;
        const meetsEntry = entryPriceUsd == null || offerUsd >= Number(entryPriceUsd);
        const meetsMin = minOfferUsd == null || offerUsd >= Number(minOfferUsd);
        const eligible = meetsEntry && meetsMin;
        const stakeBtc = btcPrice > 0 && offerUsd > 0 ? offerUsd / btcPrice : null;
        return { ...item, offerUsd, stakeBtc, eligible };
      })
      .sort((a, b) => (b.offerUsd || 0) - (a.offerUsd || 0));
  }, [vaultItems, btcPrice, entryPriceUsd, minOfferUsd]);

  const hasGameCredit = gameCreditBtc > 0;
  // Render when vault staking is enabled OR the user holds spendable game credit.
  if (!vaultEnabled && !hasGameCredit) return null;

  return (
    <Box sx={{ mb: 2 }}>
      <FormControl component="fieldset" variant="standard" sx={{ mb: 1, minWidth: 0, width: '100%' }}>
        <Typography
          variant="caption"
          component="legend"
          sx={{
            fontWeight: 700,
            mb: 0.75,
            color: PANEL_MUTED,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontSize: '0.65rem',
            display: 'block'
          }}
        >
          Payment method
        </Typography>
        <RadioGroup
          row
          value={paymentMethod}
          onChange={(e) => onPaymentMethodChange?.(e.target.value)}
          sx={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 0.5,
            mx: 0
          }}
        >
          <FormControlLabel
            value="wallet"
            control={<Radio size="small" disableRipple sx={paymentRadioSx} />}
            label="Wallet (BTC)"
            sx={paymentMethodLabelSx}
          />
          {vaultEnabled && (
            <FormControlLabel
              value="vault"
              control={<Radio size="small" disableRipple sx={paymentRadioSx} />}
              label="Vault skin"
              sx={paymentMethodLabelSx}
            />
          )}
          {hasGameCredit && (
            <FormControlLabel
              value="game_credit"
              control={<Radio size="small" disableRipple sx={paymentRadioSx} />}
              label="Site balance"
              sx={paymentMethodLabelSx}
            />
          )}
        </RadioGroup>
      </FormControl>

      {paymentMethod === 'game_credit' && (
        <Typography variant="body2" sx={{ color: PANEL_MUTED, mb: 1 }}>
          Site balance: {gameCreditBtc.toFixed(8)} BTC available.
          The bet amount below is drawn from your site balance.
        </Typography>
      )}

      {paymentMethod === 'vault' && (
        <>
          {fetchError && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {fetchError}
            </Alert>
          )}

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={28} />
            </Box>
          ) : stakeable.length === 0 ? (
            <Typography variant="body2" sx={{ color: PANEL_MUTED }}>
              No eligible vault items available. Items on hold, in escrow, or listed for rent cannot be staked.
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 220, overflow: 'auto' }}>
              {stakeable.map((item) => {
                const id = item.id || item.vaultItemId;
                const selected = selectedVaultItemId === id;
                const name = item.itemName || item.marketHashName || id;
                return (
                  <Button
                    key={id}
                    variant={selected ? 'contained' : 'outlined'}
                    disabled={!item.eligible}
                    onClick={() => item.eligible && onSelectVaultItem?.(id)}
                    sx={{
                      justifyContent: 'flex-start',
                      textAlign: 'left',
                      py: 1,
                      opacity: item.eligible ? 1 : 0.55
                    }}
                  >
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {name}
                      </Typography>
                      <Typography variant="caption" display="block">
                        Offer ${item.offerUsd?.toFixed(2) || '—'}
                        {item.stakeBtc != null ? ` · ~${item.stakeBtc.toFixed(8)} BTC` : ''}
                      </Typography>
                      {!item.eligible && entryPriceUsd != null && (
                        <Typography variant="caption" color="error">
                          Below entry price (${entryPriceUsd})
                        </Typography>
                      )}
                    </Box>
                    {(item.holdActive || item.deliveryBlocked) && (
                      <Chip size="small" label="Hold" color="warning" sx={{ ml: 1 }} />
                    )}
                  </Button>
                );
              })}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

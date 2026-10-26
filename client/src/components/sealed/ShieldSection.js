import React, { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined';
import ConfirmationNumberOutlinedIcon from '@mui/icons-material/ConfirmationNumberOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import { csrfHeaders } from '../../utils/csrfHeaders';
import SectionHeader from './SectionHeader';
import { inlaidSx, raisedSx } from './ViewBoard';

/**
 * Shield and unshield tTARI — the two Ootle privacy instruments, operable:
 *  - Stealth tTARI: a hidden amount at this wallet's address (any amount)
 *  - Vouchers: a public deposit into the pool, then private bearer vouchers
 *    in fixed 1 / 10 / 100 / 1,000 tTARI denominations
 * Shielded value leaves the revealed balance, so games and predictions
 * cannot spend it until it is unshielded again.
 */

const DENOMS = [1000, 100, 10, 1];
const ink = '#0f172a';
const muted = '#64748b';

function fmt(n) {
  const v = Number(n || 0);
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function timeAgo(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Greedy 1,000/100/10/1 breakdown of a whole-tTARI amount. */
function voucherBreakdown(wholeTari) {
  const n = Math.max(0, Math.floor(Number(wholeTari) || 0));
  const parts = [];
  let rest = n;
  for (const d of DENOMS) {
    const count = Math.floor(rest / d);
    if (count > 0) parts.push(`${count.toLocaleString('en-US')} × ${d.toLocaleString('en-US')}`);
    rest -= count * d;
  }
  return parts.join('  +  ');
}

const INSTRUMENTS = [
  {
    id: 'stealth',
    title: 'Stealth tTARI',
    badge: 'Amount hidden',
    badgeStyle: { background: '#eff6ff', border: '#bfdbfe', color: '#1d4ed8' },
    copy: 'A hidden amount at this address. Unshield any portion, any time.'
  },
  {
    id: 'voucher',
    title: 'Vouchers',
    badge: 'Amount + owner hidden',
    badgeStyle: { background: '#ecfdf5', border: '#a7f3d0', color: '#047857' },
    copy: 'Public deposit into the pool, then private 1 · 10 · 100 · 1,000 tTARI vouchers.'
  }
];

const inputSx = {
  minHeight: 44,
  width: { xs: '100%', sm: 168 },
  px: 1.5,
  borderRadius: 2,
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  color: ink,
  fontWeight: 700,
  fontSize: '1rem',
  fontFamily: 'inherit',
  outline: 'none',
  '&:focus': { borderColor: '#2563eb', boxShadow: '0 0 0 3px rgba(37, 99, 235, 0.15)' }
};

const chipSx = {
  minHeight: 34,
  px: 1.5,
  borderRadius: 999,
  border: '1px solid #c7d2e3',
  background: '#ffffff',
  color: '#475569',
  fontWeight: 700,
  fontSize: '0.78rem',
  fontFamily: 'inherit',
  cursor: 'pointer',
  '&:hover': { borderColor: '#93c5fd', background: '#eff6ff' },
  '&:disabled': { opacity: 0.5, cursor: 'default' }
};

const primaryButtonSx = {
  minHeight: 44,
  px: 2.5,
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
  '&:disabled': { opacity: 0.55, cursor: 'default', boxShadow: 'none' }
};

function InstrumentCard({ option, selected, onSelect, heldTari, showHeld }) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      sx={{
        display: 'grid',
        gap: 0.75,
        textAlign: 'left',
        p: { xs: 1.75, sm: 2 },
        borderRadius: 2.5,
        border: `1.5px solid ${selected ? '#2563eb' : '#e2e8f0'}`,
        background: selected ? '#eff6ff' : '#f8fafc',
        boxShadow: selected ? '0 6px 18px rgba(37, 99, 235, 0.14)' : 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'all .15s ease',
        '&:hover': { borderColor: selected ? '#2563eb' : '#93c5fd' }
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Box sx={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: `2px solid ${selected ? '#2563eb' : '#cbd5e1'}`,
          background: selected ? '#2563eb' : 'transparent',
          boxShadow: selected ? 'inset 0 0 0 3px #eff6ff' : 'none',
          flexShrink: 0
        }} />
        <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', color: ink }}>{option.title}</Typography>
        <Box component="span" sx={{ px: 1, py: 0.25, borderRadius: 999, background: option.badgeStyle.background, border: `1px solid ${option.badgeStyle.border}`, color: option.badgeStyle.color, fontSize: '0.68rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
          {option.badge}
        </Box>
      </Box>
      <Typography sx={{ color: muted, fontSize: '0.82rem', lineHeight: 1.5 }}>{option.copy}</Typography>
      {showHeld ? (
        <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: heldTari > 0 ? '#1d4ed8' : '#94a3b8' }}>
          {heldTari > 0 ? `You hold ${fmt(heldTari)} tTARI here` : 'Nothing held here'}
        </Typography>
      ) : null}
    </Box>
  );
}

function EventRow({ event, onCopy, copied }) {
  const shielded = event.direction === 'shield';
  const legRejected = Boolean(event.legRejected);
  // a recent move whose on-chain leg has not fired yet: the escrow could not
  // cover it at the time and the retry worker is waiting for a refill
  const ageH = event.at ? (Date.now() - Date.parse(event.at)) / 3600000 : Infinity;
  const legPending = !event.txid && !legRejected && ageH < 24;
  return (
    <Box sx={{ display: 'grid', gap: 0.4, py: 0.75, borderBottom: '1px dashed #e2e8f0', '&:last-child': { borderBottom: 'none' } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Box sx={{
          width: 28,
          height: 28,
          borderRadius: 1.5,
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          background: shielded ? '#eff6ff' : '#f0fdf4',
          border: `1px solid ${shielded ? '#bfdbfe' : '#bbf7d0'}`,
          color: shielded ? '#2563eb' : '#15803d'
        }}>
          {shielded ? <LockOutlinedIcon sx={{ fontSize: 15 }} /> : <LockOpenOutlinedIcon sx={{ fontSize: 15 }} />}
        </Box>
        <Typography sx={{ fontWeight: 700, fontSize: '0.84rem', color: ink }}>
          {shielded ? 'Shielded' : 'Unshielded'} {fmt(event.tari)} tTARI
        </Typography>
        <Box component="span" sx={{ px: 0.9, py: 0.2, borderRadius: 999, background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#475569', fontSize: '0.68rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
          {event.instrument === 'voucher' ? 'Vouchers' : 'Stealth'}
        </Box>
        <Box
          component="span"
          title={legPending ? 'The escrow could not fund this leg yet; it fires automatically when the testnet faucet refills it.' : undefined}
          sx={{ px: 0.9, py: 0.2, borderRadius: 999, background: event.onChain ? '#ecfdf5' : legPending ? '#fffbeb' : '#f1f5f9', border: `1px solid ${event.onChain ? '#a7f3d0' : legPending ? '#fde68a' : '#e2e8f0'}`, color: event.onChain ? '#047857' : legPending ? '#92400e' : '#64748b', fontSize: '0.68rem', fontWeight: 800, whiteSpace: 'nowrap' }}
        >
          {event.onChain ? 'Esmeralda on-chain' : legPending ? 'Leg pending, fires on escrow refill' : legRejected ? 'Leg rejected, ledger only' : 'Ledger'}
        </Box>
        <Typography sx={{ color: '#94a3b8', fontSize: '0.74rem', fontWeight: 600, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
          {timeAgo(event.at)}
        </Typography>
      </Box>
      {event.txid ? (
        <Box
          component="button"
          type="button"
          onClick={() => onCopy(event.txid)}
          title="Copy the transaction id"
          sx={{
            justifySelf: 'start',
            display: 'inline-flex', alignItems: 'center', gap: 0.5, ml: 5,
            px: 1.25, py: 0.35, borderRadius: 1.5,
            border: '1px solid #e2e8f0', background: '#ffffff',
            color: copied === event.txid ? '#15803d' : '#475569',
            fontWeight: 700, fontSize: '0.7rem',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            cursor: 'pointer', overflowWrap: 'anywhere', textAlign: 'left',
            whiteSpace: 'normal', wordBreak: 'break-all', maxWidth: '100%'
          }}
        >
          tx {event.txid}
          <ContentCopyOutlinedIcon sx={{ fontSize: 12, flexShrink: 0 }} />
          {copied === event.txid ? 'copied' : ''}
        </Box>
      ) : null}
    </Box>
  );
}

export default function ShieldSection({ address, spendableTari, vault, onVault, escrowCapacityTari }) {
  const [mode, setMode] = useState('shield');
  const [instrument, setInstrument] = useState('stealth');
  const [amount, setAmount] = useState('');
  const [picks, setPicks] = useState({ 1000: 0, 100: 0, 10: 0, 1: 0 });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { ok, text }
  const [copiedTx, setCopiedTx] = useState('');

  const copyTx = async (txid) => {
    try {
      await navigator.clipboard.writeText(String(txid));
      setCopiedTx(String(txid));
      setTimeout(() => setCopiedTx(''), 2000);
    } catch (_) { /* clipboard is optional */ }
  };

  const spendable = Number(spendableTari || 0);
  const capacity = escrowCapacityTari == null ? null : Number(escrowCapacityTari);
  // a shield must be coverable on chain: the smaller of your stack and the escrow
  const shieldCeiling = capacity == null ? spendable : Math.min(spendable, capacity);
  const stealthShieldedCalc = Number(vault && vault.stealthTari || 0);
  const voucherShieldedCalc = Number(vault && vault.voucherTari || 0);
  const held = useMemo(() => ({
    1000: Number(vault && vault.vouchers && vault.vouchers['1000'] || 0),
    100: Number(vault && vault.vouchers && vault.vouchers['100'] || 0),
    10: Number(vault && vault.vouchers && vault.vouchers['10'] || 0),
    1: Number(vault && vault.vouchers && vault.vouchers['1'] || 0)
  }), [vault]);
  const pickTotal = useMemo(() => DENOMS.reduce((sum, d) => sum + d * (picks[d] || 0), 0), [picks]);

  // Landing in Unshield should show the money: if only one instrument holds
  // value, select it for the user instead of an empty panel.
  const fundedInstrument = stealthShieldedCalc > 0 && voucherShieldedCalc <= 0
    ? 'stealth'
    : voucherShieldedCalc > 0 && stealthShieldedCalc <= 0 ? 'voucher' : null;

  // in unshield mode, follow the money
  useEffect(() => {
    if (mode === 'unshield' && fundedInstrument && instrument !== fundedInstrument) {
      setInstrument(fundedInstrument);
      setNote(null);
    }
  }, [mode, fundedInstrument]);

  // keep the redeem steppers inside what is actually held as the vault moves
  useEffect(() => {
    setPicks((current) => {
      const next = {};
      let changed = false;
      for (const d of DENOMS) {
        next[d] = Math.min(current[d] || 0, held[d]);
        if (next[d] !== (current[d] || 0)) changed = true;
      }
      return changed ? next : current;
    });
  }, [held]);

  const reset = () => {
    setAmount('');
    setPicks({ 1000: 0, 100: 0, 10: 0, 1: 0 });
  };

  const switchMode = (next) => {
    setMode(next);
    setNote(null);
    reset();
  };

  const switchInstrument = (next) => {
    setInstrument(next);
    setNote(null);
    reset();
  };

  const onAmountChange = (raw) => {
    let text = String(raw || '');
    if (instrument === 'voucher') {
      text = text.replace(/[^\d]/g, '').slice(0, 7);
    } else {
      text = text.replace(/[^\d.]/g, '');
      const [whole, ...rest] = text.split('.');
      text = rest.length ? `${whole}.${rest.join('').slice(0, 6)}` : whole;
    }
    setAmount(text);
  };

  const quickSet = (value) => onAmountChange(String(value));

  const submit = async () => {
    if (busy) return;
    setNote(null);
    const isVoucher = instrument === 'voucher';
    if (mode === 'shield') {
      const value = Number(amount);
      if (!amount || !(value > 0)) {
        setNote({ ok: false, text: 'Enter an amount to shield.' });
        return;
      }
      if (value > spendable) {
        setNote({ ok: false, text: `Your revealed balance is ${fmt(spendable)} tTARI.` });
        return;
      }
      if (capacity != null && value > capacity) {
        setNote({
          ok: false,
          text: capacity <= 0
            ? 'The testnet escrow is temporarily out of tTARI. Shielding reopens as soon as the network faucet refills it.'
            : `The escrow can cover ${fmt(capacity)} tTARI on chain right now, so shield up to that.`
        });
        return;
      }
    } else if (isVoucher) {
      if (pickTotal <= 0) {
        setNote({ ok: false, text: 'Select at least one voucher to redeem.' });
        return;
      }
    } else if (!amount || !(Number(amount) > 0)) {
      setNote({ ok: false, text: 'Enter an amount to unshield.' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/ootle/local-wallet/${mode}`, {
        method: 'POST',
        credentials: 'include',
        headers: csrfHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(mode === 'shield'
          ? { address, instrument, amount }
          : (isVoucher
            ? { instrument, vouchers: { '1000': picks[1000], '100': picks[100], '10': picks[10], '1': picks[1] } }
            : { instrument, amount }))
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        setNote({ ok: false, text: String((data && data.error) || 'That did not go through.') });
        return;
      }
      const row = data.data || {};
      const what = isVoucher ? 'vouchers' : 'stealth tTARI';
      const moved = fmt(row.movedTari);
      const nowShielded = row.vault ? fmt(row.vault.totalTari) : null;
      if (mode === 'shield') {
        setNote({
          ok: true,
          text: (row.onChain
            ? `Shielded ${moved} tTARI as ${what}. The ${isVoucher ? 'public deposit' : 'blinded output'} is on Esmeralda${row.txid ? ` (tx ${String(row.txid).slice(0, 8)}…)` : ''}.`
            : `Shielded ${moved} tTARI as ${what} in the vault ledger.`)
            + (nowShielded != null ? ` ${nowShielded} tTARI shielded now.` : '')
        });
      } else {
        setNote({
          ok: true,
          text: `Unshielded ${moved} tTARI back into your revealed balance.`
            + (row.txid ? ` The reveal is on Esmeralda (tx ${String(row.txid).slice(0, 12)}…).` : '')
            + (nowShielded != null ? ` ${nowShielded} tTARI still shielded.` : '')
        });
      }
      reset();
      if (onVault && row.vault) onVault(row.vault);
    } catch (_) {
      setNote({ ok: false, text: 'Something went wrong. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const stealthShielded = stealthShieldedCalc;
  const voucherShielded = voucherShieldedCalc;
  const events = (vault && Array.isArray(vault.events) ? vault.events : []).slice(0, 6);
  const maxQuick = mode === 'shield' && instrument === 'voucher' ? Math.floor(shieldCeiling) : Math.floor(shieldCeiling * 100) / 100;
  const canShieldSomething = mode === 'shield' ? shieldCeiling >= (instrument === 'voucher' ? 1 : 0.1)
    : (instrument === 'voucher' ? voucherShielded > 0 : stealthShielded > 0);

  return (
    <Box
      sx={{ ...inlaidSx, color: ink }}
      id="ootle-shield-section"
    >
      <SectionHeader
        eyebrow="Privacy"
        title="Shield tTARI"
        copy="Shielded tTARI is held apart from your spendable balance. Games and predictions cannot touch it until you unshield."
        action={(
          <Box sx={{ display: 'inline-flex', p: 0.4, borderRadius: 999, background: 'rgba(37, 99, 235, 0.08)', boxShadow: 'inset 0 1px 2px rgba(15, 23, 42, 0.08)' }}>
            {['shield', 'unshield'].map((m) => (
              <Box
                key={m}
                component="button"
                type="button"
                onClick={() => switchMode(m)}
                sx={{
                  minHeight: 32,
                  px: 2,
                  borderRadius: 999,
                  border: 'none',
                  background: mode === m ? 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)' : 'transparent',
                  color: mode === m ? '#ffffff' : '#334155',
                  fontWeight: 800,
                  fontSize: '0.8rem',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  textTransform: 'capitalize'
                }}
              >
                {m}
              </Box>
            ))}
          </Box>
        )}
      />

      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }, mt: 2 }}>
        {INSTRUMENTS.map((option) => (
          <InstrumentCard
            key={option.id}
            option={option}
            selected={instrument === option.id}
            onSelect={() => switchInstrument(option.id)}
            showHeld={mode === 'unshield'}
            heldTari={option.id === 'stealth' ? stealthShielded : voucherShielded}
          />
        ))}
      </Box>

      <Box sx={{ ...raisedSx, mt: 2, p: { xs: 1.75, sm: 2 }, display: 'grid', gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: muted }}>
            Revealed {fmt(spendable)} tTARI · Shielded {fmt(stealthShielded + voucherShielded)} tTARI
            {stealthShielded + voucherShielded > 0 ? ` (${fmt(stealthShielded)} stealth + ${fmt(voucherShielded)} vouchers)` : ''}
            {capacity != null ? ` · escrow covers ${fmt(capacity)} on chain` : ''}
          </Typography>
          {mode === 'shield' && capacity != null && capacity < 1 ? (
            <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: '#b45309', lineHeight: 1.5 }}>
              The testnet escrow is out of tTARI, so no on-chain shield is possible until the network faucet refills
              it. Check back shortly. Unshielding and everything else keeps working.
            </Typography>
          ) : null}
          {mode === 'unshield' && instrument === 'stealth' && stealthShielded > 0 ? (
            <Box component="button" type="button" sx={chipSx} onClick={() => quickSet(Math.floor(stealthShielded * 100) / 100)}>
              Max {fmt(stealthShielded)}
            </Box>
          ) : null}
        </Box>

        {instrument === 'voucher' && mode === 'unshield' ? (
          <Box sx={{ display: 'grid', gap: 1 }}>
            {DENOMS.map((d) => {
              const count = held[d];
              const picked = picks[d] || 0;
              return (
                <Box key={d} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
                  <Box sx={{
                    display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.5,
                    borderRadius: 2, background: count > 0 ? '#ffffff' : '#f1f5f9',
                    border: `1px solid ${count > 0 ? '#dbeafe' : '#e2e8f0'}`,
                    color: count > 0 ? '#1d4ed8' : '#94a3b8',
                    fontWeight: 800, fontSize: '0.82rem', minWidth: 150
                  }}>
                    <ConfirmationNumberOutlinedIcon sx={{ fontSize: 16 }} />
                    {fmt(d)} tTARI × {count} held
                  </Box>
                  {(['decr', 'incr'].map((op) => (
                    <Box
                      key={op}
                      component="button"
                      type="button"
                      disabled={busy || (op === 'decr' ? picked <= 0 : picked >= count)}
                      onClick={() => setPicks((c) => ({ ...c, [d]: op === 'decr' ? c[d] - 1 : c[d] + 1 }))}
                      sx={{
                        width: 34, height: 34, borderRadius: 1.5,
                        border: '1px solid #c7d2e3', background: '#ffffff',
                        color: ink, fontSize: '1rem', fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer',
                        '&:hover': { borderColor: '#93c5fd', background: '#eff6ff' },
                        '&:disabled': { opacity: 0.4, cursor: 'default' }
                      }}
                    >
                      {op === 'decr' ? '−' : '+'}
                    </Box>
                  )))}
                  <Typography sx={{ fontWeight: 800, fontSize: '0.86rem', color: picked > 0 ? '#2563eb' : '#94a3b8', minWidth: 74 }}>
                    redeem {picked}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
            <Box
              component="input"
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
              inputMode={instrument === 'voucher' ? 'numeric' : 'decimal'}
              placeholder={instrument === 'voucher' ? 'Whole tTARI' : '0.0'}
              disabled={busy}
              aria-label="Amount in tTARI"
              sx={inputSx}
            />
            <Typography sx={{ fontWeight: 800, fontSize: '0.86rem', color: muted }}>tTARI</Typography>
            {mode === 'shield' ? [10, 50, 100].filter((q) => q <= maxQuick).map((q) => (
              <Box key={q} component="button" type="button" sx={chipSx} disabled={busy} onClick={() => quickSet(q)}>
                {q}
              </Box>
            )) : null}
            {mode === 'shield' && maxQuick >= (instrument === 'voucher' ? 1 : 0.1) ? (
              <Box component="button" type="button" sx={chipSx} disabled={busy} onClick={() => quickSet(maxQuick)}>
                Max
              </Box>
            ) : null}
          </Box>
        )}

        {instrument === 'voucher' && mode === 'shield' && Number(amount) >= 1 ? (
          <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: '#047857' }}>
            You receive {voucherBreakdown(amount)}
          </Typography>
        ) : null}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Box component="button" type="button" sx={primaryButtonSx} disabled={busy || !canShieldSomething} onClick={submit}>
            {busy ? 'Working…' : (mode === 'shield'
              ? (instrument === 'voucher'
                ? (amount ? `Get ${fmt(amount)} in vouchers` : 'Get vouchers')
                : (amount ? `Shield ${fmt(amount)} tTARI` : 'Shield tTARI'))
              : (instrument === 'voucher'
                ? `Redeem ${fmt(pickTotal)} tTARI`
                : (amount ? `Unshield ${fmt(amount)} tTARI` : 'Unshield tTARI')))}
          </Box>
          {mode === 'unshield' && instrument === 'stealth' && stealthShielded <= 0 ? (
            <Typography sx={{ fontSize: '0.8rem', color: muted, fontWeight: 600 }}>
              {voucherShielded > 0
                ? `Your ${fmt(voucherShielded)} shielded tTARI is held in vouchers. Switch instruments above to redeem them.`
                : 'Nothing shielded yet. Shield tTARI first, then unshield it here.'}
            </Typography>
          ) : null}
          {mode === 'unshield' && instrument === 'voucher' && voucherShielded <= 0 ? (
            <Typography sx={{ fontSize: '0.8rem', color: muted, fontWeight: 600 }}>
              {stealthShielded > 0
                ? `Your ${fmt(stealthShielded)} shielded tTARI is in stealth. Switch instruments above to unshield it.`
                : 'You hold no vouchers yet. Shield into vouchers first, then redeem them here.'}
            </Typography>
          ) : null}
        </Box>

        {note ? (
          <Typography
            sx={{
              fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.5, px: 1.5, py: 1, borderRadius: 2,
              background: note.ok ? '#ecfdf5' : '#fef2f2',
              border: `1px solid ${note.ok ? '#a7f3d0' : '#fecaca'}`,
              color: note.ok ? '#047857' : '#b91c1c'
            }}
            aria-live="polite"
          >
            {note.text}
          </Typography>
        ) : null}

        {events.length ? (
          <Box sx={{ display: 'grid', gap: 0.25, pt: 1, borderTop: '1px solid #e2e8f0' }}>
            <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: muted, mb: 0.5 }}>
              Recent activity
            </Typography>
            {/* capped and scrollable: history grows forever, the panel must not */}
            <Box sx={{ maxHeight: 260, overflowY: 'auto', pr: 0.5 }}>
              {events.map((event) => (
                <EventRow key={event.id || event.at} event={event} onCopy={copyTx} copied={copiedTx} />
              ))}
            </Box>
          </Box>
        ) : null}

        <Typography sx={{ fontSize: '0.76rem', color: '#94a3b8', lineHeight: 1.5 }}>
          On Esmeralda, the site escrow signs the on-chain leg on your behalf: a stealth shield produces a blinded output
          with the amount hidden, while a voucher deposit is sent in the clear. At mainnet, your browser wallet signs
          these transactions itself.
        </Typography>
      </Box>
    </Box>
  );
}

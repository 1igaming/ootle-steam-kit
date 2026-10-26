import React, { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LockClockOutlinedIcon from '@mui/icons-material/LockClockOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import ScienceRoundedIcon from '@mui/icons-material/ScienceRounded';
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined';
import { useAuth } from '../../context/AuthContext';
import { csrfHeaders } from '../../utils/csrfHeaders';
import { readWalletState } from '../../utils/localOotleWallet';
import SectionHeader from './SectionHeader';
import SealedInventoryPanel, { inventoryItemThumbUrl, inventoryItemTitle } from './SealedInventoryPanel';
import { inlaidSx, raisedSx, TOAST_KEYFRAMES } from './ViewBoard';

/**
 * The Trade tab: a two-sided market.
 *   List: pick an item from your Steam inventory and set a tTARI ask.
 *   Listing locks nothing; it stays up until you delist or it sells.
 *   Buy: lock the seller's ask into an Ootle contract. The claim code that
 *   comes back goes in the Steam trade message; the contract pays the
 *   seller only against that code from that seller.
 */

const POLL_MS = 12000;
const ink = '#0f172a';
const muted = '#64748b';

const STATUS_CHIP = {
  watching: { text: 'Paid · awaiting the trade', bg: '#eef2ff', border: '#c7d2fe', color: '#4338ca' },
  sent: { text: 'Trade sent · confirm delivery', bg: '#fffbeb', border: '#fde68a', color: '#92400e' },
  released: { text: 'Complete · seller paid', bg: '#f0f9ff', border: '#bae6fd', color: '#0369a1' },
  refunded: { text: 'Refunded', bg: '#f1f5f9', border: '#e2e8f0', color: '#475569' }
};

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function timeAgo(value) {
  const ms = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) return 'recently';
  const mins = Math.max(1, Math.round((Date.now() - ms) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function countdownText(msLeft) {
  if (!Number.isFinite(msLeft) || msLeft <= 0) return 'window closed';
  const s = Math.floor(msLeft / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m left`;
  return `${m}m ${String(sec).padStart(2, '0')}s left`;
}

function StatusChip({ status }) {
  const c = STATUS_CHIP[status] || STATUS_CHIP.watching;
  return (
    <Box component="span" sx={{ px: 1.25, py: 0.4, borderRadius: 999, background: c.bg, border: `1px solid ${c.border}`, color: c.color, fontSize: '0.72rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
      {c.text}
    </Box>
  );
}

function ItemThumb({ row, size = 42 }) {
  if (row.imageUrl) {
    return (
      <Box component="img" src={row.imageUrl} alt={row.itemName} sx={{ width: size, height: size, objectFit: 'contain', borderRadius: 1.5, background: '#f8fafc', border: '1px solid #e2e8f0', p: 0.5 }} />
    );
  }
  return (
    <Box sx={{ width: size, height: size, borderRadius: 1.5, background: '#f8fafc', border: '1px solid #e2e8f0', display: 'grid', placeItems: 'center', color: '#2563eb' }}>
      <Inventory2OutlinedIcon sx={{ fontSize: size / 2 }} />
    </Box>
  );
}

function CodeChip({ code, onCopy, copied }) {
  if (!code) return null;
  return (
    <Box
      component="button"
      type="button"
      onClick={() => onCopy(code)}
      title="Copy the claim code"
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.4,
        borderRadius: 999, border: '1px solid #bfdbfe', background: '#ffffff',
        color: copied === code ? '#15803d' : '#1d4ed8',
        fontWeight: 800, fontSize: '0.8rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        letterSpacing: '0.06em', cursor: 'pointer'
      }}
    >
      {copied === code ? 'Copied' : code}
      <ContentCopyOutlinedIcon sx={{ fontSize: 13 }} />
    </Box>
  );
}

function PurchaseCard({ row, now, busy, onSent, onConfirm, onCancel, onCopy, copied, role }) {
  const msLeft = Date.parse(row.expiresAt) - now;
  const isDone = row.status === 'released' || row.status === 'refunded';
  return (
    <Box sx={{ ...raisedSx, p: { xs: 1.5, sm: 2 }, display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
        <ItemThumb row={row} />
        <Box sx={{ minWidth: 0, flex: '1 1 180px' }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.92rem', color: ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.itemName}
          </Typography>
          <Typography sx={{ fontSize: '0.74rem', color: muted, fontWeight: 600 }}>
            {fmt(row.amountTari)} tTARI · {timeAgo(row.fundedAt)}
          </Typography>
        </Box>
        <StatusChip status={row.status} />
      </Box>

      {row.code && !isDone ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', p: 1, borderRadius: 1.5, background: '#eff6ff', border: '1px dashed #93c5fd' }}>
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#1d4ed8' }}>
            Claim code for the Steam trade message:
          </Typography>
          <CodeChip code={row.code} onCopy={onCopy} copied={copied} />
        </Box>
      ) : null}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {row.status === 'watching' && role === 'seller' ? (
            <Box
              component="button"
              type="button"
              disabled={busy}
              onClick={() => onSent(row.id)}
              sx={{
                minHeight: 38, px: 2.25, borderRadius: 999, border: 'none',
                background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                color: '#fff', fontWeight: 800, fontSize: '0.8rem', fontFamily: 'inherit', cursor: 'pointer',
                '&:disabled': { opacity: 0.55, cursor: 'default' }
              }}
            >
              Trade sent with the code
            </Box>
          ) : null}
          {row.status === 'watching' && role === 'buyer' ? (
            <Box
              component="button"
              type="button"
              disabled={busy}
              onClick={() => onCancel(row.id)}
              sx={{
                minHeight: 38, px: 2, borderRadius: 999,
                border: '1px solid #c7d2e3', background: '#ffffff', color: '#475569',
                fontWeight: 800, fontSize: '0.8rem', fontFamily: 'inherit', cursor: 'pointer',
                '&:disabled': { opacity: 0.55, cursor: 'default' }
              }}
            >
              Cancel purchase
            </Box>
          ) : null}
          {row.status === 'sent' && role === 'buyer' ? (
            <Box
              component="button"
              type="button"
              disabled={busy}
              onClick={() => onConfirm(row.id)}
              sx={{
                minHeight: 38, px: 2.25, borderRadius: 999, border: 'none',
                background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                color: '#fff', fontWeight: 800, fontSize: '0.8rem', fontFamily: 'inherit', cursor: 'pointer',
                '&:disabled': { opacity: 0.55, cursor: 'default' }
              }}
            >
              Confirm received to release
            </Box>
          ) : null}
        </Box>
        {!isDone && row.expiresAt ? (
          <Typography sx={{ fontSize: '0.74rem', fontWeight: 800, color: msLeft < 10 * 60 * 1000 ? '#b45309' : muted, whiteSpace: 'nowrap' }}>
            {countdownText(msLeft)}
          </Typography>
        ) : null}
      </Box>
      {row.status === 'watching' && role === 'buyer' ? (
        <Typography sx={{ fontSize: '0.7rem', color: muted, fontWeight: 600 }}>
          Cancel freely until the seller sends. Once the trade is in flight, payment follows delivery or the deadline.
        </Typography>
      ) : null}
    </Box>
  );
}

export default function EscrowDemoView() {
  const { user, authenticated } = useAuth();
  const steamId = user && user.steamId ? String(user.steamId) : '';
  const [data, setData] = useState({ myListings: [], openListings: [], buying: [], selling: [], settled: [] });
  const [loaded, setLoaded] = useState(false);
  const [item, setItem] = useState(null); // item picked for listing
  const [ask, setAsk] = useState('25');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [copied, setCopied] = useState('');
  const toastTimer = useRef(null);
  const [now, setNow] = useState(Date.now());

  const say = (text) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4200);
  };
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const refresh = () => {
    if (!authenticated) return;
    fetch('/api/ootle/escrow-demo', { credentials: 'include', cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : { data: null }))
      .then((body) => {
        const rows = body.data || {};
        setData({
          myListings: Array.isArray(rows.myListings) ? rows.myListings : [],
          openListings: Array.isArray(rows.openListings) ? rows.openListings : [],
          buying: Array.isArray(rows.buying) ? rows.buying : [],
          selling: Array.isArray(rows.selling) ? rows.selling : [],
          settled: Array.isArray(rows.settled) ? rows.settled : []
        });
        setLoaded(true);
      })
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      clearInterval(tick);
    };
  }, [authenticated]);

  const walletState = readWalletState(steamId);
  const hasWallet = Boolean(walletState.address);

  const selectInventoryItem = (invItem) => {
    if (!invItem) return;
    setItem({
      name: inventoryItemTitle(invItem) || invItem.marketHashName || invItem.name || 'Item',
      imageUrl: inventoryItemThumbUrl(invItem) || null,
      itemPriceUsd: Number(invItem.marketPrice) > 0 ? Number(invItem.marketPrice) : null
    });
  };

  const pickItem = async () => {
    try {
      const res = await fetch('/api/ootle/escrow-demo/item', { credentials: 'include', cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.data) setItem(body.data);
    } catch (_) { /* keep the last item */ }
  };

  const askOk = /^\d+(\.\d{1,6})?$/.test(ask.trim()) && Number(ask) >= 1 && Number(ask) <= 1000000000;

  const submitListing = async () => {
    if (busy || !item || !askOk) return;
    setBusy(true);
    try {
      const res = await fetch('/api/ootle/escrow-demo/list', {
        method: 'POST',
        credentials: 'include',
        headers: csrfHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          itemName: item.name,
          imageUrl: item.imageUrl,
          itemPriceUsd: item.itemPriceUsd,
          askTari: ask.trim()
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.success === false) {
        say(String((body && body.error) || 'We could not post that listing. Please try again.'));
        return;
      }
      say(`Listed ${item.name} at ${fmt(ask)} tTARI. Your ask is live; delist whenever you like.`);
      setItem(null);
      refresh();
    } catch (_) {
      say('We could not post that listing. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const act = async (path, payload, message) => {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: csrfHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload || {})
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.success === false) {
        say(String((body && body.error) || 'Something went wrong. Please try again.'));
        return null;
      }
      if (message) say(message);
      refresh();
      return body.data;
    } catch (_) {
      say('Something went wrong. Please try again.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(''), 2000);
    } catch (_) { /* clipboard is optional */ }
  };

  return (
    <>
      <style>{TOAST_KEYFRAMES}</style>

      {/* ---- LIST ---- */}
      <Box sx={inlaidSx} id="ootle-list-section">
        <SectionHeader
          eyebrow="Sell"
          title="List an item"
          copy="Choose an item from your inventory and name your price in tTARI. Nothing is held while it is listed; the ask simply stands until you delist it or a buyer takes it."
        />
        {authenticated ? (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap', mt: 2 }}>
              {item ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 0.75, pr: 1.5, borderRadius: 2, background: '#ffffff', border: '1px solid #e2e8f0', minWidth: 0, boxShadow: '0 1px 3px rgba(15, 23, 42, 0.07)' }}>
                  <ItemThumb row={item} size={40} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 800, fontSize: '0.84rem', color: ink, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.name}
                    </Typography>
                    {item.itemPriceUsd ? (
                      <Typography sx={{ fontSize: '0.72rem', color: muted, fontWeight: 600 }}>
                        market ${Number(item.itemPriceUsd).toFixed(2)}
                      </Typography>
                    ) : null}
                  </Box>
                  <Box
                    component="button"
                    type="button"
                    onClick={() => setItem(null)}
                    title="Pick a different item"
                    sx={{
                      ml: 'auto', width: 30, height: 30, borderRadius: 1.5, flexShrink: 0,
                      border: '1px solid #c7d2e3', background: '#ffffff', color: '#475569',
                      fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer'
                    }}
                  >
                    ✕
                  </Box>
                </Box>
              ) : null}
              <Box
                component="input"
                id="escrow-ask"
                aria-label="Asking price in tTARI"
                inputMode="decimal"
                value={ask}
                disabled={busy}
                onChange={(e) => setAsk(e.target.value.replace(/[^\d.]/g, ''))}
                sx={{
                  width: 130, minHeight: 44, px: 1.5, borderRadius: 2,
                  border: '1px solid', borderColor: askOk ? '#cbd5e1' : '#dc2626',
                  background: '#ffffff', color: ink, fontWeight: 700, fontSize: '0.9rem',
                  fontFamily: 'inherit', outline: 'none',
                  '&:focus': { borderColor: '#2563eb', boxShadow: '0 0 0 3px rgba(37, 99, 235, 0.12)' }
                }}
              />
              <Typography sx={{ color: muted, fontWeight: 800, fontSize: '0.84rem' }}>tTARI ask</Typography>
              <Box
                component="button"
                type="button"
                id="escrow-list"
                disabled={busy || !item || !askOk}
                onClick={submitListing}
                sx={{
                  minHeight: 44, px: 2.5, borderRadius: 2, border: 'none',
                  background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                  color: '#fff', fontWeight: 800, fontSize: '0.86rem', fontFamily: 'inherit', cursor: 'pointer',
                  boxShadow: '0 6px 18px rgba(37, 99, 235, 0.3)',
                  '&:disabled': { opacity: 0.55, cursor: 'default', boxShadow: 'none' }
                }}
              >
                {busy ? 'Listing…' : 'List it'}
              </Box>
            </Box>

            {!item ? (
              <Box sx={{ display: 'grid', gap: 1, mt: 1.5 }}>
                <SealedInventoryPanel
                  authenticated={authenticated}
                  onSelect={selectInventoryItem}
                  height={330}
                />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
                  <Typography sx={{ color: muted, fontSize: '0.78rem', fontWeight: 600 }}>
                    Nothing tradable, or want a stand-in?
                  </Typography>
                  <Box
                    component="button"
                    type="button"
                    id="escrow-pick-item"
                    disabled={busy}
                    onClick={pickItem}
                    sx={{
                      minHeight: 34, px: 1.75, borderRadius: 999,
                      border: '1px dashed #93c5fd', background: '#ffffff', color: '#1d4ed8',
                      fontWeight: 800, fontSize: '0.78rem', fontFamily: 'inherit', cursor: 'pointer',
                      '&:disabled': { opacity: 0.55, cursor: 'default' }
                    }}
                  >
                    Use a pretend item
                  </Box>
                </Box>
              </Box>
            ) : null}
          </>
        ) : (
          <Typography sx={{ color: muted, fontSize: '0.86rem', mt: 1.5 }}>
            Sign in with Steam to list an item.
          </Typography>
        )}
      </Box>

      {/* ---- YOUR LISTINGS ---- */}
      {authenticated && loaded && data.myListings.length > 0 ? (
        <Box sx={inlaidSx}>
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: muted, mb: 1.25 }}>
            Your listings
          </Typography>
          <Box sx={{ display: 'grid', gap: 0.75 }}>
            {data.myListings.map((row) => (
              <Box key={row.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap', ...raisedSx, p: 1.25 }}>
                <ItemThumb row={row} size={36} />
                <Box sx={{ minWidth: 0, flex: '1 1 200px' }}>
                  <Typography sx={{ fontWeight: 800, fontSize: '0.84rem', color: ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.itemName}
                  </Typography>
                  <Typography sx={{ fontSize: '0.72rem', color: muted, fontWeight: 600 }}>
                    asking {fmt(row.askTari)} tTARI · listed {timeAgo(row.listedAt)}
                  </Typography>
                </Box>
                <Box
                  component="button"
                  type="button"
                  disabled={busy}
                  onClick={() => act(`/api/ootle/escrow-demo/list/${row.id}/delist`, {}, 'Delisted. Relist the item whenever you are ready.')}
                  sx={{
                    minHeight: 38, px: 2, borderRadius: 999,
                    border: '1px solid #c7d2e3', background: '#ffffff', color: '#475569',
                    fontWeight: 800, fontSize: '0.8rem', fontFamily: 'inherit', cursor: 'pointer',
                    '&:disabled': { opacity: 0.55, cursor: 'default' }
                  }}
                >
                  Delist
                </Box>
                <Box
                  component="button"
                  type="button"
                  disabled={busy || !hasWallet}
                  title={hasWallet ? 'Preview the buyer side of this listing' : 'Create your Ootle wallet first'}
                  onClick={() => act(`/api/ootle/escrow-demo/list/${row.id}/buy`, { demo: true },
                    `You have taken this listing as a demo. Send the trade with the claim code to continue the flow.`)}
                  sx={{
                    minHeight: 38, px: 2, borderRadius: 999, border: 'none',
                    background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                    color: '#fff', fontWeight: 800, fontSize: '0.8rem', fontFamily: 'inherit', cursor: 'pointer',
                    '&:disabled': { opacity: 0.55, cursor: 'default' }
                  }}
                >
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                    <ScienceRoundedIcon sx={{ fontSize: 14 }} /> Play the buyer
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      ) : null}

      {/* ---- BUY ---- */}
      <Box sx={inlaidSx} id="ootle-buy-section">
        <SectionHeader
          eyebrow="Buy"
          title="Buy a listed item"
          copy="Paying locks the seller's ask into an Ootle contract and issues a claim code for the Steam trade message. Funds release only against that code from that seller, so an unexpected gift or a Market purchase can never trigger a payout."
        />
        {loaded && data.openListings.length === 0 ? (
          <Typography sx={{ color: muted, fontSize: '0.86rem', mt: 1.5 }}>
            No open listings from other sellers at the moment. The board refreshes as new asks come in.
          </Typography>
        ) : null}
        <Box sx={{ display: 'grid', gap: 0.75, mt: data.openListings.length ? 2 : 0 }}>
          {data.openListings.map((row) => (
            <Box key={row.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap', ...raisedSx, p: 1.25 }}>
              <ItemThumb row={row} size={36} />
              <Box sx={{ minWidth: 0, flex: '1 1 200px' }}>
                <Typography sx={{ fontWeight: 800, fontSize: '0.84rem', color: ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.itemName}
                </Typography>
                <Typography sx={{ fontSize: '0.72rem', color: muted, fontWeight: 600 }}>
                  asking {fmt(row.askTari)} tTARI{row.itemPriceUsd ? ` · market $${Number(row.itemPriceUsd).toFixed(2)}` : ''} · listed {timeAgo(row.listedAt)}
                </Typography>
              </Box>
              {authenticated ? (
                <Box
                  component="button"
                  type="button"
                  disabled={busy || !hasWallet}
                  onClick={() => act(`/api/ootle/escrow-demo/list/${row.id}/buy`, { address: walletState.address },
                    `Purchased for ${fmt(row.askTari)} tTARI. The funds are in the contract; complete the Steam trade with the claim code to finish.`)}
                  sx={{
                    minHeight: 38, px: 2.25, borderRadius: 999, border: 'none',
                    background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                    color: '#fff', fontWeight: 800, fontSize: '0.8rem', fontFamily: 'inherit', cursor: 'pointer',
                    '&:disabled': { opacity: 0.55, cursor: 'default' }
                  }}
                >
                  Buy for {fmt(row.askTari)} tTARI
                </Box>
              ) : (
                <Typography sx={{ color: muted, fontSize: '0.78rem', fontWeight: 600 }}>Sign in to buy</Typography>
              )}
            </Box>
          ))}
        </Box>
      </Box>

      {/* ---- IN-FLIGHT ---- */}
      {authenticated && loaded && data.selling.length > 0 ? (
        <Box sx={inlaidSx}>
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: muted, mb: 1.25 }}>
            Awaiting your trade
          </Typography>
          <Box sx={{ display: 'grid', gap: 1.5 }}>
            {data.selling.map((row) => (
              <PurchaseCard
                key={row.id}
                row={row}
                now={now}
                busy={busy}
                role="seller"
                onSent={(id) => act(`/api/ootle/escrow-demo/${id}/sent`, {}, 'Marked as sent. The buyer confirms delivery, and the contract releases the tTARI.')}
                onConfirm={() => {}}
                onCancel={() => {}}
                onCopy={copyCode}
                copied={copied}
              />
            ))}
          </Box>
        </Box>
      ) : null}

      {authenticated && loaded && data.buying.length > 0 ? (
        <Box sx={inlaidSx}>
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: muted, mb: 1.25 }}>
            Purchases in progress
          </Typography>
          <Box sx={{ display: 'grid', gap: 1.5 }}>
            {data.buying.map((row) => (
              <PurchaseCard
                key={row.id}
                row={row}
                now={now}
                busy={busy}
                role="buyer"
                onSent={() => {}}
                onConfirm={(id) => act(`/api/ootle/escrow-demo/${id}/received`, {}, 'Delivery confirmed. The contract has paid the seller.')}
                onCancel={(id) => act(`/api/ootle/escrow-demo/${id}/cancel`, {}, 'Purchase cancelled. Your tTARI has been returned and the listing is back on the board.')}
                onCopy={copyCode}
                copied={copied}
              />
            ))}
          </Box>
        </Box>
      ) : null}

      {/* ---- SETTLED ---- */}
      {authenticated && settledCount(data) > 0 ? (
        <Box sx={{ ...raisedSx, p: { xs: 1.5, sm: 2 }, display: 'grid', gap: 0.75 }}>
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: muted }}>
            Completed
          </Typography>
          {data.settled.slice(0, 6).map((row) => (
            <Box key={row.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap', py: 0.5 }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.84rem', color: ink, minWidth: 0, flex: '1 1 220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.itemName}
              </Typography>
              <Typography sx={{ fontWeight: 800, fontSize: '0.84rem', color: '#1d4ed8', whiteSpace: 'nowrap' }}>
                {fmt(row.amountTari)} tTARI
              </Typography>
              <StatusChip status={row.status} />
              <Typography sx={{ color: '#94a3b8', fontSize: '0.74rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {timeAgo(row.settledAt || row.fundedAt)}
              </Typography>
            </Box>
          ))}
        </Box>
      ) : null}

      {toast ? (
        <Typography
          id="escrow-note"
          sx={{
            position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)', zIndex: 1400,
            maxWidth: 'min(92vw, 560px)', px: 2.25, py: 1.25, borderRadius: 999,
            background: '#0f172a', color: '#ffffff', fontWeight: 700, fontSize: '0.88rem',
            textAlign: 'center', boxShadow: '0 12px 32px rgba(15, 23, 42, 0.35)',
            animation: 'ootleToastIn .25s ease', pointerEvents: 'none'
          }}
          aria-live="polite"
        >
          {toast}
        </Typography>
      ) : null}
    </>
  );
}

function settledCount(data) {
  return (data.settled || []).length;
}

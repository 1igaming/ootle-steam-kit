import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  InputAdornment,
  Skeleton,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import {
  getInventoryDisplayImageUrl,
  overlayInventoryRowsFromMarketplace,
  withThumbWidth
} from '../../utils/inventoryImagesClient';
import { fetchLocalCatalogMaps, mergeInventoryWithLocalCatalog } from '../../utils/inventoryCatalogMerge';
import { deriveItemMarketState } from '../../utils/itemMarketState';
import { getItemRarityStyle } from '../../utils/itemRarityStyles';
import { cleanAvailability, getAvailabilityBodyColor } from '../../utils/availabilityHtml';
import { glassCard, glassSearchFieldSx } from '../../styles/marketShellSx';
import {
  CATALOG_ITEM_IMAGE_WELL,
  CATALOG_ITEM_INK,
  CATALOG_ITEM_MUTED,
  catalogItemCardSx,
  catalogItemThumbWellSx
} from '../../styles/catalogItemCardSx';

let steamAppId = '';

const PLACEHOLDER_ITEM_SRC = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" rx="12" fill="#f1f5f9"/><text x="64" y="78" font-size="52" text-anchor="middle" fill="#94a3b8">?</text></svg>'
);

const overlayChipSx = {
  height: 20,
  fontWeight: 800,
  fontSize: '0.62rem',
  letterSpacing: '0.01em',
  maxWidth: '100%',
  boxShadow: '0 1px 4px rgba(2, 6, 23, 0.18)',
  '& .MuiChip-label': {
    px: 0.75,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  }
};

const STATUS_CHIP_TONES = {
  listed: {
    bgcolor: 'rgba(239, 246, 255, 0.96)',
    color: '#1e3a8a',
    border: '1px solid rgba(147, 197, 253, 0.75)'
  },
  unlisted: {
    bgcolor: 'rgba(248, 250, 252, 0.96)',
    color: '#475569',
    border: '1px solid rgba(148, 163, 184, 0.55)'
  }
};

const statusChipSx = (listed) => ({
  ...overlayChipSx,
  ...(listed ? STATUS_CHIP_TONES.listed : STATUS_CHIP_TONES.unlisted)
});

const selectedCardSx = {
  border: '1px solid rgba(37, 99, 235, 0.9)',
  boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.35), 0 12px 40px rgba(59, 130, 246, 0.25)',
  '&::before': { ...catalogItemCardSx['&::before'], opacity: 1 }
};

const countPillSx = {
  display: 'inline-flex',
  alignItems: 'center',
  px: 1.1,
  py: 0.25,
  borderRadius: 999,
  background: '#eff6ff',
  border: '1px solid #bfdbfe',
  color: '#1d4ed8',
  fontSize: '0.72rem',
  fontWeight: 800,
  letterSpacing: '0.02em',
  whiteSpace: 'nowrap'
};

const scrollAreaSx = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  WebkitOverflowScrolling: 'touch',
  px: { xs: 1.25, sm: 1.5 },
  pt: 0.75,
  pb: { xs: 1.5, sm: 2 },
  containerType: 'inline-size',
  scrollbarWidth: 'thin',
  scrollbarColor: 'rgba(37,99,235,0.35) transparent',
  '&::-webkit-scrollbar': { width: 8 },
  '&::-webkit-scrollbar-thumb': { background: 'rgba(37,99,235,0.3)', borderRadius: 999 },
  '&::-webkit-scrollbar-thumb:hover': { background: 'rgba(37,99,235,0.5)' },
  '&::-webkit-scrollbar-track': { background: 'transparent' }
};

/** Panel-width grid: 1 col when tight, 2 cols when the inventory panel is wide enough. */
const cardGridSx = {
  display: 'grid',
  gap: { xs: 1, sm: 1.25 },
  gridTemplateColumns: 'minmax(0, 1fr)',
  '@container (min-width: 520px)': {
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))'
  }
};

export function inventoryItemTitle(item) {
  return String(item?.name || item?.marketHashName || 'Item').trim();
}

export function inventoryItemThumbUrl(item) {
  return withThumbWidth(getInventoryDisplayImageUrl(item), 256);
}

/**
 * The tradable Steam stack to list from: stackable games ship one asset with
 * an amount, so this is the tradable asset holding the most units. Null when
 * nothing is tradable.
 */
export function tradableStack(item) {
  const assets = Array.isArray(item?.assets) ? item.assets : [];
  let best = null;
  assets.forEach((asset) => {
    if (asset.tradable === false) return;
    const quantity = Math.max(parseInt(asset.quantity, 10) || 0, 1);
    if (!best || quantity > best.quantity) best = { assetId: String(asset.assetId), quantity };
  });
  return best;
}

/** Asset id of the tradable stack, or '' when the item cannot be listed. */
export function tradableAssetId(item) {
  const stack = tradableStack(item);
  return stack ? stack.assetId : '';
}

function groupKeyFor(item) {
  return item.marketHashName
    || (item.classId || item.classid ? `classid_${item.classId || item.classid}` : null)
    || item.name
    || `item_${item.assetId || item.assetid || 'unknown'}`;
}

/** Stack duplicates the same way the /inventory page does, keeping every asset id. */
function consolidateInventory(items) {
  const groups = new Map();
  items.forEach((item) => {
    const key = groupKeyFor(item);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: item.name || 'Unknown Item',
        marketHashName: item.marketHashName || null,
        classId: item.classId || item.classid || null,
        iconUrl: item.iconUrl || item.imageUrl || item.icon_url || null,
        imageUrl: item.imageUrl || item.iconUrl || item.icon_url || null,
        iconUrlLarge: item.iconUrlLarge || null,
        description: item.description || '',
        availability: cleanAvailability(item.availability || ''),
        type: item.type || '',
        marketPrice: item.marketPrice || 0,
        offerPrice: item.offerPrice || 0,
        quantity: 0,
        assets: []
      });
    }
    const group = groups.get(key);
    const qty = Math.max(parseInt(item.quantity, 10) || 0, parseInt(item.amount, 10) || 0, 1);
    group.quantity += qty;
    const assetId = item.assetId || item.assetid;
    if (assetId) {
      group.assets.push({ assetId: String(assetId), quantity: qty, tradable: item.tradable !== false });
    }
  });
  return Array.from(groups.values()).map((group) => ({
    ...group,
    tradable: group.assets.length > 0 && group.assets.some((asset) => asset.tradable)
  }));
}

function inventoryImageFallback(item) {
  return (event) => {
    const classId = item.classId ?? item.classid;
    const steamAkamai = item.imageUrl && String(item.imageUrl).includes('community.cloudflare.steamstatic.com')
      ? String(item.imageUrl).replace('community.cloudflare.steamstatic.com', 'community.akamai.steamstatic.com')
      : null;
    const steamClass = classId != null && steamAppId
      ? `https://community.cloudflare.steamstatic.com/economy/image/class/${steamAppId}/${classId}/300fx300f`
      : '';
    const fallbackUrl =
      (item.fallbackImageUrl && !String(item.fallbackImageUrl).includes('/api/items/') ? item.fallbackImageUrl : '')
      || steamClass;
    const stage = Number(event.currentTarget.dataset.fallbackStage || '0');
    if (stage === 0 && steamAkamai) {
      event.currentTarget.dataset.fallbackStage = '1';
      event.currentTarget.src = steamAkamai;
      return;
    }
    if (stage <= 1 && fallbackUrl) {
      event.currentTarget.dataset.fallbackStage = '2';
      event.currentTarget.src = fallbackUrl;
      return;
    }
    event.currentTarget.dataset.fallbackStage = '3';
    event.currentTarget.src = PLACEHOLDER_ITEM_SRC;
  };
}

function catalogPriceLayers(item) {
  const marketUsd = Number(item?.marketPrice) || 0;
  const offerUsd = Number(item?.offerPrice) || 0;
  const storeUsd = Number(item?.storePriceUsd) || 0;
  return {
    marketUsd,
    offerUsd,
    storeUsd,
    listedOnSteam: marketUsd > 0 || offerUsd > 0,
    hasStartingAt: Boolean(item?.priceStartsAt),
    showStoreAsPrimary: marketUsd === 0 && storeUsd > 0
  };
}

function formatUsd(price) {
  if (typeof price !== 'number' || Number.isNaN(price)) return '$0.00';
  return `$${price.toFixed(2)}`;
}

/** One clean price row for the sealed picker (no stacked last-sale block). */
function SealedCompactPrice({ item }) {
  const layers = catalogPriceLayers(item);
  if (layers.listedOnSteam) {
    const left = layers.hasStartingAt || layers.marketUsd > 0
      ? `${layers.hasStartingAt ? 'Starting' : 'Market'} ${formatUsd(layers.marketUsd)}`
      : null;
    const right = layers.offerUsd > 0 ? `Offer ${formatUsd(layers.offerUsd)}` : null;
    const line = [left, right].filter(Boolean).join(' · ');
    if (!line) {
      return (
        <Typography sx={{ color: '#94a3b8', fontSize: '0.72rem', fontWeight: 600 }}>
          Price unavailable
        </Typography>
      );
    }
    return (
      <Typography
        sx={{
          color: CATALOG_ITEM_INK,
          fontSize: '0.72rem',
          fontWeight: 700,
          lineHeight: 1.3,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {left ? (
          <Box component="span" sx={{ color: CATALOG_ITEM_MUTED, fontWeight: 600 }}>{left}</Box>
        ) : null}
        {left && right ? <Box component="span" sx={{ color: CATALOG_ITEM_MUTED, fontWeight: 600 }}> · </Box> : null}
        {right ? <Box component="span" sx={{ color: '#16a34a' }}>{right}</Box> : null}
      </Typography>
    );
  }
  if (layers.showStoreAsPrimary) {
    return (
      <Typography sx={{ color: CATALOG_ITEM_INK, fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        <Box component="span" sx={{ color: CATALOG_ITEM_MUTED, fontWeight: 600 }}>Store </Box>
        {formatUsd(layers.storeUsd)}
      </Typography>
    );
  }
  return (
    <Typography sx={{ color: '#94a3b8', fontSize: '0.72rem', fontWeight: 600 }}>
      Price unavailable
    </Typography>
  );
}

function SealedInventoryCard({ item, selected, onSelect }) {
  const title = inventoryItemTitle(item);
  const itemRarity = String(item.itemRarity || item.baseRarity || item.rarity || '').trim();
  const rarityStyle = getItemRarityStyle(itemRarity);
  const showOfficialRarity = Boolean(item.isDrop) && Boolean(itemRarity) && Boolean(rarityStyle);
  const availability = cleanAvailability(item.availability || '');

  let badgeLabel = null;
  let badgeListed = false;
  let badgeTip = item.marketStateDescription || '';
  if (!item.tradable) {
    badgeLabel = 'Not tradable';
    badgeListed = false;
    badgeTip = 'Steam marks this stack as not tradable right now.';
  } else if (item.isLimited && !item.isDrop) {
    badgeLabel = 'Limited';
    badgeListed = item.marketState === 'limited_market_listed';
    badgeTip = item.marketStateDescription
      || (item.marketState === 'limited_market_listed'
        ? 'Limited and listed on Steam'
        : item.marketState === 'limited_market_unlisted'
          ? 'Limited and not listed on Steam'
          : item.limitedPhase === 'ended'
            ? 'Limited sale ended'
            : 'Limited item');
  } else if (item.hasMarketPrice) {
    badgeLabel = 'Listed';
    badgeListed = true;
    badgeTip = item.marketStateDescription || 'Listed on Steam';
  } else {
    badgeLabel = 'Unlisted';
    badgeListed = false;
    badgeTip = item.marketStateDescription || 'Not listed on Steam';
  }

  return (
    <Card
      role="button"
      tabIndex={item.tradable ? 0 : -1}
      aria-pressed={selected}
      aria-disabled={!item.tradable}
      onClick={() => { if (item.tradable && onSelect) onSelect(item); }}
      onKeyDown={(event) => {
        if (!item.tradable || !onSelect) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(item);
        }
      }}
      sx={{
        ...catalogItemCardSx,
        height: 'auto',
        flexDirection: 'row',
        alignItems: 'stretch',
        minHeight: 88,
        ...(selected ? selectedCardSx : null),
        ...(item.tradable ? null : { cursor: 'not-allowed', opacity: 0.62 }),
        '&:focus-visible': { outline: '3px solid rgba(59, 130, 246, 0.6)', outlineOffset: 2 }
      }}
    >
      <Box
        sx={{
          position: 'relative',
          width: 88,
          flexShrink: 0,
          alignSelf: 'stretch',
          background: CATALOG_ITEM_IMAGE_WELL,
          borderRight: '1px solid rgba(226, 232, 240, 0.9)'
        }}
      >
        <Box
          component="img"
          loading="lazy"
          decoding="async"
          src={inventoryItemThumbUrl(item)}
          alt={title}
          onError={inventoryImageFallback(item)}
          sx={{
            ...catalogItemThumbWellSx,
            position: 'absolute',
            inset: 8,
            width: 'calc(100% - 16px)',
            height: 'calc(100% - 16px)',
            objectFit: 'contain',
            borderRadius: 1.2,
            p: 0.35
          }}
        />
        {item.quantity > 1 ? (
          <Chip
            label={`×${item.quantity}`}
            size="small"
            sx={{
              position: 'absolute',
              top: 6,
              right: 6,
              height: 18,
              bgcolor: '#3b82f6',
              color: '#fff',
              fontWeight: 800,
              fontSize: '0.62rem',
              zIndex: 2,
              '& .MuiChip-label': { px: 0.55 }
            }}
          />
        ) : null}
        {selected ? (
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              left: 6,
              bottom: 6,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
              color: '#fff',
              boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)',
              zIndex: 2
            }}
          >
            <CheckCircleIcon sx={{ fontSize: 14 }} />
          </Box>
        ) : null}
      </Box>

      <CardContent
        sx={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 0.45,
          py: 1.1,
          px: 1.35,
          '&:last-child': { pb: 1.1 }
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, minWidth: 0 }}>
          <Typography
            title={title}
            sx={{
              flex: 1,
              minWidth: 0,
              fontWeight: 800,
              fontSize: '0.88rem',
              lineHeight: 1.25,
              color: CATALOG_ITEM_INK,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {title}
          </Typography>
          {badgeLabel ? (
            <Tooltip title={badgeTip} placement="top">
              <Chip label={badgeLabel} size="small" sx={statusChipSx(badgeListed)} />
            </Tooltip>
          ) : null}
        </Box>

        {showOfficialRarity ? (
          <Chip
            label={itemRarity}
            size="small"
            variant="outlined"
            sx={{
              ...overlayChipSx,
              alignSelf: 'flex-start',
              bgcolor: rarityStyle.bgcolor,
              color: rarityStyle.color,
              borderColor: rarityStyle.borderColor
            }}
          />
        ) : null}

        {availability ? (
          <Typography
            title={availability}
            sx={{
              color: getAvailabilityBodyColor(availability),
              fontSize: '0.68rem',
              fontWeight: 600,
              lineHeight: 1.25,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {availability}
          </Typography>
        ) : null}

        <SealedCompactPrice item={item} />
      </CardContent>
    </Card>
  );
}

/**
 * Signed-in Steam inventory as compact selectable rows inside a fixed-height
 * glass panel. Search filters in place; only tradable stacks can be selected.
 */
export default function SealedInventoryPanel({ authenticated, selectedKey, onSelect, height }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const requestId = useRef(0);

  const load = useCallback(async (forceRefresh = false) => {
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const url = `/api/steam/inventory${forceRefresh ? '?forceRefresh=true' : ''}`;
      const res = await fetch(url, { credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (id !== requestId.current) return;
      if (!res.ok) {
        if (res.status === 401) {
          setError('Your session expired. Sign in through Steam again to see your inventory.');
        } else if (body.error === 'private_inventory') {
          setError('Your Steam inventory is private. Set it to public in your Steam privacy settings to list items.');
        } else if (body.error === 'inventory_not_configured') {
          setError(body.message || 'No game is configured for trading on this deployment yet.');
        } else {
          setError('Your inventory did not load. Try again in a moment.');
        }
        setItems([]);
        return;
      }
      steamAppId = String(body.appId || '');
      const raw = Array.isArray(body.data) ? body.data : (Array.isArray(body.items) ? body.items : []);
      let rows = consolidateInventory(raw);
      try {
        const maps = await fetchLocalCatalogMaps(rows);
        rows = mergeInventoryWithLocalCatalog(rows, maps);
      } catch (mergeErr) {
        console.warn('[SealedInventoryPanel] Local catalog merge failed:', mergeErr);
      }
      try {
        rows = await overlayInventoryRowsFromMarketplace(rows);
      } catch (overlayErr) {
        console.warn('[SealedInventoryPanel] Marketplace overlay failed:', overlayErr);
      }
      if (id !== requestId.current) return;
      rows = rows
        .map((row) => ({ ...row, ...deriveItemMarketState(row) }))
        .sort((a, b) => inventoryItemTitle(a).localeCompare(inventoryItemTitle(b)));
      setItems(rows);
    } catch (err) {
      if (id !== requestId.current) return;
      setError('Your inventory did not load. Try again in a moment.');
      setItems([]);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authenticated) {
      setItems([]);
      setLoading(false);
      return undefined;
    }
    const timer = setTimeout(() => { load(false); }, 150);
    return () => clearTimeout(timer);
  }, [authenticated, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const name = inventoryItemTitle(item).toLowerCase();
      const desc = String(item.description || '').toLowerCase();
      const type = String(item.type || '').toLowerCase();
      return name.includes(q) || desc.includes(q) || type.includes(q);
    });
  }, [items, query]);

  const totalItems = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const countLabel = loading
    ? 'Loading'
    : `${totalItems} ${totalItems === 1 ? 'item' : 'items'}${items.length && items.length !== totalItems ? ` · ${items.length} unique` : ''}`;

  return (
    <Box
      sx={{
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.45)',
        borderRadius: 2,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
        display: 'flex',
        flexDirection: 'column',
        height,
        minHeight: 0,
        overflow: 'hidden'
      }}
    >
      <Box
        sx={{
          px: { xs: 1.5, sm: 2 },
          pt: { xs: 1.5, sm: 2 },
          pb: 1.25,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: { xs: 1, sm: 1.5 },
          borderBottom: '1px solid #e2e8f0'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: { xs: '1 1 100%', sm: '0 1 auto' } }}>
          <Typography component="h2" sx={{ color: '#0f172a', fontWeight: 800, fontSize: { xs: '1.05rem', sm: '1.15rem' }, letterSpacing: '-0.01em', lineHeight: 1.2 }}>
            Your inventory
          </Typography>
          <Box component="span" sx={countPillSx} aria-live="polite">{countLabel}</Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flex: '1 1 240px', justifyContent: { sm: 'flex-end' }, minWidth: 0 }}>
          <TextField
            id="sealed-inventory-search"
            placeholder="Search your items"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            type="search"
            size="small"
            autoComplete="off"
            inputProps={{ 'aria-label': 'Search your inventory' }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 18, color: '#64748b' }} />
                </InputAdornment>
              ),
              endAdornment: query ? (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setQuery('')} aria-label="Clear search" sx={{ color: '#64748b' }}>
                    <CloseIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </InputAdornment>
              ) : null
            }}
            sx={{
              maxWidth: { sm: 320 },
              flex: 1,
              '& .MuiOutlinedInput-root': {
                borderRadius: 999,
                backgroundColor: '#ffffff',
                color: '#0f172a',
                fontSize: '0.85rem',
                minHeight: 38,
                paddingLeft: 1,
                '& fieldset': { borderColor: '#c7d2e3', borderWidth: 1 },
                '&:hover fieldset': { borderColor: '#93c5fd' },
                '&.Mui-focused fieldset': { borderColor: '#2563eb', borderWidth: 1.5 },
                '& input': { color: '#0f172a' },
                '& input::placeholder': { color: '#94a3b8', opacity: 1 }
              }
            }}
          />
          <Tooltip title="Reload from Steam">
            <span>
              <IconButton
                onClick={() => load(true)}
                disabled={loading}
                aria-label="Reload inventory from Steam"
                sx={{
                  color: '#1d4ed8',
                  border: '1px solid #bfdbfe',
                  background: '#ffffff',
                  '&:hover': { background: '#eff6ff' },
                  '&.Mui-disabled': { color: '#94a3b8' }
                }}
                size="small"
              >
                <RefreshIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={scrollAreaSx}>
        {loading ? (
          <Box sx={cardGridSx}>
            {Array.from({ length: 8 }, (_, index) => (
              <Card key={index} sx={{ ...catalogItemCardSkeletonSx, height: 'auto', flexDirection: 'row', minHeight: 88 }}>
                <Skeleton variant="rectangular" width={88} height={88} sx={{ bgcolor: CATALOG_ITEM_IMAGE_WELL, flexShrink: 0 }} />
                <CardContent sx={{ flex: 1, py: 1.25, px: 1.35 }}>
                  <Skeleton variant="text" width="70%" />
                  <Skeleton variant="text" width="45%" />
                </CardContent>
              </Card>
            ))}
          </Box>
        ) : null}

        {!loading && error ? (
          <Box sx={{ textAlign: 'center', py: 6, px: 2 }}>
            <Typography sx={{ color: '#b45309', fontWeight: 700, mb: 1.5 }}>{error}</Typography>
            <Button
              variant="outlined"
              onClick={() => load(true)}
              sx={{ textTransform: 'none', fontWeight: 700, color: '#1d4ed8', borderColor: '#bfdbfe', borderRadius: 999, '&:hover': { borderColor: '#2563eb', background: '#eff6ff' } }}
            >
              Try again
            </Button>
          </Box>
        ) : null}

        {!loading && !error && items.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6, px: 2 }}>
            <Typography sx={{ color: '#64748b', fontWeight: 700 }}>No items were found in your Steam inventory.</Typography>
          </Box>
        ) : null}

        {!loading && !error && items.length > 0 && filtered.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6, px: 2 }}>
            <Typography sx={{ color: '#64748b', fontWeight: 700, mb: 1.5 }}>No items match that search.</Typography>
            <Button
              variant="outlined"
              onClick={() => setQuery('')}
              startIcon={<CloseIcon />}
              sx={{ textTransform: 'none', fontWeight: 700, color: '#1d4ed8', borderColor: '#bfdbfe', borderRadius: 999, '&:hover': { borderColor: '#2563eb', background: '#eff6ff' } }}
            >
              Clear search
            </Button>
          </Box>
        ) : null}

        {!loading && !error && filtered.length > 0 ? (
          <Box sx={cardGridSx}>
            {filtered.map((item) => (
              <SealedInventoryCard
                key={item.key}
                item={item}
                selected={item.key === selectedKey}
                onSelect={onSelect}
              />
            ))}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

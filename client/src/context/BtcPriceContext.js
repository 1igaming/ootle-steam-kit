import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { formatBtcFromUsd, usdToBtc } from '../utils/btcMoney';

const BtcPriceContext = createContext(null);

const REFRESH_MS = 60 * 1000;

export function BtcPriceProvider({ children }) {
  const [btcUsd, setBtcUsd] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/bitcoin/price', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      const price = Number(data?.data?.btc_usd);
      if (data?.success && price > 0) {
        setBtcUsd(price);
        setUpdatedAt(data.data.lastUpdated || new Date().toISOString());
      }
    } catch (error) {
      console.warn('[BtcPrice] refresh failed:', error.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const value = useMemo(
    () => ({
      btcUsd,
      updatedAt,
      refresh,
      usdToBtc: (usd) => usdToBtc(usd, btcUsd),
      formatBtcFromUsd: (usd, opts) => formatBtcFromUsd(usd, btcUsd, opts)
    }),
    [btcUsd, updatedAt, refresh]
  );

  return <BtcPriceContext.Provider value={value}>{children}</BtcPriceContext.Provider>;
}

export function useBtcPrice() {
  const ctx = useContext(BtcPriceContext);
  if (!ctx) {
    throw new Error('useBtcPrice must be used within a BtcPriceProvider');
  }
  return ctx;
}

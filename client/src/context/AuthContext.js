import React, { createContext, useContext, useEffect, useState } from 'react';

const AuthContext = createContext(null);

/**
 * Steam session context: polls /auth/status, exposes login/logout.
 * login() preserves the current hash route across the Steam round trip.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/auth/status', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setAuthenticated(Boolean(data.authenticated));
        setUser(data.user || null);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const login = () => {
    if (window.location.hostname && window.location.hostname !== 'localhost') {
      const back = `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.href = `/auth/steam?return=${encodeURIComponent(back)}`;
      return;
    }
    window.location.href = '/auth/steam';
  };

  const logout = async () => {
    try { await fetch('/auth/logout', { credentials: 'include' }); } catch (_) { /* best effort */ }
    window.location.href = '/';
  };

  return (
    <AuthContext.Provider value={{ user, authenticated, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

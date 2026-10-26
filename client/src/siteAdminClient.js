// Client-side admin hint used to show admin-only UI. The server-side gate
// (ADMIN_STEAM_ID / ADMIN_STEAM_IDS in server/.env) is what actually
// authorizes admin actions; this only decides what to render.

export function sessionSteamId64(user) {
  if (!user) return '';
  const v = user.steamId != null ? user.steamId : user.id;
  return v == null ? '' : String(v).trim();
}

export function isSiteAdminUser(user) {
  const expected = process.env.REACT_APP_ADMIN_STEAM_ID;
  return Boolean(expected) && sessionSteamId64(user) === String(expected).trim();
}

/** Admin = steam id present in ADMIN_STEAM_ID / ADMIN_STEAM_IDS. */
const ADMIN_STEAM_IDS = Object.freeze(Array.from(new Set(
  [process.env.ADMIN_STEAM_ID || '']
    .concat(String(process.env.ADMIN_STEAM_IDS || '').split(','))
    .map((v) => String(v == null ? '' : v).trim())
    .filter(Boolean)
)));

const isAdmin = (user) => {
  const candidates = [user?.steamId, user?.id]
    .filter((v) => v != null && String(v).trim() !== '')
    .map((v) => String(v).trim());
  return candidates.some((id) => ADMIN_STEAM_IDS.includes(id));
};

const verifyAdmin = (req, res, next) => {
  if (!req.isAuthenticated?.() || !req.user || !isAdmin(req.user)) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Admin only' });
  }
  req.adminVerified = true;
  next();
};

module.exports = { verifyAdmin, isAdmin, ADMIN_STEAM_IDS };

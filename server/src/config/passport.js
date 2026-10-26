/**
 * Steam OpenID login. Works on any host: the return URL and realm are read
 * from the environment so the same code serves localhost, staging, or prod.
 * Supports one strategy per host so users return to the host they started on.
 */
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const axios = require('axios');

const ADMIN_STEAM_IDS = Object.freeze(Array.from(new Set(
  [process.env.ADMIN_STEAM_ID || '']
    .concat(String(process.env.ADMIN_STEAM_IDS || '').split(','))
    .map((v) => String(v == null ? '' : v).trim())
    .filter(Boolean)
)));

async function fetchSteamPlayerSummary(apiKey, steamId) {
  if (!apiKey) return null;
  const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${encodeURIComponent(steamId)}`;
  const { data } = await axios.get(url, { timeout: 12000 });
  return data?.response?.players?.[0] || null;
}

passport.serializeUser((obj, done) => done(null, obj));
passport.deserializeUser((obj, done) => done(null, obj));

const steamVerify = async function steamVerify(req, identifier, _profile, done) {
  try {
    const match = identifier && String(identifier).match(/(\d{17})$/);
    if (!match) return done(null, false, { message: 'Invalid Steam identifier' });
    const steamId = match[1];
    let profile = {
      steamid: steamId,
      personaname: `Player ${steamId}`,
      profileurl: `https://steamcommunity.com/profiles/${steamId}`
    };
    try {
      const player = await fetchSteamPlayerSummary(process.env.STEAM_API_KEY, steamId);
      if (player) profile = player;
    } catch (_) { /* profile is cosmetic */ }
    const user = {
      steamId,
      id: steamId,
      displayName: profile.personaname,
      username: profile.personaname,
      avatar: profile.avatarmedium || profile.avatar || '',
      avatarMedium: profile.avatarmedium || '',
      avatarFull: profile.avatarfull || '',
      profileUrl: profile.profileurl || ''
    };
    done(null, user);
  } catch (error) {
    done(null, false, { message: error.message || 'Steam login failed' });
  }
};

function hostConfig(host) {
  const fallback = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3013}`;
  const base = host ? `https://${host}` : fallback;
  return { returnURL: `${base}/auth/steam/return`, realm: `${base}/` };
}

let steamConfigured = false;

function initializePassport() {
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey || apiKey === 'your-steam-api-key') {
    console.warn('STEAM_API_KEY not set: Steam login unavailable.');
    steamConfigured = false;
    return false;
  }
  steamConfigured = true;
  const main = hostConfig(null);
  passport.use('steam', new SteamStrategy({
    returnURL: main.returnURL,
    realm: main.realm,
    apiKey,
    profile: false,
    passReqToCallback: true
  }, steamVerify));
  return true;
}

/** Register a strategy bound to a specific host (multi-domain deployments). */
function registerHostStrategy(host, name) {
  const cfg = hostConfig(host);
  passport.use(name, new SteamStrategy({
    returnURL: cfg.returnURL,
    realm: cfg.realm,
    apiKey: process.env.STEAM_API_KEY,
    profile: false,
    passReqToCallback: true
  }, steamVerify));
}

module.exports = { initializePassport, registerHostStrategy, ADMIN_STEAM_IDS, steamLoginConfigured: () => steamConfigured };

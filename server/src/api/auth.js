/**
 * Steam auth routes: /auth/steam, /auth/steam/return, /auth/status,
 * /auth/logout. The return-to-host logic keeps users on the origin they
 * started from in multi-domain deployments.
 */
const express = require('express');
const passport = require('passport');
const { registerHostStrategy, steamLoginConfigured } = require('../config/passport');

const router = express.Router();

router.get('/auth/steam', (req, res, next) => {
  if (!steamLoginConfigured()) return res.redirect('/?login=notconfigured');
  const host = req.hostname;
  const isLocal = !host || host === 'localhost' || host === '127.0.0.1';
  const name = isLocal ? 'steam' : `steam-${host.replace(/[^a-z0-9.-]/gi, '-')}`;
  if (!isLocal) {
    try { registerHostStrategy(host, name); } catch (_) { /* already registered */ }
  }
  return passport.authenticate(name, { failureRedirect: '/' })(req, res, next);
});

router.get('/auth/steam/return', (req, res, next) => {
  if (!steamLoginConfigured()) return res.redirect('/?login=notconfigured');
  const host = req.hostname;
  const name = host && host !== 'localhost' && host !== '127.0.0.1'
    ? `steam-${host.replace(/[^a-z0-9.-]/gi, '-')}`
    : 'steam';
  passport.authenticate(name, (err, user) => {
    if (err || !user) return res.redirect('/?login=error');
    req.logIn(user, () => res.redirect('/?login=success'));
  })(req, res, next);
});

router.get('/auth/status', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    // refresh persona at most every 6h (avatars change)
    res.json({ authenticated: true, user: req.user });
    return;
  }
  res.json({ authenticated: false, user: null });
});

router.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) return next();
  res.status(401).json({ error: 'Unauthorized', message: 'You must be logged in' });
}

module.exports = { router, ensureAuthenticated };

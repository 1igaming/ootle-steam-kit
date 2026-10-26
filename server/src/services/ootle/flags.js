/**
 * Env-driven feature flags for the DApp. All defaults are safe for a fresh
 * deployment: read-only market data, faucet on, nothing sends funds unless
 * OOTLE_ENABLE_TRANSFERS=true.
 */

function readBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

function flags() {
  return {
    transfersEnabled: readBool('OOTLE_ENABLE_TRANSFERS', false),
    faucetEnabled: readBool('OOTLE_FAUCET_ENABLED', true),
    predictionsEnabled: readBool('OOTLE_PREDICTIONS_ENABLED', true),
    hotAccount: process.env.OOTLE_HOT_ACCOUNT || 'dapp-escrow'
  };
}

module.exports = { flags };

/**
 * Shared Tari/Ootle constants for the DApp server.
 * Everything deployment-specific comes from the environment.
 */

const path = require('path');
const fs = require('fs');

/** Micro Tari per Tari (6 decimals). */
const MICRO_PER_TARI = 1000000n;

/** Fee headroom for dry runs and balance checks. */
const DEFAULT_MAX_FEE_MICRO = 2000000n;

/** Tari L2 resource address (native TARI token on Ootle). */
const TARI_RESOURCE = 'resource_0101010101010101010101010101010101010101010101010101010101010101';

/** Wallet daemon escrow/hot account used by this DApp (rename freely). */
const HOT_ACCOUNT = process.env.OOTLE_HOT_ACCOUNT || 'dapp-escrow';

module.exports = {
  MICRO_PER_TARI,
  DEFAULT_MAX_FEE_MICRO,
  TARI_RESOURCE,
  HOT_ACCOUNT
};

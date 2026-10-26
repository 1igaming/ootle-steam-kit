/**
 * Keeps the Esmeralda escrow funded so faucet claims and shield on-chain
 * legs are real testnet transfers. The network testnet faucet vault drains
 * and refills over time; whenever the escrow sits below target this asks
 * walletd for free test coins for the difference (accounts.
 * create_free_test_coins, Admin API key required). Without the key or with
 * an empty faucet vault this is a silent no-op — nothing else changes.
 */

const fs = require('fs');

const ESCROW_ACCOUNT = 'dapp-escrow';
const CHECK_INTERVAL_MS = 60 * 1000; // every minute — vault refills arrive in drips and claims are first-come
const MAX_MINT_PER_CALL_MICRO = 50000n * 1000000n; // 50,000 tTARI per mint

function mintAdminKey() {
  const file = process.env.OOTLE_MINT_ADMIN_KEY_FILE;
  if (!file) return '';
  try {
    return String(fs.readFileSync(file, 'utf8')).trim();
  } catch (_) {
    return '';
  }
}

function targetMicro() {
  const tari = Number(process.env.OOTLE_ESCROW_TARGET_TARI || 20000);
  return BigInt(Math.max(0, Math.round(tari))) * 1000000n;
}

async function escrowBalanceMicro(walletd) {
  try {
    const res = await walletd.rpc('accounts.get_balances', { account: { Name: ESCROW_ACCOUNT } });
    const rows = Array.isArray(res && res.balances) ? res.balances : [];
    let total = 0n;
    for (const row of rows) {
      if (String(row.resource_address || '').startsWith('resource_010101010101')
        || row.token_symbol === 'tTARI') {
        total += BigInt(row.balance || '0') + BigInt(row.confidential_balance || '0');
      }
    }
    return total;
  } catch (_) {
    return null;
  }
}

const CLAIM_MINIMUM_MICRO = 1000n * 1000000n; // the vault must hold one full claim for ANY claim to pass

/** One top-up attempt. Returns { mintedMicro } or { skipped, reason }. */
async function tryTopUp({ client } = {}) {
  const key = mintAdminKey();
  if (!key) return { skipped: 'no_admin_key' };
  const { createWalletdClient } = require('./walletdClient');
  const walletd = client || createWalletdClient({ token: key });
  const balance = await escrowBalanceMicro(walletd);
  if (balance == null) return { skipped: 'balance_unreadable' };
  const target = targetMicro();
  if (balance >= target) return { skipped: 'at_target', balanceMicro: balance.toString() };

  // The shared network faucet vault serves claims only while it holds at
  // least one full claim; above that, a claim may take whatever it holds.
  // Ask for the smaller of what we are missing and what the vault has.
  let vaultMicro = null;
  try {
    const vault = await walletd.rpc('accounts.get_faucet_balance', {});
    vaultMicro = BigInt(vault && vault.balance || '0');
  } catch (_) {
    vaultMicro = null;
  }
  if (vaultMicro != null && vaultMicro < CLAIM_MINIMUM_MICRO) {
    return { skipped: 'vault_short', vaultMicro: vaultMicro.toString() };
  }

  const missing = target - balance;
  let mintMicro = missing > MAX_MINT_PER_CALL_MICRO ? MAX_MINT_PER_CALL_MICRO : missing;
  if (vaultMicro != null && mintMicro > vaultMicro - 1000000n) {
    mintMicro = vaultMicro - 1000000n; // leave the claim minimum intact
  }
  if (mintMicro <= 0n) return { skipped: 'vault_short', vaultMicro: vaultMicro.toString() };

  try {
    const minted = await walletd.rpc('accounts.create_free_test_coins', {
      account: { Name: ESCROW_ACCOUNT },
      amount: mintMicro.toString(),
      max_fee: '10000'
    });
    const txid = minted && (minted.transaction_id || minted.transactionId);
    console.log(`💧 Ootle escrow topped up with ${Number(mintMicro) / 1e6} tTARI${txid ? ` (tx ${txid})` : ''}`);
    return { mintedMicro: mintMicro.toString(), txid: txid ? String(txid) : null };
  } catch (err) {
    // someone else claimed first, walletd hiccup, … — the next tick retries
    return { skipped: 'mint_failed', reason: String(err && err.message || '').slice(0, 160) };
  }
}

let started = false;

/** Start the periodic top-up (once per process). */
function start() {
  if (started) return;
  started = true;
  const run = async () => {
    await tryTopUp().catch(() => {});
    // whether or not a mint landed, the balance may now cover legs that
    // failed earlier — heal them
    const { retryPendingLegs } = require('./localWalletOps');
    const healed = await retryPendingLegs().catch(() => null);
    if (healed && healed.fired > 0) {
      console.log(`🔁 Retried ${healed.fired} on-chain leg${healed.fired === 1 ? '' : 's'} after escrow check`);
    }
  };
  setTimeout(run, 30 * 1000); // let the daemon connection settle after boot
  setInterval(run, CHECK_INTERVAL_MS).unref();
}

module.exports = { tryTopUp, start, escrowBalanceMicro, ESCROW_ACCOUNT };

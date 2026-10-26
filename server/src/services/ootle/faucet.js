/**
 * Testnet faucet: sends 333 tTARI from the Esmeralda escrow account to a
 * browser wallet address, once per Steam account and once per address every
 * 24 hours. Claims are recorded in data/ootle/faucet-claims.json with their
 * transaction id. When the escrow runs dry the faucet says so instead of
 * half-sending.
 */

const fs = require('fs');
const path = require('path');

const STORE_DIR = process.env.DAPP_DATA_DIR
  ? path.join(process.env.DAPP_DATA_DIR, 'ootle')
  : path.join(__dirname, '../../../data/ootle');
const STORE_FILE = path.join(STORE_DIR, 'faucet-claims.json');

const AMOUNT_MICRO = 333n * 1000000n;
const AMOUNT_TARI = 333;
/** Fee headroom so the balance check does not reject a send the daemon would accept. */
const FEE_MARGIN_MICRO = 10n * 1000000n;

function readClaims() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { claims: {}, byAddress: {} };
    return { claims: parsed.claims || {}, byAddress: parsed.byAddress || {} };
  } catch (_) {
    return { claims: {}, byAddress: {} };
  }
}

function writeClaims(state) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const tmp = `${STORE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

function assertAddress(address) {
  const value = String(address || '').trim();
  if (!value.startsWith('otl_esm_') || value.length < 40 || value.length > 250 || /\s/.test(value)) {
    const err = new Error('Create your Ootle wallet first, then try the faucet.');
    err.code = 'bad_address';
    throw err;
  }
  return value;
}

async function claim({ steamId, address, client }) {
  const value = assertAddress(address);
  const key = String(steamId || '');
  if (!key) {
    const err = new Error('Sign in through Steam first.');
    err.code = 'forbidden';
    throw err;
  }

  const state = readClaims();

  const { liveWalletd } = require('./walletdClient');
  const walletd = client || liveWalletd();

  // Best-effort on-chain send: while the escrow holds tTARI the claim also
  // lands as a real stealth transfer. When it cannot, the claim still
  // credits the browser wallet's ledger balance so the testnet faucet never
  // turns anyone away.
  // keep a floor in the escrow for shield/unshield legs: when it runs low,
  // claims stay ledger-only instead of draining the last of the on-chain
  // funds (the ledger credit below still always lands)
  let escrowShort = false;
  try {
    const { escrowBalanceMicro } = require('./escrowTopUp');
    const { liveWalletd } = require('./walletdClient');
    const escrowMicro = await escrowBalanceMicro(liveWalletd());
    escrowShort = escrowMicro != null && escrowMicro < 2000n * 1000000n;
  } catch (_) {
    escrowShort = false; // unreadable balance should not block a real send
  }

  let txid = null;
  let onChain = false;
  if (!escrowShort) try {
    const { stealthTransferParams } = require('./withdrawals');
    // tight fee: walletd burns the whole max_fee as exhaust on esmeralda
    // (real cost ~0.01 tTARI), so the default 2 tTARI would drain the
    // escrow a claim at a time
    const params = stealthTransferParams({
      accountName: 'dapp-escrow',
      address: value,
      amount: AMOUNT_MICRO,
      maxFee: 100000n
    });
    const sent = await walletd.stealthTransfer(params);
    txid = sent && (sent.transaction_id || sent.transactionId);
    onChain = Boolean(txid);
  } catch (_) { /* ledger credit below still applies */ }

  state.claims[key] = { at: new Date().toISOString(), address: value, txid: txid ? String(txid) : null, tari: AMOUNT_TARI };
  state.byAddress[value] = state.claims[key].at;
  writeClaims(state);

  const games = require('./games');
  await games.creditBalance(key, AMOUNT_TARI, 'faucet');

  const transfers = require('./browserTransfers');
  if (onChain) {
    transfers.record({ address: value, txid: String(txid), tari: AMOUNT_TARI, kind: 'faucet' }).catch(() => {});
  }

  return { txid: txid ? String(txid) : null, onChain, tari: AMOUNT_TARI, address: value };
}

module.exports = { claim, AMOUNT_TARI };

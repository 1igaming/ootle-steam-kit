/**
 * Outbound tTARI transfers from the DApp escrow to browser wallet
 * addresses (faucet claims, game payouts). The wallet daemon has no
 * view-key import in v0.43, so it cannot scan for the browser's stealth
 * outputs; since the DApp escrow is the only source of funds to those
 * addresses during the alpha, the confirmed balance of a browser wallet
 * is exactly the sum of transfers we sent that the chain has Accepted.
 *
 * Store: data/ootle/browser-transfers.json
 * { transfers: [{ id, address, txid, tari, kind, at, confirmed }] }
 */

const fs = require('fs');
const path = require('path');

const STORE_DIR = process.env.DAPP_DATA_DIR
  ? process.env.DAPP_DATA_DIR || path.join(__dirname, '../../../data')
  : path.join(__dirname, '../../../data/ootle');
const STORE_FILE = path.join(STORE_DIR, 'browser-transfers.json');

let chain = Promise.resolve();

function mutate(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

function readAll() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return Array.isArray(parsed.transfers) ? parsed : { transfers: [] };
  } catch (_) {
    return { transfers: [] };
  }
}

function writeAll(state) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const tmp = `${STORE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

function record({ address, txid, tari, kind }) {
  const cleanAddress = String(address || '').trim();
  if (!cleanAddress.startsWith('otl_esm_')) throw new Error('bad address');
  return mutate(() => {
    const state = readAll();
    state.transfers.unshift({
      id: `${String(txid)}:${cleanAddress.slice(-8)}`,
      address: cleanAddress,
      txid: String(txid),
      tari: Number(tari) || 0,
      kind: String(kind || 'transfer'),
      at: new Date().toISOString(),
      confirmed: false
    });
    state.transfers = state.transfers.slice(0, 1000);
    writeAll(state);
    return { recorded: true };
  });
}

/** Ledger credit with no on-chain leg (faucet when the escrow is dry). */
function credit({ address, tari, kind }) {
  const cleanAddress = String(address || '').trim();
  if (!cleanAddress.startsWith('otl_esm_')) throw new Error('bad address');
  return mutate(() => {
    const state = readAll();
    state.transfers.unshift({
      id: `credit:${Date.now()}:${cleanAddress.slice(-8)}`,
      address: cleanAddress,
      txid: null,
      tari: Number(tari) || 0,
      kind: String(kind || 'credit'),
      at: new Date().toISOString(),
      confirmed: true,
      ledgerOnly: true
    });
    state.transfers = state.transfers.slice(0, 1000);
    writeAll(state);
    return { credited: true };
  });
}

function transfersFor(address) {
  const clean = String(address || '').trim();
  return readAll().transfers.filter((t) => t.address === clean);
}

/**
 * Mark transfers Accepted once their transaction shows up as Accepted in
 * the daemon's transaction list. Called opportunistically on balance reads.
 */
async function confirmPending(client) {
  const { liveWalletd } = require('./walletdClient');
  const walletd = client || liveWalletd();
  const state = readAll();
  const pending = state.transfers.filter((t) => !t.confirmed && t.txid);
  if (!pending.length) return { confirmed: 0 };
  let statuses;
  try {
    const res = await walletd.rpc('transactions.list', { limit: 100 });
    statuses = new Map(
      (res && Array.isArray(res.transactions) ? res.transactions : [])
        .filter((t) => t && t.id)
        .map((t) => [String(t.id), String(t.status || '')])
    );
  } catch (_) {
    return { confirmed: 0 };
  }
  let confirmed = 0;
  for (const t of pending) {
    const status = statuses.get(String(t.txid));
    if (status === 'Accepted') {
      t.confirmed = true;
      confirmed += 1;
    }
  }
  if (confirmed > 0) writeAll(state);
  return { confirmed };
}

/** Confirmed balance in tTARI for a browser address, plus pending count. */
function balanceOf(address) {
  const rows = transfersFor(address);
  const confirmed = rows.filter((t) => t.confirmed);
  const pending = rows.length - confirmed.length;
  const tari = confirmed.reduce((sum, t) => sum + (Number(t.tari) || 0), 0);
  return { tari, pending, transfers: rows.length, latest: rows[0] || null };
}

module.exports = { record, credit, transfersFor, confirmPending, balanceOf };

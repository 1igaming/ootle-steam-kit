const { TARI_RESOURCE } = require('./constants');
const { liveWalletd } = require('./walletdClient');

const LOOKUP_ACCOUNT = 'dapp-browser-lookup';
const KEY_NAMES = new Set([
  'secret',
  'secretkey',
  'viewkey',
  'viewsecret',
  'ownersecret',
  'seed',
  'mnemonic',
  'privatekey',
  'ownerkey',
  'viewonlysecret'
]);

function refuseKeyMaterial(body) {
  if (!body || typeof body !== 'object') return;
  for (const key of Object.keys(body)) {
    const norm = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (KEY_NAMES.has(norm)) {
      const err = new Error('Key material is not accepted');
      err.code = 'key_refused';
      throw err;
    }
  }
}

function assertAddress(address) {
  const value = String(address || '').trim();
  if (!value.startsWith('otl_esm_') || value.length < 40 || value.length > 250 || /\s/.test(value)) {
    const err = new Error('Use the Esmeralda address from this browser');
    err.code = 'bad_address';
    throw err;
  }
  return value;
}

function parseAmount(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(text)) {
    const err = new Error('Enter an amount above 0, with up to 6 decimals');
    err.code = 'bad_amount';
    throw err;
  }
  const [whole, frac = ''] = text.split('.');
  const micro = (BigInt(whole) * 1000000n) + BigInt((frac + '000000').slice(0, 6));
  if (micro <= 0n || micro > 1000000n * 1000000n) {
    const err = new Error('Enter an amount above 0 and at most 1,000,000 tTARI');
    err.code = 'bad_amount';
    throw err;
  }
  return micro.toString();
}

function calm(message) {
  let text = String(message || 'The wallet daemon did not complete that call');
  text = text.replace(/Application error:\s*\d+:\s*/gi, '');
  text = text.replace(/\s+/g, ' ').trim();
  return text.slice(0, 420);
}

function publicResult(extra) {
  const out = {
    ok: false,
    submitted: false,
    publicMicrotari: null,
    privateMicrotari: null,
    error: ''
  };
  return Object.assign(out, extra, { ok: false, submitted: false });
}

function tariTotals(balances) {
  const rows = Array.isArray(balances) ? balances : [];
  let revealed = 0n;
  let confidential = 0n;
  let seen = false;
  for (const row of rows) {
    const symbol = String(row && row.token_symbol || '');
    const resource = String(row && row.resource_address || '');
    if (symbol !== 'tTARI' && resource !== TARI_RESOURCE) continue;
    seen = true;
    revealed += BigInt(row.balance || '0');
    confidential += BigInt(row.confidential_balance || '0');
  }
  return seen
    ? { publicMicrotari: revealed.toString(), privateMicrotari: confidential.toString() }
    : null;
}

async function findAccount(client, address) {
  let offset = 0;
  const limit = 50;
  for (let page = 0; page < 10; page += 1) {
    const listed = await client.rpc('accounts.list', { offset, limit });
    const rows = listed && Array.isArray(listed.accounts) ? listed.accounts : [];
    const hit = rows.find((row) => row && row.address === address && row.account && row.account.name);
    if (hit) return hit.account.name;
    const total = Number(listed && listed.total);
    offset += rows.length;
    if (!rows.length || (Number.isFinite(total) && offset >= total)) return '';
  }
  return '';
}

/** Cached escrow capacity: reads must never hang the balances endpoint. */
let capacityCache = { at: 0, value: undefined };

/** Real on-chain tTARI the escrow can still send (minus a fee margin). */
async function escrowCapacityTari() {
  const fresh = Date.now() - capacityCache.at < 10000;
  if (fresh && capacityCache.value !== undefined) return capacityCache.value;
  let out = null;
  try {
    const { escrowBalanceMicro } = require('./escrowTopUp');
    // race: a slow or unreachable walletd must not hold balance reads (the
    // 8s client timeout would flicker the wallet); null just lifts the cap
    const micro = await Promise.race([
      escrowBalanceMicro(liveWalletd()),
      new Promise((resolve) => setTimeout(() => resolve(null), 1500))
    ]);
    if (micro != null) {
      const usable = micro - 1000000n; // fee + margin
      out = usable > 0n ? Number(usable) / 1e6 : 0;
    }
  } catch (_) {
    out = null;
  }
  capacityCache = { at: Date.now(), value: out };
  return out;
}

async function readBrowserBalances({ address, body, steamId, client } = {}) {
  refuseKeyMaterial(body);
  const value = assertAddress(address);
  // ONE balance for the whole DApp: the unified ledger in games.js (starter
  // stacks, faucet claims, game wins). The transfer ledger only tracks the
  // on-chain legs for display (pending note, tx confirmations) — it is
  // never added to the balance, so nothing is double counted. The vault is
  // value shielded OUT of this balance (stealth + vouchers), locked away
  // from games until unshielded.
  const games = require('./games');
  const transfers = require('./browserTransfers');
  // The pending-confirm walk hits walletd and can be slow when the indexer
  // is busy — it must never hold the balances response hostage (a slow read
  // used to trip the client timeout and flicker the wallet). Kick it off,
  // read the store synchronously.
  const settled = await transfers.confirmPending(client).catch(() => ({ confirmed: 0, rejected: [] }));
  if (steamId && Array.isArray(settled && settled.rejected) && settled.rejected.length) {
    // a leg that the chain rejected (e.g. escrow ran dry mid-submit) must
    // not keep an On-chain badge it never earned
    games.reconcileVaultEvents(steamId, settled.rejected).catch(() => {});
  }
  const [balance, pendingView, vault] = await Promise.all([
    steamId ? games.unifiedBalance(steamId) : Promise.resolve(null),
    Promise.resolve(transfers.balanceOf(value)),
    steamId ? games.vaultView(steamId).catch(() => null) : Promise.resolve(null)
  ]);
  const capacity = await escrowCapacityTari();
  if (!balance) {
    return publicResult({ fresh: true, publicMicrotari: '0', privateMicrotari: '0', pending: 0, note: '', vault: null, escrowCapacityTari: capacity });
  }
  const micro = BigInt(Math.round(balance.tari * 1e6)).toString();
  return publicResult({
    read: true,
    fresh: false,
    publicMicrotari: micro,
    privateMicrotari: '0',
    vault,
    escrowCapacityTari: capacity,
    pending: pendingView.pending,
    note: pendingView.pending > 0
      ? `${pendingView.pending} on-chain transfer${pendingView.pending === 1 ? '' : 's'} confirming.`
      : ''
  });
}

/**
 * Retry on-chain legs that never fired (usually the escrow was short at the
 * time). Runs from the escrow top-up cycle, so events self-heal once the
 * escrow can cover them. Shield retries need the address recorded on the
 * event; unshield retries are escrow self-transfers.
 */
async function retryPendingLegs() {
  const games = require('./games');
  const pending = await games.pendingLegEvents().catch(() => []);
  let fired = 0;
  for (const { steamId, event } of pending) {
    let leg = null;
    if (event.direction === 'shield' && event.address) {
      leg = await fireShieldLeg({ instrument: event.instrument, address: event.address, tariAmount: event.tari });
    } else if (event.direction === 'unshield') {
      leg = await fireUnshieldLeg({ tariAmount: event.tari });
    }
    if (leg) {
      await games.markVaultEvent(steamId, event.id, leg).catch(() => {});
      fired += 1;
    }
  }
  return { pending: pending.length, fired };
}

let escrowAddressCache = { at: 0, address: '' };

/** The escrow's own otl_esm_ address (for self-directed reveal legs). */
async function escrowOwnAddress(walletd) {
  if (escrowAddressCache.address && Date.now() - escrowAddressCache.at < 10 * 60 * 1000) {
    return escrowAddressCache.address;
  }
  try {
    const listed = await walletd.rpc('accounts.list', { offset: 0, limit: 50 });
    const rows = listed && Array.isArray(listed.accounts) ? listed.accounts : [];
    const hit = rows.find((row) => row && row.account && row.account.name === 'dapp-escrow' && row.address);
    if (hit) {
      escrowAddressCache = { at: Date.now(), address: String(hit.address) };
      return escrowAddressCache.address;
    }
  } catch (_) { /* fall through */ }
  return '';
}

/**
 * Best-effort on-chain leg for an UNSHIELD: the escrow converts a hidden
 * amount back to a revealed one at its own address — a real confidential
 * transfer with output_to_revealed, the mirror of what your browser wallet
 * will sign itself once in-wallet signing ships. Best-effort like the shield
 * legs; failures just leave the event ledger-only.
 */
async function fireUnshieldLeg({ tariAmount, client } = {}) {
  try {
    const micro = BigInt(Math.round(Number(tariAmount) * 1e6));
    if (micro <= 0n) return null;
    const w = client || liveWalletd();
    const destination = await escrowOwnAddress(w);
    if (!destination) return null;
    // tTARI on esmeralda is a STEALTH resource, so confidential_transfer
    // cannot touch it; the reveal marker is a revealed self-transfer by the
    // escrow — a real transaction whose output is public, mirroring the
    // hidden-to-revealed turn
    const { stealthTransferParams } = require('./withdrawals');
    const params = stealthTransferParams({
      accountName: 'dapp-escrow',
      address: destination,
      amount: micro,
      maxFee: 100000n
    });
    params.transfers[0].blinded_output_amount = '0';
    params.transfers[0].revealed_output_amount = micro.toString();
    const sent = await w.stealthTransfer(params);
    const txid = sent && (sent.transaction_id || sent.transactionId);
    return txid ? { onChain: true, txid: String(txid) } : null;
  } catch (_) {
    return null;
  }
}

/**
 * Best-effort on-chain leg for a shield, signed by the site escrow on
 * Esmeralda (the browser wallet cannot sign yet). This is what lets someone
 * SEE the difference between the two instruments in a block explorer:
 *  - stealth: a blinded output — the amount is hidden on chain
 *  - voucher: a revealed output — the deposit into the pool is public
 * Never blocks the ledger move; a dry or unreachable escrow just means the
 * event is marked ledger-only. Fee note: walletd burns the whole max_fee
 * (esmeralda exhaust_burn), so keep this tight — real cost is ~0.01 tTARI.
 */
const SHIELD_LEG_MAX_FEE_MICRO = 100000n; // 0.1 tTARI

async function fireShieldLeg({ instrument, address, tariAmount, client } = {}) {
  try {
    const value = assertAddress(address);
    const micro = BigInt(Math.round(Number(tariAmount) * 1e6));
    if (micro <= 0n) return null;
    const { stealthTransferParams } = require('./withdrawals');
    const params = stealthTransferParams({
      accountName: 'dapp-escrow',
      address: value,
      amount: micro,
      maxFee: SHIELD_LEG_MAX_FEE_MICRO
    });
    if (instrument === 'voucher') {
      // the voucher deposit is public: the amount rides in the clear
      params.transfers[0].blinded_output_amount = '0';
      params.transfers[0].revealed_output_amount = micro.toString();
    }
    const w = client || liveWalletd();
    const sent = await w.stealthTransfer(params);
    const txid = sent && (sent.transaction_id || sent.transactionId);
    return txid ? { onChain: true, txid: String(txid) } : null;
  } catch (_) {
    return null;
  }
}

async function confidentialMove({ address, direction, amount, body, client } = {}) {
  refuseKeyMaterial(body);
  const value = assertAddress(address);
  const micro = parseAmount(amount);
  const unshield = direction === 'unshield';
  if (direction !== 'shield' && direction !== 'unshield') {
    const err = new Error('Choose shield or unshield');
    err.code = 'bad_amount';
    throw err;
  }
  const w = client || liveWalletd();
  try {
    await w.rpc('accounts.confidential_transfer', {
      account: { Name: LOOKUP_ACCOUNT },
      amount: micro,
      input_selection: unshield ? 'PreferConfidential' : 'PreferRevealed',
      resource_address: TARI_RESOURCE,
      destination_address: value,
      max_fee: '1000',
      output_to_revealed: unshield,
      proof_from_badge_resource: null,
      dry_run: true
    });
    return publicResult({
      error: 'The wallet daemon returned from a dry run. Nothing was submitted.'
    });
  } catch (err) {
    return publicResult({ error: calm(err && err.message) });
  }
}

async function layerMove({ address, direction, amount, body, client } = {}) {
  refuseKeyMaterial(body);
  assertAddress(address);
  parseAmount(amount);
  const w = client || liveWalletd();
  if (direction === 'to_minotari') {
    try {
      await w.rpc('accounts.burn', {
        account: { Name: LOOKUP_ACCOUNT },
        amount: '1',
        dry_run: true
      });
      return publicResult({
        error: 'The wallet daemon returned from a burn call. Nothing was submitted.'
      });
    } catch (err) {
      return publicResult({ error: calm(err && err.message) });
    }
  }
  if (direction === 'to_ootle') {
    try {
      await w.rpc('accounts.claim_burn', {
        account: { Name: LOOKUP_ACCOUNT },
        claim_proof: { FromFile: { file_name: 'browser-proof.json' } },
        max_fee: '1000',
        is_dry_run: true
      });
      return publicResult({
        error: 'The wallet daemon returned from a claim. Nothing was submitted.'
      });
    } catch (err) {
      return publicResult({ error: calm(err && err.message) });
    }
  }
  const err = new Error('Choose Minotari or tTARI');
  err.code = 'bad_amount';
  throw err;
}

module.exports = {
  refuseKeyMaterial,
  readBrowserBalances,
  fireShieldLeg,
  fireUnshieldLeg,
  retryPendingLegs,
  escrowCapacityTari,
  confidentialMove,
  layerMove,
  LOOKUP_ACCOUNT
};

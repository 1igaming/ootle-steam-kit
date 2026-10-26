// Browser-only Ootle account. The storage key names which record belongs to
// this Steam id. The secret is never sent to the site.
//
// v2 records (legacy): plaintext { secretKey, viewKey, address }. Created
//   silently before the setup flow existed. Still readable so Show keys keeps
//   working, but they have no recovery phrase.
// v3 records: { address (public), kdf, cipher }. cipher is AES-GCM over
//   { secretKey, viewKey, mnemonic } with a key derived from the 7-digit PIN,
//   so nothing readable leaves the setup flow. The address stays outside the
//   cipher so balance reads do not need the PIN.

const PREFIX = 'tari.dapp.wallet.v1:';
const PIN_LENGTH = 7;
const KDF_ITERATIONS = 250000;
const VIEW_TAG = new TextEncoder().encode('tari-dapp-view-key:v1:');

const pending = new Map();
const unlocked = new Map();
const listeners = new Set();

/** Notify mounted components that a wallet was created, unlocked, locked, or forgotten. */
function notifyWalletChanged() {
  listeners.forEach((cb) => {
    try { cb(); } catch (_) { /* listener errors must not break the wallet */ }
  });
}

/**
 * Subscribe to wallet changes (create/restore/unlock/lock/forget).
 * Returns an unsubscribe function.
 */
export function subscribeLocalOotleWallet(callback) {
  if (typeof callback !== 'function') return () => {};
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Ask the browser to mark this origin's storage as persistent right after
 * wallet creation. Without it the browser may
 * evict localStorage under disk pressure and take the sealed wallet with it.
 * Must run inside a user gesture; returns the granted state.
 */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      return await navigator.storage.persist();
    }
  } catch (_) { /* denial is survivable; the record stays in localStorage */ }
  return false;
}

/** 'persistent', 'best-effort', or 'unsupported'. */
export async function readStoragePersistence() {
  try {
    if (navigator.storage && typeof navigator.storage.persisted === 'function') {
      return (await navigator.storage.persisted()) ? 'persistent' : 'best-effort';
    }
  } catch (_) { /* older browsers */ }
  return 'unsupported';
}

function storageKeyFor(steamId) {
  const id = String(steamId || '').trim();
  if (!/^\d{5,20}$/.test(id)) return '';
  return PREFIX + id;
}

function readRecord(storageKey) {
  if (!storageKey) return null;
  try {
    const record = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (!record || typeof record !== 'object') return null;
    return record;
  } catch (_) {
    return null;
  }
}

function isLegacy(record) {
  return Boolean(record) && typeof record.secretKey === 'string' && /^[0-9a-f]{64}$/.test(record.secretKey);
}

function isSealed(record) {
  return Boolean(
    record
    && record.version === 3
    && typeof record.address === 'string'
    && record.address.startsWith('otl_esm_')
    && record.kdf && typeof record.kdf.salt === 'string'
    && record.cipher && typeof record.cipher.iv === 'string' && typeof record.cipher.data === 'string'
  );
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const clean = String(hex || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function sha256(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(buf);
}

/** Ristretto255 group order; Tari scalars are little-endian and must be < L. */
const CURVE_L = 7237005577332262213973186563042994240857116359379907606001950938285454250989n;

function reduceScalar(bytes) {
  let value = 0n;
  for (let i = 31; i >= 0; i -= 1) value = (value << 8n) | BigInt(bytes[i]);
  const reduced = value % CURVE_L;
  const out = new Uint8Array(32);
  let v = reduced;
  for (let i = 0; i < 32; i += 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** The view secret is derived from the owner secret so the 24 words alone restore the wallet. */
async function deriveViewSecret(ownerBytes) {
  const input = new Uint8Array(VIEW_TAG.length + ownerBytes.length);
  input.set(VIEW_TAG, 0);
  input.set(ownerBytes, VIEW_TAG.length);
  return reduceScalar(await sha256(input));
}

async function importWalletModule() {
  return import(/* webpackIgnore: true */ '/ootle/wallet-keys.js');
}

let preloadJob = null;

/**
 * Start downloading and compiling the key WASM when the wallet UI first
 * renders, so the create step never waits on a cold 1.7 MB module. The
 * browser caches it; a failed preload is ignored and the create flow
 * reports its own error.
 */
export function preloadOotleWalletModule() {
  if (!preloadJob) {
    preloadJob = importWalletModule().catch(() => null);
  }
  return preloadJob;
}

async function pinToAesKey(pin, saltBytes) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function sealSecrets(pin, secrets) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await pinToAesKey(pin, salt);
  const plain = new TextEncoder().encode(JSON.stringify(secrets));
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return {
    kdf: { name: 'PBKDF2-SHA-256', iterations: KDF_ITERATIONS, salt: toHex(salt) },
    cipher: { iv: toHex(iv), data: toHex(new Uint8Array(buf)) }
  };
}

async function openSealed(pin, record) {
  const key = await pinToAesKey(pin, fromHex(record.kdf.salt));
  const buf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromHex(record.cipher.iv) },
    key,
    fromHex(record.cipher.data)
  );
  const secrets = JSON.parse(new TextDecoder().decode(buf));
  if (!secrets || typeof secrets.secretKey !== 'string' || !/^[0-9a-f]{64}$/.test(secrets.secretKey)) {
    throw new Error('bad_record');
  }
  return secrets;
}

/** Fresh wallet: 24-word seed -> owner secret -> derived view secret -> address. */
async function buildSeedWallet() {
  const { entropyToMnemonic } = await import('./bip39');
  const entropy = crypto.getRandomValues(new Uint8Array(32));
  const mnemonic = await entropyToMnemonic(entropy);
  const ownerBytes = reduceScalar(entropy);
  const viewBytes = await deriveViewSecret(ownerBytes);
  const mod = await importWalletModule();
  if (typeof mod.createEsmeraldaAccountFromSecrets !== 'function') {
    throw new Error('The browser wallet could not be created.');
  }
  const account = mod.createEsmeraldaAccountFromSecrets(toHex(ownerBytes), toHex(viewBytes));
  if (!account || !String(account.address || '').startsWith('otl_esm_')) {
    throw new Error('The browser wallet could not be created.');
  }
  return {
    secretKey: account.ownerSecret,
    viewKey: account.viewSecret,
    address: account.address,
    mnemonic
  };
}

/** Restore: 24 words -> owner secret -> same view secret + address as the original device. */
async function walletFromMnemonic(words) {
  const { mnemonicToEntropy } = await import('./bip39');
  const ownerBytes = reduceScalar(await mnemonicToEntropy(words));
  const viewBytes = await deriveViewSecret(ownerBytes);
  const mod = await importWalletModule();
  if (typeof mod.createEsmeraldaAccountFromSecrets !== 'function') {
    throw new Error('The wallet could not be restored on this device.');
  }
  const account = mod.createEsmeraldaAccountFromSecrets(toHex(ownerBytes), toHex(viewBytes));
  return {
    secretKey: account.ownerSecret,
    viewKey: account.viewSecret,
    address: account.address,
    mnemonic: Array.isArray(words) ? words : String(words || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  };
}

/**
 * Wallet state for the UI. 'none' -> offer the setup flow, 'legacy' -> a
 * wallet from before the setup flow (plaintext, no seed), 'locked' -> ask for
 * the PIN, 'unlocked' -> keys are readable in this tab.
 */
export function readWalletState(steamId) {
  const storageKey = storageKeyFor(steamId);
  if (!storageKey) return { status: 'none', storageKey, address: '' };
  const record = readRecord(storageKey);
  if (isSealed(record)) {
    const cached = unlocked.get(storageKey);
    if (cached) {
      return { status: 'unlocked', storageKey, address: record.address, createdAt: record.createdAt || '' };
    }
    return { status: 'locked', storageKey, address: record.address, createdAt: record.createdAt || '' };
  }
  if (isLegacy(record)) {
    return { status: 'legacy', storageKey, address: record.address || '', createdAt: record.createdAt || '' };
  }
  return { status: 'none', storageKey, address: '' };
}

/** Create a new wallet behind the setup flow. Stores the sealed record, returns the seed words once. */
export async function createLocalOotleWallet(steamId, pin) {
  const storageKey = storageKeyFor(steamId);
  if (!storageKey) throw new Error('Sign in through Steam first.');
  const pinText = String(pin || '');
  if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pinText)) throw new Error(`The PIN is ${PIN_LENGTH} digits.`);
  const existing = readRecord(storageKey);
  if (isSealed(existing) || isLegacy(existing)) throw new Error('This browser already has a wallet.');
  const secrets = await buildSeedWallet();
  const sealedPart = await sealSecrets(pinText, {
    secretKey: secrets.secretKey,
    viewKey: secrets.viewKey,
    mnemonic: secrets.mnemonic
  });
  const record = { version: 3, createdAt: new Date().toISOString(), address: secrets.address, ...sealedPart };
  localStorage.setItem(storageKey, JSON.stringify(record));
  unlocked.set(storageKey, { secretKey: secrets.secretKey, viewKey: secrets.viewKey, mnemonic: secrets.mnemonic });
  notifyWalletChanged();
  requestPersistentStorage();
  return { address: secrets.address, mnemonic: secrets.mnemonic };
}

/** Restore from the 24-word phrase. Same PIN sealing as a new wallet. */
export async function restoreLocalOotleWallet(steamId, pin, words) {
  const storageKey = storageKeyFor(steamId);
  if (!storageKey) throw new Error('Sign in through Steam first.');
  const pinText = String(pin || '');
  if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pinText)) throw new Error(`The PIN is ${PIN_LENGTH} digits.`);
  const existing = readRecord(storageKey);
  if (isSealed(existing) || isLegacy(existing)) throw new Error('This browser already has a wallet.');
  const secrets = await walletFromMnemonic(words);
  const sealedPart = await sealSecrets(pinText, {
    secretKey: secrets.secretKey,
    viewKey: secrets.viewKey,
    mnemonic: secrets.mnemonic
  });
  const record = { version: 3, createdAt: new Date().toISOString(), address: secrets.address, ...sealedPart };
  localStorage.setItem(storageKey, JSON.stringify(record));
  unlocked.set(storageKey, { secretKey: secrets.secretKey, viewKey: secrets.viewKey, mnemonic: secrets.mnemonic });
  notifyWalletChanged();
  requestPersistentStorage();
  return { address: secrets.address };
}

export async function unlockLocalOotleWallet(steamId, pin) {
  const storageKey = storageKeyFor(steamId);
  const record = readRecord(storageKey);
  if (!isSealed(record)) throw new Error('This browser has no wallet with a PIN.');
  let secrets;
  try {
    secrets = await openSealed(String(pin || ''), record);
  } catch (_) {
    throw new Error('That PIN did not unlock the wallet.');
  }
  unlocked.set(storageKey, secrets);
  notifyWalletChanged();
  return { address: record.address };
}

export function lockLocalOotleWallet(steamId) {
  unlocked.delete(storageKeyFor(steamId));
  notifyWalletChanged();
}

export function forgetLocalOotleWallet(steamId) {
  const storageKey = storageKeyFor(steamId);
  if (storageKey) localStorage.removeItem(storageKey);
  unlocked.delete(storageKey);
  notifyWalletChanged();
}

/** Sealed-record keys for Show keys. Only while unlocked in this tab. */
export function readUnlockedOotleSecret(steamId) {
  const storageKey = storageKeyFor(steamId);
  const cached = unlocked.get(storageKey);
  return cached
    ? { secretKey: cached.secretKey, viewKey: cached.viewKey || '', mnemonic: cached.mnemonic || null, address: (readRecord(storageKey) || {}).address || '' }
    : null;
}

/** Legacy v2 plaintext record, or null. Kept so old wallets keep working. */
export function readLocalOotleSecret(steamId) {
  const storageKey = storageKeyFor(steamId);
  const record = readRecord(storageKey);
  if (!isLegacy(record)) return null;
  return {
    storageKey,
    secretKey: record.secretKey,
    viewKey: typeof record.viewKey === 'string' ? record.viewKey : '',
    address: typeof record.address === 'string' ? record.address : '',
    createdAt: record.createdAt || ''
  };
}

export function readLocalOotleAddress(steamId) {
  return readWalletState(steamId).address;
}

/** Legacy auto-create kept for callers that still expect it; the setup flow never uses it. */
export function ensureLocalOotleWallet(steamId) {
  const storageKey = storageKeyFor(steamId);
  if (!storageKey) return Promise.resolve({ ok: false, storageKey: '' });
  const state = readWalletState(steamId);
  if (state.status !== 'none') return Promise.resolve({ ok: true, storageKey, created: false, address: state.address });
  if (pending.has(storageKey)) return pending.get(storageKey);
  const job = (async () => {
    const mod = await importWalletModule();
    const created = mod.createEsmeraldaAccount();
    if (!created || !/^[0-9a-f]{64}$/.test(created.ownerSecret || '')) {
      throw new Error('The browser wallet could not be created');
    }
    const record = {
      version: 2,
      createdAt: new Date().toISOString(),
      secretKey: created.ownerSecret,
      viewKey: created.viewSecret,
      address: created.address
    };
    localStorage.setItem(storageKey, JSON.stringify(record));
    return { ok: true, storageKey, created: true, address: record.address };
  })().finally(() => pending.delete(storageKey));
  pending.set(storageKey, job);
  return job;
}

export const PIN_DIGITS = PIN_LENGTH;

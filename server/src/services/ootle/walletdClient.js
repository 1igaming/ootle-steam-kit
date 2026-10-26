const fs = require('fs');

class WalletdError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'WalletdError';
    this.code = code;
  }
}

function readTokenFile(file) {
  if (!file) throw new WalletdError('walletd token file is not configured');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (_) {
    throw new WalletdError('walletd token file is unreadable');
  }
  const token = String(raw).trim();
  if (!token) throw new WalletdError('walletd token file is empty');
  return token;
}

function rpcUrl(base) {
  const raw = String(base || '').trim();
  if (!raw) throw new WalletdError('walletd url is not configured');
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const url = new URL(withScheme);
  if (!url.pathname || url.pathname === '/') url.pathname = '/json_rpc';
  return url.toString();
}

/**
 * JSON-RPC client for tari_ootle_walletd 0.43. Covers the calls the DApp
 * needs: settings, accounts, transaction submit. The bearer token is never put on
 * the returned object or included in errors.
 */
function createWalletdClient({ url, token, fetchImpl } = {}) {
  const endpoint = rpcUrl(url || process.env.OOTLE_WALLETD_URL || 'http://127.0.0.1:5100/json_rpc');
  const fetchFn = fetchImpl || fetch;
  let seq = 0;
  const bearer = token;

  async function rpc(method, params) {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: ++seq,
      method,
      params: params == null ? {} : params
    });
    let res;
    try {
      res = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {})
        },
        body
      });
    } catch (err) {
      throw new WalletdError(`${method}: walletd unreachable`);
    }
    let json;
    try {
      json = await res.json();
    } catch (_) {
      throw new WalletdError(`${method}: walletd returned a non-JSON response`, res.status);
    }
    if (json.error) {
      throw new WalletdError(`${method}: ${json.error.message || 'rpc error'}`, json.error.code);
    }
    return json.result;
  }

  return {
    rpc,
    settings() {
      return rpc('settings.get', {});
    },
    getAccount(name) {
      return rpc('accounts.get', { name_or_address: { Name: name } });
    },
    createOrGetAccount(name) {
      return rpc('accounts.create_or_get', {
        account: { Name: name },
        is_default: false,
        key_index: null
      });
    },
    listKeys(branch) {
      return rpc('keys.list', { branch });
    },
    getBalanceChanges(accountName, offset, limit) {
      return rpc('accounts.get_balance_changes', {
        account: { Name: accountName },
        offset,
        limit,
        resource_address: null,
        transaction_id: null,
        source_type: null
      });
    },
    getTransactionResult(transactionId) {
      return rpc('transactions.get_result', { transaction_id: transactionId });
    },
    stealthTransfer(params) {
      return rpc('accounts.stealth_transfer', params);
    },
    templateGet(templateAddress) {
      return rpc('templates.get', { template_address: templateAddress });
    }
  };
}

function liveWalletd(overrides = {}) {
  const token = overrides.token || readTokenFile(overrides.tokenFile || process.env.OOTLE_WALLETD_TOKEN_FILE);
  return createWalletdClient({
    url: overrides.url || process.env.OOTLE_WALLETD_URL,
    token,
    fetchImpl: overrides.fetchImpl
  });
}

module.exports = {
  WalletdError,
  readTokenFile,
  rpcUrl,
  createWalletdClient,
  liveWalletd
};

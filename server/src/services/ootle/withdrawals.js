/**
 * Stealth transfer parameter builder for the Tari wallet daemon.
 * Pure function: no secrets, no site-specific behavior.
 */
const { TARI_RESOURCE } = require('./constants');

function stealthTransferParams({ accountName, address, amount, maxFee, dryRun = false, revealed = false }) {
  return {
    owner_account: { Name: accountName },
    fee_params: { input_selection: 'PreferConfidential', pay_fee_with_swap: null },
    input_selection: 'PreferConfidential',
    resource_address: TARI_RESOURCE,
    transfers: [{
      destination_address: address,
      blinded_output_amount: revealed ? '0' : amount.toString(),
      revealed_output_amount: revealed ? amount.toString() : '0',
      pay_to: 'StealthPublicKey',
      attach_sender_address: false
    }],
    max_fee: maxFee.toString(),
    dry_run: Boolean(dryRun)
  };
}

module.exports = { stealthTransferParams };

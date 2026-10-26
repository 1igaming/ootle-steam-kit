# Ootle Steam Kit — Steam Login + In-Browser Tari (Ootle L2) Wallet, Privacy Shielding & P2P Escrow

An open-source template for game-item marketplaces and community sites that
authenticate with **Steam** and give every user a **Tari wallet that lives
entirely in the browser** — L1 (Minotari/XTM) awareness and L2 (Ootle/TARI)
operations included.

Built for the Tari "Spooky Secrets" October submission. New repo, new code:
the wallet, games, and market logic here are self-contained and carry no
dependencies on any specific storefront.

## What's inside

- **Browser wallet & privacy** (`client/src/`): key generation via Tari WASM,
  a 24-word BIP39 recovery phrase, a 7-digit PIN that encrypts the sealed
  record in `localStorage`, provably fair restore, step-up PIN prompts for
  sensitive actions, and two privacy instruments:
  - **Stealth tTARI**: blinded output commitments concealing account balances on chain.
  - **Private vouchers**: bearer tokens in 1, 10, 100, and 1,000 tTARI denominations.
  - **Shielded balance UX**: eye/lock toggle hiding sensitive balances.
- **P2P Escrow Market** (`client/src/components/sealed/EscrowDemoView.js` & `server/src/services/ootle/escrowDemo.js`):
  two-sided game item marketplace where buyers lock tTARI into Tari smart escrow
  and sellers deliver items via Steam trade offers matched by cryptographic claim codes.
- **Server** (`server/`): Express + Steam OpenID (host-aware return URLs),
  Socket.io crash arena with live chat, realtime ledger bus (`ootleLedger`),
  JSON-file ledgers for games and the unified balance, a testnet faucet,
  admin-managed prediction markets, and a Tari wallet-daemon client (JSON-RPC) for on-chain sends.
- **Games**: multiplayer crash arena (bustabit-style curve, provably fair
  per-round seeds, synchronous cashout locking), sandbox crater dig with cosmetic drops,
  and a mines-style dig grid with round resumption.
- **Prediction markets**: parimutuel tTARI stakes, live countdowns, pot pools, and
  resolution payouts over the wallet daemon.

## Quick start

```bash
# 1. Server
cd server && npm install
cp ../.env.example .env  # fill in STEAM_API_KEY, SESSION_SECRET
npm start                # listens on :3013

# 2. Client
cd ../client && npm install
npm start                # proxies to :3013, or set proxy in package.json
```

### Steam login

Sign-in uses Steam OpenID, which needs a Web API key of your own: grab one
at <https://steamcommunity.com/dev/apikey> (any domain works for local
testing) and put it in `server/.env` as `STEAM_API_KEY`. Without a key the
app still runs — browsing, the wallet, and games-vs-the-ledger all work —
but the sign-in button will tell you login isn't configured. Set
`ADMIN_STEAM_ID` to your own 64-bit SteamID to unlock the admin routes.

### Trade view

The Trade tab loads the signed-in player's Steam inventory for whichever
game you point it at — set `STEAM_INVENTORY_APP_ID` in `server/.env`
(CS2 is 730, TF2 440, Dota 2 570; `STEAM_INVENTORY_CONTEXT_ID` defaults
to 2, the tradable inventory for most games). Players need their Steam
inventory visibility set to Public for Steam to serve it. Item catalog
overlays — prices, rarity tags, market state — are stubbed in
`client/src/utils/` for you to wire to your own data source.

Point `OOTLE_WALLETD_URL` at a Tari wallet daemon (`tari_ootle_walletd
--network esmeralda`) to enable on-chain sends. Without a daemon, the DApp
runs in ledger mode: every feature works, transfers are recorded and clearly
labeled.

## Security model

- Wallet keys are generated in the browser (WASM) and never leave it. No
  server route accepts or returns key material — enforced in
  `localWalletOps.js` (`refuseKeyMaterial`).
- The PIN encrypts the sealed wallet record (PBKDF2-SHA256 → AES-GCM).
- Admin actions are gated by `ADMIN_STEAM_IDS` only.
- All game outcomes are provably fair: seed hashes commit before play, seeds
  reveal at settlement.

## License

MIT

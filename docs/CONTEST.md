# Tari October submission notes

**Track**: "Spooky Secrets" (privacy demo) — new repo, new code.

## What this project demonstrates

1. **A self-custodial Tari wallet in the browser.** Keys are generated with
   the Tari WASM crypto library inside the user's browser, sealed with a
   PIN-derived AES-GCM key, and restorable from a 24-word phrase. The server
   never sees key material and structurally refuses it.
2. **Two operable privacy instruments (Spooky Secrets Track):**
   - **Stealth tTARI**: blinded output commitments where account amounts are hidden on chain.
   - **Private Bearer Vouchers**: fixed-denomination (1, 10, 100, 1,000 tTARI) pool claims where both amount and owner remain hidden after deposit.
   - **Shielded Balance UX**: private balance tile with lock/eye reveal toggle.
3. **P2P Steam Item Escrow Marketplace:**
   - Sellers list inventory items at a chosen tTARI ask.
   - Buyers lock tTARI into Tari escrow, receiving a one-time claim code.
   - Seller delivers item via Steam trade offer containing the claim code.
   - Contract releases payment to the seller upon delivery confirmation or refunds at deadline.
4. **Steam-authenticated gaming with real Tari testnet economics:**
   - Multiplayer crash arena, provably fair per round (committed seed hash, seed revealed at settlement, synchronous cash-out state).
   - Multi-mine Dig game with live session round resumption.
   - Sandbox cosmetic item dig.
5. **Parimutuel Prediction Markets:**
   - Real-time countdowns, colored Yes/No odds, live participant pots, and community categories.
6. **Unified Real-time Balance:**
   - Socket.io ledger bridge (`ootleLedger`) syncing faucet claims, games, shields, and escrows instantly across all views.

## Reproduce

```bash
# terminal 1: Tari wallet daemon on esmeralda
tari_ootle_walletd --network esmeralda --listen-on 127.0.0.1:5100

# terminal 2 + 3: this repo
cd server && npm i && cp ../.env.example .env && npm start
cd client && npm i && npm start
```

Sign in with Steam → create the wallet → save the phrase → claim from the
faucet → play. Everything runs against the Esmeralda testnet.

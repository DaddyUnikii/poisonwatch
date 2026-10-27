# Changelog

## 0.1.0 — 2026-10-27

- First release: find address-poisoning attempts against a wallet on Ethereum, BNB Chain, Base, Arbitrum, Optimism and Polygon.
- History from Etherscan v2 (with key), Blockscout (keyless) or chunked `eth_getLogs` with automatic range shrinking; `--chain auto` scans every chain the wallet has used.
- Real counterparties come only from transactions the wallet signed, so spoofed transfers can never look trusted.
- Lookalike matching on leading/trailing hex characters (`--prefix` / `--suffix`, default 4 + 4) with a diff marker.
- Detects zero-value `transferFrom` spoofs, dust (`--dust`) and fake tokens (famous symbols on non-canonical contracts, homoglyphs like `ĖTḨ`).
- HIGH / MEDIUM / LOW scoring with reasons; terminal table, `--json`, `--markdown`; `--fail-on` for CI.
- `check <wallet> <recipient>` pre-send verdict: DANGER (exit 2) / CAUTION / KNOWN / NEW.
- Keyless RPC fallbacks that accept topic-only `eth_getLogs` (48 Club on BNB Chain, Tenderly gateways elsewhere), with chunk size following the cap an RPC names.
- "Check wallet" GitHub Actions workflow to run a scan or a pre-send check from a phone, with per-chain annotations.

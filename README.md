<div align="center">

# ☠️ poisonwatch

**Catch address-poisoning attacks before you copy the wrong address.**

[![CI](https://github.com/DaddyUnikii/poisonwatch/actions/workflows/ci.yml/badge.svg)](https://github.com/DaddyUnikii/poisonwatch/actions/workflows/ci.yml)
![node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)
![deps](https://img.shields.io/badge/dependencies-0-brightgreen)
![chains](https://img.shields.io/badge/chains-ETH%20·%20BSC%20·%20Base%20·%20Arb%20·%20OP%20·%20Polygon-blue)
![license](https://img.shields.io/badge/license-MIT-lightgrey)

</div>

Address poisoning is simple and it works: right after you pay someone, a bot creates an address with the
**same first and last characters** and plants it in your history with a zero-value `transferFrom`, a speck of dust
or a fake "USDT". Next time you copy the recipient from your history, you copy theirs. `poisonwatch` reads your
history, learns who you **really** send to, and flags every lookalike trying to blend in.

## Install

```bash
git clone https://github.com/DaddyUnikii/poisonwatch && cd poisonwatch
node bin/poisonwatch.js <your-address>          # no npm install, zero dependencies
npm link                                        # optional: get the `poisonwatch` command
```

## Usage

```bash
poisonwatch 0xYourWallet                        # auto: every chain the wallet has used
poisonwatch 0xYourWallet -c bsc,base            # pick chains (eth, bsc, base, arb, op, polygon, all)
poisonwatch 0xYourWallet --prefix 5 --suffix 5  # stricter lookalike matching (default 4 + 4)
poisonwatch 0xYourWallet --json                 # machine-readable
poisonwatch 0xYourWallet --fail-on high         # exit 2 if anything is HIGH (CI / cron)
ETHERSCAN_API_KEY=xxx poisonwatch 0xYourWallet  # full history on every chain
```

### Before you send: `check`

```bash
poisonwatch check 0xYourWallet 0xRecipient
```

| Verdict | Meaning | Exit |
|---|---|---|
| ⛔ `DANGER` | the recipient looks like an address you really sent to (or is a flagged poison address) | 2 |
| ⚠️ `CAUTION` | it only ever reached you through suspicious transfers | 0 |
| ✅ `KNOWN` | you sent to this exact address before and nothing imitates it | 0 |
| 🆕 `NEW` | never seen: not poison as far as history shows, check every character | 0 |

## Run it from your phone (GitHub Actions)

No laptop needed. Fork or use this repo → **Actions** → **Check wallet** → **Run workflow**. Paste your address, and
optionally the recipient you are about to pay. The verdict shows up in the run's **Summary** page, and the run turns red
on `DANGER`. Add an `ETHERSCAN_API_KEY` repo secret for full history on every chain.

## Safety

- **Read-only.** It never asks for a private key or seed phrase and never signs or sends anything.
- Without an API key, BNB Chain falls back to RPC and only sees the last `--days` of transfers.
- A clean result is not a guarantee. **Never copy a recipient from your transaction history**; use an address book.

## Development

```bash
npm test     # node:test with fixtures and fake fetch/RPC, no network needed
```

MIT © [Unikii](https://github.com/DaddyUnikii)

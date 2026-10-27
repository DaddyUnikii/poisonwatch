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

```text
# real output (vitalik.eth on Ethereum, trimmed)
poisonwatch · eth · 0xd8da…6045
source: blockscout (latest 1000) · 1000 token transfers · 17 addresses you really sent to · match 4+4 chars

RISK    SUSPECT ADDRESS                             EVENTS    SEEN
HIGH    0x6ff9c31e780b34c4690d4514c6e41608d70ba434       4     3mo
  real  0x6ff94bf88e94c6f73024d6336db8ac428025a434   ← you sent here 2×
              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ differs
        ↳ looks like 0x6ff9…a434, an address you sent to 2×, 4× fake token "sent" from your wallet
HIGH    0x6181f50feac3ca945d8ff660b39fe1e493b20313       3     3mo
  real  0x6181a4c5566051081b70d9348db673ee83ca0313   ← you sent here 4×
              ^^^^^^^^^^^^^^^^^^^^^^^^^^ ^^ ^^ differs
        ↳ looks like 0x6181…0313, an address you sent to 4×, 3× fake token "sent" from your wallet
LOW     0xd103d1d73b3b33422446ca40280594169fd65b2b       1     2mo
        ↳ 1× zero-value transferFrom spoof from your wallet
…
```

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

## How it works

1. **History** — incoming and outgoing ERC-20 `Transfer` events (zero-value, dust and fake tokens included) plus your
   own transactions. Best source first: Etherscan v2 (if `ETHERSCAN_API_KEY` is set) → Blockscout's keyless API →
   chunked `eth_getLogs` over the last `--days`, shrinking the block range when a public RPC complains.
2. **Who you really pay** — only sends inside transactions **you signed**. A `Transfer(you → x)` you never signed is a
   spoof, so it can never make a poison address look trusted.
3. **Lookalikes** — any other address sharing the first `--prefix` and last `--suffix` hex characters with a real
   counterparty. Fake tokens are caught by symbol (`USDT`, `USDC`, `WETH`, an ERC-20 called `ETH`, homoglyphs like `ĖTḨ`)
   on a contract that is not the canonical one.
4. **Score**:

| Signal | Points |
|---|---|
| Lookalike of an address you really sent to | +3 |
| Unusually close match (2+ extra matching characters) | +1 |
| You already sent funds to the lookalike | +3 |
| Zero-value `transferFrom` spoof from your wallet | +2 |
| Fake-token transfer (in, or "sent" from your wallet) | +2 |
| Zero-value or dust transfer to you (below `--dust`, default 0.01 tokens) | +1 |

`HIGH` ≥ 5 · `MEDIUM` 3–4 · `LOW` 2

## Safety

- **Read-only.** It never asks for a private key or seed phrase and never signs or sends anything.
- Without an API key, BNB Chain falls back to RPC and only sees the last `--days` of transfers.
- A clean result is not a guarantee. **Never copy a recipient from your transaction history**; use an address book.

## Development

```bash
npm test     # node:test with fixtures and fake fetch/RPC, no network needed
```

MIT © [Unikii](https://github.com/DaddyUnikii)

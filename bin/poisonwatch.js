#!/usr/bin/env node
import { resolveChain, CHAINS } from '../src/chains.js';
import { makeRpc } from '../src/rpc.js';
import { watch } from '../src/watch.js';
import { activeChains } from '../src/sources.js';
import { failsGate } from '../src/detect.js';
import { checkRecipient } from '../src/check.js';
import { diffMarker } from '../src/detect.js';
import { isAddress } from '../src/hex.js';
import { renderReport, toJSON, toMarkdown } from '../src/format.js';
import { readFileSync } from 'node:fs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `poisonwatch — catch address-poisoning attacks against your EVM wallet.

Usage
  poisonwatch <wallet> [options]               scan history for poison lookalike addresses
  poisonwatch check <wallet> <recipient>       before sending: is this recipient a lookalike?

Options
  -c, --chain <list>   chains, comma separated (default: auto = every chain the wallet has used)
                       ${Object.keys(CHAINS).join(', ')}, auto, or "all"
  -d, --days <n>       how far back to read when only RPC is available (default: 3)
  -n, --limit <n>      newest transfers to read from an explorer (default: 1000)
      --prefix <n>     leading hex chars that must match to count as a lookalike (default: 4)
      --suffix <n>     trailing hex chars that must match (default: 4)
      --dust <amount>  transfers below this many tokens count as dust (default: 0.01)
      --rpc <url>      use your own RPC (single chain only)
      --fail-on <lvl>  exit 2 if any finding is at/above high|medium|low (for CI)
      --json           machine-readable output
      --markdown       markdown table (great for GitHub job summaries)
  -v, --version        print the version
  -h, --help           show this help

Exit codes: 0 ok · 1 error · 2 --fail-on tripped, or check says DANGER.
Read-only: poisonwatch never asks for a key and never signs anything.
Set ETHERSCAN_API_KEY for full history on every chain (free key, etherscan.io).`;

function parse(argv) {
  const o = { chain: 'auto', days: 3, limit: 1000, prefix: 4, suffix: 4, dust: 0.01 };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a === '-c' || a === '--chain') o.chain = next();
    else if (a === '-d' || a === '--days') o.days = Number(next());
    else if (a === '-n' || a === '--limit') o.limit = Number(next());
    else if (a === '--prefix') o.prefix = Number(next());
    else if (a === '--suffix') o.suffix = Number(next());
    else if (a === '--dust') o.dust = Number(next());
    else if (a === '--rpc') o.rpc = next();
    else if (a === '--fail-on') o.failOn = next().toUpperCase();
    else if (a === '--json') o.json = true;
    else if (a === '--markdown' || a === '--md') o.md = true;
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else pos.push(a);
  }
  if (pos[0] === 'check') { o.cmd = 'check'; o.address = pos[1]; o.recipient = pos[2]; }
  else { o.cmd = 'scan'; o.address = pos[0]; }
  return o;
}

const die = (msg) => { console.error(msg); process.exit(1); };

async function pickChains(o, wallet) {
  if (o.chain === 'all') return Object.keys(CHAINS).map(resolveChain);
  if (o.chain === 'auto') {
    const all = Object.keys(CHAINS).map(resolveChain);
    const used = await activeChains({ chains: all, wallet, makeRpc });
    if (!o.json && !o.md) console.error(`auto: ${used.length ? used.map((c) => c.key).join(', ') : 'no activity found, scanning eth'}`);
    return used.length ? used : [resolveChain('eth')];
  }
  return o.chain.split(',').map((k) => resolveChain(k.trim()));
}

async function runChain(o, chain, wallet) {
  const rpc = makeRpc(o.rpc ? [o.rpc] : chain.rpc);
  const quiet = o.json || o.md || !process.stderr.isTTY;
  const r = await watch({ chain, wallet, rpc, days: o.days, limit: o.limit, apiKey: process.env.ETHERSCAN_API_KEY,
    prefix: o.prefix, suffix: o.suffix, dust: o.dust,
    onProgress: quiet ? undefined : (p) => process.stderr.write(`\r  reading ${chain.key} ${Math.round(p * 100)}%`) });
  if (!quiet) process.stderr.write('\r\x1b[K');
  return r;
}

function renderCheck(res, chain) {
  const mark = { DANGER: '⛔ DANGER', CAUTION: '⚠️  CAUTION', KNOWN: '✅ KNOWN', NEW: '🆕 NEW' }[res.verdict];
  const lines = [`${mark} · ${chain} · ${res.recipient}`];
  for (const t of res.lookalikeOf || []) {
    lines.push(`   real   ${t.address}   ← you sent here ${t.sends}×`);
    lines.push(`          ${diffMarker(res.recipient, t.address)} differs`);
  }
  for (const r of res.reasons) lines.push(`   ↳ ${r}`);
  return lines.join('\n');
}

async function main() {
  let o;
  try { o = parse(process.argv.slice(2)); } catch (e) { die(e.message); }
  if (o.version) { console.log(VERSION); process.exit(0); }
  if (o.help || !o.address) { console.log(HELP); process.exit(o.help ? 0 : 1); }
  if (!isAddress(o.address)) die('not an EVM address: ' + o.address);
  if (o.cmd === 'check' && !isAddress(o.recipient || '')) die('check needs a recipient address: poisonwatch check <wallet> <recipient>');
  if (!(o.days > 0) || !(o.limit > 0)) die('--days and --limit must be positive numbers');
  if (!(o.prefix >= 1 && o.prefix <= 20 && o.suffix >= 1 && o.suffix <= 20)) die('--prefix and --suffix must be between 1 and 20');
  if (o.failOn && !['HIGH', 'MEDIUM', 'LOW'].includes(o.failOn)) die('--fail-on must be high, medium or low');
  const wallet = o.address.toLowerCase();
  let chains;
  try { chains = await pickChains(o, wallet); } catch (e) { die(e.message); }
  if (o.rpc && chains.length > 1) die('--rpc works with a single chain');

  const reports = [];
  let tripped = false;
  for (const chain of chains) {
    try {
      const r = await runChain(o, chain, wallet);
      if (o.cmd === 'check') {
        const res = checkRecipient({ analysis: r, recipient: o.recipient, prefix: o.prefix, suffix: o.suffix });
        reports.push({ chain: chain.key, source: r.source, ...res });
        if (res.verdict === 'DANGER') tripped = true;
        if (o.md) console.log(`### ${chain.key}\n\n\`\`\`\n${renderCheck(res, chain.key)}\n\`\`\`\n`);
        if (o.md) console.error(`${chain.key}: ${res.verdict} for ${res.recipient} (source: ${r.source})`);
        else if (!o.json) console.log(renderCheck(res, chain.key) + '\n');
      } else {
        reports.push(r);
        if (failsGate(r.findings, o.failOn)) tripped = true;
        if (o.md) console.log(toMarkdown(r) + '\n');
        if (o.md) console.error(`${chain.key}: ${r.counts.HIGH} high · ${r.counts.MEDIUM} medium · ${r.counts.LOW} low (source: ${r.source}, ${r.transfersRead} transfers)`);
        else if (!o.json) console.log(renderReport(r) + '\n');
      }
    } catch (e) {
      reports.push({ chain: chain.key, error: e.message });
      if (!o.json) console.error(`${chain.key}: failed (${e.message}). Try --rpc <your url> or a smaller --days.\n`);
    }
  }
  if (o.json) console.log(toJSON(reports.length === 1 ? reports[0] : reports));
  if (!reports.length || reports.every((r) => r.error)) process.exit(1);
  if (tripped) process.exit(2);
}

main();

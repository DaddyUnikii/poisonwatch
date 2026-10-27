import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sharedEnds, isLookalike, diffMarker, isFakeToken, isDust, normSymbol, realCounterparties, classify, analyze, levelFor, failsGate, worstLevel } from '../src/detect.js';
import { resolveChain } from '../src/chains.js';
import { normalizeTokenTx, normalizeTx, explorerHistory, rpcHistory, nextStep, TOPIC_TRANSFER } from '../src/sources.js';
import { renderReport, toJSON, toMarkdown, age } from '../src/format.js';
import { formatUnits, isAddress, decodeString, pad32 } from '../src/hex.js';

const BSC = resolveChain('bsc');
const load = (name) => {
  const f = JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
  f.transfers = f.transfers.map((t) => ({ ...t, value: BigInt(t.value) }));
  if (f.txs) f.txs = f.txs.map((t) => ({ ...t, value: BigInt(t.value) }));
  return f;
};
const FX = load('poisoned-wallet.json');
const FRIEND = '0x6ff94bf88e94c6f73024d6336db8ac428025a434';
const ZERO_POISON = '0x6ff9e6e3e3e3d1839447575eeda9f0db114ba434';
const FAKE_POISON = '0x6ff9c31e780b34c4690d4514c6e41608d70ba434';
const EXCHANGE = '0x28c6c06298d514db089934071355e5743bf21d60';
const DUST_POISON = '0x28c6a1b2c3d4e5f60718293a4b5c6d7e8f901d60';
const SPAMMER = '0x1234567890abcdef1234567890abcdef12345678';

test('sharedEnds counts matching leading and trailing hex chars', () => {
  assert.deepEqual(sharedEnds(FRIEND, ZERO_POISON), { prefix: 4, suffix: 4 });
  assert.deepEqual(sharedEnds('0xAAAA000000000000000000000000000000001234', '0xaaaa111111111111111111111111111111111234'), { prefix: 4, suffix: 4 });
  const same = sharedEnds(FRIEND, FRIEND);
  assert.equal(same.prefix + same.suffix, 40); // never double-counts
});

test('isLookalike respects prefix/suffix and ignores identical or unrelated addresses', () => {
  assert.equal(isLookalike(ZERO_POISON, FRIEND), true);
  assert.equal(isLookalike(FRIEND, FRIEND.toUpperCase().replace('0X', '0x')), false); // same address, different case
  assert.equal(isLookalike(SPAMMER, FRIEND), false);
  assert.equal(isLookalike(ZERO_POISON, FRIEND, { prefix: 5, suffix: 4 }), false);
  assert.equal(isLookalike(ZERO_POISON, FRIEND, { prefix: 3, suffix: 3 }), true);
});

test('diffMarker points at the characters that differ', () => {
  const m = diffMarker('0x1234aaaa', '0x1234bbba');
  assert.equal(m, '      ^^^');
});

test('normSymbol folds homoglyph symbols', () => {
  assert.equal(normSymbol('ĖTḨ'), 'ETH');
  assert.equal(normSymbol('ŪSDT'), 'USDT');
  assert.equal(normSymbol(' usdt.e '), 'USDTE');
});

test('isFakeToken flags famous symbols on the wrong contract, incl. ERC-20s named after the native coin', () => {
  const real = { token: '0x55d398326f99059ff775485246999027b3197955', symbol: 'USDT' };
  assert.equal(isFakeToken(real, BSC), false);
  assert.equal(isFakeToken({ token: '0xfa4e000000000000000000000000000000000bad', symbol: 'USDT' }, BSC), true);
  assert.equal(isFakeToken({ token: '0xfa4e000000000000000000000000000000000bad', symbol: 'ŪSDT' }, BSC), true);
  assert.equal(isFakeToken({ token: '0xfa4e000000000000000000000000000000000bad', symbol: 'CAKE' }, BSC), false);
  const eth = resolveChain('eth');
  assert.equal(isFakeToken({ token: '0xfa4e000000000000000000000000000000000bad', symbol: 'ĖTḨ' }, eth), true);
  assert.equal(isFakeToken({ token: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', symbol: 'WETH' }, eth), false);
  assert.equal(isFakeToken({ token: '0x2170ed0880ac9a755fd29b2688956bd959f933f8', symbol: 'ETH' }, BSC), false); // Binance-Peg ETH is real
});

test('isDust uses whole-token threshold and never treats zero as dust', () => {
  assert.equal(isDust({ value: 10n ** 12n, decimals: 18 }), true);
  assert.equal(isDust({ value: 10n ** 16n, decimals: 18 }), false); // exactly 0.01 is not below
  assert.equal(isDust({ value: 0n, decimals: 18 }), false);
  assert.equal(isDust({ value: 5000n, decimals: 6 }, 0.01), true); // 0.005 USDC
  assert.equal(isDust({ value: 5n, decimals: null }), false);
});

test('realCounterparties keeps signed sends only', () => {
  const real = realCounterparties({ wallet: FX.wallet, transfers: FX.transfers, txs: FX.txs, chain: BSC });
  assert.deepEqual([...real.keys()].sort(), [EXCHANGE, FRIEND].sort());
  assert.equal(real.get(FRIEND).sends, 2);
  assert.equal(real.get(EXCHANGE).sends, 1);
});

test('realCounterparties without a tx list trusts txFrom (RPC mode)', () => {
  const transfers = FX.transfers.map((t) => (t.from === FX.wallet ? { ...t, txFrom: t.hash.startsWith('0xa') ? FX.wallet : '0x00000000000000000000000000000000deadbeef' } : t));
  const real = realCounterparties({ wallet: FX.wallet, transfers, txs: null, chain: BSC });
  assert.deepEqual([...real.keys()], [FRIEND]);
});

test('classify recognises each poisoning trick', () => {
  const signed = new Set(['0xa1', '0xa2', '0xa3']);
  const by = (h) => classify(FX.transfers.find((t) => t.hash === h), { wallet: FX.wallet, signed, chain: BSC });
  assert.equal(by('0xa1'), null);
  assert.deepEqual(by('0xb1'), { counterparty: ZERO_POISON, kind: 'zero-spoof' });
  assert.deepEqual(by('0xb2'), { counterparty: FAKE_POISON, kind: 'fake-spoof' });
  assert.deepEqual(by('0xb3'), { counterparty: DUST_POISON, kind: 'dust' });
  assert.deepEqual(by('0xb4'), { counterparty: SPAMMER, kind: 'fake' });
  assert.equal(by('0xc1'), null);
});

test('analyze ranks poison addresses', () => {
  const a = analyze({ wallet: FX.wallet, transfers: FX.transfers, txs: FX.txs, chain: BSC });
  const by = Object.fromEntries(a.findings.map((f) => [f.address, f]));
  assert.equal(by[ZERO_POISON].level, 'HIGH');
  assert.equal(by[ZERO_POISON].lookalikeOf, FRIEND);
  assert.equal(by[ZERO_POISON].realSends, 2);
  assert.equal(by[FAKE_POISON].level, 'HIGH');
  assert.equal(by[DUST_POISON].level, 'MEDIUM');
  assert.equal(by[DUST_POISON].lookalikeOf, EXCHANGE);
  assert.equal(by[SPAMMER].level, 'LOW');
  assert.equal(by[SPAMMER].lookalikeOf, null);
  assert.equal(by[FRIEND], undefined);
  assert.equal(by['0xabcabcabcabcabcabcabcabcabcabcabcabcabca'], undefined);
  assert.deepEqual(a.counts, { HIGH: 2, MEDIUM: 1, LOW: 1 });
  assert.equal(a.findings[a.findings.length - 1].address, SPAMMER); // sorted by score
});

test('analyze flags a lookalike you already sent real funds to', () => {
  const tx = { hash: '0xd1', from: FX.wallet, to: BSC.tokens.USDT[0], value: 0n, time: 1761000000 };
  const t = { hash: '0xd1', time: 1761000000, token: BSC.tokens.USDT[0], symbol: 'USDT', decimals: 18, from: FX.wallet, to: ZERO_POISON, value: 80n * 10n ** 18n };
  const a = analyze({ wallet: FX.wallet, transfers: [...FX.transfers, t], txs: [...FX.txs, tx], chain: BSC });
  const f = a.findings.find((x) => x.address === ZERO_POISON);
  assert.equal(f.level, 'HIGH');
  assert.equal(f.sentTo, 1);
  assert.match(f.reasons.join(' '), /already sent funds/);
  assert.equal(a.findings.find((x) => x.address === FRIEND), undefined); // the older, real one is not blamed
});

test('stricter matching drops weaker lookalikes', () => {
  const a = analyze({ wallet: FX.wallet, transfers: FX.transfers, txs: FX.txs, chain: BSC, prefix: 6, suffix: 6 });
  assert.equal(a.findings.filter((f) => f.lookalikeOf).length, 0);
});

test('levels, worst level and --fail-on gate', () => {
  assert.equal(levelFor(5), 'HIGH');
  assert.equal(levelFor(4), 'MEDIUM');
  assert.equal(levelFor(2), 'LOW');
  const fs = [{ level: 'MEDIUM' }, { level: 'LOW' }];
  assert.equal(worstLevel(fs), 'MEDIUM');
  assert.equal(worstLevel([]), null);
  assert.equal(failsGate(fs, 'high'), false);
  assert.equal(failsGate(fs, 'medium'), true);
  assert.equal(failsGate(fs, undefined), false);
  assert.throws(() => failsGate(fs, 'nope'));
});

test('explorer rows are normalized (fake fetch, no network)', async () => {
  const rows = {
    tokentx: [{ hash: '0xB1', blockNumber: '10', timeStamp: '1760500100', contractAddress: BSC.tokens.USDT[0], tokenSymbol: 'USDT', tokenDecimal: '18', from: FX.wallet, to: ZERO_POISON.toUpperCase().replace('0X', '0x'), value: '0' }],
    txlist: [{ hash: '0xA1', from: FX.wallet, to: BSC.tokens.USDT[0], value: '0', timeStamp: '1760000000', isError: '0' }],
  };
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    const action = new URL(url).searchParams.get('action');
    return { status: 200, text: async () => JSON.stringify({ status: '1', message: 'OK', result: rows[action] }) };
  };
  const h = await explorerHistory({ base: 'https://x.test/api', wallet: FX.wallet, limit: 50, fetchImpl, label: 'test' });
  assert.equal(h.transfers[0].to, ZERO_POISON);
  assert.equal(h.transfers[0].value, 0n);
  assert.equal(h.transfers[0].decimals, 18);
  assert.equal(h.txs[0].hash, '0xa1');
  assert.match(seen[0], /offset=50/);
  assert.equal(normalizeTx({ hash: '0x1', value: '5', isError: '1' }).isError, true);
  assert.equal(normalizeTokenTx({ hash: '0x1', value: '7', tokenDecimal: '' }).decimals, null);
});

test('explorer "no transactions" is an empty history, other errors throw', async () => {
  const mk = (body) => async () => ({ status: 200, text: async () => JSON.stringify(body) });
  const h = await explorerHistory({ base: 'https://x.test/api', wallet: FX.wallet, fetchImpl: mk({ status: '0', message: 'No transactions found', result: [] }), label: 't' });
  assert.equal(h.transfers.length, 0);
  await assert.rejects(explorerHistory({ base: 'https://x.test/api', wallet: FX.wallet, fetchImpl: mk({ status: '0', message: 'NOTOK', result: 'Invalid API Key' }), label: 't' }), /Invalid API Key/);
});

test('rpcHistory reads Transfer logs, skips NFTs and checks who signed outgoing txs (fake RPC)', async () => {
  const t = (a) => '0x' + pad32(a);
  const u = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');
  const fake = '0xfa4e000000000000000000000000000000000bad';
  const logs = [
    { address: fake, topics: [TOPIC_TRANSFER, t(FX.wallet), t(FAKE_POISON)], data: u(80n * 10n ** 18n), blockNumber: '0x64', logIndex: '0x0', transactionHash: '0xb2' },
    { address: fake, topics: [TOPIC_TRANSFER, t(FX.wallet), t(FAKE_POISON), u(7)], data: '0x', blockNumber: '0x64', logIndex: '0x1', transactionHash: '0xb2' },
  ];
  const str = (s) => '0x' + u(32).slice(2) + u(s.length).slice(2) + Buffer.from(s).toString('hex').padEnd(64, '0');
  const rpc = {
    call: async (method, params) => {
      if (method === 'eth_blockNumber') return '0x64';
      if (method === 'eth_getLogs') return params[0].topics[1] ? logs : [];
      if (method === 'eth_call') return params[0].data === '0x95d89b41' ? str('USDT') : u(18);
      if (method === 'eth_getTransactionByHash') return { from: '0x00000000000000000000000000000000deadbeef' };
      throw new Error('unexpected ' + method);
    },
  };
  const h = await rpcHistory({ chain: BSC, wallet: FX.wallet, rpc, days: 1 });
  assert.equal(h.txs, null);
  assert.equal(h.transfers.length, 1);
  assert.equal(h.transfers[0].symbol, 'USDT');
  assert.equal(h.transfers[0].txFrom, '0x00000000000000000000000000000000deadbeef');
  const a = analyze({ wallet: FX.wallet, transfers: h.transfers, txs: h.txs, chain: BSC });
  assert.equal(a.findings[0].address, FAKE_POISON);
});

const report = () => {
  const a = analyze({ wallet: FX.wallet, transfers: FX.transfers, txs: FX.txs, chain: BSC });
  return { chain: 'bsc', chainId: 56, wallet: a.wallet, source: 'fixture', fullHistory: true, transfersRead: FX.transfers.length, counterparties: a.counterparties, findings: a.findings, counts: a.counts, settings: { prefix: 4, suffix: 4 } };
};

test('renderReport shows suspect and real address with a diff marker', () => {
  const out = renderReport(report());
  assert.match(out, /poisonwatch · bsc · 0x5f37…2b9e/);
  assert.match(out, new RegExp(ZERO_POISON));
  assert.match(out, new RegExp('real  ' + FRIEND));
  assert.match(out, /\^+.*differs/);
  assert.match(out, /2 high · 1 medium · 1 low/);
});

test('clean wallet says so', () => {
  const out = renderReport({ ...report(), findings: [], counts: { HIGH: 0, MEDIUM: 0, LOW: 0 } });
  assert.match(out, /No poison addresses found/);
});

test('json and markdown output', () => {
  const r = report();
  const j = JSON.parse(toJSON(r));
  assert.equal(j.findings.length, 4);
  assert.ok(Array.isArray(j.counterparties[0].what));
  const md = toMarkdown(r);
  assert.match(md, /\| 🔴 HIGH \| `0x6ff9/);
});

test('helpers', () => {
  assert.equal(age(1000, 1000 + 86400 * 3), '3d');
  assert.equal(age(0), '?');
  assert.equal(formatUnits(1500000n, 6), '1.5');
  assert.equal(formatUnits(1n, 18), '<0.000001');
  assert.equal(isAddress(FRIEND), true);
  assert.equal(isAddress('0x123'), false);
  assert.equal(decodeString('0x' + Buffer.from('MKR').toString('hex').padEnd(64, '0')), 'MKR');
});

test('nextStep follows the block cap an RPC names, else halves', () => {
  assert.equal(nextStep(5000, 'Block range too large for public access: maximum 1000 blocks'), 1000);
  assert.equal(nextStep(5000, 'exceed maximum block range: 5000'), 2500);
  assert.equal(nextStep(5000, 'query returned more than 10000 results'), 2500);
  assert.equal(nextStep(80, 'too large'), 50);
});

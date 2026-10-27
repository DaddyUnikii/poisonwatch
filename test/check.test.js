import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyze } from '../src/detect.js';
import { checkRecipient } from '../src/check.js';
import { resolveChain } from '../src/chains.js';

const BSC = resolveChain('bsc');
const FX = JSON.parse(readFileSync(new URL('./fixtures/poisoned-wallet.json', import.meta.url)));
FX.transfers = FX.transfers.map((t) => ({ ...t, value: BigInt(t.value) }));
FX.txs = FX.txs.map((t) => ({ ...t, value: BigInt(t.value) }));
const A = analyze({ wallet: FX.wallet, transfers: FX.transfers, txs: FX.txs, chain: BSC });
const check = (recipient, analysis = A) => checkRecipient({ analysis, recipient });

test('a flagged poison address is DANGER and names the real one', () => {
  const r = check('0x6ff9e6e3e3e3d1839447575eeda9f0db114ba434');
  assert.equal(r.verdict, 'DANGER');
  assert.equal(r.lookalikeOf[0].address, '0x6ff94bf88e94c6f73024d6336db8ac428025a434');
  assert.equal(r.lookalikeOf[0].sends, 2);
});

test('an unseen lookalike of a real counterparty is DANGER too', () => {
  const r = check('0x6FF9' + '0'.repeat(32) + 'A434');
  assert.equal(r.verdict, 'DANGER');
  assert.match(r.reasons[0], /never sent here/);
});

test('the real friend address is KNOWN', () => {
  const r = check('0x6FF94BF88E94C6F73024D6336DB8AC428025A434'.replace('0X', '0x'));
  assert.equal(r.verdict, 'KNOWN');
  assert.equal(r.sends, 2);
});

test('a spammer that mimics nobody is CAUTION', () => {
  assert.equal(check('0x1234567890abcdef1234567890abcdef12345678').verdict, 'CAUTION');
});

test('a brand new address is NEW', () => {
  const r = check('0x00000000000000000000000000000000c0ffee00');
  assert.equal(r.verdict, 'NEW');
  assert.match(r.reasons[0], /whole address/);
});

test('if you already sent to both twins, even the real one is DANGER', () => {
  const tx = { hash: '0xd1', from: FX.wallet, to: BSC.tokens.USDT[0], value: 0n, time: 1761000000 };
  const t = { hash: '0xd1', time: 1761000000, token: BSC.tokens.USDT[0], symbol: 'USDT', decimals: 18, from: FX.wallet, to: '0x6ff9e6e3e3e3d1839447575eeda9f0db114ba434', value: 1n };
  const a = analyze({ wallet: FX.wallet, transfers: [...FX.transfers, t], txs: [...FX.txs, tx], chain: BSC });
  const r = check('0x6ff94bf88e94c6f73024d6336db8ac428025a434', a);
  assert.equal(r.verdict, 'DANGER');
  assert.match(r.reasons[0], /lookalike/);
});

test('stricter --prefix/--suffix changes the verdict', () => {
  const r = checkRecipient({ analysis: { ...A, findings: [] }, recipient: '0x6ff9' + '0'.repeat(32) + 'a434', prefix: 6, suffix: 6 });
  assert.equal(r.verdict, 'NEW');
});

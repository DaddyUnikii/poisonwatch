// Pure detection logic. No network: everything here works on normalized history, so it is
// fully covered by fixture tests.
//
// A transfer is { hash, block, time, token, symbol, decimals, from, to, value (BigInt), txFrom? }
// A tx is       { hash, from, to, value (BigInt), time, isError }
// `txs` may be null when the source cannot list the wallet's transactions (plain RPC); then
// each outgoing transfer must carry `txFrom` (the real sender of its transaction).

export const DEFAULTS = { prefix: 4, suffix: 4, dust: 0.01 };
const ZERO = '0x0000000000000000000000000000000000000000';
const LEVELS = ['HIGH', 'MEDIUM', 'LOW'];

const lc = (a) => (a || '').toLowerCase();
const hexBody = (a) => lc(a).replace(/^0x/, '');

/** How many leading and trailing hex characters two addresses share (ignoring 0x and case). */
export function sharedEnds(a, b) {
  const x = hexBody(a), y = hexBody(b);
  let p = 0;
  while (p < x.length && x[p] === y[p]) p++;
  let s = 0;
  while (s < x.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
  return { prefix: p, suffix: s };
}

/** True when `a` is a different address that shares the first `prefix` and last `suffix` chars of `b`. */
export function isLookalike(a, b, { prefix = DEFAULTS.prefix, suffix = DEFAULTS.suffix } = {}) {
  if (!a || !b || lc(a) === lc(b)) return false;
  const m = sharedEnds(a, b);
  return m.prefix >= prefix && m.suffix >= suffix;
}

/** Marks which characters differ, e.g. "      ^^^^^^^^^^^^…" under the 0x-prefixed address. */
export function diffMarker(a, b) {
  const x = lc(a), y = lc(b);
  let out = '';
  for (let i = 0; i < x.length; i++) out += x[i] === y[i] ? ' ' : '^';
  return out.replace(/\s+$/, '');
}

/** Folds look-alike symbols ("ĖTḨ", "U$DT", "usdt ") down to plain ASCII ("ETH", "UDT", "USDT"). */
export const normSymbol = (s) => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * A token that claims a famous symbol (USDT, USDC, WETH… or the chain's native coin, e.g. an
 * ERC-20 called "ETH") but is not the real contract on this chain.
 */
export function isFakeToken(t, chain) {
  if (!chain || !t.symbol) return false;
  const known = chain.tokens || {};
  const sym = normSymbol(t.symbol);
  const real = known[sym] || (sym === normSymbol(chain.native) ? [] : null);
  if (!real) return false;
  return !real.includes(lc(t.token));
}

/** A non-zero amount below `dust` whole tokens (default 0.01). */
export function isDust(t, dust = DEFAULTS.dust) {
  if (t.value === 0n || t.decimals == null) return false;
  const scale = 10n ** BigInt(t.decimals);
  // value / 10^decimals < dust   <=>   value * 1e6 < dust * 1e6 * 10^decimals
  return t.value * 1000000n < BigInt(Math.round(dust * 1e6)) * scale;
}

/**
 * Addresses the wallet genuinely sent value to: native transfers it signed, and token transfers
 * out of it inside transactions it signed. Spoofed "outgoing" events (zero-value transferFrom,
 * fake tokens emitting Transfer(you → poison)) are excluded because you never signed them.
 */
export function realCounterparties({ wallet, transfers = [], txs = null, chain }) {
  const me = lc(wallet);
  const signed = txs ? new Set(txs.filter((t) => lc(t.from) === me && !t.isError).map((t) => lc(t.hash))) : null;
  const out = new Map();
  const add = (addr, time, what) => {
    const a = lc(addr);
    if (!a || a === me || a === ZERO) return;
    const c = out.get(a) || { address: a, sends: 0, first: time || 0, last: time || 0, what: new Set() };
    c.sends++;
    if (time && (!c.first || time < c.first)) c.first = time;
    if (time && time > c.last) c.last = time;
    c.what.add(what);
    out.set(a, c);
  };
  for (const t of txs || []) {
    if (lc(t.from) === me && t.to && !t.isError && t.value > 0n) add(t.to, t.time, chain ? chain.native : 'native');
  }
  for (const t of transfers) {
    if (lc(t.from) !== me || t.value === 0n) continue;
    const mine = signed ? signed.has(lc(t.hash)) : lc(t.txFrom) === me;
    if (mine) add(t.to, t.time, t.symbol || 'token');
  }
  return out;
}

/** Classifies one transfer touching the wallet. Returns null when it is ordinary. */
export function classify(t, { wallet, signed, chain, dust = DEFAULTS.dust }) {
  const me = lc(wallet);
  const from = lc(t.from), to = lc(t.to);
  const fake = isFakeToken(t, chain);
  if (from === me) {
    const mine = signed ? signed.has(lc(t.hash)) : lc(t.txFrom) === me;
    if (mine) return null; // you signed it, so it is a real send
    // you did not sign this, yet a token says you sent something
    if (t.value === 0n) return { counterparty: to, kind: 'zero-spoof' };
    return { counterparty: to, kind: fake ? 'fake-spoof' : 'spoof' };
  }
  if (to === me) {
    if (fake) return { counterparty: from, kind: 'fake' };
    if (t.value === 0n) return { counterparty: from, kind: 'zero' };
    if (isDust(t, dust)) return { counterparty: from, kind: 'dust' };
  }
  return null;
}

// An unsigned non-zero move of a real token is usually an approval being used (a gasless swap,
// a relayer), not poisoning, so it adds nothing on its own.
const POINTS = { 'zero-spoof': 2, 'fake-spoof': 2, spoof: 0, fake: 2, zero: 1, dust: 1 };
const LABEL = {
  'zero-spoof': 'zero-value transferFrom spoof from your wallet',
  'fake-spoof': 'fake token "sent" from your wallet',
  spoof: 'transfer from your wallet you never signed',
  fake: 'fake token transfer',
  zero: 'zero-value transfer',
  dust: 'dust transfer',
};

export function levelFor(score) {
  return score >= 5 ? 'HIGH' : score >= 3 ? 'MEDIUM' : 'LOW';
}

/**
 * Finds poison addresses in a wallet's history.
 * Score: lookalike of a real counterparty +3, unusually close match (≥2 extra chars) +1,
 * you already sent funds to it +3, spoofed/fake transfers +2, zero-value or dust +1.
 * HIGH ≥ 5 · MEDIUM 3–4 · LOW 2. Addresses below 2 are not reported.
 */
export function analyze({ wallet, transfers = [], txs = null, chain, prefix = DEFAULTS.prefix, suffix = DEFAULTS.suffix, dust = DEFAULTS.dust }) {
  const me = lc(wallet);
  const opts = { prefix, suffix };
  const real = realCounterparties({ wallet, transfers, txs, chain });
  const signed = txs ? new Set(txs.filter((t) => lc(t.from) === me && !t.isError).map((t) => lc(t.hash))) : null;

  // gather suspicious events per counterparty
  const events = new Map();
  for (const t of transfers) {
    const c = classify(t, { wallet, signed, chain, dust });
    if (!c || !c.counterparty || c.counterparty === ZERO) continue;
    const e = events.get(c.counterparty) || { kinds: {}, tokens: new Set(), first: 0, last: 0, hashes: [] };
    e.kinds[c.kind] = (e.kinds[c.kind] || 0) + 1;
    if (t.symbol) e.tokens.add(t.symbol);
    if (t.time && (!e.first || t.time < e.first)) e.first = t.time;
    if (t.time && t.time > e.last) e.last = t.time;
    if (e.hashes.length < 3) e.hashes.push(t.hash);
    events.set(c.counterparty, e);
  }

  const realList = [...real.values()];
  const mimicOf = (addr) => {
    let best = null;
    for (const r of realList) {
      if (!isLookalike(addr, r.address, opts)) continue;
      const m = sharedEnds(addr, r.address);
      const better = !best || r.sends > best.real.sends || (r.sends === best.real.sends && r.first < best.real.first);
      if (better) best = { real: r, match: m };
    }
    return best;
  };

  const candidates = new Set([...events.keys()]);
  for (const r of realList) candidates.add(r.address);

  const findings = [];
  for (const addr of candidates) {
    const ev = events.get(addr);
    const sentTo = real.get(addr);
    let mim = mimicOf(addr);
    // two real counterparties that look alike: the one you started sending to later is the suspect
    if (sentTo && mim) {
      const other = mim.real;
      const iAmOlder = sentTo.first && other.first ? sentTo.first < other.first : sentTo.sends > other.sends;
      if (iAmOlder) mim = null;
    }
    if (!mim && !ev) continue;
    let score = 0;
    const reasons = [];
    if (mim) {
      score += 3;
      reasons.push(`looks like ${mim.real.address.slice(0, 2 + mim.match.prefix)}…${mim.real.address.slice(-mim.match.suffix)}, an address you sent to ${mim.real.sends}×`);
      if (mim.match.prefix + mim.match.suffix >= prefix + suffix + 2) { score += 1; reasons.push(`matches ${mim.match.prefix} leading + ${mim.match.suffix} trailing characters`); }
    }
    if (mim && sentTo) { score += 3; reasons.push(`you already sent funds to this lookalike ${sentTo.sends}×`); }
    if (ev) {
      for (const [kind, n] of Object.entries(ev.kinds)) {
        // an unsigned "send" from your wallet to a lookalike is the fake-token poisoning pattern
        score += kind === 'spoof' && mim ? 2 : POINTS[kind];
        reasons.push(`${n}× ${LABEL[kind]}`);
      }
    }
    if (score < 2) continue;
    findings.push({
      address: addr,
      level: levelFor(score),
      score,
      lookalikeOf: mim ? mim.real.address : null,
      realSends: mim ? mim.real.sends : 0,
      match: mim ? mim.match : null,
      sentTo: sentTo ? sentTo.sends : 0,
      kinds: ev ? ev.kinds : {},
      tokens: ev ? [...ev.tokens] : [],
      firstSeen: ev ? ev.first : sentTo ? sentTo.first : 0,
      lastSeen: ev ? ev.last : sentTo ? sentTo.last : 0,
      sampleTx: ev ? ev.hashes : [],
      reasons,
    });
  }
  findings.sort((a, b) => b.score - a.score || (b.lastSeen || 0) - (a.lastSeen || 0));
  const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of findings) counts[f.level]++;
  return { wallet: me, findings, counts, counterparties: realList.map((r) => ({ ...r, what: [...r.what] })) };
}

export function worstLevel(findings) {
  let worst = null;
  for (const f of findings) if (worst === null || LEVELS.indexOf(f.level) < LEVELS.indexOf(worst)) worst = f.level;
  return worst;
}

/** Exit gate for --fail-on: true when any finding is at or above `level`. */
export function failsGate(findings, level) {
  if (!level) return false;
  const gate = LEVELS.indexOf(String(level).toUpperCase());
  if (gate < 0) throw new Error(`--fail-on must be high, medium or low`);
  return findings.some((f) => LEVELS.indexOf(f.level) <= gate);
}

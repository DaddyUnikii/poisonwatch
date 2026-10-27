// Where the wallet's history comes from. Best source first:
//   1. Etherscan v2 (any chain, full history) when ETHERSCAN_API_KEY is set
//   2. Blockscout's keyless etherscan-compatible API where the chain has one
//   3. Plain eth_getLogs over the last N days, chunked to fit public RPC limits
// Every source is normalized to { transfers, txs } as described in detect.js.
import { pad32, topicToAddress, decodeString } from './hex.js';

export const TOPIC_TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const lc = (a) => (a || '').toLowerCase();

async function getJSON(url, fetchImpl, label) {
  let res, text;
  for (let attempt = 0; ; attempt++) {
    res = await fetchImpl(url);
    text = await res.text();
    if ((res.status !== 429 && !/rate limit|too many/i.test(text)) || attempt >= 4) break;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); // keyless explorers rate-limit per IP
  }
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${label} returned non-JSON (HTTP ${res.status})`); }
  if (Array.isArray(body.result)) return body.result;
  if (/no (transactions|records)/i.test(body.message || '') || /no (transactions|records)/i.test(String(body.result || ''))) return [];
  throw new Error(`${label}: ${typeof body.result === 'string' ? body.result : body.message || 'bad response'}`);
}

export function normalizeTokenTx(r) {
  return {
    hash: lc(r.hash), block: Number(r.blockNumber), time: Number(r.timeStamp) || 0,
    token: lc(r.contractAddress), symbol: r.tokenSymbol || null,
    decimals: r.tokenDecimal === '' || r.tokenDecimal == null ? null : Number(r.tokenDecimal),
    from: lc(r.from), to: lc(r.to), value: BigInt(r.value || 0),
  };
}

export function normalizeTx(r) {
  return {
    hash: lc(r.hash), from: lc(r.from), to: lc(r.to), value: BigInt(r.value || 0),
    time: Number(r.timeStamp) || 0, isError: r.isError === '1' || r.txreceipt_status === '0',
  };
}

export async function explorerHistory({ base, wallet, limit = 1000, fetchImpl = globalThis.fetch, label }) {
  const q = (action) => `${base}${base.includes('?') ? '&' : '?'}${new URLSearchParams({ module: 'account', action, address: wallet, page: '1', offset: String(limit), sort: 'desc' })}`;
  const tokenRows = await getJSON(q('tokentx'), fetchImpl, label);
  const txRows = await getJSON(q('txlist'), fetchImpl, label);
  return {
    transfers: tokenRows.map(normalizeTokenTx),
    txs: txRows.map(normalizeTx),
    capped: tokenRows.length >= limit,
  };
}

/** ERC-20 Transfer logs (3 topics) in and out of the wallet over the last `days`. */
export async function rpcHistory({ chain, wallet, rpc, days = 3, onProgress = () => {}, maxLookups = 150 }) {
  const latest = parseInt(await rpc.call('eth_blockNumber', []), 16);
  const span = Math.ceil((days * 86400) / chain.blockTime);
  const start = Math.max(0, latest - span);
  const me = '0x' + pad32(wallet);
  const logs = [];
  let step = 5000;
  let from = start;
  while (from <= latest) {
    const to = Math.min(latest, from + step - 1);
    const range = { fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) };
    try {
      const [out, inc] = await Promise.all([
        rpc.call('eth_getLogs', [{ ...range, topics: [TOPIC_TRANSFER, me] }]),
        rpc.call('eth_getLogs', [{ ...range, topics: [TOPIC_TRANSFER, null, me] }]),
      ]);
      logs.push(...out, ...inc);
      from = to + 1;
      onProgress((from - start) / (latest - start + 1));
    } catch (e) {
      if (e.range && step > 250) { step = Math.floor(step / 2); continue; } // public RPCs cap ranges differently; shrink and retry
      throw e;
    }
  }
  const now = Math.floor(Date.now() / 1000);
  const seen = new Set();
  const transfers = [];
  for (const l of logs) {
    if (!l.topics || l.topics.length !== 3) continue; // ERC-721 Transfer has 4 topics
    const k = `${l.transactionHash}:${parseInt(l.logIndex, 16)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const block = parseInt(l.blockNumber, 16);
    transfers.push({
      hash: lc(l.transactionHash), block, time: now - Math.round((latest - block) * chain.blockTime),
      token: lc(l.address), symbol: null, decimals: null,
      from: topicToAddress(l.topics[1]), to: topicToAddress(l.topics[2]),
      value: !l.data || l.data === '0x' ? 0n : BigInt(l.data.slice(0, 66)),
    });
  }
  await enrich({ transfers, wallet, rpc, maxLookups });
  return { transfers, txs: null, capped: false };
}

const pool = async (items, n, fn) => {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
};

// Fills in symbol/decimals and, for transfers out of the wallet, who actually signed the tx.
export async function enrich({ transfers, wallet, rpc, maxLookups = 150 }) {
  const me = lc(wallet);
  const tokens = [...new Set(transfers.map((t) => t.token))].slice(0, maxLookups);
  const meta = new Map();
  await pool(tokens, 6, async (token) => {
    const m = { symbol: null, decimals: null };
    try { m.symbol = decodeString(await rpc.call('eth_call', [{ to: token, data: '0x95d89b41' }, 'latest'])); } catch {}
    try { const d = await rpc.call('eth_call', [{ to: token, data: '0x313ce567' }, 'latest']); if (d && d !== '0x') m.decimals = Number(BigInt(d.slice(0, 66))); } catch {}
    meta.set(token, m);
  });
  const outHashes = [...new Set(transfers.filter((t) => t.from === me).map((t) => t.hash))].slice(0, maxLookups);
  const senders = new Map();
  await pool(outHashes, 6, async (h) => {
    try { const tx = await rpc.call('eth_getTransactionByHash', [h]); if (tx) senders.set(h, lc(tx.from)); } catch {}
  });
  for (const t of transfers) {
    const m = meta.get(t.token);
    if (m) { t.symbol = m.symbol; t.decimals = m.decimals; }
    if (t.from === me) t.txFrom = senders.get(t.hash) || null;
  }
  return transfers;
}

export async function fetchHistory({ chain, wallet, rpc, days = 3, limit = 1000, apiKey, fetchImpl = globalThis.fetch, onProgress }) {
  const tries = [];
  if (apiKey) tries.push(['etherscan', `https://api.etherscan.io/v2/api?chainid=${chain.id}&apikey=${apiKey}`]);
  if (chain.blockscout) tries.push(['blockscout', chain.blockscout]);
  const errors = [];
  for (const [label, base] of tries) {
    try {
      const h = await explorerHistory({ base, wallet, limit, fetchImpl, label });
      return { ...h, source: label + (h.capped ? ` (latest ${limit})` : ''), full: !h.capped, errors };
    } catch (e) { errors.push(e.message); }
  }
  try {
    const h = await rpcHistory({ chain, wallet, rpc, days, onProgress });
    return { ...h, source: `rpc (last ${days}d)`, full: false, errors };
  } catch (e) {
    throw new Error([...errors, `rpc: ${e.message}`].join('; '));
  }
}

/** Chains where the wallet has sent at least one transaction (used by --chain auto). */
export async function activeChains({ chains, wallet, makeRpc }) {
  const out = await Promise.all(chains.map(async (c) => {
    try {
      const n = await makeRpc(c.rpc, { retries: 0, timeoutMs: 8000 }).call('eth_getTransactionCount', [wallet, 'latest']);
      return parseInt(n, 16) > 0 ? c : null;
    } catch { return null; }
  }));
  return out.filter(Boolean);
}

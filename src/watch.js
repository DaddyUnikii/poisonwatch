// Glue: fetch a wallet's history on one chain and run the detector over it.
import { fetchHistory } from './sources.js';
import { analyze } from './detect.js';

export async function watch({ chain, wallet, rpc, days, limit, apiKey, prefix, suffix, dust, fetchImpl, onProgress }) {
  const h = await fetchHistory({ chain, wallet, rpc, days, limit, apiKey, fetchImpl, onProgress });
  const a = analyze({ wallet, transfers: h.transfers, txs: h.txs, chain, prefix, suffix, dust });
  return {
    chain: chain.key, chainId: chain.id, explorer: chain.explorer, wallet: a.wallet,
    source: h.source, fullHistory: h.full, transfersRead: h.transfers.length, txsRead: h.txs ? h.txs.length : null,
    counterparties: a.counterparties, findings: a.findings, counts: a.counts,
    settings: { prefix: prefix ?? 4, suffix: suffix ?? 4 },
  };
}

// Tiny JSON-RPC client with endpoint fallback and retry. No dependencies.
// A "block range too large" style error from eth_getLogs is surfaced as e.range once every
// endpoint has refused, so the caller can shrink its window; rate limits just move on.
export function makeRpc(urls, { fetchImpl = globalThis.fetch, retries = 2, timeoutMs = 15000 } = {}) {
  let preferred = 0;
  let id = 0;
  async function call(method, params) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      let rangeErr = null;
      for (let k = 0; k < urls.length; k++) {
        const i = (preferred + k) % urls.length;
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), timeoutMs);
          const res = await fetchImpl(urls[i], {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: ctrl.signal,
          }).finally(() => clearTimeout(timer));
          const text = await res.text();
          let body;
          try { body = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status} from ${urls[i]}`); }
          if (body.error) {
            const { message = 'rpc error', data } = body.error;
            const e = new Error(typeof data === 'string' && data ? `${message}: ${data}` : message); // some RPCs put the reason in `data`
            e.rpc = true;
            if (method === 'eth_getLogs' && !/rate|request limit/i.test(e.message) && /range|blocks|results|too large|too many|exceed/i.test(e.message)) e.range = true;
            throw e;
          }
          preferred = i;
          return body.result;
        } catch (e) {
          if (e.range) rangeErr = e;
          lastErr = e;
        }
      }
      if (rangeErr) throw rangeErr;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
    throw lastErr;
  }
  return { call, urls };
}

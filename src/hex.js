export const strip = (h) => (h.startsWith('0x') ? h.slice(2) : h);
export const isAddress = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
export const pad32 = (h) => strip(h).toLowerCase().padStart(64, '0');
export const topicToAddress = (t) => '0x' + strip(t).slice(-40).toLowerCase();
export const toBig = (h) => (h == null || h === '' || h === '0x' ? 0n : BigInt(String(h).startsWith('0x') ? h : h));
export const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '?');

// Decodes an ABI string return value, or a bytes32 string (old tokens like MKR).
export function decodeString(h) {
  const s = strip(h || '');
  if (!s) return null;
  try {
    if (s.length >= 128) {
      const off = Number(BigInt('0x' + s.slice(0, 64)));
      const len = Number(BigInt('0x' + s.slice(off * 2, off * 2 + 64)));
      if (len > 0 && len < 256) return clean(Buffer.from(s.slice(off * 2 + 64, off * 2 + 64 + len * 2), 'hex').toString('utf8'));
    }
    return clean(Buffer.from(s.slice(0, 64), 'hex').toString('utf8').replace(/\0+$/, '')) || null;
  } catch { return null; }
}
const clean = (t) => t.replace(/[\u0000-\u001f\u007f]/g, '').trim();

export function formatUnits(v, decimals = 18, maxFrac = 6) {
  const d = BigInt(decimals);
  const base = 10n ** d;
  const whole = v / base;
  const frac = (v % base).toString().padStart(Number(d), '0').slice(0, maxFrac).replace(/0+$/, '');
  if (whole === 0n && !frac && v > 0n) return '<' + (maxFrac ? '0.' + '0'.repeat(maxFrac - 1) + '1' : '1');
  return whole.toLocaleString('en-US') + (frac ? '.' + frac : '');
}

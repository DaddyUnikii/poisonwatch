import { short } from './hex.js';
import { diffMarker } from './detect.js';

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const red = c('31;1'), yellow = c('33'), green = c('32'), dim = c('2'), bold = c('1');
const levelColor = { HIGH: red, MEDIUM: yellow, LOW: green };
const icon = { HIGH: '🔴', MEDIUM: '🟡', LOW: '🟢' };

export function age(ts, now = Date.now() / 1000) {
  if (!ts) return '?';
  const d = Math.floor((now - ts) / 86400);
  if (d < 1) return 'today';
  if (d < 60) return `${d}d`;
  if (d < 730) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

export function kindsSummary(kinds) {
  const n = Object.values(kinds || {}).reduce((a, b) => a + b, 0);
  return n ? String(n) : '-';
}

export function renderReport(r, { max = 25 } = {}) {
  const lines = [];
  lines.push(bold(`poisonwatch · ${r.chain} · ${short(r.wallet)}`));
  lines.push(dim(`source: ${r.source} · ${r.transfersRead} token transfers · ${r.counterparties.length} addresses you really sent to · match ${r.settings.prefix}+${r.settings.suffix} chars`));
  lines.push('');
  if (!r.findings.length) { lines.push(green('✓ No poison addresses found.') + dim(r.fullHistory ? '' : '  (older history needs --days N or ETHERSCAN_API_KEY)')); return lines.join('\n'); }
  lines.push(dim(['RISK  ', 'SUSPECT ADDRESS'.padEnd(42), 'EVENTS', '  SEEN'].join('  ')));
  for (const f of r.findings.slice(0, max)) {
    lines.push([levelColor[f.level](f.level.padEnd(6)), f.address, kindsSummary(f.kinds).padStart(6), age(f.lastSeen).padStart(6)].join('  '));
    if (f.lookalikeOf) {
      lines.push(dim('  real') + '  ' + f.lookalikeOf + dim(`   ← you sent here ${f.realSends}×`));
      lines.push('        ' + red(diffMarker(f.address, f.lookalikeOf)) + dim(' differs'));
    }
    lines.push(dim('        ↳ ' + f.reasons.join(', ')));
  }
  if (r.findings.length > max) lines.push(dim(`        … and ${r.findings.length - max} more (use --json for all)`));
  lines.push('');
  lines.push(`${red(r.counts.HIGH + ' high')} · ${yellow(r.counts.MEDIUM + ' medium')} · ${green(r.counts.LOW + ' low')}`);
  lines.push(dim('Never copy an address from your transaction history. Use your address book or the original source.'));
  return lines.join('\n');
}

export function toJSON(r) {
  return JSON.stringify(r, (k, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Set ? [...v] : v), 2);
}

export function toMarkdown(r, { max = 50 } = {}) {
  const out = [`### ${r.chain} · \`${r.wallet}\``, '', `Source: ${r.source} · ${r.transfersRead} token transfers · ${r.counterparties.length} real counterparties`, ''];
  if (!r.findings.length) return out.concat('✅ No poison addresses found.').join('\n');
  out.push('| Risk | Suspect address | Looks like (real) | Events | Seen | Why |', '|---|---|---|---|---|---|');
  for (const f of r.findings.slice(0, max)) {
    out.push(`| ${icon[f.level]} ${f.level} | \`${f.address}\` | ${f.lookalikeOf ? '`' + f.lookalikeOf + '`' : '-'} | ${kindsSummary(f.kinds)} | ${age(f.lastSeen)} | ${f.reasons.join(', ')} |`);
  }
  if (r.findings.length > max) out.push('', `…and ${r.findings.length - max} more.`);
  out.push('', '> Never copy an address from your transaction history.');
  return out.join('\n');
}

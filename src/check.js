// "Is it safe to send here?" Pure logic on top of analyze(): no network.
import { isLookalike, sharedEnds } from './detect.js';

const lc = (a) => (a || '').toLowerCase();

/**
 * verdict:
 *   DANGER  recipient looks like an address you really sent to, or is a flagged poison address
 *   CAUTION recipient only ever showed up through suspicious transfers to you
 *   KNOWN   you have sent to this exact address before and nothing looks like it
 *   NEW     never seen: not poison as far as history shows, but verify every character
 */
export function checkRecipient({ analysis, recipient, prefix = 4, suffix = 4 }) {
  const to = lc(recipient);
  const real = analysis.counterparties || [];
  const finding = analysis.findings.find((f) => f.address === to);
  const exact = real.find((r) => r.address === to);
  const twins = real.filter((r) => isLookalike(to, r.address, { prefix, suffix }))
    .map((r) => ({ address: r.address, sends: r.sends, last: r.last, match: sharedEnds(to, r.address) }))
    .sort((a, b) => b.sends - a.sends);

  if (finding && (finding.level !== 'LOW' || finding.lookalikeOf)) {
    return { verdict: 'DANGER', recipient: to, lookalikeOf: twins, finding, reasons: finding.reasons };
  }
  if (twins.length && !exact) {
    return { verdict: 'DANGER', recipient: to, lookalikeOf: twins, reasons: [`you have never sent here, but it looks like ${twins.length > 1 ? twins.length + ' addresses' : 'an address'} you have`] };
  }
  if (twins.length && exact) {
    return { verdict: 'DANGER', recipient: to, lookalikeOf: twins, sends: exact.sends, reasons: [`you sent here ${exact.sends}×, but you also sent to a lookalike; one of them may be a poison address`] };
  }
  if (finding) return { verdict: 'CAUTION', recipient: to, finding, reasons: finding.reasons };
  if (exact) return { verdict: 'KNOWN', recipient: to, sends: exact.sends, last: exact.last, reasons: [`you sent here ${exact.sends}× before`] };
  return { verdict: 'NEW', recipient: to, reasons: ['never seen in your history; check the whole address, not just the start and end'] };
}

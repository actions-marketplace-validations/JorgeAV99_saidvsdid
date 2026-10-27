import type { Finding } from '../rules/index.js';
import { EXPERIMENTAL } from '../rules/index.js';
import { coverageCounts } from '../coverage.js';
import { verdictLabel, type Report } from './model.js';

function location(f: Finding): string {
  const at = f.line === null ? f.file : `${f.file}:${f.line}`;
  return f.side === 'base' ? `${at} (base)` : at;
}

export function renderText(report: Report): string {
  const lines: string[] = [];
  const base = report.repo.base_ref ? `${report.repo.base_ref.ref} (merge-base ${report.repo.base.slice(0, 12)})` : report.repo.base.slice(0, 12);
  lines.push(`saidvsdid ${report.tool.version} — base ${base} → head ${report.repo.head.slice(0, 12)}`);
  const coverage = report.coverage ? coverageCounts(report.coverage) : `test files analysed: ${report.files.length}`;
  lines.push(`rules: ${report.rules.map((r) => (EXPERIMENTAL.has(r) ? `${r} (experimental)` : r)).join(', ')} · ${coverage}`);
  // Every test file not wholly analysed, with why (src/coverage.ts): an OK never covers them.
  for (const f of report.coverage?.files ?? []) {
    if (f.state !== 'analysed') lines.push(`${f.state === 'partly-analysed' ? 'partly analysed' : 'not analysed'}: ${f.path} — ${f.reasons.join('; ')}`);
  }
  for (const n of report.not_evaluated) lines.push(`not evaluated: ${n.rule}${EXPERIMENTAL.has(n.rule) ? ' (experimental)' : ''} — ${n.reason}`);
  const scopes = report.tool.scopes;
  if (scopes?.python_unavailable) lines.push(`python: test files not read — ${scopes.python_unavailable}${scopes.python_remedy ? `; ${scopes.python_remedy}` : ''}`);
  lines.push('');
  for (const u of report.unverifiable) {
    lines.push(`UNVERIFIABLE  ${u.file} (${u.side})`);
    lines.push(`      ${u.reason}; excluded from the comparison`);
  }
  if (report.unverifiable.length > 0) lines.push('');
  if (report.findings.length === 0) {
    lines.push(report.unverifiable.length > 0 ? 'No findings in the files that could be analysed.' : 'No findings.');
  } else {
    for (const f of report.findings) {
      lines.push(`${f.severity.toUpperCase().padEnd(4)}  ${f.rule}  ${location(f)}`);
      lines.push(`      ${f.message}`);
      // A grouped finding (src/rules/group.ts): every test, when the message shows only some.
      if (f.tests && f.tests.length > 5) for (const t of f.tests) lines.push(`        - ${t}`);
    }
  }
  lines.push('');
  const { fail, warn, info } = report.counts;
  lines.push(`Verdict: ${verdictLabel(report)} (${fail} fail, ${warn} warn, ${info} info) — exit ${report.exit_code}`);
  return lines.join('\n') + '\n';
}

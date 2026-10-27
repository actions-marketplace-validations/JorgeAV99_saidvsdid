import { EXPERIMENTAL } from '../rules/index.js';
import { coverageCounts, incomplete } from '../coverage.js';
import { verdictLabel, type Report } from './model.js';

const ICON = { fail: '❌', warn: '⚠️', info: 'ℹ️' } as const;

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Markdown suitable for a PR comment or a GitHub job summary. */
export function renderMarkdown(report: Report): string {
  const { fail, warn, info } = report.counts;
  const lines: string[] = [];
  const [word, ...rest] = verdictLabel(report).split(' — ');
  lines.push(`### saidvsdid: **${word}**${rest.length ? ` — ${rest.join(' — ')}` : ''}`);
  lines.push('');
  lines.push(
    `\`${report.repo.base.slice(0, 12)}\` → \`${report.repo.head.slice(0, 12)}\` · ` +
      `${fail} fail · ${warn} warn · ${info} info · rules ${report.rules.map((r) => (EXPERIMENTAL.has(r) ? `${r} (experimental)` : r)).join(', ')}`,
  );
  lines.push('');
  if (report.coverage) {
    lines.push(`${incomplete(report.coverage) ? '⚠️ ' : ''}**Coverage:** ${coverageCounts(report.coverage)}`, '');
    for (const f of report.coverage.files) {
      if (f.state !== 'analysed') lines.push(`- \`${cell(f.path)}\` — ${f.state === 'partly-analysed' ? 'partly analysed' : 'not analysed'}: ${cell(f.reasons.join('; '))}`);
    }
    if (incomplete(report.coverage)) lines.push('');
  }
  if (report.not_evaluated.length > 0) {
    for (const n of report.not_evaluated) lines.push(`- **Not evaluated:** ${n.rule}${EXPERIMENTAL.has(n.rule) ? ' (experimental)' : ''} — ${cell(n.reason)}`);
    lines.push('');
  }
  const scopes = report.tool.scopes;
  if (scopes?.python_unavailable) {
    lines.push(`- **Python test files were not read:** ${cell(scopes.python_unavailable)}${scopes.python_remedy ? ` — ${cell(scopes.python_remedy)}` : ''}`, '');
  }
  if (report.unverifiable.length > 0) {
    lines.push('**Unverifiable** — the verdict cannot be OK:');
    lines.push('');
    for (const u of report.unverifiable) lines.push(`- \`${u.file}\` (${u.side}): ${u.reason}`);
    lines.push('');
  }
  if (report.findings.length === 0) {
    lines.push('No findings.');
  } else {
    lines.push('| | Rule | Location | Finding |');
    lines.push('|---|---|---|---|');
    for (const f of report.findings) {
      const at = f.line === null ? f.file : `${f.file}:${f.line}`;
      const loc = f.side === 'base' ? `${at} (base)` : at;
      // A grouped finding (src/rules/group.ts) folds its full list of tests when it is longer than the message shows.
      const folded = f.tests && f.tests.length > 5 ? ` <details><summary>${f.tests.length} tests</summary>${f.tests.map((t) => cell(t)).join('<br>')}</details>` : '';
      lines.push(`| ${ICON[f.severity]} | ${f.rule} | \`${cell(loc)}\` | ${cell(f.message)}${folded} |`);
    }
  }
  lines.push('');
  lines.push(`<sub>saidvsdid ${report.tool.version} · \`npx saidvsdid explain <RULE>\` for details</sub>`);
  return lines.join('\n') + '\n';
}

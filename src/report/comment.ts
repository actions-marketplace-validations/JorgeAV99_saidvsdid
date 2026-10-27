import { coverageCounts, incomplete } from '../coverage.js';
import { EXPERIMENTAL, type Finding, type RuleId } from '../rules/index.js';
import { verdictLabel, type Report } from './model.js';

/** The hidden line that marks saidvsdid's own PR comment, so a later run updates it instead of adding another. */
export const COMMENT_MARKER = '<!-- saidvsdid:pr-comment -->';

/** What the Action's `fail-on` input asked for: nothing fails the check, or this verdict and worse ones do. */
export type FailOn = 'none' | 'fail' | 'warn';

/** Where a finding's file and line are on GitHub, on the side of the diff it points at; null: no link. */
export type LineLink = (side: 'base' | 'head', file: string, line: number | null) => string | null;

/**
 * Where the rest of a report is when the comment cannot hold all of it: the job's artifact (its exact page, once
 * finalised), or, when it could not be uploaded, why, and what reproduces it.
 */
export type RestOfReport =
  | { kind: 'artifact'; url: string }
  | { kind: 'reproduce'; why: string; pr: number; baseSha: string; mergeBase: string; head: string; exclude: readonly string[]; version: string };

export interface CommentOptions {
  link: LineLink | null;
  failOn: FailOn;
  /** GitHub's limit for a comment is 65,536 characters; past it, the comment is bounded (renderComment). */
  maxLength?: number;
  /** The full report (the artifact's Markdown): every finding, test, file and text whole, no limit. */
  full?: boolean;
  /** Where the rest is, when the comment is bounded. */
  rest?: RestOfReport | null;
}

const ICON = { fail: '❌', warn: '⚠️', info: 'ℹ️' } as const;

/** What happened to the tests, in the order a reviewer reads it. Each rule belongs to exactly one group. */
export const GROUPS: readonly { title: string; rules: readonly RuleId[] }[] = [
  { title: 'Tests removed or replaced', rules: ['TG001'] },
  { title: 'Tests skipped, focused or marked to fail', rules: ['TG002', 'TG003'] },
  { title: 'Assertions removed or relaxed', rules: ['TG004'] },
  { title: 'Configuration, timeouts and retries changed', rules: ['TG005'] },
  { title: "The agent's claims (experimental)", rules: ['TG006', 'TG007'] },
];

/** CommonMark's line endings (LF, CRLF, a lone CR). */
const LINE_ENDING = /\r\n?|\n/g;

/** The longest text the comment shows of one message, name, path or reason, in code points, its ellipsis included. */
export const MAX_TEXT = 200;

/** At most MAX_TEXT code points: past it, the first MAX_TEXT - 1 and an ellipsis. `full`: the whole text (the full report). */
function shorten(s: string, full = false): string {
  if (full) return s;
  const points = [...s];
  return points.length > MAX_TEXT ? `${points.slice(0, MAX_TEXT - 1).join('')}…` : s;
}

/**
 * The report's text with nothing in it that a code span reads: every backtick is U+02CB (ˋ), which looks like one, so
 * no run of them can close the span or open a fence; line breaks and tabs are spaces, so it stays on its line; and it
 * is at most MAX_TEXT long (unless `full`). Never a fence sized to the text: GitHub's renderer (cmark-gfm) stops reading
 * a backtick run at 80, past which a "longer fence" is plain text (Codex, on the commit that sized them).
 */
export function sanitize(s: string, full = false): string {
  return shorten(s.replace(/`/g, 'ˋ').replace(/[\r\n\t]/g, ' '), full);
}

/**
 * The report's text in the comment: its messages, test names, paths and reasons hold the pull request's own text, which
 * the comment GitHub's token posts must never turn into HTML, a link, an image, a mention or a reference. It is never
 * read for its backticks or escaped piece by piece: the whole text, sanitised, is one code span of one backtick, the one
 * Markdown context where GitHub renders nothing (no mention, reference or autolink either). The comment has no table,
 * so a `|` stays as it is. An empty text is a span of one space: a code span cannot be empty.
 */
export function literal(s: string, full = false): string {
  const text = sanitize(s, full);
  return text === '' ? '` `' : `\`${text}\``;
}

/** The same text inside a folded list, an HTML block where Markdown is not read: <code>, with its HTML escaped. */
function htmlLiteral(s: string, full = false): string {
  return `<code>${shorten(s.replace(LINE_ENDING, ' '), full).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</code>`;
}

/**
 * A link's destination is data too (the path is the pull request's): every character but a URL's own letters, digits
 * and `-._~:/?#[]@!$&'*+,;=%` is percent-encoded, so no parenthesis, space or angle bracket ends it (CommonMark, *Links*).
 */
function destination(url: string): string {
  const bytes = new TextEncoder();
  return url.replace(/[^A-Za-z0-9\-._~:/?#[\]@!$&'*+,;=%]/gu, (c) => [...bytes.encode(c)].map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join(''));
}

/** How a body is rendered: `whole` (the comment as it is), `bounded` (it did not fit: budgets), `full` (the artifact). */
type Mode = 'whole' | 'bounded' | 'full';

function location(f: Finding, link: LineLink | null, full: boolean): string {
  // `(base)`, as the CLI prints it: the finding is about the base side (a removed test, or a side that was not read).
  const label = `${literal(f.line === null ? f.file : `${f.file}:${f.line}`, full)}${f.side === 'base' ? ' (base)' : ''}`;
  const url = link ? link(f.side, f.file, f.line) : null;
  return url ? `[${label}](${destination(url)})` : label;
}

/** The rendered characters a folded list of tests may take when the comment is bounded; the rest are counted. */
const FOLDED_BUDGET = 2_000;

function item(f: Finding, link: LineLink | null, mode: Mode): { lines: string[]; cut: boolean } {
  const full = mode === 'full';
  const out = [`- ${ICON[f.severity]} **${f.severity.toUpperCase()}** ${location(f, link, full)} — ${literal(f.message, full)} <sub>${f.rule}</sub>`];
  // A grouped finding (src/rules/group.ts) folds its full list of tests when it is longer than the message shows.
  if (f.tests && f.tests.length > 5) {
    const tests = f.tests.map((t) => htmlLiteral(t, full));
    const shown = mode === 'bounded' ? fill(tests, FOLDED_BUDGET, (n) => `and ${n} more`) : { lines: tests, cut: false };
    out.push(`  <details><summary>${f.tests.length} tests</summary>${shown.lines.join('<br>')}</details>`);
    return { lines: out, cut: shown.cut };
  }
  return { lines: out, cut: false };
}

export function gateText(failOn: FailOn): string {
  if (failOn === 'warn') return 'this check fails only on WARN or worse (`fail-on: warn`)';
  if (failOn === 'fail') return 'this check fails only on FAIL or worse (`fail-on: fail`)';
  return 'this check does not block the merge, whatever the verdict (`fail-on` not set)';
}

/**
 * Section budgets of a bounded comment, in rendered characters (escaping, link destinations and the "and N more" line
 * included); the findings get the rest, the most that fit.
 */
export const BUDGETS = { coverage: 4_000, byFile: 10_000, unverifiable: 4_000, rest: 3_000 } as const;

/** The lines that fit in `budget` characters (each with its line break), then `more(n)` for the n left out. */
function fill(lines: readonly string[], budget: number, more: (n: number) => string): { lines: string[]; cut: boolean } {
  const out: string[] = [];
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    const tail = i === lines.length - 1 ? 0 : more(lines.length - i - 1).length + 1;
    if (used + lines[i]!.length + 1 + tail > budget) {
      out.push(more(lines.length - i));
      return { lines: out, cut: true };
    }
    out.push(lines[i]!);
    used += lines[i]!.length + 1;
  }
  return { lines: out, cut: false };
}

/** A command printed only when the comment holds it exactly: no shell expansion, no character the code span changes. */
const SAFE_GLOB = /^[A-Za-z0-9._/*?{},!+=@:-]+$/;
const MAX_COMMAND = 190;

/** What reproduces the report when it could not be attached, never a partial command. */
function reproduction(r: Extract<RestOfReport, { kind: 'reproduce' }>): string[] {
  const out = [
    `The full report could not be attached (${literal(r.why)}). Reproduce it with the whole history:`,
    '',
    `1. \`git fetch origin ${r.baseSha} +refs/pull/${r.pr}/head\`, and \`git fetch --unshallow\` if the clone is shallow;`,
  ];
  // Single quotes keep each glob from the shell; the whitelist keeps the code span from changing it.
  const excludes = r.exclude.map((g) => `--exclude='${g}'`);
  const command = `npx saidvsdid@${r.version} check --exact-base --base ${r.mergeBase} --head ${r.head}${excludes.length ? ` ${excludes.join(' ')}` : ''}`;
  if (r.exclude.every((g) => SAFE_GLOB.test(g)) && [...command].length <= MAX_COMMAND) out.push(`2. \`${command}\`.`);
  else {
    out.push(
      `2. \`npx saidvsdid@${r.version} check --exact-base --base ${r.mergeBase} --head ${r.head}\` with the same \`--exclude\` globs as this workflow's \`exclude\` input (${r.exclude.length}): the exact command does not fit here.`,
    );
  }
  out.push('', `npm's saidvsdid ${r.version} has the Action's version string; a build of the Action between releases may differ from it. The Python on your machine may change Python files' results.`);
  return out;
}

/** The claim rules' "not evaluated" for want of a transcript: the Action never has one, so the footer says it once. */
const NO_TRANSCRIPT = 'no transcript or evidence (--transcript, --evidence)';

/** The body for `shown` findings in a mode; `cut` says whether anything was left out (a finding, or a capped list). */
function compose(report: Report, options: CommentOptions, mode: Mode, shown: number): { body: string; cut: boolean } {
  const full = mode === 'full';
  const lines: string[] = [COMMENT_MARKER, '### saidvsdid: what this pull request does to the tests', ''];
  let cut = false;
  // Once, before the findings: Python test files were not read, why, and how to fix it (the runner's interpreter).
  const scopes = report.tool.scopes;
  // Never shortened: the remedy is ours and must be read whole (the interpreter's path can be long); still escaped.
  if (scopes?.python_unavailable) lines.push(`⚠️ **Python test files were not read:** ${literal(scopes.python_unavailable, true)}${scopes.python_remedy ? ` — ${literal(scopes.python_remedy, true)}` : ''}`, '');
  // What was read of the changed test files (src/coverage.ts), before any finding: an OK never covers what is listed.
  if (report.coverage) {
    const c = report.coverage;
    lines.push(`${incomplete(c) ? '⚠️ ' : ''}**Coverage:** ${coverageCounts(c)}`, '');
    const partial = c.files
      .filter((f) => f.state !== 'analysed')
      .map((f) => `- ${literal(f.path, full)} — ${f.state === 'partly-analysed' ? 'partly analysed' : 'not analysed'}: ${literal(f.reasons.join('; '), full)}`);
    const listed = mode === 'bounded' ? fill(partial, BUDGETS.coverage, (n) => `- and ${n} more`) : { lines: partial, cut: false };
    cut ||= listed.cut;
    if (listed.lines.length > 0) lines.push(...listed.lines, '');
  }

  const groups = GROUPS.map((g) => ({ title: g.title, findings: report.findings.filter((f) => g.rules.includes(f.rule)) })).filter((g) => g.findings.length > 0);
  const total = report.findings.length;
  // Totals first when the list is long: by kind and by file (a bounded comment, and the full report).
  if (mode !== 'whole' && total > 0) {
    const { fail, warn, info } = report.counts;
    lines.push(`**${total} finding${total === 1 ? '' : 's'}:** ${fail} FAIL · ${warn} WARN · ${info} INFO`, '');
    for (const g of groups) lines.push(`- ${g.title}: ${g.findings.length}`);
    const perFile = new Map<string, Record<'fail' | 'warn' | 'info', number>>();
    for (const f of report.findings) {
      const n = perFile.get(f.file) ?? { fail: 0, warn: 0, info: 0 };
      n[f.severity]++;
      perFile.set(f.file, n);
    }
    const files = [...perFile].sort((a, b) => b[1].fail + b[1].warn + b[1].info - (a[1].fail + a[1].warn + a[1].info) || (a[0] < b[0] ? -1 : 1));
    const rows = files.map(([file, n]) => `${htmlLiteral(file, full)}: ${[n.fail && `${n.fail} FAIL`, n.warn && `${n.warn} WARN`, n.info && `${n.info} INFO`].filter(Boolean).join(' · ')}`);
    const open = `<details><summary>Findings by file (${files.length} file${files.length === 1 ? '' : 's'})</summary>`;
    const listed = mode === 'bounded' ? fill(rows, BUDGETS.byFile - open.length - 10, (n) => `and ${n} more file${n === 1 ? '' : 's'}`) : { lines: rows, cut: false };
    cut ||= listed.cut;
    lines.push('', `${open}${listed.lines.join('<br>')}</details>`, '');
  }

  if (groups.length === 0) lines.push(report.unverifiable.length > 0 ? 'No findings in the files that could be analysed.' : 'No findings in what saidvsdid reads.', '');
  let left = shown;
  for (const g of groups) {
    const items: string[] = [];
    for (const f of g.findings) {
      if (left > 0) {
        const it = item(f, options.link, mode);
        items.push(...it.lines);
        cut ||= it.cut;
      }
      left--;
    }
    // A group with nothing shown is not printed: its count is in the totals.
    if (items.length > 0) lines.push(`**${g.title}**`, '', ...items, '');
  }
  const hidden = total - Math.min(shown, total);
  if (hidden > 0) lines.push(`**${hidden} of ${total} findings are not shown here** (GitHub's size limit for a comment).`, '');
  cut ||= hidden > 0;
  if (report.unverifiable.length > 0) {
    lines.push('**Could not be analysed** — the verdict cannot be OK:', '');
    const rows = report.unverifiable.map((u) => `- ${literal(u.file, full)} (${u.side}): ${literal(u.reason, full)}`);
    const listed = mode === 'bounded' ? fill(rows, BUDGETS.unverifiable, (n) => `- and ${n} more`) : { lines: rows, cut: false };
    cut ||= listed.cut;
    lines.push(...listed.lines, '');
  }
  // Where the rest is, once every section has said whether it left something out.
  if (cut && mode === 'bounded' && options.rest) {
    const rest = options.rest.kind === 'artifact' ? [`The full report, every finding (Markdown and JSON), is this job's artifact: [saidvsdid report](${options.rest.url}).`] : reproduction(options.rest);
    lines.push(...fill(rest, BUDGETS.rest, () => 'The rest of the report could not be described here.').lines, '');
  }
  // One line per reason: TG006 and TG007 without a transcript read as one; that one, which the Action always has, in the footer.
  const reasons = new Map<string, RuleId[]>();
  for (const n of report.not_evaluated) reasons.set(n.reason, [...(reasons.get(n.reason) ?? []), n.rule]);
  const claimsOnly = reasons.size === 1 && reasons.has(NO_TRANSCRIPT);
  if (!claimsOnly) {
    for (const [reason, rules] of reasons) {
      const experimental = rules.every((r) => EXPERIMENTAL.has(r)) ? ' (experimental)' : '';
      lines.push(`Not evaluated: ${rules.join(', ')}${experimental} — ${literal(reason)}.`, '');
    }
  }
  const { fail, warn, info } = report.counts;
  lines.push('---', '');
  lines.push(`**Verdict: ${verdictLabel(report, { claims: !claimsOnly })}** · ${fail} fail · ${warn} warn · ${info} info — ${gateText(options.failOn)}.`, '');
  const notEvaluated = claimsOnly ? ` · ${reasons.get(NO_TRANSCRIPT)!.join(', ')} (experimental, the agent's claims): not evaluated, the Action reads no transcript` : '';
  lines.push(
    `<sub>saidvsdid ${report.tool.version} · base \`${report.repo.base.slice(0, 12)}\` → head \`${report.repo.head.slice(0, 12)}\` · ` +
      'FAIL: a fact about the code, checkable by reading it · WARN: for a human to look at · ' +
      `\`npx saidvsdid explain <RULE>\` says what each rule catches and what it does not${notEvaluated}</sub>`,
  );
  return { body: lines.join('\n') + '\n', cut };
}

/** Whether the comment holds the whole report: if not, the Action attaches it (src/action/artifact.ts). */
export function commentFits(report: Report, options: CommentOptions): boolean {
  return compose(report, options, 'whole', report.findings.length).body.length <= (options.maxLength ?? 65_000);
}

/**
 * The body of the PR comment and the job summary: what happened to the tests first, with links to the lines, then the
 * verdict. The whole report when it fits; else bounded — each section within its budget, the most findings that fit
 * (binary search: each one adds its lines, so the length grows with their number), the exact count of those not shown,
 * and where the rest is. `full`: everything, no limit (the artifact's Markdown).
 */
export function renderComment(report: Report, options: CommentOptions): string {
  const max = options.maxLength ?? 65_000;
  const total = report.findings.length;
  if (options.full) return compose(report, options, 'full', total).body;
  const whole = compose(report, options, 'whole', total).body;
  if (whole.length <= max) return whole;
  const at = (k: number): string => compose(report, options, 'bounded', k).body;
  if (at(total).length <= max) return at(total);
  let lo = 0;
  let hi = total - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (at(mid).length <= max) lo = mid;
    else hi = mid - 1;
  }
  return at(lo);
}

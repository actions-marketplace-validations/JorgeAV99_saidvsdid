// `saidvsdid baseline`: the dumb rival for the benchmark. Plain regular
// expressions over the lines of `git diff`, no syntax tree, no extractor, no
// safety net. It is deliberately what a ~100-line script would do: DO NOT
// make it smarter. Its misses and false alarms are what the real rules are
// measured against (see docs/rules.md, "baseline").
import { git, repoRoot, selectBase } from './git/diff.js';
import { EXIT_CODES, REPORT_SCHEMA_ID, verdictFor, type Report } from './report/model.js';
import type { Finding, RuleId, Severity } from './rules/index.js';
import { VERSION } from './version.js';

const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)__tests__\/|(^|\/)test_[^/]*\.py$|_test\.py$)/;
const TEST_DECL = /\b(it|test)\s*\(|^\s*def test_/;
const ONLY = /\.only\b|\bf(it|describe)\s*\(|mark\.only\b/;
const SKIP = /\.(skip|todo|fixme)\b|\bx(it|test|describe)\s*\(|mark\.(skip|skipif|xfail)\b|pytest\.(skip|xfail)\(|skipTest\(/;
const ASSERT = /\bexpect\s*\(|\bassert\b|\bassert\w*\(/g;
const TIMEOUT_LINE = /timeout|,\s*\d{4,}\s*\)\s*;?\s*$/i;

interface FileDiff {
  path: string;
  deleted: boolean;
  added: string[];
  removed: string[];
}

function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = { path: line.split(' b/').pop() ?? '', deleted: false, added: [], removed: [] };
      files.push(current);
    } else if (!current) continue;
    else if (line.startsWith('deleted file mode')) current.deleted = true;
    else if (line.startsWith('+++') || line.startsWith('---')) continue;
    else if (line.startsWith('+')) current.added.push(line.slice(1));
    else if (line.startsWith('-')) current.removed.push(line.slice(1));
  }
  return files;
}

const count = (lines: string[], re: RegExp): number => lines.filter((l) => re.test(l)).length;
const countAll = (lines: string[], re: RegExp): number => lines.reduce((n, l) => n + (l.match(re)?.length ?? 0), 0);
const maxNumber = (lines: string[]): number => Math.max(0, ...lines.filter((l) => TIMEOUT_LINE.test(l)).flatMap((l) => (l.match(/\d[\d_]*/g) ?? []).map((n) => Number(n.replace(/_/g, '')))));

export function runBaseline(options: { repo: string; base: string; head: string; exactBase?: boolean }): Report {
  const repo = repoRoot(options.repo);
  // The same commits `check` compares (src/git/diff.ts, selectBase): the rival is benchmarked on the same diff.
  const { base, head, baseRef } = selectBase(repo, options.base, options.head, options.exactBase ?? false);
  const diff = git(repo, ['diff', '--no-ext-diff', '--no-color', '--unified=0', base, head, '--']);
  const findings: Finding[] = [];
  const add = (rule: RuleId, severity: Severity, file: string, message: string): void => {
    findings.push({ rule, severity, file, side: 'head', line: null, test: null, message });
  };
  const files = parseDiff(diff).filter((f) => TEST_FILE.test(f.path));
  for (const f of files) {
    if (f.deleted) {
      add('TG001', 'fail', f.path, 'Test file deleted');
      continue;
    }
    const removedTests = count(f.removed, TEST_DECL) - count(f.added, TEST_DECL);
    if (removedTests > 0) add('TG001', 'fail', f.path, `${removedTests} test declaration(s) removed`);
    if (count(f.added, ONLY) > count(f.removed, ONLY)) add('TG002', 'fail', f.path, 'Focus marker added (.only / fit / fdescribe)');
    if (count(f.added, SKIP) > count(f.removed, SKIP)) add('TG003', 'fail', f.path, 'Skip marker added (.skip / xit / skip / xfail / todo)');
    const lostAsserts = countAll(f.removed, ASSERT) - countAll(f.added, ASSERT);
    if (lostAsserts > 0) add('TG004', 'warn', f.path, `${lostAsserts} fewer expect/assert`);
    const before = maxNumber(f.removed);
    const after = maxNumber(f.added);
    if (before > 0 && after >= before * 3) add('TG005', 'warn', f.path, `Timeout raised from ${before} to ${after}`);
  }
  const verdict = verdictFor(findings, []);
  const counts: Record<Severity, number> = { fail: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return {
    schema: REPORT_SCHEMA_ID,
    tool: { name: 'saidvsdid', version: VERSION },
    repo: { base, head, ...(baseRef ? { base_ref: baseRef } : {}) },
    mode: 'diff',
    rules: ['TG001', 'TG002', 'TG003', 'TG004', 'TG005'],
    not_evaluated: [],
    verdict,
    exit_code: EXIT_CODES[verdict],
    counts,
    unverifiable: [],
    files: files.map((f) => ({ path: f.path, base_path: f.path, base_tests: 0, head_tests: 0, parse_errors: false })),
    findings: findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.rule < b.rule ? -1 : 1)),
  };
}

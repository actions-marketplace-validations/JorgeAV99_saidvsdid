// A comment past GitHub's limit (65,536 characters) is bounded, never rejected: the whole report when it fits; else each
// section within its budget, the most findings that fit, the exact count of those not shown, and where the rest is (the
// job's artifact, or what reproduces it). The full report (the artifact's Markdown) shortens nothing.
import { describe, expect, it } from 'vitest';
import type { Coverage } from '../src/coverage.js';
import { BUDGETS, commentFits, renderComment, type RestOfReport } from '../src/report/comment.js';
import { REPORT_SCHEMA_ID, type Report } from '../src/report/model.js';
import type { Finding } from '../src/rules/index.js';

const SHA = (c: string): string => c.repeat(40);

function report(findings: Finding[], extra: Partial<Report> = {}): Report {
  const counts = { fail: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return {
    schema: REPORT_SCHEMA_ID,
    tool: { name: 'saidvsdid', version: '0.3.0' },
    repo: { base: SHA('a'), head: SHA('b') },
    mode: 'diff',
    rules: ['TG001', 'TG002', 'TG003', 'TG004', 'TG005'],
    not_evaluated: [],
    verdict: counts.fail > 0 ? 'FAIL' : counts.warn > 0 ? 'WARN' : 'OK',
    exit_code: counts.fail > 0 ? 2 : counts.warn > 0 ? 1 : 0,
    counts,
    unverifiable: [],
    files: [],
    findings,
    ...extra,
  };
}

/** 760 findings like the audit's playground pull request 4: 600 skips in 40 files, 150 removed tests, 150 assertions. */
function huge(): Finding[] {
  const out: Finding[] = [];
  for (let m = 1; m <= 40; m++) for (let t = 1; t <= 15; t++) out.push({ rule: 'TG003', severity: 'fail', file: `src/module_${m}.test.js`, side: 'head', line: t * 5, test: null, message: `Adds \`it.skip\` (skip, unconditional) to test "module ${m} > case ${t} of module ${m} computes the expected value"` });
  for (let m = 41; m <= 50; m++) out.push({ rule: 'TG001', severity: 'fail', file: `src/module_${m}.test.js`, side: 'base', line: null, test: null, message: `Deletes the test file, which declared 15 tests`, tests: Array.from({ length: 15 }, (_, i) => `module ${m} > case ${i + 1}`) });
  for (let m = 51; m <= 60; m++) for (let t = 1; t <= 15; t++) out.push({ rule: 'TG004', severity: 'warn', file: `src/module_${m}.test.js`, side: 'head', line: t * 5, test: null, message: `Removes 1 of 2 assertion calls from "module ${m} > case ${t}"; it may check less` });
  return out;
}

const shownItems = (body: string): number => body.split('\n').filter((l) => /^- (❌|⚠️|ℹ️) \*\*/.test(l)).length;
const ARTIFACT: RestOfReport = { kind: 'artifact', url: 'https://github.com/octo/demo/actions/runs/42/artifacts/9001' };

describe('a comment that fits is the whole report', () => {
  it('no totals, no omission line, every coverage file listed even past the bounded budget', () => {
    const files = Array.from({ length: 300 }, (_, i) => ({ path: `pkg/calc_${i}_test.go`, base_path: null, state: 'not-analysed' as const, reasons: ['head: Go, a language saidvsdid does not read'] }));
    const coverage: Coverage = { analysed: 0, partly_analysed: 0, not_analysed: 300, excluded: 0, files };
    const r = report([], { coverage });
    const body = renderComment(r, { link: null, failOn: 'none', rest: ARTIFACT });
    expect(commentFits(r, { link: null, failOn: 'none' })).toBe(true);
    expect(body.split('\n').filter((l) => l.startsWith('- `pkg/calc_')).length).toBe(300);
    expect(body).not.toContain('not shown here');
    expect(body).not.toContain('artifact');
    expect(files.map((f) => `- \`${f.path}\` — not analysed: \`head: Go, a language saidvsdid does not read\``).join('\n').length).toBeGreaterThan(BUDGETS.coverage);
  });
});

describe('a comment that does not fit is bounded', () => {
  const r = report(huge());
  const options = { link: (side: 'base' | 'head', file: string, line: number | null) => `https://github.com/octo/demo/blob/${side === 'base' ? SHA('a') : SHA('b')}/${file}${line === null ? '' : `#L${line}`}`, failOn: 'none' as const, rest: ARTIFACT };
  const body = renderComment(r, options);

  it('fits, with the totals by kind and by file on top', () => {
    expect(commentFits(r, { link: null, failOn: 'none' })).toBe(false);
    expect(body.length).toBeLessThanOrEqual(65_000);
    expect(body).toContain('**760 findings:** 610 FAIL · 150 WARN · 0 INFO');
    expect(body).toContain('- Tests skipped, focused or marked to fail: 600');
    expect(body).toContain('- Tests removed or replaced: 10');
    expect(body).toContain('- Assertions removed or relaxed: 150');
    expect(body).toContain('<details><summary>Findings by file (60 files)</summary>');
    expect(body.indexOf('**760 findings:**')).toBeLessThan(body.indexOf('**Tests skipped, focused or marked to fail**'));
  });

  it('says exactly how many findings it does not show, and the shown ones are a prefix', () => {
    const shown = shownItems(body);
    expect(shown).toBeGreaterThan(0);
    expect(body).toContain(`**${760 - shown} of 760 findings are not shown here** (GitHub's size limit for a comment).`);
  });

  it('shows the most that fit: one more would not', () => {
    const shown = shownItems(body);
    // With room for exactly this body, the search finds the same number; with one character less, fewer.
    expect(shownItems(renderComment(r, { ...options, maxLength: body.length }))).toBe(shown);
    expect(shownItems(renderComment(r, { ...options, maxLength: body.length - 1 }))).toBeLessThan(shown);
  });

  it('prints no group with nothing shown', () => {
    // The 600 skips come first in the order a reviewer reads (removed, then marked); assertions may not be reached.
    if (!/- ⚠️ \*\*WARN\*\*/.test(body)) expect(body).not.toContain('**Assertions removed or relaxed**');
  });

  it('links the exact artifact, and nothing else of the run', () => {
    expect(body).toContain("is this job's artifact: [saidvsdid report](https://github.com/octo/demo/actions/runs/42/artifacts/9001).");
    expect(body.match(/actions\/runs/g)).toHaveLength(1);
  });
});

describe('every section within its budget, whatever it holds', () => {
  it('the worst case of every section at once stays under the limit', () => {
    const nasty = (i: number): string => `${'"&<'.repeat(60)}${i}`.slice(0, 200);
    const coverage: Coverage = { analysed: 0, partly_analysed: 0, not_analysed: 400, excluded: 0, files: Array.from({ length: 400 }, (_, i) => ({ path: `${nasty(i)}_test.go`, base_path: null, state: 'not-analysed' as const, reasons: [nasty(i)] })) };
    const unverifiable = Array.from({ length: 1200 }, (_, i) => ({ file: `${nasty(i)}.test.js`, side: 'head' as const, reason: 'syntax errors; test extraction may be incomplete' }));
    const findings: Finding[] = Array.from({ length: 300 }, (_, i) => ({ rule: 'TG003', severity: 'fail', file: `${nasty(i)}.test.js`, side: 'head', line: 1, test: null, message: nasty(i), tests: Array.from({ length: 200 }, (_, t) => nasty(t)) }));
    const r = report(findings, { coverage, unverifiable, verdict: 'UNVERIFIABLE', exit_code: 3 });
    const body = renderComment(r, { link: (_s, file) => `https://github.com/octo/demo/blob/${SHA('b')}/${encodeURIComponent(file)}`, failOn: 'none', rest: ARTIFACT });
    expect(body.length).toBeLessThanOrEqual(65_000);
    expect(body).toContain('**Verdict: UNVERIFIABLE**');
    expect(body).toContain('⚠️ **Coverage:** 0 test files analysed · 400 not analysed');
    expect(body).toMatch(/- and \d+ more\n/);
    expect(body).toMatch(/<br>and \d+ more<\/details>/);
    // Every folded list within its own budget: the findings still get most of the room.
    expect(shownItems(body)).toBeGreaterThan(5);
  });
});

describe('when the report could not be attached, what reproduces it — never a partial command', () => {
  const base = { kind: 'reproduce' as const, why: 'upload: HTTP 500', pr: 7, baseSha: SHA('c'), mergeBase: SHA('a'), head: SHA('b'), version: '0.3.0' };
  const bounded = (rest: RestOfReport): string => renderComment(report(huge()), { link: null, failOn: 'none', rest });

  it('fetches the pull request head explicitly, then the exact command with each glob single-quoted', () => {
    const body = bounded({ ...base, exclude: ['fixtures/**', 'src/report/*.ts'] });
    expect(body).toContain('The full report could not be attached (`upload: HTTP 500`).');
    expect(body).toContain(`\`git fetch origin ${SHA('c')} +refs/pull/7/head\``);
    expect(body).toContain(`\`npx saidvsdid@0.3.0 check --exact-base --base ${SHA('a')} --head ${SHA('b')} --exclude='fixtures/**' --exclude='src/report/*.ts'\``);
    expect(body).toContain("npm's saidvsdid 0.3.0 has the Action's version string; a build of the Action between releases may differ from it.");
  });

  it("a glob it cannot print exactly: no command with it, the workflow's input named instead", () => {
    const body = bounded({ ...base, exclude: ["it's here/**"] });
    expect(body).not.toContain("--exclude='");
    expect(body).toContain("with the same `--exclude` globs as this workflow's `exclude` input (1): the exact command does not fit here.");
  });

  it('too many globs for one line: the same', () => {
    const body = bounded({ ...base, exclude: Array.from({ length: 20 }, (_, i) => `fixtures/case-${i}/**`) });
    expect(body).not.toContain("--exclude='");
    expect(body).toContain("`exclude` input (20)");
  });
});

describe('the full report', () => {
  it('shortens nothing and caps nothing', () => {
    const long = 'x'.repeat(500);
    const r = report([{ rule: 'TG003', severity: 'fail', file: `${long}.test.js`, side: 'head', line: 1, test: null, message: long, tests: Array.from({ length: 80 }, (_, i) => `t${i}`) }]);
    const full = renderComment(r, { link: null, failOn: 'none', full: true });
    expect(full).toContain(`\`${long}\``);
    expect(full).toContain('<code>t79</code>');
    expect(full).not.toContain('…');
  });
});

describe('Codex, round 1 of the code review', () => {
  it('a comment where only the list of files that could not be analysed is capped still says where the rest is', () => {
    const findings: Finding[] = Array.from({ length: 261 }, (_, i) => ({ rule: 'TG003', severity: 'fail', file: `src/f${i}.test.js`, side: 'head', line: 1, test: null, message: `Adds \`it.skip\` (skip, unconditional) to test "case ${i} ${'x'.repeat(120)}"` }));
    const unverifiable = Array.from({ length: 50 }, (_, i) => ({ file: `src/broken_${i}_${'y'.repeat(150)}.test.js`, side: 'head' as const, reason: 'syntax errors; test extraction may be incomplete' }));
    const r = report(findings, { unverifiable, verdict: 'UNVERIFIABLE', exit_code: 3 });
    const body = renderComment(r, { link: null, failOn: 'none', rest: ARTIFACT });
    expect(body.length).toBeLessThanOrEqual(65_000);
    expect(body).toMatch(/- and \d+ more\n/);
    expect(body).toContain("is this job's artifact: [saidvsdid report](https://github.com/octo/demo/actions/runs/42/artifacts/9001).");
  });

  // The independent review of the fix: in the case above the size limit also hides findings, which already marked the
  // comment as cut before the list, so the old order printed the pointer too. Here every finding is shown and the list
  // of files that could not be analysed is the only thing capped.
  it('every finding shown, only the list of files that could not be analysed capped: the pointer is still there', () => {
    const findings: Finding[] = Array.from({ length: 3 }, (_, i) => ({ rule: 'TG003', severity: 'fail', file: `src/f${i}.test.js`, side: 'head', line: 1, test: null, message: `Adds \`it.skip\` (skip, unconditional) to test "case ${i}"` }));
    const unverifiable = Array.from({ length: 400 }, (_, i) => ({ file: `src/broken_${i}_${'y'.repeat(180)}.test.js`, side: 'head' as const, reason: 'syntax errors; test extraction may be incomplete' }));
    const r = report(findings, { unverifiable, verdict: 'UNVERIFIABLE', exit_code: 3 });
    expect(commentFits(r, { link: null, failOn: 'none' })).toBe(false);
    const body = renderComment(r, { link: null, failOn: 'none', rest: ARTIFACT });
    expect(body.length).toBeLessThanOrEqual(65_000);
    expect(shownItems(body)).toBe(3);
    expect(body).not.toContain('not shown here');
    expect(body).toMatch(/- and \d+ more\n/);
    expect(body).toContain("is this job's artifact: [saidvsdid report](https://github.com/octo/demo/actions/runs/42/artifacts/9001).");
  });

  it("the Python notice is never shortened, in the comment or in the full report: the diagnostic and the remedy are read whole", () => {
    const path = `/opt/${'very-long-directory-name/'.repeat(8)}bin/python3`;
    const unavailable = `Python 3.10.12 (${path}) is older than 3.11, the oldest saidvsdid reads`;
    const remedy = `on GitHub Actions, add actions/setup-python with python-version 3.11 or later before saidvsdid; elsewhere, change SAIDVSDID_PYTHON (now ${JSON.stringify(path)}) to one`;
    expect(unavailable.length).toBeGreaterThan(200);
    expect(remedy.length).toBeGreaterThan(200);
    const r = report([], { tool: { name: 'saidvsdid', version: '0.3.0', scopes: { typescript: '5.9.3', python: null, python_unavailable: unavailable, python_remedy: remedy } } });
    for (const full of [false, true]) {
      const body = renderComment(r, { link: null, failOn: 'none', full });
      expect(body).toContain(`⚠️ **Python test files were not read:** \`${unavailable}\``);
      expect(body).toContain(`\`${remedy}\``);
    }
  });
});

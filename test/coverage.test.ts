// What the check read of the changed test files (src/coverage.ts, docs/rules.md *Coverage*): an OK never sounds like a
// guarantee when a changed test file was read in part or not at all (the 0.2.0 audit: a Go pull request that adds
// `t.Skip` got the same "OK — no issues found" as a docs-only one).
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/check.js';
import { foreignTestLanguage, unreadLibraryOf } from '../src/coverage.js';
import type { FileChange } from '../src/git/diff.js';
import { verdictLabel } from '../src/report/model.js';
import { renderText } from '../src/report/text.js';
import { renderComment } from '../src/report/comment.js';

type Files = Record<string, string>;

async function check(base: Files, head: Files, exclude: string[] = []) {
  const paths = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();
  const changes: FileChange[] = paths
    .filter((p) => base[p] !== head[p])
    .map((p) => ({ status: !(p in base) ? 'A' : !(p in head) ? 'D' : 'M', basePath: p in base ? p : null, headPath: p in head ? p : null }));
  return analyze({ base: '0'.repeat(40), head: '1'.repeat(40), changes, read: (side, p) => (side === 'base' ? base : head)[p] ?? null, exclude });
}

const VITEST = (body: string): string => `import { describe, it, expect } from 'vitest'\n\ndescribe('s', () => {\n${body}\n})\n`;
const GO_BASE = 'package calc\n\nimport "testing"\n\nfunc TestSum(t *testing.T) {}\n\nfunc TestZero(t *testing.T) {}\n';
const GO_HEAD = 'package calc\n\nimport "testing"\n\nfunc TestSum(t *testing.T) {\n\tt.Skip("flaky")\n}\n';

describe('the OK says what it covers', () => {
  it('a Go test changed: not analysed, never "no issues found"', async () => {
    const r = await check({ 'calc_test.go': GO_BASE }, { 'calc_test.go': GO_HEAD });
    expect(r.verdict).toBe('OK');
    expect(r.coverage).toMatchObject({ analysed: 0, partly_analysed: 0, not_analysed: 1, files: [{ path: 'calc_test.go', state: 'not-analysed', reasons: ['base and head: Go, a language saidvsdid does not read'] }] });
    expect(verdictLabel(r)).toBe('OK — no findings in what it read; 1 test file partly analysed or not analysed (0 test files analysed · 1 not analysed)');
    const comment = renderComment(r, { link: null, failOn: 'none' });
    expect(comment).toContain('⚠️ **Coverage:** 0 test files analysed · 1 not analysed');
    expect(comment).toContain('- `calc_test.go` — not analysed: `base and head: Go, a language saidvsdid does not read`');
    expect(comment.indexOf('**Coverage:**')).toBeLessThan(comment.indexOf('**Verdict'));
    expect(renderText(r)).toContain('not analysed: calc_test.go — base and head: Go');
  });

  it('a docs-only pull request: no test files detected, a different text from both', async () => {
    const r = await check({ 'README.md': 'a\n' }, { 'README.md': 'b\n' });
    expect(verdictLabel(r)).toBe('OK — no test files detected in the selected scope');
  });

  it('every changed test file analysed: the plain OK, and the comment still counts them', async () => {
    const r = await check({ 'a.test.js': VITEST("  it('a', () => { expect(1).toBe(1) })") }, { 'a.test.js': VITEST("  it('a', () => { expect(2).toBe(2) })") });
    expect(r.coverage).toMatchObject({ analysed: 1, partly_analysed: 0, not_analysed: 0 });
    expect(verdictLabel(r)).toBe('OK — no issues found (TG006, TG007 not evaluated)');
    expect(renderComment(r, { link: null, failOn: 'none' })).toContain('**Coverage:** 1 test file analysed\n');
  });

  it('a mixed pull request with findings still says what it did not read', async () => {
    const r = await check(
      { 'a.test.js': VITEST("  it('a', () => { expect(1).toBe(1) })\n  it('b', () => { expect(1).toBe(1) })"), 'calc_test.go': GO_BASE },
      { 'a.test.js': VITEST("  it('a', () => { expect(1).toBe(1) })\n  it.skip('b', () => { expect(1).toBe(1) })"), 'calc_test.go': GO_HEAD },
    );
    expect(r.verdict).toBe('FAIL');
    expect(r.coverage).toMatchObject({ analysed: 1, not_analysed: 1 });
    expect(renderComment(r, { link: null, failOn: 'none' })).toContain('⚠️ **Coverage:** 1 test file analysed · 1 not analysed');
  });

  it('an excluded path is counted, not analysed and not hidden', async () => {
    const r = await check({ 'fixtures/x.test.js': VITEST("  it('a', () => {})") }, { 'fixtures/x.test.js': VITEST("  it.skip('a', () => {})") }, ['fixtures/**']);
    expect(r.coverage).toMatchObject({ analysed: 0, excluded: 1, files: [] });
    expect(verdictLabel(r)).toBe('OK — no test files detected in the selected scope (1 changed path excluded)');
  });
});

describe('partly analysed: a runner or a library saidvsdid does not read', () => {
  it('AVA under another name: no test recognised, partly analysed (the import says why)', async () => {
    const src = (a: string): string => `import check from 'ava'\n\ncheck('x', (t) => {\n  t.is(1, 1)\n${a}})\n`;
    const r = await check({ 'x.test.js': src('  t.truthy(true)\n') }, { 'x.test.js': src('') });
    expect(r.verdict).toBe('OK');
    expect(r.coverage?.files).toEqual([{ path: 'x.test.js', base_path: 'x.test.js', state: 'partly-analysed', reasons: ['base and head: it imports ava, a test library saidvsdid does not read'] }]);
  });

  it('bun:test: partly analysed', async () => {
    const src = (m: string): string => `import { test, expect } from 'bun:test'\n\ntest${m}('x', () => { expect(1).toBe(1) })\n`;
    const r = await check({ 'x.test.ts': src('') }, { 'x.test.ts': src('.skip') });
    expect(r.coverage?.files[0]).toMatchObject({ state: 'partly-analysed' });
  });

  it("Jest's globals: partly analysed, with the binding's reason", async () => {
    const src = (b: string): string => `describe('s', () => {\n  it('x', () => { expect(${b}).toBe(1) })\n})\n`;
    const r = await check({ 'x.test.js': src('1') }, { 'x.test.js': src('2') });
    expect(r.coverage?.files[0]).toMatchObject({ state: 'partly-analysed', reasons: [expect.stringMatching(/^base and head: a runner saidvsdid is not certain of \(.*global/)] });
  });
});

describe('two sides, one state', () => {
  it('a clean head never erases an incomplete base: syntax errors at base', async () => {
    const r = await check({ 'a.test.js': VITEST("  it('a', () => {") }, { 'a.test.js': VITEST("  it('a', () => { expect(1).toBe(1) })") });
    expect(r.coverage?.files[0]).toMatchObject({ state: 'not-analysed', reasons: ['base: syntax errors'] });
  });

  it('a rename from .js to .go is classified by each side', async () => {
    const r = await analyze({
      base: '0'.repeat(40),
      head: '1'.repeat(40),
      changes: [{ status: 'R', basePath: 'a.test.js', headPath: 'a_test.go' }],
      read: (side, p) => (side === 'base' && p === 'a.test.js' ? VITEST("  it('a', () => {})") : side === 'head' && p === 'a_test.go' ? GO_BASE : null),
    });
    expect(r.coverage?.files).toEqual([{ path: 'a_test.go', base_path: 'a.test.js', state: 'not-analysed', reasons: ['head: Go, a language saidvsdid does not read'] }]);
  });

  it('an added file has no base side to count', async () => {
    const r = await check({}, { 'calc_test.go': GO_HEAD });
    expect(r.coverage?.files[0]?.reasons).toEqual(['head: Go, a language saidvsdid does not read']);
  });
});

describe('the closed tables', () => {
  it.each([
    ['calc_test.go', 'Go'],
    ['spec/user_spec.rb', 'Ruby'],
    ['test/user_test.rb', 'Ruby'],
    ['tests/integration.rs', 'Rust'],
    ['crates/x/tests/a/b.rs', 'Rust'],
    ['src/FooTest.java', 'Java'],
    ['src/FooTests.kt', 'Kotlin'],
    ['Foo.Tests/FooTests.cs', 'C#'],
    ['tests/FooTest.php', 'PHP'],
    ['test/foo_test.exs', 'Elixir'],
    ['Tests/FooTests.swift', 'Swift'],
    ['test/foo_test.dart', 'Dart'],
    ['src/foo_test.cc', 'C/C++'],
    ['test/cli.bats', 'Bats'],
  ])('%s is a %s test file', (path, language) => {
    expect(foreignTestLanguage(path)).toBe(language);
  });

  it.each(['src/lib.rs', 'src/Contests.java', 'calc.go', 'src/a.test.js', 'tests/test_a.py'])('%s is not in the table', (path) => {
    expect(foreignTestLanguage(path)).toBeNull();
  });

  it.each([
    ["import test from 'ava'", 'ava'],
    ['const tap = require("tap")', 'tap'],
    ["import { test } from 'bun:test'", 'bun:test'],
    ["import 'mocha'", 'mocha'],
    ["import x from 'avalanche'", null],
    ["import { test } from 'vitest'", null],
  ])('%s → %s', (source, library) => {
    expect(unreadLibraryOf(source)).toBe(library);
  });
});

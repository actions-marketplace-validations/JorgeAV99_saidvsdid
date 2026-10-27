import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CASES_DIR, SESSIONS_DIR, buildFixtureRepo, caseEvidence, listCases } from '../fixtures/build.js';
import { git } from '../src/git/diff.js';
import { main } from '../src/cli.js';
import { VERSION } from '../src/version.js';

const workdir = mkdtempSync(join(tmpdir(), 'saidvsdid-cli-'));
let repo = '';

beforeAll(() => {
  repo = buildFixtureRepo(join(CASES_DIR, 'TG001', 'deleted-test-file'), join(workdir, 'repo')).repo;
});
afterAll(() => rmSync(workdir, { recursive: true, force: true }));

async function run(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { stdout: (t) => (out += t), stderr: (t) => (err += t), cwd: repo });
  return { code, out, err };
}

describe('cli', () => {
  it('prints the version', async () => {
    expect(await run('--version')).toEqual({ code: 0, out: `${VERSION}\n`, err: '' });
  });

  it('check exits 2 on FAIL and renders every format', async () => {
    const text = await run('check', '--base', 'HEAD~1');
    expect(text.code).toBe(2);
    expect(text.out).toContain('FAIL  TG001  tests/test_parser.py (base)');
    expect(text.out).toContain('Verdict: FAIL (1 fail, 0 warn, 0 info) — exit 2');

    const json = await run('check', '--base', 'HEAD~1', '--format', 'json');
    const report = JSON.parse(json.out) as { verdict: string; exit_code: number; findings: unknown[] };
    expect(report).toMatchObject({ schema: 'saidvsdid/report/v1', verdict: 'FAIL', exit_code: 2 });
    expect(report.findings).toHaveLength(1);

    const md = await run('check', '--base', 'HEAD~1', '--format', 'md');
    expect(md.out).toContain('### saidvsdid: **FAIL**');
    expect(md.out).toContain('| ❌ | TG001 | `tests/test_parser.py (base)` |');
  });

  it('check output is deterministic', async () => {
    const a = await run('check', '--base', 'HEAD~1', '--format', 'json');
    const b = await run('check', '--base', 'HEAD~1', '--format', 'json');
    expect(a.out).toBe(b.out);
  });

  it('--rules restricts the rules that run', async () => {
    const r = await run('check', '--base', 'HEAD~1', '--rules', 'tg002,TG003');
    expect(r.code).toBe(0);
    expect(r.out).toContain('rules: TG002, TG003');
  });

  it('--exclude drops matching paths', async () => {
    const r = await run('check', '--base', 'HEAD~1', '--exclude', 'tests/**');
    expect(r.code).toBe(0);
    expect(r.out).toContain('0 test files analysed · 1 changed path excluded');
  });

  it('--output writes the report to a file', async () => {
    const path = join(workdir, 'report.md');
    const r = await run('check', '--base', 'HEAD~1', '--format', 'md', '--output', path);
    expect(r).toMatchObject({ code: 2, out: '' });
    expect(readFileSync(path, 'utf8')).toContain('**FAIL**');
  });

  it.each([
    [['check'], /--base <ref> is required/],
    [['check', '--base', 'does-not-exist'], /"does-not-exist" is not a commit in this clone \(git fetch it\?\)/],
    [['check', '--base', 'HEAD', '--repo', tmpdir()], /is not inside a git repository: run saidvsdid in a clone, or pass --repo <dir>/],
    [['check', '--base', 'HEAD~1', '--format', 'xml'], /--format must be text, json or md/],
    [['check', '--base', 'HEAD~1', '--rules', 'TG999'], /unknown rule "TG999"/],
    [['check', '--base', 'HEAD~1', '--bogus'], /Unknown option '--bogus'/],
    [['check', '--base', 'HEAD~1', '--evidence', 'a.json', '--transcript', 'b.jsonl'], /use --evidence or --transcript, not both/],
    [['check', '--base', 'HEAD~1', '--agent', 'cursor'], /--agent must be auto, claude or codex/],
    [['check', '--base', 'HEAD~1', '--f2p-timeout', '0'], /--f2p-timeout must be a positive number/],
    [['run', 'npm', 'test'], /expected `saidvsdid run \[--output <file>\] -- <command...>`/],
    [['evidence', 'from-transcript'], /expected exactly one <transcript> file/],
    [['frobnicate'], /unknown command "frobnicate"/],
    [['explain', 'TG999'], /unknown rule "TG999"/],
  ])('%j exits 3 with a clear error', async (argv, message) => {
    const r = await run(...argv);
    expect(r.code).toBe(3);
    expect(r.err).toMatch(message);
  });

  it('check --transcript builds the evidence from a real transcript', async () => {
    const c = join(CASES_DIR, 'TG006', 'claude-no-run');
    const repoDir = buildFixtureRepo(c, join(workdir, 'no-run'), 'claude-honest').repo;
    let out = '';
    const code = await main(['check', '--base', 'HEAD~1', '--transcript', join(c, 'transcript.jsonl')], { stdout: (t) => (out += t), stderr: () => {}, cwd: repoDir });
    // Edits and no test run: a warning for the reviewer, described as a fact.
    expect(code).toBe(1);
    expect(out).toContain('WARN  TG006  transcript.jsonl');
    expect(out).toContain('The agent said "All 6 tests pass."; no test run visible');
  });

  it('transcript mode never says PASS: nothing above INFO is "OK — no issues found (claims not verified)", exit 0', async () => {
    const c = join(CASES_DIR, 'TG006', 'claude-honest');
    const repoDir = buildFixtureRepo(c, join(workdir, 'honest'), 'claude-honest').repo;
    for (const format of ['text', 'md', 'json'] as const) {
      let out = '';
      const code = await main(['check', '--base', 'HEAD~1', '--format', format, '--transcript', join(SESSIONS_DIR, 'claude-honest', 'transcript.jsonl')], { stdout: (t) => (out += t), stderr: () => {}, cwd: repoDir });
      expect(code).toBe(0);
      expect(out).not.toMatch(/\bPASS\b/);
      if (format === 'text') expect(out).toContain('Verdict: OK — no issues found (claims not verified)');
      if (format === 'md') expect(out).toContain('### saidvsdid: **OK** — no issues found (claims not verified)');
      if (format === 'json') expect(JSON.parse(out)).toMatchObject({ verdict: 'OK', exit_code: 0 });
    }
    // The claim rules are marked experimental.
    let out = '';
    await main(['check', '--base', 'HEAD~1', '--transcript', join(SESSIONS_DIR, 'claude-honest', 'transcript.jsonl')], { stdout: (t) => (out += t), stderr: () => {}, cwd: repoDir });
    expect(out).toContain('TG006 (experimental), TG007 (experimental)');
    // Without a transcript, a clean diff is OK, never a PASS, and TG006/TG007 are not evaluated (not among the rules).
    for (const format of ['text', 'md', 'json'] as const) {
      out = '';
      expect(await main(['check', '--base', 'HEAD~1', '--format', format], { stdout: (t) => (out += t), stderr: () => {}, cwd: repoDir })).toBe(0);
      expect(out).not.toMatch(/\bPASS\b/);
      if (format === 'text') {
        expect(out).toContain('rules: TG001, TG002, TG003, TG004, TG005 ·');
        expect(out).toContain('not evaluated: TG006 (experimental) — no transcript or evidence (--transcript, --evidence)');
        expect(out).toContain('Verdict: OK — no issues found (TG006, TG007 not evaluated)');
      }
      if (format === 'md') expect(out).toContain('### saidvsdid: **OK** — no issues found (TG006, TG007 not evaluated)');
      if (format === 'json') {
        expect(JSON.parse(out)).toMatchObject({ verdict: 'OK', exit_code: 0, mode: 'diff', rules: ['TG001', 'TG002', 'TG003', 'TG004', 'TG005'] });
        expect(JSON.parse(out).not_evaluated.map((n: { rule: string }) => n.rule)).toEqual(['TG006', 'TG007']);
      }
    }
  });

  it('check --evidence: never a PASS, even with a green recorder run on head; evidence about other code is not evaluated', async () => {
    const cases = listCases();
    const runWith = async (name: string): Promise<{ code: number; out: string }> => {
      const c = cases.find((x) => x.id === `TG006/${name}`)!;
      const built = buildFixtureRepo(c.dir, join(workdir, name), c.session, c.links);
      const file = join(workdir, `${name}.json`);
      writeFileSync(file, caseEvidence(c, built)!);
      let out = '';
      const code = await main(['check', '--base', 'HEAD~1', '--evidence', file], { stdout: (t) => (out += t), stderr: () => {}, cwd: built.repo });
      return { code, out };
    };
    const onHead = await runWith('evidence-on-head-tree');
    expect(onHead.code).toBe(0);
    expect(onHead.out).toContain('Verdict: OK — no issues found (claims not verified)');
    expect(onHead.out).not.toMatch(/\bPASS\b|\bverified by\b|\bbacked by\b/);
    const other = await runWith('evidence-head-mismatch');
    expect(other.code).toBe(1);
    expect(other.out).toContain('not evaluated: TG006 (experimental) — the evidence is not about the reviewed code: its repo.head 999999999999 is not the reviewed head');
    expect(other.out).not.toMatch(/\bPASS\b/);
  });

  it('evidence from-transcript prints evidence/v2; --strict rejects content the adapter does not know', async () => {
    const good = await run('evidence', 'from-transcript', join(SESSIONS_DIR, 'codex-honest', 'transcript.jsonl'));
    expect(good.code).toBe(0);
    const evidence = JSON.parse(good.out) as { schema: string; claims: { kind: string }[]; runs: { exit_code: number | null }[] };
    expect(evidence.schema).toBe('evidence/v2');
    expect(evidence.claims.map((c) => c.kind)).toEqual(['suite_passed', 'regression_test_added']);
    expect(evidence.runs.map((r) => r.exit_code)).toEqual([1, 0]);

    const unknown = join(CASES_DIR, 'TG006', 'codex-unknown-item', 'transcript.jsonl');
    const lenient = await run('evidence', 'from-transcript', unknown);
    expect(lenient.code).toBe(0);
    expect(JSON.parse(lenient.out)).toMatchObject({ transcript: { complete: false } });
    expect(lenient.err).toContain('unknown item type "patch_review"');
    const strict = await run('evidence', 'from-transcript', '--strict', unknown);
    expect(strict.code).toBe(3);
    expect(strict.err).toMatch(/transcript has unrecognised content .*\n\s+unknown item type "patch_review"/);

    const notTranscript = join(workdir, 'plain.jsonl');
    writeFileSync(notTranscript, '{"hello":"world"}\n');
    expect((await run('evidence', 'from-transcript', notTranscript)).err).toMatch(/not a Claude Code or Codex transcript/);
  });

  it('run records the exit status and the tree of the working copy, and exits with the command', async () => {
    const out = join(workdir, 'run-evidence.json');
    const r = await run('run', '--output', out, '--', 'node', '-e', 'console.log("Tests  3 passed (3)"); process.exit(4)');
    expect(r.code).toBe(4);
    expect(r.out).toContain('Tests  3 passed (3)');
    const evidence = JSON.parse(readFileSync(out, 'utf8')) as { runs: { exit_code: number; recognized: boolean; tree_sha: string; source: string }[]; repo: { head: string } };
    expect(evidence.runs).toHaveLength(1);
    expect(evidence.runs[0]).toMatchObject({ exit_code: 4, recognized: false, source: 'wrapper' });
    expect(evidence.runs[0]!.tree_sha).toMatch(/^[0-9a-f]{40}$/);
    // The fixture's working copy is clean: its tree is HEAD's.
    expect(evidence.runs[0]!.tree_sha).toBe(git(repo, ['rev-parse', 'HEAD^{tree}']).trim());
    expect(evidence.repo.head).toBe(git(repo, ['rev-parse', 'HEAD']).trim());
    expect((await run('evidence', 'validate', out)).code).toBe(0);
  });

  it('a test file with syntax errors makes the verdict UNVERIFIABLE (exit 3) with a visible message', async () => {
    const broken = buildFixtureRepo(join(CASES_DIR, 'CORE', 'parse-error'), join(workdir, 'broken')).repo;
    let out = '';
    const code = await main(['check', '--base', 'HEAD~1'], { stdout: (t) => (out += t), stderr: () => {}, cwd: broken });
    expect(code).toBe(3);
    expect(out).toContain('UNVERIFIABLE  tests/slug.test.ts (head)');
    expect(out).toContain('syntax errors; test extraction may be incomplete');
    expect(out).toContain('Verdict: UNVERIFIABLE');
  });

  it('explain prints the rule section from docs/rules.md', async () => {
    const r = await run('explain', 'tg002');
    expect(r.code).toBe(0);
    expect(r.out.startsWith('## TG002 New focused test')).toBe(true);
    expect(r.out).not.toContain('## TG003');
  });

  it('evidence validate accepts valid files and rejects invalid ones with exit 3', async () => {
    const doc = readFileSync(new URL('../docs/evidence.md', import.meta.url), 'utf8');
    const example = /## Example\s+```json\n([\s\S]*?)```/.exec(doc)![1]!;
    const good = join(workdir, 'good.json');
    const bad = join(workdir, 'bad.json');
    writeFileSync(good, example);
    writeFileSync(bad, example.replace('"exit_code": 1', '"exit_code": "1"'));
    expect((await run('evidence', 'validate', good)).code).toBe(0);
    const r = await run('evidence', 'validate', bad);
    expect(r.code).toBe(3);
    expect(r.err).toContain('$.runs[0].exit_code: expected integer, got "1"');
    expect((await run('check', '--base', 'HEAD~1', '--evidence', bad)).code).toBe(3);
  });
});

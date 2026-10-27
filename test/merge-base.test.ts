// `check --base <ref>` compares the merge base of <ref> and the head with the head, as the Action does and as GitHub's
// "Files changed" shows a pull request: a branch that is behind its base is never charged with what the base did after
// the branch left it (the 0.2.0 audit, the playground's pull request 13: a false FAIL on a test the branch never touched).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { git } from '../src/git/diff.js';

const workdir = mkdtempSync(join(tmpdir(), 'saidvsdid-merge-base-'));
const repo = join(workdir, 'repo');
const commits: Record<'forkPoint' | 'feature' | 'mainTip', string> = { forkPoint: '', feature: '', mainTip: '' };

const testFile = (skip: boolean): string =>
  [
    "import { describe, it, expect } from 'vitest'",
    '',
    "describe('sum', () => {",
    "  it('adds', () => {",
    '    expect(1 + 2).toBe(3)',
    '  })',
    '',
    `  it${skip ? '.skip' : ''}('handles zero', () => {`,
    '    expect(0 + 0).toBe(0)',
    '  })',
    '})',
    '',
  ].join('\n');

function write(path: string, text: string): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}

function commit(message: string, date: string): string {
  git(repo, ['add', '-A']);
  git(repo, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '-q', `--date=${date}`, '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

beforeAll(() => {
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
  write('src/sum.test.js', testFile(true));
  commits.forkPoint = commit('a test skipped where the branch leaves main', '2026-01-01T00:00:00Z');
  git(repo, ['checkout', '-q', '-b', 'feature']);
  write('src/double.js', 'export const double = (a) => a * 2\n');
  commits.feature = commit('the branch: an unrelated change, no test touched', '2026-01-02T00:00:00Z');
  git(repo, ['checkout', '-q', 'main']);
  write('src/sum.test.js', testFile(false));
  commits.mainTip = commit('main moves on: the skip is removed', '2026-01-03T00:00:00Z');
  git(repo, ['checkout', '-q', 'feature']);
});
afterAll(() => rmSync(workdir, { recursive: true, force: true }));

async function check(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(['check', ...args], { stdout: (t) => (out += t), stderr: (t) => (err += t), cwd: repo });
  return { code, out, err };
}

describe('check --base: the merge base, as a pull request', () => {
  it('charges a branch behind its base with nothing the base did after it left', async () => {
    const r = await check('--base', 'main', '--format', 'json');
    const report = JSON.parse(r.out) as { verdict: string; repo: { base: string; head: string; base_ref?: { ref: string; sha: string } } };
    expect(report.verdict).toBe('OK');
    expect(r.code).toBe(0);
    expect(report.repo.base).toBe(commits.forkPoint);
    expect(report.repo.head).toBe(commits.feature);
    expect(report.repo.base_ref).toEqual({ ref: 'main', sha: commits.mainTip });
  });

  it('says which commit it compared', async () => {
    const r = await check('--base', 'main');
    expect(r.out).toContain(`base main (merge-base ${commits.forkPoint.slice(0, 12)}) → head ${commits.feature.slice(0, 12)}`);
  });

  it('--exact-base compares the two commits as they are', async () => {
    const r = await check('--base', 'main', '--exact-base');
    expect(r.code).toBe(2);
    expect(r.out).toContain('FAIL  TG003  src/sum.test.js:8');
  });

  it('a base that is an ancestor of the head is its own merge base', async () => {
    const r = await check('--base', commits.forkPoint, '--format', 'json');
    const report = JSON.parse(r.out) as { repo: { base: string; base_ref?: unknown } };
    expect(report.repo.base).toBe(commits.forkPoint);
    expect(report.repo.base_ref).toBeUndefined();
  });
});

describe('the Action compares what check --base compares', () => {
  it('records the base by its source, pull_request.base.sha, when it compares the merge base', async () => {
    const { runCheck } = await import('../src/check.js');
    const report = await runCheck({ repo, base: commits.mainTip, head: commits.feature, baseLabel: 'pull_request.base.sha' });
    expect(report.verdict).toBe('OK');
    expect(report.repo).toEqual({ base: commits.forkPoint, head: commits.feature, base_ref: { ref: 'pull_request.base.sha', sha: commits.mainTip } });
  });

  it('two histories with no common ancestor are an ERROR that says so, not a fetch-depth problem', async () => {
    const { runAction } = await import('../src/action/run.js');
    git(repo, ['checkout', '-q', '--orphan', 'unrelated']);
    write('other.txt', 'x\n');
    const orphan = commit('a root of its own', '2026-01-04T00:00:00Z');
    git(repo, ['checkout', '-q', 'feature']);
    const dir = mkdtempSync(join(workdir, 'event-'));
    writeFileSync(join(dir, 'event.json'), JSON.stringify({ pull_request: { number: 1, base: { sha: orphan }, head: { sha: commits.feature } } }));
    writeFileSync(join(dir, 'summary.md'), '');
    const result = await runAction({
      env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: join(dir, 'event.json'), GITHUB_REPOSITORY: 'octo/demo', GITHUB_WORKSPACE: repo, GITHUB_STEP_SUMMARY: join(dir, 'summary.md'), INPUT_COMMENT: 'false' },
      fetch: (() => Promise.reject(new Error('no API call expected'))) as typeof fetch,
      log: () => {},
    });
    expect(result.verdict).toBe('ERROR');
    expect(result.body).toContain('have no common ancestor');
    expect(result.body).not.toContain('fetch-depth');
  });

  it('a commit missing from the clone is the fetch-depth ERROR', async () => {
    const { runAction } = await import('../src/action/run.js');
    const dir = mkdtempSync(join(workdir, 'event-'));
    writeFileSync(join(dir, 'event.json'), JSON.stringify({ pull_request: { number: 1, base: { sha: 'a'.repeat(40) }, head: { sha: commits.feature } } }));
    const result = await runAction({
      env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: join(dir, 'event.json'), GITHUB_REPOSITORY: 'octo/demo', GITHUB_WORKSPACE: repo, INPUT_COMMENT: 'false' },
      fetch: (() => Promise.reject(new Error('no API call expected'))) as typeof fetch,
      log: () => {},
    });
    expect(result.verdict).toBe('ERROR');
    expect(result.body).toContain('check out with ˋfetch-depth: 0ˋ');
  });
});

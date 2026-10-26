// The merge criterion's check (CLAUDE.md, scripts/full-ci-status.mjs): a pull request may be merged only if the job
// `full-ci` of .github/workflows/full-ci.yml succeeded on its last commit — a skipped or failed one, another commit's,
// or another job's success never counts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mergeVerdict, passingRun, REQUIRED_JOBS } from '../scripts/full-ci-status.mjs';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
/** A documentation-only diff: neither the matrix nor the platform jobs are required. */
const NONE = { matrix: false, platform: false, evidence: false };
const run = (id: number, sha: string, jobs: [string, string | null][], conclusion: string | null = 'success') => ({ id, head_sha: sha, status: conclusion === null ? 'in_progress' : 'completed', conclusion, jobs: jobs.map(([name, conclusion]) => ({ name, conclusion })) });

describe('full-ci on the last commit', () => {
  it('passes with a run whose `full-ci` job succeeded on the head commit', () => {
    expect(passingRun(HEAD, [run(1, HEAD, [['full-ci (paths)', 'success'], ['full-ci', 'success']])])?.id).toBe(1);
  });

  it('a later run whose full-ci job was skipped does not hide an earlier pass, and is no pass itself', () => {
    expect(passingRun(HEAD, [run(2, HEAD, [['full-ci', 'skipped']]), run(1, HEAD, [['full-ci', 'success']])])?.id).toBe(1);
    expect(passingRun(HEAD, [run(2, HEAD, [['full-ci', 'skipped']])])).toBeNull();
  });

  it('fails with full-ci failed, on another commit, while running, or with only other jobs green', () => {
    expect(passingRun(HEAD, [run(1, HEAD, [['full-ci', 'failure']])])).toBeNull();
    expect(passingRun(HEAD, [run(1, OLD, [['full-ci', 'success']])])).toBeNull();
    expect(passingRun(HEAD, [run(1, HEAD, [['full-ci', null]])])).toBeNull();
    expect(passingRun(HEAD, [run(1, HEAD, [['guarantee matrix (full)', 'success'], ['macos', 'success']])])).toBeNull();
    expect(passingRun(HEAD, [])).toBeNull();
  });
});

describe('the PR is up to date with its base: the squash is the tree full-ci tested', () => {
  const pass = [run(1, HEAD, [['full-ci', 'success']])];

  it('passes when the base is an ancestor of the head (nothing on main the PR lacks)', () => {
    expect(mergeVerdict({ sha: HEAD, runs: pass, behindBy: 0, base: 'main', scope: NONE })).toMatchObject({ ok: true });
  });

  it('fails when main has a commit the PR lacks, even with full-ci green: rebase and pass full-ci again', () => {
    const v = mergeVerdict({ sha: HEAD, runs: pass, behindBy: 2, base: 'main', scope: NONE });
    expect(v.ok).toBe(false);
    expect(v.why).toContain('behind main by 2 commits');
    expect(v.why).toContain('rebase');
  });

  it('fails when it cannot tell, and without a full-ci pass on the last commit', () => {
    for (const behindBy of [null, -1, 1.5, Number.NaN]) expect(mergeVerdict({ sha: HEAD, runs: pass, behindBy, base: 'main', scope: NONE }).ok, String(behindBy)).toBe(false);
    expect(mergeVerdict({ sha: HEAD, runs: [run(1, OLD, [['full-ci', 'success']])], behindBy: 0, base: 'main', scope: NONE }).ok).toBe(false);
  });
});

// Codex (PR #9): a PR opened against another branch, where its diff was documentation and full-ci skipped the matrix,
// then retargeted to main, kept that green on the same commit. The scope is read again at the merge, against the
// current base: the run that passed must have run what that diff requires.
describe('the run that passed covers the scope of the diff against the current base', () => {
  const MATRIX = 'guarantee matrix (full)';
  const PLATFORM = 'Python 3.11–3.15 scope reader';
  const EVIDENCE = 'fixtures vs. real runners (windows)';
  const withMatrix = [run(1, HEAD, [['full-ci', 'success'], [PLATFORM, 'success'], [MATRIX, 'success']])];
  const withoutMatrix = [run(1, HEAD, [['full-ci', 'success'], [PLATFORM, 'success'], [MATRIX, 'skipped']])];
  const docsOnly = [run(1, HEAD, [['full-ci', 'success'], ['test (docs only, ubuntu, node 22)', 'success'], [PLATFORM, 'skipped'], [MATRIX, 'skipped']])];
  const verdict = (runs: ReturnType<typeof run>[], scope: { matrix: boolean; platform: boolean; evidence: boolean }) => mergeVerdict({ sha: HEAD, runs, behindBy: 0, base: 'main', scope });

  it('the diff needs the matrix: only a pass that ran it counts (the retargeted PR)', () => {
    expect(verdict(withMatrix, { matrix: true, platform: true, evidence: false }).ok).toBe(true);
    const v = verdict(withoutMatrix, { matrix: true, platform: true, evidence: false });
    expect(v.ok).toBe(false);
    expect(v.why).toContain('guarantee matrix');
  });

  it('the diff needs the platform jobs: a documentation-only pass does not count', () => {
    expect(verdict(docsOnly, { matrix: false, platform: true, evidence: false }).ok).toBe(false);
    expect(verdict(docsOnly, { matrix: false, platform: false, evidence: false }).ok).toBe(true);
  });

  it('a pass that ran more than the diff needs counts', () => {
    expect(verdict(withMatrix, { matrix: false, platform: false, evidence: false }).ok).toBe(true);
    expect(verdict(withoutMatrix, { matrix: false, platform: true, evidence: false }).ok).toBe(true);
  });

  it('without a scope (it could not be read) it fails', () => {
    expect(mergeVerdict({ sha: HEAD, runs: withMatrix, behindBy: 0, base: 'main', scope: null }).ok).toBe(false);
  });

  it('the job names it requires are full-ci.yml\'s', () => {
    const yml = readFileSync(new URL('../.github/workflows/full-ci.yml', import.meta.url), 'utf8');
    for (const name of [MATRIX, PLATFORM, EVIDENCE, 'full-ci']) expect(yml).toContain(`name: ${name}\n`);
    expect(REQUIRED_JOBS).toEqual({ matrix: MATRIX, platform: PLATFORM, evidence: EVIDENCE });
  });

  it('the diff needs the fixtures against the real runners: only a pass that ran them counts', () => {
    const withEvidence = [run(1, HEAD, [['full-ci', 'success'], [PLATFORM, 'success'], [EVIDENCE, 'success']])];
    const withoutEvidence = [run(1, HEAD, [['full-ci', 'success'], [PLATFORM, 'success'], [EVIDENCE, 'skipped']])];
    const scope = { matrix: false, platform: true, evidence: true };
    expect(verdict(withEvidence, scope).ok).toBe(true);
    const v = verdict(withoutEvidence, scope);
    expect(v.ok).toBe(false);
    expect(v.why).toContain('real runners');
    expect(verdict(withoutEvidence, { ...scope, evidence: false }).ok).toBe(true);
    expect(mergeVerdict({ sha: HEAD, runs: withEvidence, behindBy: 0, base: 'main', scope: { matrix: false, platform: true } as never }).ok).toBe(false);
  });
});

// Codex (PR #9, round 2): on a pull_request event a checkout without `ref` tests the temporary merge with the base the
// PR had then, not its head; a PR retargeted afterwards would merge a tree no run tested. Every checkout of full-ci.yml
// pins the head commit, whose tree is the squash's once the PR is up to date with its base.
describe('full-ci tests the head commit itself', () => {
  it('every checkout of full-ci.yml pins the pull request\'s head (or the called commit)', () => {
    const lines = readFileSync(new URL('../.github/workflows/full-ci.yml', import.meta.url), 'utf8').split('\n');
    const checkouts = lines.flatMap((l, i) => (/^- uses: actions\/checkout@[0-9a-f]{40} # v[\d.]+$/.test(l.trim()) ? [i] : []));
    expect(lines.filter((l) => l.includes('actions/checkout@')).length).toBe(checkouts.length);
    expect(checkouts.length).toBeGreaterThan(5);
    for (const i of checkouts) {
      const step: string[] = [];
      for (let j = i + 1; j < lines.length && !lines[j]!.trimStart().startsWith('- ') && lines[j]!.trim() !== ''; j++) step.push(lines[j]!.trim());
      expect(step, `checkout at line ${i + 1}`).toContain('ref: ${{ github.event.pull_request.head.sha || github.sha }}');
    }
  });
});

// Codex (PR #9, round 3): a run cancelled while a job with always() kept its success is not a pass.
describe('the run itself completed with success', () => {
  it('a cancelled, failed or unfinished run does not count, whatever its jobs say', () => {
    const jobs: [string, string | null][] = [['full-ci', 'success']];
    expect(passingRun(HEAD, [run(1, HEAD, jobs)])?.id).toBe(1);
    for (const conclusion of ['cancelled', 'failure', null]) expect(passingRun(HEAD, [run(1, HEAD, jobs, conclusion)]), String(conclusion)).toBeNull();
  });
});

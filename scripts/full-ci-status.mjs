#!/usr/bin/env node
// May a pull request be merged? The merge criterion (CLAUDE.md) asks this before every merge. The `main` ruleset makes
// GitHub enforce most of it (the CI and full-ci checks green on the head, the branch up to date with main); this script
// also checks the third condition below, which no ruleset can express, and prints the merge command.
//
//   node scripts/full-ci-status.mjs <PR>    # exit 0 and the merge command if so; exit 1 and why not otherwise
//
// Three conditions, read at the moment of the check:
// - the pull request up to date with its base: the base branch is an ancestor of the head (the head is 0 commits
//   behind it, GitHub's comparison). Then the squash merge writes exactly the head's tree. Otherwise: rebase on the
//   base (or merge it in), push, and pass full-ci again on the new last commit;
// - `full-ci` green on the pull request's last commit: a run of .github/workflows/full-ci.yml on exactly that commit
//   whose job `full-ci` concluded `success` (a cancelled or unfinished one has no success: it does not count);
// - that run covered the diff against the base as it is now: the scope is read again here, with the workflow's own
//   filter (scripts/guarantee-matrix-paths.mjs, failing closed) on `origin/<base>...<head>`, and the run must have run
//   the guarantee matrix if the diff needs it, the platform jobs if it is not documentation alone, and Windows' fixtures
//   against the real runners if it touches what they read. A pull request
//   retargeted after its run (its diff was documentation against the old base) does not keep that run's green.
// The merge command it prints pins the head (`--match-head-commit`): a push after the check makes the merge fail. The
// base is read at the check: merge right after it, one pull request at a time.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide, DOCS, EXCLUDED, RUNNER_EVIDENCE } from './guarantee-matrix-paths.mjs';

/**
 * The job of full-ci.yml that succeeds only when the matrix ran whole, one that runs only with the platform jobs, and
 * Windows' fixtures against the real runners (the `full-ci` job requires each when its paths job asks for it). A name that no longer exists is never a success:
 * the check fails closed (test/full-ci-status.test.ts reads the names in the workflow).
 */
export const REQUIRED_JOBS = { matrix: 'guarantee matrix (full)', platform: 'Python 3.11–3.15 scope reader', evidence: 'fixtures vs. real runners (windows)' };

/**
 * The run on exactly that commit that completed with success (a run cancelled while a job kept its success does not
 * count), whose job `full-ci` succeeded, and, given a scope, that ran what it requires; or null.
 * @param {string} sha
 * @param {{ id: number, head_sha: string, status?: string, conclusion?: string | null, html_url?: string, jobs: { name: string, conclusion: string | null }[] }[]} runs
 * @param {{ matrix: boolean, platform: boolean, evidence: boolean }} [scope]
 */
export function passingRun(sha, runs, scope = { matrix: false, platform: false, evidence: false }) {
  const succeeded = (r, name) => r.jobs.some((j) => j.name === name && j.conclusion === 'success');
  return (
    runs.find(
      (r) => r.head_sha === sha && r.status === 'completed' && r.conclusion === 'success' && succeeded(r, 'full-ci') && (!scope.matrix || succeeded(r, REQUIRED_JOBS.matrix)) && (!scope.platform || succeeded(r, REQUIRED_JOBS.platform)) && (!scope.evidence || succeeded(r, REQUIRED_JOBS.evidence)),
    ) ?? null
  );
}

/**
 * The decision: ok only with the head 0 commits behind its base, and a full-ci pass on the head commit that ran what
 * the scope of base...head requires. `behindBy` is what GitHub's comparison says (`behind_by`): anything but a
 * non-negative integer is not an answer; a null scope (it could not be read) is not one either.
 * @param {{ sha: string, runs: Parameters<typeof passingRun>[1], behindBy: unknown, base: string, scope: { matrix: boolean, platform: boolean, evidence: boolean } | null }} input
 */
export function mergeVerdict({ sha, runs, behindBy, base, scope }) {
  if (typeof behindBy !== 'number' || !Number.isInteger(behindBy) || behindBy < 0) {
    return { ok: false, run: null, why: `could not tell whether the pull request is up to date with ${base}` };
  }
  if (behindBy > 0) {
    return { ok: false, run: null, why: `the pull request is behind ${base} by ${behindBy} commit${behindBy === 1 ? '' : 's'}: rebase it on ${base} (or merge ${base} into it), push, and pass full-ci again on the new last commit` };
  }
  if (scope === null || typeof scope !== 'object' || typeof scope.matrix !== 'boolean' || typeof scope.platform !== 'boolean' || typeof scope.evidence !== 'boolean') {
    return { ok: false, run: null, why: `could not read the scope of the pull request's diff against ${base}` };
  }
  if (!passingRun(sha, runs)) return { ok: false, run: null, why: `no full-ci run passed on its last commit ${sha}: wait for the run that every push starts, or re-run it if it failed` };
  const run = passingRun(sha, runs, scope);
  if (!run) {
    const needs = [scope.matrix ? `the guarantee matrix ("${REQUIRED_JOBS.matrix}")` : null, scope.platform ? `the platform jobs ("${REQUIRED_JOBS.platform}")` : null, scope.evidence ? `the fixtures against the real runners on Windows ("${REQUIRED_JOBS.evidence}")` : null].filter(Boolean).join(' and ');
    return { ok: false, run: null, why: `full-ci passed on ${sha}, but no passing run ran ${needs}, which its diff against ${base} requires now (was the pull request retargeted?): run full-ci again (re-run its workflow on the last commit, or push)` };
  }
  return { ok: true, run, why: `full-ci passed on its last commit ${sha}, which is up to date with ${base}, and ran what its diff requires (matrix: ${scope.matrix}, platform: ${scope.platform}, evidence: ${scope.evidence})` };
}

/**
 * The scope of the pull request's diff against its base as it is now, with the workflow's own filter: the base and the
 * head fetched from origin (the head checked to be `sha`), then `decide(origin/<base>, sha)` for the matrix and with
 * DOCS for the platform jobs. Null if anything fails.
 */
function scopeOf(pr, base, sha) {
  try {
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('fetch', '--quiet', 'origin', `+refs/heads/${base}:refs/remotes/origin/${base}`);
    git('fetch', '--quiet', 'origin', `refs/pull/${pr}/head`);
    if (git('rev-parse', 'FETCH_HEAD') !== sha) return null;
    const platform = decide(`origin/${base}`, sha, process.cwd(), DOCS).run;
    return { matrix: decide(`origin/${base}`, sha, process.cwd(), EXCLUDED).run, platform, evidence: platform && decide(`origin/${base}`, sha, process.cwd(), RUNNER_EVIDENCE).run };
  } catch {
    return null;
  }
}

function gh(args) {
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 26 }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pr = process.argv[2];
  if (!pr || !/^\d+$/.test(pr)) {
    console.error('usage: node scripts/full-ci-status.mjs <PR number>');
    process.exit(2);
  }
  const { nameWithOwner: repo } = gh(['repo', 'view', '--json', 'nameWithOwner']);
  const view = gh(['pr', 'view', pr, '--json', 'headRefOid,baseRefName,state']);
  const sha = view.headRefOid;
  const base = view.baseRefName;
  if (view.state !== 'OPEN') {
    console.log(`PR ${pr} is ${view.state}`);
    process.exit(1);
  }
  const behindBy = gh(['api', `repos/${repo}/compare/${encodeURIComponent(base)}...${sha}`]).behind_by;
  const listed = gh(['api', `repos/${repo}/actions/workflows/full-ci.yml/runs?head_sha=${sha}&per_page=100`]).workflow_runs;
  const runs = listed.map((r) => ({
    id: r.id,
    head_sha: r.head_sha,
    status: r.status,
    conclusion: r.conclusion,
    html_url: r.html_url,
    jobs: gh(['api', `repos/${repo}/actions/runs/${r.id}/jobs?per_page=100`]).jobs.map((j) => ({ name: j.name, conclusion: j.conclusion })),
  }));
  const scope = scopeOf(pr, base, sha);
  const verdict = mergeVerdict({ sha, runs, behindBy, base, scope });
  console.log(`PR ${pr}: ${verdict.why}${verdict.run ? `: ${verdict.run.html_url}` : ''}`);
  if (!verdict.ok) process.exit(1);
  console.log(`merge with: gh pr merge ${pr} --squash --match-head-commit ${sha}`);
}

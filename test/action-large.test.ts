// The Action on a pull request too large for one comment (the 0.2.0 audit's playground pull request 4: 600 skips, 150
// tests deleted, 150 assertions removed): the comment is bounded and links the full report, uploaded as the job's
// artifact; a failed upload gives what reproduces it instead; a pull request that fits uploads nothing. The job summary
// holds the full report. Against a fake GitHub API and a fake artifact service.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureRepo, type FixtureRepo } from '../fixtures/build.js';
import { runAction } from '../src/action/run.js';

const tmp = mkdtempSync(join(tmpdir(), 'saidvsdid-action-large-'));
let repo: FixtureRepo;

function testFile(m: number, mode: 'base' | 'skip' | 'noassert'): string {
  const lines = ["import { describe, it, expect } from 'vitest'", '', `describe('module ${m}', () => {`];
  for (let t = 1; t <= 15; t++) {
    lines.push(`  it${mode === 'skip' ? '.skip' : ''}('case ${t} of module ${m} computes the expected value', () => {`, `    expect(${t} + ${m}).toBe(${t + m})`);
    if (mode !== 'noassert') lines.push(`    expect(${t} * 2).toBe(${t * 2})`);
    lines.push('  })', '');
  }
  lines.push('})', '');
  return lines.join('\n');
}

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

beforeAll(() => {
  const c = join(tmp, 'case');
  for (let m = 1; m <= 60; m++) write(join(c, 'base'), `src/module_${m}.test.js`, testFile(m, 'base'));
  for (let m = 1; m <= 40; m++) write(join(c, 'head'), `src/module_${m}.test.js`, testFile(m, 'skip'));
  for (let m = 51; m <= 60; m++) write(join(c, 'head'), `src/module_${m}.test.js`, testFile(m, 'noassert'));
  writeFileSync(join(c, 'case.json'), '{}');
  repo = buildFixtureRepo(c, join(tmp, 'repo'));
}, 120_000);
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const TOKEN = `e30.${Buffer.from(JSON.stringify({ scp: 'Actions.Results:run-id:job-id' })).toString('base64url')}.sig`;

interface Call {
  method: string;
  url: string;
}

function services(artifactStatus = 200) {
  const calls: Call[] = [];
  let posted = '';
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ method, url: u });
    const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status });
    if (u.includes('/twirp/')) {
      if (artifactStatus !== 200) return json(artifactStatus, {});
      return u.endsWith('/CreateArtifact') ? json(200, { ok: true, signed_upload_url: 'https://blob.example.test/u?sig=s' }) : json(200, { ok: true, artifact_id: '9001' });
    }
    if (u.startsWith('https://blob.example.test/')) return new Response('', { status: 201 });
    if (method === 'GET') return json(200, []);
    posted = typeof init?.body === 'string' ? (JSON.parse(init.body) as { body: string }).body : '';
    return json(201, { id: 1, html_url: 'https://github.com/octo/demo/pull/7#issuecomment-1' });
  }) as typeof globalThis.fetch;
  return { fetch, calls, posted: () => posted };
}

async function run(fetch: typeof globalThis.fetch, base = repo.base, head = repo.head) {
  const dir = mkdtempSync(join(tmp, 'run-'));
  writeFileSync(join(dir, 'event.json'), JSON.stringify({ pull_request: { number: 7, base: { sha: base }, head: { sha: head } } }));
  writeFileSync(join(dir, 'summary.md'), '');
  const result = await runAction({
    env: {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: join(dir, 'event.json'),
      GITHUB_REPOSITORY: 'octo/demo',
      GITHUB_WORKSPACE: repo.repo,
      GITHUB_STEP_SUMMARY: join(dir, 'summary.md'),
      GITHUB_TOKEN: 'test-token',
      GITHUB_API_URL: 'https://api.github.test',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_RUN_ID: '42',
      GITHUB_JOB: 'saidvsdid',
      ACTIONS_RUNTIME_TOKEN: TOKEN,
      ACTIONS_RESULTS_URL: 'https://results.example.test/',
      INPUT_EXCLUDE: 'fixtures/**',
    },
    fetch,
    log: () => {},
  });
  return { result, summary: readFileSync(join(dir, 'summary.md'), 'utf8') };
}

describe('a pull request too large for one comment', () => {
  it('bounded comment, the full report as the artifact, linked exactly; the summary holds everything', async () => {
    const s = services();
    const { result, summary } = await run(s.fetch);
    expect(result.verdict).toBe('FAIL');
    const body = s.posted();
    expect(body.length).toBeLessThanOrEqual(65_000);
    expect(body).toContain('**760 findings:** 610 FAIL · 150 WARN · 0 INFO');
    expect(body).toMatch(/\*\*\d+ of 760 findings are not shown here\*\*/);
    expect(body).toContain("is this job's artifact: [saidvsdid report](https://github.com/octo/demo/actions/runs/42/artifacts/9001).");
    expect(s.calls.filter((c) => c.url.includes('/twirp/')).map((c) => c.url.replace(/^.*\//, ''))).toEqual(['CreateArtifact', 'FinalizeArtifact']);
    // The summary is the full report: all 760 findings, no omission line.
    expect(summary.split('\n').filter((l) => /^- (❌|⚠️) \*\*/.test(l))).toHaveLength(760);
    expect(summary).not.toContain('not shown here');
  });

  it('a failed upload changes neither the verdict nor the gate, and gives what reproduces the report', async () => {
    const s = services(500);
    const { result } = await run(s.fetch);
    expect(result).toMatchObject({ verdict: 'FAIL', exitCode: 0 });
    const body = s.posted();
    expect(body).toContain('The full report could not be attached (`CreateArtifact: HTTP 500`).');
    expect(body).toContain(`\`git fetch origin ${repo.base} +refs/pull/7/head\``);
    expect(body).toContain(`--exact-base --base ${repo.base} --head ${repo.head} --exclude='fixtures/**'\``);
    expect(body).not.toContain('actions/runs');
  });

  it('a pull request that fits uploads nothing', async () => {
    const s = services();
    const { result } = await run(s.fetch, repo.base, repo.base);
    expect(result.verdict).toBe('OK');
    expect(s.calls.some((c) => c.url.includes('/twirp/'))).toBe(false);
  });
});

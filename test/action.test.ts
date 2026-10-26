// The GitHub Action (action.yml, src/action/run.ts, src/report/comment.ts) on the synthetic repositories of
// fixtures/action/: the comment a reviewer reads, one comment per pull request, and a check that stays green whatever
// the verdict unless `fail-on` asks otherwise.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Parser, type Node } from 'commonmark';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { buildFixtureRepo, type FixtureRepo } from '../fixtures/build.js';
import { ACTIONS_BOT, actionEnv, blocks, commandData, parseExclude, parseFailOn, runAction, type ActionResult } from '../src/action/run.js';
import { runCheck } from '../src/check.js';
import { COMMENT_MARKER, GROUPS, literal, MAX_TEXT, renderComment, sanitize } from '../src/report/comment.js';
import type { Report, Verdict } from '../src/report/model.js';
import { RULE_IDS } from '../src/rules/index.js';

const FIXTURES = new URL('../fixtures/action/', import.meta.url);
const CASES = ['demo', 'pytest', 'clean', 'hostile'] as const;
type Case = (typeof CASES)[number];

const tmp = mkdtempSync(join(tmpdir(), 'saidvsdid-action-'));
const repos = {} as Record<Case, FixtureRepo>;
const reports = {} as Record<Case, Report>;

beforeAll(async () => {
  for (const c of CASES) {
    repos[c] = buildFixtureRepo(fileURLToPath(new URL(c, FIXTURES)), join(tmp, c));
    reports[c] = await runCheck({ repo: repos[c].repo, base: repos[c].base, head: repos[c].head });
  }
}, 120_000);

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const LINK = (r: FixtureRepo) => (side: 'base' | 'head', file: string, line: number | null) => `https://github.com/octo/demo/blob/${side === 'base' ? r.base : r.head}/${file}${line === null ? '' : `#L${line}`}`;

describe('the PR comment', () => {
  it.each(CASES)('%s: reads as fixtures/action/%s/comment.md', async (c) => {
    expect(reports[c].verdict).toBe(c === 'clean' ? 'OK' : 'FAIL');
    await expect(renderComment(reports[c], { link: LINK(repos[c]), failOn: 'none' })).toMatchFileSnapshot(`../fixtures/action/${c}/comment.md`);
  });

  it('what happened to the tests comes first, in the order removed, marked, assertions, configuration; the verdict last', () => {
    const body = renderComment(reports.demo, { link: null, failOn: 'none' });
    const at = (s: string): number => body.indexOf(s);
    expect(body.startsWith(`${COMMENT_MARKER}\n`)).toBe(true);
    const order = ['Tests removed or replaced', 'Tests skipped, focused or marked to fail', 'Assertions removed or relaxed', 'Configuration, timeouts and retries changed', '**Verdict: FAIL**'].map(at);
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('every location links to its line, on the side it is about: a removed test at base, the rest at head', () => {
    const body = renderComment(reports.demo, { link: LINK(repos.demo), failOn: 'none' });
    const { base, head } = repos.demo;
    expect(body).toContain(`[\`src/cart.test.ts:18\` (removed)](https://github.com/octo/demo/blob/${base}/src/cart.test.ts#L18)`);
    expect(body).toContain(`[\`src/cart.test.ts:13\`](https://github.com/octo/demo/blob/${head}/src/cart.test.ts#L13)`);
    expect(body).toContain(`[\`vitest.config.ts:6\`](https://github.com/octo/demo/blob/${head}/vitest.config.ts#L6)`);
  });

  it('every rule has exactly one group', () => {
    expect(GROUPS.flatMap((g) => g.rules).sort()).toEqual([...RULE_IDS].sort());
  });

  it('says how the check gates, never "pass"', () => {
    for (const c of CASES) {
      expect(renderComment(reports[c], { link: null, failOn: 'none' })).toContain('this check does not block the merge, whatever the verdict');
      expect(renderComment(reports[c], { link: null, failOn: 'fail' })).toContain('this check fails only on FAIL or worse');
      expect(renderComment(reports[c], { link: null, failOn: 'warn' })).toContain('this check fails only on WARN or worse');
      expect(renderComment(reports[c], { link: null, failOn: 'none' })).not.toMatch(/\bpass(ed)?\b/i);
    }
  });

  // Backtick runs of every length to 100 (cmark-gfm, GitHub's renderer, stops reading a run at 80: Codex's
  // counterexample to a fence sized to the text), and the rest of what a code span or GitHub could read.
  const STRINGS = [
    ...Array.from({ length: 100 }, (_, i) => `a${'`'.repeat(i + 1)} <img src=x> @octocat #12 ${'`'.repeat(i + 1)}b`),
    '', ' ', '  ', '`', ' a ', ' a', 'a ', ' `', 'a``b`c', 'a````b```c``d`e', 'src/d```o````c.test.ts', '\\`<b>x</b>`',
    '[OK](https://evil.example)', '![](https://evil.example/p.png)', 'a | b', 'x)y]z', 'two\nlines', 'cr\r\nlf', 'lone\rcr', 'tab\there',
    '<img src=x> @octocat '.repeat(500),
  ];

  it("the report's text, sanitised: no backtick, no line break or tab, at most MAX_TEXT code points", () => {
    for (const s of STRINGS) {
      const t = sanitize(s);
      expect(t, JSON.stringify(s.slice(0, 40))).not.toMatch(/[`\r\n\t]/);
      expect([...t].length).toBeLessThanOrEqual(MAX_TEXT);
    }
    expect(sanitize('a``b')).toBe('aˋˋb');
    expect(sanitize('a\r\nb\tc')).toBe('a  b c');
    const long = sanitize('x'.repeat(10_000));
    expect([...long]).toHaveLength(MAX_TEXT);
    expect(long).toBe(`${'x'.repeat(MAX_TEXT - 1)}…`);
    // Code points, never half a surrogate pair.
    expect(sanitize('😀'.repeat(300))).toBe(`${'😀'.repeat(MAX_TEXT - 1)}…`);
  });

  it("the report's text is one code span of one backtick holding the sanitised text, whatever it holds", () => {
    // CommonMark's reference parser (scripts/check-gfm-render.mjs asks GitHub's own renderer): `x <literal> y` is a
    // paragraph of a text, a code span, and a text; the span holds the sanitised text, less the one space CommonMark
    // strips from each side when both are spaces and it is not all spaces (spec 0.31, *Code spans*); an empty text is
    // a span of a space.
    for (const s of STRINGS) {
      const out = literal(s);
      expect(out).toMatch(/^`[^`]+`$/);
      const t = sanitize(s);
      const shown = t === '' ? ' ' : t.startsWith(' ') && t.endsWith(' ') && !/^ +$/.test(t) ? t.slice(1, -1) : t;
      const paragraph = new Parser().parse(`x ${out} y`).firstChild!;
      const children: { type: string; literal: string | null }[] = [];
      for (let n = paragraph.firstChild; n; n = n.next) children.push({ type: n.type, literal: n.literal });
      expect(children, JSON.stringify(s.slice(0, 40))).toEqual([
        { type: 'text', literal: 'x ' },
        { type: 'code', literal: shown },
        { type: 'text', literal: ' y' },
      ]);
    }
  });

  it('a body past the size limit counts the findings it leaves out, and keeps the verdict', () => {
    const body = renderComment(reports.demo, { link: null, failOn: 'none', maxLength: 1200 });
    expect(body.length).toBeLessThanOrEqual(1200);
    expect(body).toMatch(/_\d more findings? not shown/);
    expect(body).toContain('**Verdict: FAIL**');
  });
});

/** Every node of a Markdown document, in order. */
function nodesOf(markdown: string): Node[] {
  const out: Node[] = [];
  const walker = new Parser().parse(markdown).walker();
  for (let e = walker.next(); e; e = walker.next()) if (e.entering) out.push(e.node);
  return out;
}

// fixtures/action/hostile: test names and a path written to become HTML, a mention, a reference, a masked link or an
// image in the comment GitHub's token posts. Whatever the pull request names, its text reaches the comment only inside
// code (a code span, or <code> with its HTML escaped in the folded list), where GitHub renders nothing.
describe("the PR comment is inert to the pull request's text", () => {
  // The test names of fixtures/action/hostile/base/src/names.test.ts, as saidvsdid names them: the literal's source text
  // (its backslash escape kept).
  const NAMES = ['``` <img src=x> @octo-org/everyone `', '[Verdict: OK](https://evil.example)', '![](https://evil.example/pixel.png)', '\\\\`<b>bold</b>` fixes octo/repo#1, see https://evil.example', '` `'];
  const PATH = 'src/l)[o]`k.test.ts';
  // Removed test files of the fixture whose paths hold a parenthesis, brackets and runs of 1, 3 and 4 backticks.
  const PATHS = [PATH, 'src/d```o````c.test.ts'];
  const PAYLOAD = /img|evil|octo-org|octo\/repo|bold|Verdict: OK|kept|\.test\.|[@<>]|#\d/;

  it("outside code there is no HTML of its own, no image, no link but the lines' own, no mention and no reference", async () => {
    const { body } = (await act('hostile')).result;
    const nodes = nodesOf(body);
    const blob = `https://github.com/octo/demo/blob/(${repos.hostile.base}|${repos.hostile.head})/src/`;
    for (const n of nodes) {
      if (n.type === 'image') throw new Error(`an image: ${n.destination}`);
      if (n.type === 'html_inline') expect(['<sub>', '</sub>']).toContain(n.literal);
      if (n.type === 'html_block' && n.literal?.trimEnd() !== COMMENT_MARKER) {
        expect(n.literal).toMatch(/^ *<details><summary>\d+ tests<\/summary>(?:<code>[^<>]*<\/code>(?:<br>)?)+<\/details>\n?$/);
      }
      if (n.type === 'link') {
        expect(n.destination).toMatch(new RegExp(`^${blob}[^()\\s<>]+$`));
        for (let c = n.firstChild; c; c = c.next) expect(c.type === 'code' || (c.type === 'text' && c.literal === ' (removed)'), `${c.type} ${c.literal}`).toBe(true);
      }
      if (n.type === 'text') expect(n.literal ?? '').not.toMatch(PAYLOAD);
    }
    const links = nodes.filter((n) => n.type === 'link').map((n) => decodeURIComponent(n.destination ?? ''));
    for (const path of PATHS) expect(links).toContain(`https://github.com/octo/demo/blob/${repos.hostile.base}/${path}`);
  });

  it("a removed file's link: its label is the path, sanitised, as code; its URL, the path encoded segment by segment", async () => {
    const { body } = (await act('hostile')).result;
    const links = nodesOf(body).filter((n) => n.type === 'link');
    for (const path of PATHS) {
      // encodeURIComponent per segment, and the parentheses it leaves, which would end a Markdown link's destination.
      const encoded = path
        .split('/')
        .map((s) => encodeURIComponent(s).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
        .join('/');
      expect(body).toContain(`](https://github.com/octo/demo/blob/${repos.hostile.base}/${encoded})`);
      const link = links.find((n) => n.destination === `https://github.com/octo/demo/blob/${repos.hostile.base}/${encoded}`);
      expect(link, path).toBeDefined();
      expect(link!.firstChild?.type).toBe('code');
      expect(link!.firstChild?.literal).toBe(sanitize(path));
      expect(link!.firstChild?.next?.literal).toBe(' (removed)');
      expect(link!.firstChild?.next?.next).toBeNull();
    }
  });

  it('every name and path is still there to read, as the pull request wrote it but for its backticks (ˋ)', async () => {
    const { body } = (await act('hostile')).result;
    const nodes = nodesOf(body);
    const source = readFileSync(new URL('hostile/base/src/names.test.ts', FIXTURES), 'utf8');
    for (const name of NAMES) expect(source).toContain(`test('${name}'`);
    const code = nodes.filter((n) => n.type === 'code').map((n) => n.literal ?? '');
    for (const name of NAMES) expect(code.some((c) => c.includes(sanitize(JSON.stringify(name)))), name).toBe(true);
    expect(code).toContain(sanitize(PATH));
    const html = nodes.filter((n) => n.type === 'html_block').map((n) => n.literal ?? '').join('\n');
    for (let i = 1; i <= 6; i++) expect(html).toContain(`<code>\`\`\` &lt;img src=x${i}&gt; @octo-org/everyone \` #${i}</code>`);
  });
});

describe('fail-on', () => {
  const VERDICTS: Verdict[] = ['OK', 'WARN', 'FAIL', 'UNVERIFIABLE', 'ERROR'];

  it('none (the default) never fails; fail fails on FAIL or worse; warn on WARN or worse', () => {
    expect(VERDICTS.map((v) => blocks(v, 'none'))).toEqual([false, false, false, false, false]);
    expect(VERDICTS.map((v) => blocks(v, 'fail'))).toEqual([false, false, true, true, true]);
    expect(VERDICTS.map((v) => blocks(v, 'warn'))).toEqual([false, true, true, true, true]);
  });

  it('reads its input strictly', () => {
    expect(parseFailOn(undefined)).toBe('none');
    expect(parseFailOn('')).toBe('none');
    expect(parseFailOn(' Warn ')).toBe('warn');
    expect(() => parseFailOn('error')).toThrow(/fail-on must be/);
    expect(parseExclude('fixtures/**\n\n  data/** \r\n')).toEqual(['fixtures/**', 'data/**']);
  });
});

interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** A fake GitHub API: the comments already on the pull request, every call made, and an optional status for writes. */
function fakeGitHub(existing: { id: number; login: string; body: string }[], writeStatus = 200) {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url: String(url), body });
    const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (method === 'GET') {
      const page = Number(new URL(String(url)).searchParams.get('page'));
      return json(200, existing.slice((page - 1) * 100, page * 100).map((c) => ({ id: c.id, body: c.body, user: { login: c.login } })));
    }
    if (writeStatus !== 200) return json(writeStatus, { message: 'Resource not accessible by integration' });
    return json(method === 'POST' ? 201 : 200, { id: 1, html_url: 'https://github.com/octo/demo/pull/7#issuecomment-1' });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

interface Run {
  result: ActionResult;
  calls: Call[];
  log: string[];
  summary: string;
  output: string;
}

async function act(c: Case, inputs: Record<string, string> = {}, options: { existing?: { id: number; login: string; body: string }[]; writeStatus?: number; event?: unknown } = {}): Promise<Run> {
  const dir = mkdtempSync(join(tmp, 'run-'));
  const r = repos[c];
  const event = options.event ?? { pull_request: { number: 7, base: { sha: r.base }, head: { sha: r.head } } };
  writeFileSync(join(dir, 'event.json'), JSON.stringify(event));
  writeFileSync(join(dir, 'summary.md'), '');
  writeFileSync(join(dir, 'output'), '');
  const gh = fakeGitHub(options.existing ?? [], options.writeStatus);
  const log: string[] = [];
  const result = await runAction({
    env: {
      GITHUB_EVENT_PATH: join(dir, 'event.json'),
      GITHUB_REPOSITORY: 'octo/demo',
      GITHUB_WORKSPACE: r.repo,
      GITHUB_STEP_SUMMARY: join(dir, 'summary.md'),
      GITHUB_OUTPUT: join(dir, 'output'),
      GITHUB_TOKEN: 'test-token',
      GITHUB_API_URL: 'https://api.github.test',
      GITHUB_SERVER_URL: 'https://github.com',
      ...Object.fromEntries(Object.entries(inputs).map(([k, v]) => [`INPUT_${k.toUpperCase().replace(/-/g, '_')}`, v])),
    },
    fetch: gh.fetch,
    log: (l) => log.push(l),
  });
  return { result, calls: gh.calls, log, summary: readFileSync(join(dir, 'summary.md'), 'utf8'), output: readFileSync(join(dir, 'output'), 'utf8') };
}

describe('the Action', () => {
  it('by default the check is green whatever the verdict, and the comment says why', async () => {
    for (const c of CASES) {
      const run = await act(c);
      expect(run.result.exitCode).toBe(0);
      expect(run.result.verdict).toBe(reports[c].verdict);
      expect(run.output).toBe(`verdict=${reports[c].verdict}\nexit-code=${reports[c].exit_code}\ncomment-url=https://github.com/octo/demo/pull/7#issuecomment-1\n`);
    }
  });

  it('fail-on: fail fails on FAIL, not on OK; fail-on: warn too', async () => {
    expect((await act('demo', { 'fail-on': 'fail' })).result.exitCode).toBe(1);
    expect((await act('clean', { 'fail-on': 'fail' })).result.exitCode).toBe(0);
    expect((await act('demo', { 'fail-on': 'warn' })).result.exitCode).toBe(1);
    expect((await act('clean', { 'fail-on': 'warn' })).result.exitCode).toBe(0);
  });

  it('fail-on: warn fails on a WARN that fail-on: fail lets through', async () => {
    const warnOnly = await act('demo', { 'fail-on': 'fail', exclude: 'src/cart.test.ts' });
    expect(warnOnly.result.verdict).toBe('WARN');
    expect(warnOnly.result.exitCode).toBe(0);
    expect((await act('demo', { 'fail-on': 'warn', exclude: 'src/cart.test.ts' })).result.exitCode).toBe(1);
  });

  it('posts one comment when there is none, with the analysis of the PR from its merge base to its head', async () => {
    const run = await act('demo');
    expect(run.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://api.github.test/repos/octo/demo/issues/7/comments?per_page=100&page=1',
      'POST https://api.github.test/repos/octo/demo/issues/7/comments',
    ]);
    const body = (run.calls[1]!.body as { body: string }).body;
    expect(body).toBe(renderComment(reports.demo, { link: LINK(repos.demo), failOn: 'none' }));
    expect(run.summary).toBe(body.slice(COMMENT_MARKER.length + 1));
  });

  it("updates its own comment (on any page) instead of adding another, and never someone else's with the marker", async () => {
    const others = Array.from({ length: 120 }, (_, i) => ({ id: 100 + i, login: 'someone', body: i === 3 ? `${COMMENT_MARKER}\nnot ours` : 'lgtm' }));
    others[110] = { id: 42, login: ACTIONS_BOT, body: `${COMMENT_MARKER}\nan earlier run` };
    const run = await act('demo', {}, { existing: others });
    expect(run.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://api.github.test/repos/octo/demo/issues/7/comments?per_page=100&page=1',
      'GET https://api.github.test/repos/octo/demo/issues/7/comments?per_page=100&page=2',
      'PATCH https://api.github.test/repos/octo/demo/issues/comments/42',
    ]);
  });

  it('a comment that cannot be posted (a fork, missing permission) is a warning; the summary and the gate stay', async () => {
    const run = await act('demo', {}, { writeStatus: 403 });
    expect(run.result.exitCode).toBe(0);
    expect(run.result.commentUrl).toBeNull();
    expect(run.log.some((l) => l.startsWith('::warning::saidvsdid: the PR comment was not posted') && l.includes('pull-requests: write'))).toBe(true);
    expect(run.summary).toContain('**Verdict: FAIL**');
    expect((await act('demo', { 'fail-on': 'fail' }, { writeStatus: 403 })).result.exitCode).toBe(1);
  });

  it('comment: false writes the job summary only', async () => {
    const run = await act('demo', { comment: 'false' });
    expect(run.calls).toEqual([]);
    expect(run.summary).toContain('**Verdict: FAIL**');
  });

  it('not a pull request: ERROR, nothing posted, and it blocks only when fail-on asks', async () => {
    const run = await act('demo', {}, { event: { push: {} } });
    expect(run.result.verdict).toBe('ERROR');
    expect(run.result.exitCode).toBe(0);
    expect(run.calls).toEqual([]);
    expect(run.summary).toContain('**Verdict: ERROR**');
    expect((await act('demo', { 'fail-on': 'fail' }, { event: { push: {} } })).result.exitCode).toBe(1);
  });

  it('a base commit missing from the clone is an ERROR that names fetch-depth', async () => {
    const run = await act('demo', {}, { event: { pull_request: { number: 7, base: { sha: 'f'.repeat(40) }, head: { sha: repos.demo.head } } } });
    expect(run.result.verdict).toBe('ERROR');
    expect(run.result.body).toContain('fetch-depth: 0');
    expect(run.calls.map((c) => c.method)).toEqual(['GET', 'POST']);
  });

  it('a misconfigured input fails the step, whatever fail-on would say', async () => {
    const run = await act('demo', { 'fail-on': 'sometimes' });
    expect(run.result.exitCode).toBe(1);
    expect(run.log[0]).toMatch(/^::error::saidvsdid: fail-on must be/);
    expect(run.calls).toEqual([]);
  });

  it("a workflow command's data cannot start another command", () => {
    expect(commandData('a\n::set-env name=X::1\r%')).toBe('a%0A::set-env name=X::1%0D%25');
  });
});

// The bundle action.yml runs (dist/action/, versioned; full-ci's check-dist rebuilds it and compares), copied alone to a
// directory of its own: it reads nothing outside it (the grammars, web-tree-sitter's runtime, the Python scope reader),
// and on the fixture repositories it writes what the source writes.
describe('the bundle (dist/action/index.js), alone', () => {
  const BUNDLE = fileURLToPath(new URL('../dist/action/', import.meta.url));

  it.each(['demo', 'pytest'] as const)('%s: the same summary, outputs and exit code as the source', async (c) => {
    expect(existsSync(join(BUNDLE, 'index.js')), 'dist/action/index.js: node scripts/build-action.mjs').toBe(true);
    const alone = mkdtempSync(join(tmp, 'bundle-'));
    cpSync(BUNDLE, join(alone, 'action'), { recursive: true });
    const dir = mkdtempSync(join(tmp, 'bundle-run-'));
    const r = repos[c];
    writeFileSync(join(dir, 'event.json'), JSON.stringify({ pull_request: { number: 7, base: { sha: r.base }, head: { sha: r.head } } }));
    writeFileSync(join(dir, 'summary.md'), '');
    writeFileSync(join(dir, 'output'), '');
    const run = spawnSync(process.execPath, [join(alone, 'action', 'index.js')], {
      cwd: r.repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_EVENT_PATH: join(dir, 'event.json'),
        GITHUB_REPOSITORY: 'octo/demo',
        GITHUB_WORKSPACE: r.repo,
        GITHUB_STEP_SUMMARY: join(dir, 'summary.md'),
        GITHUB_OUTPUT: join(dir, 'output'),
        GITHUB_SERVER_URL: 'https://github.com',
        'INPUT_FAIL-ON': 'fail',
        INPUT_EXCLUDE: '',
        INPUT_COMMENT: 'false',
        'INPUT_GITHUB-TOKEN': '',
      },
    });
    const source = await act(c, { 'fail-on': 'fail', comment: 'false' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(source.result.exitCode);
    expect(readFileSync(join(dir, 'summary.md'), 'utf8')).toBe(source.summary);
    expect(readFileSync(join(dir, 'output'), 'utf8')).toBe(source.output);
  }, 120_000);
});

describe('action.yml', () => {
  const yml = readFileSync(new URL('../action.yml', import.meta.url), 'utf8');

  // GitHub refuses a manifest that is not valid YAML before any step runs (an unquoted `pull-requests: write` in a
  // description did: the probe pull request's jobs failed in "Set up job"). Parsed strictly, as a whole.
  it('is valid YAML, and its manifest is what GitHub reads: inputs with their defaults, outputs, a node24 main', () => {
    const doc = parseYaml(yml, { strict: true, uniqueKeys: true }) as Record<string, unknown>;
    expect(Object.keys(doc).sort()).toEqual(['branding', 'description', 'inputs', 'name', 'outputs', 'runs']);
    const inputs = doc['inputs'] as Record<string, { description: string; required: boolean; default: string }>;
    expect(Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.default]))).toEqual({ 'fail-on': 'none', exclude: '', comment: 'true', 'github-token': '${{ github.token }}' });
    for (const v of Object.values(inputs)) expect(typeof v.description === 'string' && v.required === false).toBe(true);
    expect(Object.keys(doc['outputs'] as object)).toEqual(['verdict', 'exit-code', 'comment-url']);
    expect(doc['runs']).toEqual({ using: 'node24', main: 'dist/action/index.js' });
    expect(existsSync(new URL('../dist/action/index.js', import.meta.url))).toBe(true);
  });

  it("its description fits the Marketplace's limit (under 125 characters), quoted (it holds ': ')", () => {
    const description = /^description: '([^'\n]*)'\n/m.exec(yml)?.[1];
    expect(description).toBeDefined();
    expect([...description!].length).toBeLessThan(125);
  });

  it("declares the inputs, with fail-on off by default, and runs the versioned bundle with GitHub's Node.js 24", () => {
    expect(yml).toMatch(/fail-on:\n {4}description: .*\n {4}required: false\n {4}default: none\n/);
    expect(yml).toMatch(/comment:\n {4}description: .*\n {4}required: false\n {4}default: 'true'\n/);
    expect(yml).toMatch(/github-token:\n {4}description: .*\n {4}required: false\n {4}default: \$\{\{ github\.token \}\}\n/);
    expect(yml).toMatch(/\nruns:\n {2}using: node24\n {2}main: dist\/action\/index\.js\n$/);
    // Nothing is installed or built in the user's repository: no step, no shell.
    expect(yml).not.toMatch(/\n\s*(?:steps|run|shell):/);
    expect(readFileSync(new URL('../src/action/main.ts', import.meta.url), 'utf8')).toContain('runAction(');
  });

  it('reads its inputs as GitHub gives them to a JavaScript action (hyphens kept), and the token from its input', () => {
    expect(actionEnv({ 'INPUT_FAIL-ON': 'warn', 'INPUT_GITHUB-TOKEN': 't', INPUT_COMMENT: 'false', INPUT_EXCLUDE: 'a/**' })).toEqual({
      'INPUT_FAIL-ON': 'warn',
      'INPUT_GITHUB-TOKEN': 't',
      INPUT_FAIL_ON: 'warn',
      GITHUB_TOKEN: 't',
      INPUT_COMMENT: 'false',
      INPUT_EXCLUDE: 'a/**',
    });
  });

  it('uses no secret but the job token', () => {
    expect(yml).not.toMatch(/secrets\./);
    expect(yml.match(/\$\{\{ github\.token \}\}/g)).toHaveLength(1);
  });
});

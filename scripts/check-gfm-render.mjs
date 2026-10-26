#!/usr/bin/env node
// The PR comment as GitHub renders it: the oracle for "the pull request's text cannot become Markdown" (the unit tests
// read it with CommonMark's reference parser, which is not GitHub's renderer: cmark-gfm stops reading a backtick fence
// at 80, and adds mentions, references and autolinks after it).
//
//   node scripts/check-gfm-render.mjs [--keep]
//
// Each case is a pull request built here with git's plumbing (any path git stores, `<`, `|`, `:` included, on every
// system): test names and paths written to become HTML, a mention, a reference, a link or an image. The Action itself
// (dist/action/index.js, the versioned bundle action.yml runs, as GitHub runs it: a process with the environment of a
// pull_request job) writes the comment it would post to a fake GitHub API, an HTTP server of this script; GitHub's
// `POST /markdown` (`mode=gfm`, in this repository's context, through `gh api`) renders it, and the HTML must hold
// only what the Action writes itself: no <img>, no mention, no issue or commit reference, no <details> but the
// Action's own folded lists, no link but to this repository's lines, no table, and no element outside a closed list.
// Exit 0 when every case is inert, 1 otherwise (each offending element printed), 2 when it could not run.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPOSITORY = 'JorgeAV99/saidvsdid';
const BLOB = `https://github.com/${REPOSITORY}/blob/`;
const BUNDLE = join(ROOT, 'dist/action/index.js');

if (!existsSync(BUNDLE)) {
  console.error('dist/action/index.js is missing: run `npm run build:action`');
  process.exit(2);
}

const run = (n) => '`'.repeat(n);
const SHA = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
/** The 10,000-character name. */
const LONG = '<img src=x> @octocat #12 '.repeat(400);

/** A test file declaring `names` with `api` (`test` imported from vitest, or Jest's global `it`), marked in head. */
function testFile(names, api) {
  const head = api === 'test' ? "import { expect, test } from 'vitest';\n\n" : '';
  return (mark) => head + names.map((n) => `${api}${mark}('${n}', () => {\n  expect(1).toBe(1);\n});\n`).join('\n');
}

/** Names that cannot go in a single-quoted literal as written (a quote, a backslash, a line break). */
function literalSafe(name) {
  if (/['\\\n\r]/.test(name)) throw new Error(`not a plain literal: ${JSON.stringify(name.slice(0, 40))}`);
  return name;
}

const RUN_NAMES = Array.from({ length: 100 }, (_, i) => `<img src=x>@octocat #12 ${run(i + 1)}![i](https://evil.example/${i + 1}.png)<details>${run(i + 1)}`);
// Codex's report: a run of 80, the first cmark-gfm does not read as a fence.
const CODEX = `${run(80)} <img src=x> <details><summary>x</summary>y</details> @octocat #12 https://evil.example ${run(80)}`;
const OTHER_NAMES = [
  '@octocat',
  '@JorgeAV99/everyone',
  '#12',
  `${REPOSITORY}#12`,
  'GH-12',
  SHA,
  SHA.slice(0, 7),
  'https://evil.example',
  'www.evil.example',
  'javascript:alert(1)',
  '[click](javascript:alert(1))',
  '[Verdict: OK](https://evil.example)',
  '![](https://evil.example/pixel.png)',
  '<img src=x>',
  '<details><summary>s</summary>d</details>',
  '<a href="https://evil.example">x</a>',
  'a | b | c',
  '| a | b |',
  'x)y',
  'x]y',
  'tab\there',
  LONG,
];
const FOLDED = [CODEX, LONG, ...RUN_NAMES.slice(77, 82), 'last'];
const pathOf = (n) => `src/${run(n)}<img src=x>@octocat #12${run(n)}.test.ts`;
const OTHER_PATHS = ['src/a|b|c.test.ts', 'src/x)y.test.ts', 'src/x]y.test.ts', 'src/@octocat/#12.test.ts', 'src/javascript:alert(1).test.ts', 'src/![i](https:/evil.example/p.png).test.ts', `src/${run(80)}<details>${run(80)}.test.ts`];

/** A pull request: files at base, files at head, and how many folded lists (<details>) the Action itself writes. */
const CASES = [
  { name: 'backtick runs 1–100 and the 80 of Codex in test names', base: { 'src/names.test.ts': testFile([...RUN_NAMES, CODEX].map(literalSafe), 'test')('') }, head: { 'src/names.test.ts': testFile([...RUN_NAMES, CODEX], 'test')('.skip') }, details: 0 },
  { name: 'mentions, references, a SHA, links, HTML, |, ), ] and 10,000 characters in test names', base: { 'src/other.test.ts': testFile(OTHER_NAMES.map(literalSafe), 'test')('') }, head: { 'src/other.test.ts': testFile(OTHER_NAMES, 'test')('.skip') }, details: 0 },
  { name: 'the folded list of a grouped warning', base: { 'src/globals.test.js': testFile(FOLDED.map(literalSafe), 'it')('') }, head: { 'src/globals.test.js': testFile(FOLDED, 'it')('.skip') }, details: 1 },
  ...[[1, 34], [35, 67], [68, 100]].map(([from, to]) => ({
    name: `backtick runs ${from}–${to} in removed files' paths`,
    base: Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [pathOf(from + i), testFile(['kept'], 'test')('')])),
    head: { 'src/keep.ts': 'export {};\n' },
    details: 0,
  })),
  { name: "|, ), ], a mention, a reference, a scheme and an image in removed files' paths", base: Object.fromEntries(OTHER_PATHS.map((p) => [p, testFile(['kept'], 'test')('')])), head: { 'src/keep.ts': 'export {};\n' }, details: 0 },
];

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'oracle', GIT_AUTHOR_EMAIL: 'oracle@example.com', GIT_COMMITTER_NAME: 'oracle', GIT_COMMITTER_EMAIL: 'oracle@example.com' };
const git = (cwd, args, options = {}) =>
  execFileSync('git', ['-c', 'core.protectNTFS=false', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', env: { ...ENV, ...options.env }, input: options.input, maxBuffer: 1 << 28 }).trim();

/** A commit of exactly `files` (no working tree: paths the file system could not hold are fine). */
function commit(repo, files, parent, message) {
  const env = { GIT_INDEX_FILE: join(repo, '.git', `index-${message}`) };
  for (const [path, content] of Object.entries(files)) {
    const blob = git(repo, ['hash-object', '-w', '--stdin'], { input: content });
    git(repo, ['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], { env });
  }
  const tree = git(repo, ['write-tree'], { env });
  return git(repo, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message]);
}

/**
 * The fake GitHub API the Action posts to: no comment yet on the pull request (GET: an empty list), and each comment
 * posted (POST) kept, by the request's path.
 */
function fakeGitHub() {
  const posted = new Map();
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET') return res.end('[]');
      posted.set(req.url, JSON.parse(Buffer.concat(chunks).toString('utf8')).body);
      res.statusCode = 201;
      res.end(JSON.stringify({ id: 1, html_url: '' }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, posted, base: `http://127.0.0.1:${server.address().port}` })));
}

/** The bundle's run: its exit code, stdout and stderr. */
function runBundle(cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BUNDLE], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** The body the Action posts for a case (pull request 1 of this repository), and its verdict. */
async function commentOf(dir, c, api) {
  const repo = join(dir, 'repo');
  git(dir, ['init', '-q', repo]);
  const base = commit(repo, c.base, null, 'base');
  const head = commit(repo, c.head, base, 'head');
  writeFileSync(join(dir, 'event.json'), JSON.stringify({ pull_request: { number: 1, base: { sha: base }, head: { sha: head } } }));
  writeFileSync(join(dir, 'output'), '');
  // The environment GitHub gives a JavaScript action on a pull_request job: the inputs with their defaults (hyphens
  // kept), the event, the workspace, the API. Nothing else of this process's own GITHUB_* reaches it.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GITHUB_') && !k.startsWith('INPUT_')));
  const result = await runBundle(repo, {
    ...env,
    GITHUB_EVENT_PATH: join(dir, 'event.json'),
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_WORKSPACE: repo,
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_API_URL: api.base,
    GITHUB_OUTPUT: join(dir, 'output'),
    'INPUT_FAIL-ON': 'none',
    INPUT_EXCLUDE: '',
    INPUT_COMMENT: 'true',
    'INPUT_GITHUB-TOKEN': 'none',
  });
  const path = `/repos/${REPOSITORY}/issues/1/comments`;
  const body = api.posted.get(path) ?? null;
  api.posted.clear();
  const verdict = /^verdict=(.*)$/m.exec(readFileSync(join(dir, 'output'), 'utf8'))?.[1] ?? null;
  if (result.code !== 0 || body === null) throw new Error(`${c.name}: no comment posted (exit ${result.code}, verdict ${verdict}): ${(result.stdout + result.stderr).trim().slice(0, 400)}`);
  return { body, verdict };
}

/** GitHub's rendering of `text`, as an issue comment of this repository would show it. */
function render(dir, text) {
  const input = join(dir, 'markdown.json');
  writeFileSync(input, JSON.stringify({ text, mode: 'gfm', context: REPOSITORY }));
  return execFileSync('gh', ['api', '-X', 'POST', '/markdown', '--input', input], { encoding: 'utf8', maxBuffer: 1 << 28 });
}

/** The elements GitHub writes for the Action's own Markdown (headings, lists, emphasis, code, links, <sub>, <details>, the icons' emoji). */
const ELEMENTS = new Set(['div', 'h3', 'a', 'svg', 'path', 'p', 'ul', 'li', 'strong', 'em', 'code', 'sub', 'hr', 'details', 'summary', 'br', 'g-emoji']);

/** What in GitHub's HTML did not come from the Action: one line per offending element. */
function offences(html, details) {
  const out = [];
  for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g)) {
    const [tag, name, attrs] = [m[0], m[1].toLowerCase(), m[2]];
    if (!ELEMENTS.has(name)) out.push(`element <${name}>: ${tag.slice(0, 160)}`);
    if (/\b(user-mention|team-mention|issue-link|commit-link)\b/.test(attrs)) out.push(`reference: ${tag.slice(0, 160)}`);
    if (name === 'a') {
      const href = /\bhref="([^"]*)"/.exec(attrs)?.[1] ?? '';
      const anchor = /\bclass="anchor"/.test(attrs) && /^#[a-z0-9-]+$/.test(href);
      if (!anchor && !href.startsWith(BLOB)) out.push(`link: ${tag.slice(0, 160)}`);
    }
  }
  const found = (html.match(/<details\b/g) ?? []).length;
  if (found !== details) out.push(`${found} <details>, the Action writes ${details}`);
  return out;
}

const keep = process.argv.includes('--keep');
const root = mkdtempSync(join(tmpdir(), 'saidvsdid-gfm-'));
let failed = 0;
const api = await fakeGitHub();
try {
  for (const [i, c] of CASES.entries()) {
    const dir = join(root, String(i));
    mkdirSync(dir);
    const { body, verdict } = await commentOf(dir, c, api);
    const html = render(dir, body);
    writeFileSync(join(dir, 'comment.md'), body);
    writeFileSync(join(dir, 'comment.html'), html);
    // A finding the size limit leaves out is a payload not rendered: the case would prove nothing.
    const bad = [...offences(html, c.details), ...(/more findings? not shown/.test(body) ? ['findings left out by the size limit: split the case'] : [])];
    const sizes = `${body.length} characters of Markdown, ${html.length} of HTML`;
    console.log(`${bad.length === 0 ? 'inert ' : 'UNSAFE'}  ${c.name} (verdict ${verdict}; ${sizes})`);
    for (const b of bad.slice(0, 12)) console.log(`        ${b}`);
    if (bad.length > 12) console.log(`        … ${bad.length - 12} more`);
    if (bad.length > 0) failed++;
  }
} catch (e) {
  console.error(`could not run: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 2;
}
api.server.close();
if (keep) console.log(`kept: ${root}`);
else rmSync(root, { recursive: true, force: true });
if (process.exitCode !== 2) {
  console.log(failed === 0 ? `all ${CASES.length} cases inert in GitHub's rendering` : `${failed} of ${CASES.length} cases not inert`);
  process.exitCode = failed === 0 ? 0 : 1;
}

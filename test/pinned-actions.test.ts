// Every action this repository runs from elsewhere is pinned by its full commit SHA, with the release it is as a
// comment: `uses: actions/checkout@<40 hex> # v4.4.0` (.github/dependabot.yml keeps both current). A tag or a branch
// can be moved to other code after the review; a commit cannot. Read in action.yml (users inherit it) and in every
// workflow under .github/. Fails closed: a line that names `uses:` and is not one of the forms below fails, and so
// does a file with no `uses:` it can read where one is written.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

/** Every `uses` value of a parsed document, wherever it is (a step, a job calling a workflow, a flow mapping). */
function usesValues(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(usesValues);
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([k, v]) => (k === 'uses' ? [String(v)] : usesValues(v)));
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function yamlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? yamlFiles(p) : /\.ya?ml$/.test(e) ? [p] : [];
  });
}

const FILES = [join(ROOT, 'action.yml'), ...yamlFiles(join(ROOT, '.github'))];

/** One `uses:` line: the step key or a job's reusable workflow, its value (quoted or not), and a comment. */
const USES = /^\s*(?:-\s+)?uses:\s*(?:"([^"]*)"|'([^']*)'|([^\s#'"]+))\s*(?:#\s*(.*?))?\s*$/;
/** A local action or workflow of this repository: nothing to pin. */
const LOCAL = /^\.\/[A-Za-z0-9._/-]*$/;
/** owner/repo[/path]@<40 hex>, and the release as a comment. */
const PINNED = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?@[0-9a-f]{40}$/;
const RELEASE = /^v\d+(?:\.\d+){0,2}$/;

/** Why a `uses:` line is not pinned, or null. */
function unpinned(line: string): string | null {
  const m = USES.exec(line);
  if (!m) return 'a `uses:` this test does not read';
  const value = m[1] ?? m[2] ?? m[3] ?? '';
  const comment = m[4] ?? null;
  if (LOCAL.test(value)) return null;
  if (value.startsWith('docker://')) return /@sha256:[0-9a-f]{64}$/.test(value) ? null : 'a Docker image not pinned by its digest';
  if (!PINNED.test(value)) return 'not pinned by a full commit SHA';
  if (comment === null || !RELEASE.test(comment)) return 'no release comment (`# vX.Y.Z`) after the SHA';
  return null;
}

/**
 * What is not pinned in a YAML file: each line that names `uses` outside a comment, read by the forms above (any
 * other is a problem), and the document parsed: every `uses` it holds must be one of the lines read.
 */
function problems(text: string): string[] {
  const bad: string[] = [];
  const read: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!/\buses\b/.test(line.replace(/#.*$/, ''))) return;
    const why = unpinned(line);
    if (why !== null) bad.push(`line ${i + 1}: ${line.trim()} — ${why}`);
    else read.push(USES.exec(line)!.slice(1, 4).find((v) => v !== undefined)!);
  });
  const parsed = usesValues(parseYaml(text, { strict: true, uniqueKeys: true })).sort();
  if (JSON.stringify(parsed) !== JSON.stringify(read.sort())) bad.push(`the YAML holds uses ${JSON.stringify(parsed)}, the lines read ${JSON.stringify(read)}`);
  return bad;
}

describe('every external action is pinned by its full commit SHA', () => {
  it('the files read include action.yml and the workflows', () => {
    const names = FILES.map((f) => relative(ROOT, f).replace(/\\/g, '/'));
    expect(names).toContain('action.yml');
    expect(names).toContain('.github/workflows/ci.yml');
    expect(names).toContain('.github/workflows/full-ci.yml');
  });

  it.each(FILES.map((f) => [relative(ROOT, f).replace(/\\/g, '/'), f]))('%s', (_name, file) => {
    expect(problems(readFileSync(file, 'utf8'))).toEqual([]);
  });

  // Codex, review of #8: a quoted key is valid YAML that a line scanner may not see.
  it.each([
    ['a quoted key', 'jobs:\n  a:\n    steps:\n      - "uses": actions/checkout@v4\n'],
    ["a key in single quotes", "jobs:\n  a:\n    steps:\n      - 'uses': actions/checkout@v4\n"],
    ['a flow mapping', 'jobs:\n  a:\n    steps: [{ uses: actions/checkout@v4 }]\n'],
  ])('refuses a `uses` in another form: %s', (_name, text) => {
    expect(problems(text)).not.toEqual([]);
  });

  it.each([
    ['      - uses: actions/checkout@v4', 'not pinned by a full commit SHA'],
    ['      - uses: actions/checkout@main', 'not pinned by a full commit SHA'],
    ['      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af67726', 'not pinned by a full commit SHA'],
    ['      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262', 'no release comment (`# vX.Y.Z`) after the SHA'],
    ['      - uses: "actions/checkout@v4" # v4', 'not pinned by a full commit SHA'],
    ['    uses: octo/repo/.github/workflows/w.yml@v1', 'not pinned by a full commit SHA'],
    ['      - uses: docker://alpine:3.20', 'a Docker image not pinned by its digest'],
    ['      - { uses: actions/checkout@v4 }', 'a `uses:` this test does not read'],
  ])('refuses %s', (line, why) => {
    expect(unpinned(line)).toBe(why);
  });

  it.each([
    '      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0',
    "      - uses: 'actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065' # v5.6.0",
    '    uses: ./.github/workflows/full-ci.yml',
    '        uses: ./',
  ])('accepts %s', (line) => {
    expect(unpinned(line)).toBeNull();
  });
});

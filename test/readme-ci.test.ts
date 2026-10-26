// The README shows what the tool prints and what this repository runs: its example comment and CLI output are the
// renderings of fixtures/action/demo, its workflow is the Action with its default (it blocks nothing), and the CI's
// dogfood step is the same Action, from this checkout, blocking on FAIL or worse.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureRepo } from '../fixtures/build.js';
import { runCheck } from '../src/check.js';
import { COMMENT_MARKER, renderComment } from '../src/report/comment.js';
import type { Report } from '../src/report/model.js';
import { renderText } from '../src/report/text.js';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const example = readFileSync(new URL('../.github/workflows/example.yml', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { repository: { url: string } };

/** The README's text between `<!-- example:NAME -->` and `<!-- /example:NAME -->`. */
function block(name: string): string {
  const start = readme.indexOf(`<!-- example:${name} -->\n`);
  const end = readme.indexOf(`<!-- /example:${name} -->`);
  expect(start, `example:${name}`).toBeGreaterThan(-1);
  expect(end, `/example:${name}`).toBeGreaterThan(start);
  return readme.slice(start + `<!-- example:${name} -->\n`.length, end);
}

const fence = (text: string, lang: string): string => {
  expect(text.startsWith(`\`\`\`${lang}\n`) && text.endsWith('```\n'), `a ${lang} code block`).toBe(true);
  return text.slice(`\`\`\`${lang}\n`.length, -'```\n'.length);
};

const tmp = mkdtempSync(join(tmpdir(), 'saidvsdid-readme-'));
let demo: Report;

beforeAll(async () => {
  const r = buildFixtureRepo(fileURLToPath(new URL('../fixtures/action/demo', import.meta.url)), join(tmp, 'demo'));
  demo = await runCheck({ repo: r.repo, base: r.base, head: r.head });
}, 120_000);

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("the README's examples are what the tool prints on fixtures/action/demo", () => {
  it('the comment, as the Action posts it (quoted, without its marker line or links)', () => {
    const body = renderComment(demo, { link: null, failOn: 'none' });
    expect(body.startsWith(`${COMMENT_MARKER}\n`)).toBe(true);
    const quoted = body
      .slice(COMMENT_MARKER.length + 1)
      .trimEnd()
      .split('\n')
      .map((l) => (l === '' ? '>' : `> ${l}`))
      .join('\n');
    expect(block('comment')).toBe(`${quoted}\n`);
  });

  it('the command line', () => {
    expect(fence(block('cli'), 'text')).toBe(renderText(demo));
  });
});

describe("the README's workflow and the CI's dogfood step", () => {
  const workflow = fence(block('workflow'), 'yaml');
  const repo = /github\.com\/([^/]+\/[^/.]+)/.exec(pkg.repository.url)![1]!;
  // Pinned by its full commit SHA, with the release as a comment (test/pinned-actions.test.ts).
  const CHECKOUT = /- uses: actions\/checkout@[0-9a-f]{40} # v\d+\.\d+\.\d+\n        with:\n          fetch-depth: 0\n/;
  const pinned = (text: string): string | null => new RegExp(`      - uses: ${repo}@[0-9a-f]{40} # v\\d+\\.\\d+\\.\\d+\\n`).exec(text)?.[0] ?? null;
  const ours = pinned(workflow);

  it('the README: on pull requests, the minimal permissions, the whole history, and the Action pinned, with its default', () => {
    expect(workflow).toContain('on: pull_request\n');
    expect(workflow).toContain('permissions:\n  contents: read\n  pull-requests: write\n\n');
    expect(workflow).toMatch(CHECKOUT);
    expect(ours).not.toBeNull();
    expect(workflow.endsWith(ours!)).toBe(true);
    expect(workflow).not.toMatch(/fail-on|secrets\./);
  });

  it('the README names `@v0` as the alternative, and its risk', () => {
    expect(readme).toContain(`\`${repo}@v0\` is the convenient alternative`);
    expect(readme).toContain('a tag can be moved');
  });

  it('the CI: the same Action from this checkout, blocking on FAIL or worse, without its fixtures and its example', () => {
    expect(ci).toMatch(/    permissions:\n      contents: read\n      pull-requests: write\n/);
    expect(ci).toMatch(CHECKOUT);
    expect(ci).toContain("      - name: Check this PR\n        if: github.event_name == 'pull_request' && github.head_ref != 'example/weakened-tests' && (success() || failure())\n        uses: ./\n        with:\n          fail-on: fail\n          exclude: |\n            fixtures/**\n            examples/**\n");
  });

  it('the example pull request: the published Action as the README pins it, with its default, on that branch alone', () => {
    expect(example).toContain("    if: github.head_ref == 'example/weakened-tests' && github.event.pull_request.head.repo.full_name == github.repository\n");
    expect(example).toContain('permissions:\n  contents: read\n  pull-requests: write\n');
    expect(example).toMatch(CHECKOUT);
    expect(example.endsWith(ours!)).toBe(true);
    expect(example).not.toMatch(/fail-on|exclude|secrets\./);
  });

  it('how to block is the input the Action reads', () => {
    expect(readme).toContain(`${ours!}        with:\n          fail-on: fail   # or: warn\n`);
  });
});

// The README's pins are the ones this repository runs: Dependabot updates the workflows' SHAs and release comments, not
// the README, so every `uses:` of the README must be, exactly (SHA and comment), the pin the workflows hold for that
// action, and the workflows must agree on it. A Dependabot pull request that fails here gets the README's update on its
// branch (CLAUDE.md, Workflow, 9).
describe("the README's `uses:` are the workflows' pins", () => {
  const WORKFLOWS = fileURLToPath(new URL('../.github/workflows/', import.meta.url));
  /** Every `uses: owner/repo@ref # comment` of a text: the action, and the line's value from the action on. */
  const pins = (text: string): Array<{ action: string; pin: string }> =>
    [...text.matchAll(/^\s*-?\s*uses:\s*(\S+?)@(\S+)(.*)$/gm)].map((m) => ({ action: m[1]!, pin: `${m[1]}@${m[2]}${m[3]!.trimEnd()}` }));
  const workflowPins = readdirSync(WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .flatMap((f) => pins(readFileSync(join(WORKFLOWS, f), 'utf8')).filter((p) => !p.action.startsWith('./')));
  const readmePins = pins(readme);

  it('the README has its pins (actions/checkout and the Action)', () => {
    expect(readmePins.map((p) => p.action)).toContain('actions/checkout');
    expect(readmePins.length).toBeGreaterThan(1);
  });

  it.each(readmePins.map((p) => [p.action, p.pin]))('%s: %s', (action, pin) => {
    const held = [...new Set(workflowPins.filter((p) => p.action === action).map((p) => p.pin))];
    expect(held, `the workflows' pins of ${action}`).toEqual([pin]);
  });
});

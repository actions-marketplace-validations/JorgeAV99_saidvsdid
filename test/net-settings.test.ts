// Safety nets for TG005: timeout/retry settings the analyzer could not
// attribute in a test file never end in PASS (without turning every
// `{ timeout: 1000 }` in test data into a warning), and a test-configuration
// token added to a runner config file warns whatever the readers understood.
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/check.js';
import type { FileChange } from '../src/git/diff.js';
import { rawTopLevelMembers } from '../src/config/json.js';
import { countConfigTokens, countSettings, packageJsonChange } from '../src/rules/net.js';

async function verdict(files: Record<string, [string | null, string | null]>): Promise<{ verdict: string; findings: string[] }> {
  const changes: FileChange[] = Object.entries(files).map(([path, [b, h]]) => ({
    status: b === null ? 'A' : h === null ? 'D' : 'M',
    basePath: b === null ? null : path,
    headPath: h === null ? null : path,
  }));
  const report = await analyze({
    base: '0'.repeat(40),
    head: '1'.repeat(40),
    changes,
    read: (side, path) => files[path]?.[side === 'base' ? 0 : 1] ?? null,
    list: (side) => Object.keys(files).filter((p) => files[p]![side === 'base' ? 0 : 1] !== null),
  });
  return { verdict: report.verdict, findings: report.findings.map((f) => `${f.rule} ${f.severity} ${f.file}: ${f.message}`) };
}

describe('settings safety net', () => {
  it('counts runner timeout/retry calls and pytest marks, not option keys in test data', async () => {
    const ts = `// jest.retryTimes(3)\nconst s = "jest.setTimeout(1)";\nconst client = { retry: 3, timeout: 60_000 };\njest.retryTimes(2);\ntest.setTimeout(1);\ntest.slow();\nthis.timeout(5);\n`;
    expect(await countSettings('a.test.ts', ts)).toEqual({ scope: 0, retry: 1, timeout: 3 });
    const py = `# @pytest.mark.flaky\n@pytest.mark.flaky(reruns=2)\n@pytest.mark.timeout(5)\ndef test_a(): requests.get(u, timeout=3)\n`;
    expect(await countSettings('test_a.py', py)).toEqual({ scope: 0, retry: 1, timeout: 1 });
  });

  it('a new test file with timeouts in its own data is not a finding', async () => {
    const head = `const client = makeClient({ timeout: 1000, retries: 2 });\nit('fetches', async () => { expect(await client.get('/')).toBe(1); });\n`;
    expect(await verdict({ 'client.test.ts': [null, head] })).toEqual({ verdict: 'OK', findings: [] });
  });

  it('options passed through a variable cannot be read: TG005 says so', async () => {
    const base = `it('a', () => { expect(1).toBe(1); });\n`;
    const head = `const opts = { retry: 3 };\nit('a', opts, () => { expect(1).toBe(1); });\n`;
    expect(await verdict({ 'a.test.ts': [base, head] })).toEqual({
      verdict: 'WARN',
      findings: ['TG005 warn a.test.ts: Test "a" takes its options from `opts`, which may set a timeout or retries: they cannot be read'],
    });
  });

  it('a retry count that is not a literal cannot be compared: TG005 says so', async () => {
    const cfg = (extra: string): string => `import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: 'e2e'${extra} });\n`;
    expect(await verdict({ 'playwright.config.ts': [cfg(''), cfg(', retries: process.env.CI ? 2 : 0')] })).toEqual({
      verdict: 'WARN',
      findings: ['TG005 warn playwright.config.ts: `retries`: set to `process.env.CI ? 2 : 0`, which cannot be read'],
    });
  });

  it('a setting hidden behind a spread in a JS config never passes', async () => {
    const cfg = (shared: string): string => `import { defineConfig } from 'vitest/config';\nconst shared = { ${shared} };\nexport default defineConfig({ test: { ...shared } });\n`;
    const r = await verdict({ 'vitest.config.ts': [cfg("environment: 'node'"), cfg("environment: 'node', retry: 2")], 'a.test.ts': [`it('a', () => {});\n`, `it('a', () => {});\n`] });
    expect(r).toEqual({ verdict: 'WARN', findings: ['TG005 warn vitest.config.ts: Test runner config changed; review manually: saidvsdid found no specific change in the settings it reads, and the file decides which tests run (more occurrences of `retry` 0 → 1)'] });
  });

  // The config net does not depend on what the readers understood (Codex review, M2):
  // the price is a WARN for settings that are harmless, which a human dismisses.
  it('a content change without a TG005 finding warns, even with no scope token (reporters)', async () => {
    const cfg = (extra: string): string => `import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { environment: 'node'${extra} } });\n`;
    const r = await verdict({ 'vitest.config.ts': [cfg(''), cfg(", reporters: ['dot']")], 'a.test.ts': [`it('a', () => {});\n`, `it('a', () => {});\n`] });
    expect(r).toEqual({ verdict: 'WARN', findings: ['TG005 warn vitest.config.ts: Test runner config changed; review manually: saidvsdid found no specific change in the settings it reads, and the file decides which tests run'] });
  });

  // The 0.2.0 audit: pypa/packaging's conftest.py edits got "the analyzer did not report anything specific about it".
  it('a conftest.py change says what the file is and that saidvsdid does not analyse it', async () => {
    const r = await verdict({ 'tests/conftest.py': ['import pytest\n', 'import pytest\n\n\ndef pytest_collection_finish(session):\n    pass\n'] });
    expect(r.findings).toEqual(['TG005 warn tests/conftest.py: Test runner config changed; review manually: `conftest.py` can change which tests run and how (hooks, fixtures, marks), and saidvsdid does not analyse it']);
  });

  describe('package.json: the scripts that run tests and the test-runner keys only, compared strictly', () => {
    const run = async (base: object | string, head: object | string): Promise<string[]> => {
      const text = (x: object | string): string => (typeof x === 'string' ? x : JSON.stringify(x, null, 2));
      return (await verdict({ 'package.json': [text(base), text(head)] })).findings;
    };
    const msg = (why: string): string => `TG005 warn package.json: Test runner config changed; review manually: ${why}`;

    it('a dependency bump or another key is out of scope', async () => {
      expect(await run({ scripts: { test: 'vitest run' }, devDependencies: { vitest: '4.0.0' } }, { scripts: { test: 'vitest run' }, devDependencies: { vitest: '4.1.0' }, type: 'module' })).toEqual([]);
    });

    it('the scripts that run tests are watched: test, test:*, their hooks and what they name, to a fixed point', async () => {
      expect(await run({ scripts: { test: 'npm run t', t: 'vitest run', build: 'tsc' } }, { scripts: { test: 'npm run t', t: 'vitest run tests/unit', build: 'tsc' } })).toEqual([msg('the `t` script changed')]);
      expect(await run({ scripts: { 'test:unit': 'vitest run' } }, { scripts: { 'test:unit': 'vitest run test/api' } })).toEqual([msg('the `test:unit` script changed')]);
      expect(await run({ scripts: { test: 'vitest run', pretest: 'tsc' } }, { scripts: { test: 'vitest run', pretest: 'tsc -b' } })).toEqual([msg('the `pretest` script changed')]);
      expect(await run({ scripts: { test: 'npm run t', t: 'run-s unit', unit: 'vitest run' } }, { scripts: { test: 'npm run t', t: 'run-s unit', unit: 'vitest run a' } })).toEqual([msg('the `unit` script changed')]);
    });

    it('other scripts, a script the PR adds and a removed script that runs no test are out of scope', async () => {
      expect(await run({ scripts: { test: 'vitest run', build: 'tsc' } }, { scripts: { test: 'vitest run', build: 'tsc -b' } })).toEqual([]);
      expect(await run({ scripts: { test: 'vitest run' } }, { scripts: { test: 'vitest run', 'test:smoke': 'node smoke.mjs' } })).toEqual([]);
      expect(await run({ scripts: { test: 'vitest run', lint: 'eslint' } }, { scripts: { test: 'vitest run' } })).toEqual([]);
    });

    it('a test script removed is a change; reordering scripts is not (each test script is compared as written)', async () => {
      expect(await run({ scripts: { test: 'vitest run', 'test:e2e': 'playwright test' } }, { scripts: { test: 'vitest run' } })).toEqual([msg('the `test:e2e` script changed')]);
      expect(await run({ scripts: { test: 'vitest run', lint: 'eslint' } }, { scripts: { lint: 'eslint', test: 'vitest run' } })).toEqual([]);
    });

    it.each(['jest', 'vitest', 'mocha', 'ava', 'c8', 'nyc'])('the `%s` key is watched', async (key) => {
      expect(await run({ scripts: {} }, { scripts: {}, [key]: { x: 1 } })).toEqual([msg(`\`${key}\` changed`)]);
    });

    it('invalid JSON or a duplicate key anywhere always warns', async () => {
      // Invalid JSON: TG005 itself already warns (its reading of the file changed); never a PASS.
      expect((await verdict({ 'package.json': [JSON.stringify({ scripts: {} }), '{ "scripts": {}, }'] })).verdict).toBe('WARN');
      expect(packageJsonChange('{ "scripts": {} }', '{ "scripts": {}, }')).toBe('package.json cannot be read with certainty (expected a string at offset 17), so any change counts');
      expect(packageJsonChange('{ "scripts": {}, }', '{ "scripts": {} }')).toBe('package.json cannot be read with certainty at base (expected a string at offset 17), so any change counts');
      expect(await run({ scripts: {} }, '{ "scripts": {}, "devDependencies": { "a": "1", "a": "2" } }')).toEqual([
        msg('package.json cannot be read with certainty (duplicate key "a"), so any change counts'),
      ]);
    });

    it('compares the raw text of the watched sections: no parsed-value equality', () => {
      // JSON.stringify turns both 1e309 and null into null; the raw text differs.
      expect(packageJsonChange('{ "c8": { "lines": 1e309 } }', '{ "c8": { "lines": null } }')).toBe('`c8` changed');
      // A test script is compared as written (its raw JSON string): an escape that reads the same still counts.
      expect(packageJsonChange('{ "scripts": { "test": "x" } }', '{ "scripts": { "test": "\\' + 'u0078" } }')).toBe('the `test` script changed');
      // Outside the watched sections, nothing counts.
      expect(packageJsonChange('{ "scripts": {}, "version": "1.0.0" }', '{ "scripts": {},  "version": "1.0.1" }')).toBeNull();
    });
  });

  describe('rawTopLevelMembers: certain or an anomaly', () => {
    it('returns the raw text of each top-level member', () => {
      expect(rawTopLevelMembers('{ "a": [1, {"b": "\\u00e9"}], "c" :true }')).toEqual({ members: new Map([['a', '[1, {"b": "\\u00e9"}]'], ['c', 'true']]) });
    });

    it.each([
      ['\uFEFF{ "a": 1 }', 'byte-order mark'],
      ['{ "a": "\uFFFD" }', 'bytes that are not valid UTF-8'],
      ['{ "scr\\u0069pts": {} }', 'key "scr\\u0069pts" is written with escapes'],
      ['{ "a": { "b": 1, "b": 2 } }', 'duplicate key "b"'],
      ['{ "a": 1 } x', 'content after the object at offset 11'],
      ['[1]', 'the root is not an object'],
      ['{ "a": 01 }', 'expected , or } at offset 8'],
      ['{ "a": "\\x" }', 'invalid escape at offset 8'],
    ])('%j → %s', (text, anomaly) => {
      expect(rawTopLevelMembers(text)).toEqual({ anomaly });
    });
  });

  it('the config net warns even where the reader understood the change (coverage.exclude)', async () => {
    const cfg = (cov: string): string => `import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { coverage: { ${cov} } } });\n`;
    const r = await verdict({ 'vitest.config.ts': [cfg(''), cfg("exclude: ['src/generated/**']")], 'a.test.ts': [`it('a', () => {});\n`, `it('a', () => {});\n`] });
    expect(r).toEqual({ verdict: 'WARN', findings: ['TG005 warn vitest.config.ts: Test runner config changed; review manually: saidvsdid found no specific change in the settings it reads, and the file decides which tests run (more occurrences of `exclude` 0 → 1)'] });
  });

  it('the config net warns on a stricter pytest timeout too', async () => {
    const r = await verdict({ 'pytest.ini': ['[pytest]\n', '[pytest]\ntimeout = 10\n'], 'tests/test_a.py': ['def test_a():\n    assert 1\n', 'def test_a():\n    assert 1\n'] });
    expect(r.verdict).toBe('WARN');
  });

  it('the config net stays quiet when TG005 already reported the file', async () => {
    const r = await verdict({ 'pytest.ini': ['[pytest]\n', '[pytest]\naddopts = --ignore=tests/legacy\n'], 'tests/legacy/test_a.py': ['def test_a():\n    assert 1\n', 'def test_a():\n    assert 1\n'] });
    expect(r.findings.filter((f) => f.includes('review manually'))).toEqual([]);
    expect(r.findings).toHaveLength(1);
  });

  it('counts config tokens in the watched sections of package.json, not in comments', async () => {
    const pkg = JSON.stringify({ scripts: { test: 'vitest run --retry=2', 'test:e2e': 'playwright test --retries 1', lint: 'eslint --ignore-path .gitignore' }, jest: { testTimeout: 1 } });
    const counts = await countConfigTokens('package.json', pkg);
    expect([counts.retry, counts.retries, counts.timeout, counts.ignore]).toEqual([1, 1, 1, 2]); // lint: --ignore-path .gitignore
    expect((await countConfigTokens('pytest.ini', '[pytest]\n# addopts = -k slow\naddopts = -q\n'))['-k']).toBe(0);
    expect((await countConfigTokens('vitest.config.ts', "// retry: 2\nexport default { test: { exclude: ['x'] } };\n")).retry).toBe(0);
  });
});

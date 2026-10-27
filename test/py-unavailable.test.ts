// Without a Python that reads the file (none found here: SAIDVSDID_PYTHON names one that does not
// exist), nothing in a Python test file is certainly the runner's: no FAIL, and the file gets one WARN
// saying why — never silence. The interpreter is looked for once per process, and vitest runs each
// test file in its own module registry, so the setting holds for this file only.
import { describe, expect, it } from 'vitest';

process.env['SAIDVSDID_PYTHON'] = 'saidvsdid-no-such-python';
const { analyze } = await import('../src/check.js');
const { runtimeOf } = await import('../src/parse/py-scopes.js');

describe('no Python interpreter', () => {
  it('a certain skip becomes a WARN, and the file says why once', async () => {
    const base = 'import pytest\n\n\ndef test_t():\n    assert 1 == 1\n';
    const head = 'import pytest\n\n\ndef test_t():\n    pytest.skip("x")\n    assert 1 == 1\n';
    const report = await analyze({
      base: '0'.repeat(40),
      head: '1'.repeat(40),
      changes: [{ status: 'M', basePath: 'test_a.py', headPath: 'test_a.py' }],
      read: (side, path) => (path === 'test_a.py' ? (side === 'base' ? base : head) : null),
    });
    expect(report.verdict).toBe('WARN');
    expect(report.findings.map((f) => [f.rule, f.severity, f.line, f.reason ?? null])).toEqual([
      ['TG003', 'warn', null, 'scope_unavailable'],
      ['TG003', 'warn', 5, null],
    ]);
    expect(report.findings[0]!.message).toMatch(/no Python interpreter runs the scope reader/);
    expect(report.tool.scopes?.python).toBeNull();
    expect(report.tool.scopes?.python_unavailable).toMatch(/no Python interpreter runs the scope reader/);
    // How to fix it, for both places it runs: the Action's runner and anywhere else.
    expect(report.tool.scopes?.python_remedy).toMatch(/add actions\/setup-python with python-version 3\.11 or later before saidvsdid/);
    expect(report.tool.scopes?.python_remedy).toMatch(/SAIDVSDID_PYTHON/);
  });
});

describe('a Python older than 3.11', () => {
  const reply = { python: '3.10.12', supported: false, tested: false, why: 'Python 3.10.12 is older than the oldest supported version (3.11)' };

  it('names the version and the executable saidvsdid ran, and how to fix it on GitHub Actions and elsewhere', () => {
    expect(runtimeOf(reply, 'python3', undefined)).toEqual({
      known: false,
      version: '3.10.12',
      why: 'Python 3.10.12 (python3) is older than 3.11, the oldest saidvsdid reads',
      remedy: 'on GitHub Actions, add actions/setup-python with python-version 3.11 or later before saidvsdid; elsewhere, put one first on PATH or set SAIDVSDID_PYTHON to it',
    });
  });

  it('with SAIDVSDID_PYTHON set, the remedy is to change it: installing another Python alone does not', () => {
    expect(runtimeOf(reply, '/opt/py310/bin/python', '/opt/py310/bin/python')).toMatchObject({
      why: 'Python 3.10.12 (/opt/py310/bin/python) is older than 3.11, the oldest saidvsdid reads',
      remedy: expect.stringContaining('change SAIDVSDID_PYTHON (now "/opt/py310/bin/python") to one'),
    });
  });

  it('a supported version is read, and an unsupported one that is not older keeps its own reason', () => {
    expect(runtimeOf({ ...reply, python: '3.15.1', supported: true, why: null }, 'python3', undefined)).toEqual({ known: true, command: 'python3', version: '3.15.1', tested: false });
    expect(runtimeOf({ ...reply, python: '3.12.3', why: 'the self-check failed: x' }, 'python3', undefined)).toEqual({ known: false, version: '3.12.3', why: 'the self-check failed: x' });
  });
});

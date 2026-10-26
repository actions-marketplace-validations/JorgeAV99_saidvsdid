// An interpreter newer than the versions CI tests reads the files as any other (docs/rules.md, *Python*): the same
// verdict, and the report records that it is not tested (`tool.scopes.python_untested`). The interpreter here is a
// tested one; what this file replaces is only what the report is told about it.
import { describe, expect, it, vi } from 'vitest';
import type * as PyScopes from '../src/parse/py-scopes.js';

vi.mock('../src/parse/py-scopes.js', async (original) => {
  const real = await original<typeof PyScopes>();
  return {
    ...real,
    pythonRuntimeIfStarted: () => {
      const rt = real.pythonRuntimeIfStarted();
      return rt && rt.known ? { ...rt, version: '3.16.0', tested: false } : rt;
    },
  };
});
const { analyze } = await import('../src/check.js');

describe('an interpreter newer than those tested', () => {
  it('the same FAIL, and the report says it is not tested', async () => {
    const base = 'import pytest\n\n\ndef test_t():\n    assert 1 == 1\n';
    const head = 'import pytest\n\n\n@pytest.mark.skip\ndef test_t():\n    assert 1 == 1\n';
    const report = await analyze({
      base: '0'.repeat(40),
      head: '1'.repeat(40),
      changes: [{ status: 'M', basePath: 'test_a.py', headPath: 'test_a.py' }],
      read: (side, path) => (path === 'test_a.py' ? (side === 'base' ? base : head) : null),
    });
    expect(report.findings.map((f) => [f.rule, f.severity, f.line])).toEqual([['TG003', 'fail', 4]]);
    expect(report.tool.scopes?.python).toBe('3.16.0');
    expect(report.tool.scopes?.python_untested).toMatch(/^Python 3\.16\.0 is newer than the versions saidvsdid's CI tests/);
  });
});

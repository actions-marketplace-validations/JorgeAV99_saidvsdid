// The interpreter that reads Python files in the tests (src/parse/py-scopes.ts), and when a test that
// needs newer syntax may stand down: never in CI, unless the run is one of the CI's Python-version
// matrix (SAIDVSDID_PYTHON_MATRIX), which runs the Python tests on every supported version.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pythonRuntime } from '../../src/parse/py-scopes.js';

/** Whether the interpreter that reads Python files here is at least `version` ("3.12"). */
export function pythonAtLeast(version: string): boolean {
  const rt = pythonRuntime();
  if (!rt.known) return false;
  const [a, b] = rt.version.split('.').map(Number);
  const [x, y] = version.split('.').map(Number);
  return a! > x! || (a === x && b! >= y!);
}

/** Why a test needing Python `version` may not stand down here, or null when it may (an older interpreter, outside the main CI). */
export function olderPythonRefused(version: string): string | null {
  if (process.env['CI'] && process.env['SAIDVSDID_PYTHON_MATRIX'] === undefined) {
    const rt = pythonRuntime();
    return `CI needs Python ${version} (SAIDVSDID_PYTHON)${rt.known ? `, found ${rt.version}` : `: ${rt.why}`}`;
  }
  return null;
}

/** Whether a fixture's sides hold a Python file (the Python-version matrix runs those). */
export function holdsPython(dir: string): boolean {
  const walk = (d: string): boolean =>
    readdirSync(d).some((e) => {
      const p = join(d, e);
      return statSync(p).isDirectory() ? walk(p) : e.endsWith('.py');
    });
  return ['base', 'head'].some((side) => {
    try {
      return walk(join(dir, side));
    } catch {
      return false;
    }
  });
}

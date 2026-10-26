// Exhaustiveness of the Python reading (python/saidvsdid_scopes.py, src/parse/py-binding.ts) against
// the interpreter itself:
// - the script classifies every node class of the running interpreter's `ast` (BINDERS, NONE), and a
//   class with an identifier or a target field is a binder or says why not (--self-check), for the
//   interpreter that reads the files and every other supported one found on this machine;
// - a version older than the script's minimum, or one where the self-check fails, is refused as a whole (a WARN per
//   file, never a reading); one newer than those CI tests is read as any other, and says it is not tested;
// - a probe for each form that binds a name: binding `pytest` makes `@pytest.mark.skip` uncertain, and
//   binding a name to a value that contains a form of the vocabulary makes its use read as the form
//   (at least a WARN), never silence.
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseTestFile } from '../src/parse/index.js';
import { pythonRuntime } from '../src/parse/py-scopes.js';
import { olderPythonRefused } from './support/python.js';

const SCRIPT = fileURLToPath(new URL('../python/saidvsdid_scopes.py', import.meta.url));

function runtime(): { command: string; version: string } {
  const rt = pythonRuntime();
  if (!rt.known) throw new Error(`a supported Python is needed for these tests: ${rt.why}`);
  return rt;
}

const atLeast = (version: string, want: [number, number]): boolean => {
  const [a, b] = version.split('.').map(Number);
  return a! > want[0] || (a === want[0] && b! >= want[1]);
};

describe('the script classifies every ast node class', () => {
  it('the interpreter that reads the files is the one the run asks for (the CI matrix: SAIDVSDID_PYTHON_MATRIX)', () => {
    const matrix = process.env['SAIDVSDID_PYTHON_MATRIX'];
    if (matrix !== undefined) expect(runtime().version.startsWith(`${matrix}.`), runtime().version).toBe(true);
    else expect(runtime().version).toMatch(/^3\.1[1-5]\./);
  });

  it('for the interpreter that reads the files', () => {
    const out = JSON.parse(execFileSync(runtime().command, ['-I', SCRIPT, '--self-check'], { encoding: 'utf8' })) as { why: string | null; classes: string[] };
    expect(out.why).toBeNull();
    expect(out.classes).toContain('NamedExpr');
  });

  it('for every other supported interpreter on this machine', () => {
    const seen: string[] = [];
    for (const minor of [11, 12, 13, 14, 15]) {
      const r = spawnSync(process.platform === 'win32' ? 'py' : `python3.${minor}`, process.platform === 'win32' ? [`-3.${minor}`, '-I', SCRIPT, '--self-check'] : ['-I', SCRIPT, '--self-check'], { encoding: 'utf8' });
      if (r.error || r.status !== 0) continue;
      const out = JSON.parse(r.stdout) as { python: string; why: string | null };
      expect(out.why, out.python).toBeNull();
      seen.push(out.python);
    }
    console.log(`self-check passed on: ${seen.join(', ') || 'no other interpreter found'}`);
  });

  /** The script's reply to one file, run with `patch` applied to the module first (its constants). */
  const patched = (patch: string): { supported: boolean; tested: boolean; why: string | null; files: Record<string, { ok: boolean }> } => {
    const code = [
      'import importlib.util, sys',
      'sys.dont_write_bytecode = True',
      `spec = importlib.util.spec_from_file_location("saidvsdid_scopes", ${JSON.stringify(SCRIPT)})`,
      'm = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(m)',
      patch,
      'm.main()',
    ].join('\n');
    const source = Buffer.from('import pytest\n').toString('base64');
    return JSON.parse(execFileSync(runtime().command, ['-c', code], { input: JSON.stringify({ files: [{ id: 'a', source }] }), encoding: 'utf8' }));
  };

  it('refuses a version older than its minimum, as a whole', () => {
    const out = patched('m.MINIMUM = (99, 0)');
    expect(out.supported).toBe(false);
    expect(out.why).toMatch(/is older than the oldest supported version \(99\.0\)/);
    expect(out.files).toEqual({});
  });

  it('reads a version newer than those it is tested on, and says so', () => {
    const out = patched('m.TESTED = ()');
    expect(out.supported).toBe(true);
    expect(out.tested).toBe(false);
    expect(out.why).toBeNull();
    expect(out.files['a']?.ok).toBe(true);
  });

  it('refuses a version whose ast it does not classify (what a newer Python may add), as a whole', () => {
    const out = patched('m.NONE.discard("Pass")');
    expect(out.supported).toBe(false);
    expect(out.why).toBe('ast node Pass is not classified');
    expect(out.files).toEqual({});
  });
});

/** The certainty of the skip marker on `test_t`. */
async function marker(source: string): Promise<string> {
  const f = await parseTestFile('test_a.py', source);
  const t = f.tests.find((x) => x.name.endsWith('test_t'));
  const m = t?.markers.find((x) => x.kind === 'skip');
  return !t ? 'no test' : !m ? 'no marker' : m.binding.certain ? 'certain' : 'uncertain';
}

const DECORATED = '\n\n@pytest.mark.skip\ndef test_t():\n    pass\n';

describe('every form that binds `pytest` anywhere makes it uncertain', () => {
  const forms: Array<[string, string, [number, number]?]> = [
    ['assignment', 'pytest = 1'],
    ['annotated assignment', 'pytest: int = 1'],
    ['annotation alone', 'pytest: int'],
    ['augmented assignment', 'pytest += 1'],
    ['walrus', '(pytest := 1)'],
    ['unpacking', 'a, *pytest = [1, 2]'],
    ['for target', 'for pytest in []:\n    pass'],
    ['comprehension target', 'xs = [1 for pytest in []]'],
    ['with target', 'with open("x") as pytest:\n    pass'],
    ['except target', 'try:\n    pass\nexcept Exception as pytest:\n    pass'],
    ['del', 'del pytest'],
    ['import', 'import os as pytest'],
    ['from import', 'from os import path as pytest'],
    ['def', 'def pytest():\n    pass'],
    ['class', 'class pytest:\n    pass'],
    ['parameter', 'def f(pytest):\n    pass'],
    ['keyword-only parameter', 'def f(*, pytest=1):\n    pass'],
    ['lambda parameter', 'f = lambda pytest: 1'],
    ['global in a function, then assigned', 'def f():\n    global pytest\n    pytest = 1'],
    ['nonlocal in a function', 'def f():\n    pytest = 1\n\n    def g():\n        nonlocal pytest'],
    ['match capture', 'match 1:\n    case pytest:\n        pass', [3, 10]],
    ['match star', 'match []:\n    case [*pytest]:\n        pass', [3, 10]],
    ['match mapping rest', 'match {}:\n    case {**pytest}:\n        pass', [3, 10]],
    ['type alias', 'type pytest = int', [3, 12]],
    ['type parameter', 'def f[pytest]():\n    pass', [3, 12]],
    ['class type parameter', 'class C[pytest]:\n    pass', [3, 12]],
    ['a star import', 'from os import *'],
  ];
  it.each(forms)('%s', async (_name, form, min) => {
    if (min && !atLeast(runtime().version, min)) {
      expect(olderPythonRefused(min.join('.'))).toBeNull();
      return;
    }
    expect(await marker(`import pytest\n\n${form}\n${DECORATED}`)).toBe('uncertain');
  });

  it('the import alone: certain', async () => {
    expect(await marker(`import pytest\n${DECORATED}`)).toBe('certain');
  });

  // symtable classifies these as the module's global (declared or implicit), and nothing else: no binding.
  it.each([
    ['a `global` declaration with no binding', 'def f():\n    global pytest\n    return pytest'],
    ['a use in a nested function', 'def f():\n    def g():\n        return pytest\n    return g'],
    ['a use in a class body and its method', 'class C:\n    p = pytest\n\n    def m(self):\n        return pytest'],
  ])('%s: certain', async (_name, form) => {
    expect(await marker(`import pytest\n\n${form}\n${DECORATED}`)).toBe('certain');
  });
});

describe('every binding with a value that contains a form of the vocabulary makes an alias', () => {
  const forms: Array<[string, string, [number, number]?]> = [
    ['assignment', 'omit = pytest.mark.skip'],
    ['a call of the form', 'omit = pytest.mark.skip(reason="x")'],
    ['annotated assignment', 'omit: object = pytest.mark.skip'],
    ['augmented assignment', 'omit = None\nomit += pytest.mark.skip'],
    ['walrus', '(omit := pytest.mark.skip)'],
    ['unpacking', '(omit,) = (pytest.mark.skip,)'],
    ['for target', 'for omit in [pytest.mark.skip]:\n    pass'],
    ['with target', 'with pytest.mark.skip as omit:\n    pass'],
    ['parameter default', 'def f(omit=pytest.mark.skip):\n    pass'],
    ['decorated def', '@pytest.mark.skip\ndef omit():\n    pass'],
    ['match capture', 'match pytest.mark.skip:\n    case omit:\n        pass', [3, 10]],
    ['type alias', 'type omit = pytest.mark.skip', [3, 12]],
  ];
  it.each(forms)('%s', async (_name, form, min) => {
    if (min && !atLeast(runtime().version, min)) {
      expect(olderPythonRefused(min.join('.'))).toBeNull();
      return;
    }
    expect(await marker(`import pytest\n\n${form}\n\n\n@omit\ndef test_t():\n    pass\n`)).toBe('uncertain');
  });

  it('a comprehension target and an except target: an element and an instance of the value', async () => {
    expect(await marker('import pytest\n\nxs = [omit for omit in [pytest.mark.skip]]\n\n\n@omit\ndef test_t():\n    pass\n')).toBe('uncertain');
    expect(await marker('import unittest\n\ntry:\n    pass\nexcept unittest.SkipTest as omit:\n    pass\n\n\ndef test_t():\n    raise omit\n')).toBe('uncertain');
  });
});

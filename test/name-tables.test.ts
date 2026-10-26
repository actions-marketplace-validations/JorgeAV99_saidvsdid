// Names read from what saidvsdid analyses are never answered by Object.prototype (src/util/names.ts).
//
// A table looked up by such a name — the analysed code's, a config's, a transcript's, a runner's output, the
// Python scope reader's reply — is a `nameTable` (no prototype), a Map or a Set, or a parsed record seen
// through `ownRecord`. Three checks: every registered table rejects the names of Object.prototype; no object
// literal of the sources typed with a string index escapes `nameTable`/`ownRecord` (the TypeScript checker
// reads the contextual types; the exemptions below are explicit and justified); and the entry points that
// read code, configs and transcripts recognise none of these names as a token, a marker, a runner or a key.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { readConftest } from '../src/config/pytest.js';
import { parseEvidence } from '../src/evidence/schema.js';
import { parseTestFile } from '../src/parse/index.js';
import { validateReply } from '../src/parse/py-scopes.js';
import { contagionUses } from '../src/rules/contagion.js';
import { classifySegment, packageScripts, parseSummary } from '../src/transcript/commands.js';
import { parseClaude } from '../src/transcript/claude.js';
import { nameTables } from '../src/util/names.js';

const PROTOTYPE_NAMES = ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__', '__defineGetter__', 'isPrototypeOf', 'propertyIsEnumerable'];

const ROOT = resolve(__dirname, '..');
/** Modules with a side effect at import (the CLI runs): not imported to register tables. */
const ENTRY_POINTS = new Set(['src/cli.ts']);

function sources(dir = join(ROOT, 'src')): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('every table looked up by a name read from the input', () => {
  it('is registered, has no prototype and answers none of the names of Object.prototype', async () => {
    const files = sources().filter((f) => !ENTRY_POINTS.has(relative(ROOT, f).split('\\').join('/')));
    for (const f of files) await import(pathToFileURL(f).href);
    const declared = new Set(files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\bnameTable\(\s*'([^']+)'/g)].map((m) => m[1]!)));
    const tables = nameTables();
    expect([...declared].filter((id) => !tables.has(id))).toEqual([]);
    expect(tables.size).toBeGreaterThanOrEqual(30);
    for (const [id, table] of tables) {
      expect(Object.getPrototypeOf(table), id).toBeNull();
      expect(Object.isFrozen(table), id).toBe(true);
      for (const name of PROTOTYPE_NAMES) {
        expect((table as Record<string, unknown>)[name], `${id}[${name}]`).toBeUndefined();
        expect(name in table, `${name} in ${id}`).toBe(false);
      }
    }
  });

  it('is never an object literal typed with a string index outside nameTable/ownRecord (the TypeScript checker reads every source)', () => {
    const files = sources();
    const config = ts.getParsedCommandLineOfConfigFile(join(ROOT, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })!;
    const program = ts.createProgram(files, config.options);
    const checker = program.getTypeChecker();
    /**
     * Object literals typed with a string index that are not looked up by an input's name, each with its reason:
     * - `TS_OPTIONS`: compiler options handed to TypeScript, never indexed by saidvsdid;
     * - `env: {…}`: a child process's environment, handed to the operating system;
     * - `object({…})` (evidence/schema.ts) and `shape({…})` (py-scopes.ts): validation shapes, whose keys are only
     *   iterated, the input's fields checked against them with `Object.hasOwn`.
     */
    const exempt = (n: ts.ObjectLiteralExpression): string | null => {
      const file = relative(ROOT, n.getSourceFile().fileName).split('\\').join('/');
      const p = n.parent;
      if (file === 'src/parse/ts-program.ts' && ts.isVariableDeclaration(p) && p.name.getText() === 'TS_OPTIONS') return 'TS_OPTIONS';
      if (ts.isPropertyAssignment(p) && p.name.getText() === 'env') return 'env';
      const callee = ts.isCallExpression(p) ? p.expression.getText() : null;
      if (file === 'src/evidence/schema.ts' && (callee === 'object' || (ts.isParameter(p) && p.name.getText() === 'optional'))) return 'object';
      if (file === 'src/parse/py-scopes.ts' && callee === 'shape') return 'shape';
      return null;
    };
    const offenders: string[] = [];
    const exempted = new Set<string>();
    for (const sf of program.getSourceFiles()) {
      if (!files.includes(resolve(sf.fileName))) continue;
      const visit = (n: ts.Node): void => {
        // `T[k]` or `k in T` with `k` any string (assertions read away) and `T` a variable bound to a plain object literal.
        const lookup = ts.isElementAccessExpression(n) ? { table: n.expression, key: n.argumentExpression } : ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.InKeyword ? { table: n.right, key: n.left } : null;
        if (lookup) {
          let key: ts.Expression = lookup.key;
          while (ts.isAsExpression(key) || ts.isParenthesizedExpression(key) || ts.isNonNullExpression(key) || ts.isTypeAssertionExpression(key)) key = key.expression;
          const keyType = checker.getTypeAtLocation(key);
          const anyString = (keyType.isUnion() ? keyType.types : [keyType]).some((u) => (u.flags & ts.TypeFlags.String) !== 0);
          const symbol = checker.getSymbolAtLocation(lookup.table);
          const decl = symbol?.valueDeclaration;
          let init = decl && ts.isVariableDeclaration(decl) ? decl.initializer : undefined;
          while (init && (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init))) init = init.expression;
          if (anyString && init && ts.isObjectLiteralExpression(init)) offenders.push(`${relative(ROOT, sf.fileName)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${n.getText().slice(0, 60)}`);
        }
        if (ts.isObjectLiteralExpression(n)) {
          const contextual = checker.getContextualType(n);
          const t = contextual ? checker.getNonNullableType(contextual) : null;
          const indexed = t !== null && (t.isUnion() ? t.types : [t]).some((u) => checker.getIndexInfosOfType(u).some((i) => (i.keyType.flags & ts.TypeFlags.String) !== 0));
          const wrapped = ts.isCallExpression(n.parent) && ['nameTable', 'ownRecord'].includes(n.parent.expression.getText());
          if (indexed && !wrapped) {
            const why = exempt(n);
            if (why) exempted.add(why);
            else offenders.push(`${relative(ROOT, sf.fileName)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${n.getText().slice(0, 60)}`);
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(offenders).toEqual([]);
    expect([...exempted].sort()).toEqual(['TS_OPTIONS', 'env', 'object', 'shape']);
  });
});

describe('a name of Object.prototype read from the input is no token, marker, runner or key', () => {
  it.each(PROTOTYPE_NAMES)('Python: the name `%s` as a mark, a pytest call, a unittest decorator and a local: no marker, no exception', async (name) => {
    const source = `import pytest\nimport unittest\n\n\n@pytest.mark.${name}\ndef test_a():\n    pytest.${name}()\n    ${name} = 1\n    assert ${name} == 1\n\n\nclass TestB(unittest.TestCase):\n    @unittest.${name}\n    def test_b(self):\n        self.${name}()\n`;
    const f = await parseTestFile('test_a.py', source);
    expect(f.markerSites).toEqual([]);
    expect(f.tests.map((t) => t.name)).toEqual(['test_a', 'TestB::test_b']);
  });

  it.each(PROTOTYPE_NAMES)('TS: the name `%s` as a member of `it`, `test` and `describe`, and as an option: no marker', async (name) => {
    const key = name === '__proto__' ? `['${name}']` : name;
    const source = `import { describe, it, test } from 'vitest';\nit.${name}('a', () => {});\ntest.${name}();\ndescribe.${name}('b', () => {});\nit('c', { ${key}: true }, () => {});\n`;
    const f = await parseTestFile('a.test.ts', source);
    expect(f.markerSites).toEqual([]);
  });

  it.each(PROTOTYPE_NAMES)('the contagion net: the name `%s` as a member and as a string in a subscript is no use', async (name) => {
    expect(await contagionUses('a.test.ts', `x.${name}();\nit['${name}']('a', () => {});\n`, [])).toEqual([]);
    expect(await contagionUses('test_a.py', `x.${name}()\ngetattr(pytest, "${name}")("x")\n`, [])).toEqual([]);
  });

  it.each(PROTOTYPE_NAMES)('a conftest.py variable named `%s` is no list of the config', async (name) => {
    const c = await readConftest('conftest.py', `${name} = ["a.py"]\ncollect_ignore = ["b.py"]\n`);
    expect(c.collectIgnore).toEqual(['b.py']);
    expect(c.collectIgnoreGlob).toEqual([]);
  });

  it.each(PROTOTYPE_NAMES)('a package.json script named `%s` is no runner unless the file defines it', (name) => {
    const scripts = packageScripts('{"scripts":{"test":"vitest run"}}');
    expect(classifySegment(`npm run ${name}`, 'posix', scripts).kind).not.toBe('test');
    const own = packageScripts(JSON.stringify({ scripts: { [name]: 'vitest run' } }));
    expect(classifySegment(`npm run ${name}`, 'posix', own)).toMatchObject({ kind: 'test', framework: 'vitest' });
  });

  it.each(PROTOTYPE_NAMES)("a runner summary's word `%s` counts nothing", (name) => {
    expect(parseSummary(` Test Files  1 passed (1)\n      Tests  2 passed | 3 ${name} (5)\n`, 'vitest')?.summary).not.toMatchObject({ passed: 5 });
  });

  it.each(PROTOTYPE_NAMES)('a Claude Code tool named `%s` is not a shell or an edit tool', (name) => {
    const line = (o: object): string => JSON.stringify(o);
    const text = [
      line({ type: 'user', uuid: 'u1', sessionId: 's', cwd: '/repo', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: 'go' } }),
      line({ type: 'assistant', uuid: 'a1', sessionId: 's', cwd: '/repo', timestamp: '2026-01-01T00:00:01Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name, input: { command: 'vitest run' } }] } }),
    ].join('\n');
    const session = parseClaude(text);
    expect(session.events.filter((e) => e.kind === 'shell' || e.kind === 'edit')).toEqual([]);
  });

  it.each(PROTOTYPE_NAMES)("the Python scope reader's reply: a name `%s` the reply does not list is not an import", (name) => {
    const reply = JSON.stringify({ protocol: 6, python: '3.12.3', supported: true, tested: true, why: null, files: { a: { ok: true, names: {}, aliases: [], methods: [], bound: {}, written: {}, literals: [], binds: {}, star: null, dynamic: [], classes: [] } } });
    const r = validateReply(reply, ['a']);
    expect(r.ok).toBe(true);
    const facts = r.ok ? r.reply.files.get('a')! : null;
    expect(facts?.ok).toBe(true);
    if (!facts?.ok) return;
    expect(facts.names[name]).toBeUndefined();
    expect(facts.bound[name]).toBeUndefined();
    expect(facts.written[name]).toBeUndefined();
  });

  it.each(PROTOTYPE_NAMES)('evidence: a field named `%s` is unknown, never a known one', (name) => {
    const r = parseEvidence(JSON.stringify({ schema: 'saidvsdid/evidence/v2', [name]: 1 }));
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.errors.join('\n')).toContain(`.${name}: unknown field`);
  });
});

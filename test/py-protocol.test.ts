// The Python scope reader's reply is read against its protocol (src/parse/py-scopes.ts,
// validateReply): every field checked, one entry per file asked. A reply that does not follow it —
// not JSON, a missing or mistyped field, another protocol, more or fewer files than asked, a file's
// entry out of shape — is a reason (a WARN for the files), never an exception and never facts.
import { describe, expect, it } from 'vitest';
import { validateReply } from '../src/parse/py-scopes.js';
import { pythonAtLeast } from './support/python.js';

const GOOD_FILE = {
  ok: true,
  names: { pytest: { path: ['pytest'], line: 1, why: null } },
  aliases: [{ form: 'Assign', line: 3, targets: ['omit'], value: [3, 7, 3, 23], refs: [{ path: ['pytest', 'mark', 'skip'], at: [3, 7, 3, 23], call: null, whole: 'value' }] }],
  methods: [{ at: [5, 4], name: 'test_t', cls: 'TestA', param: 'self', self: null, chain: null }],
  bound: { pytest: 1, omit: 3 },
  written: {},
  literals: [{ at: [6, 20], kind: 'bool', truthy: false }],
  binds: { pytest: 1, omit: 1, test_t: 1, TestA: 1 },
  star: null,
  dynamic: [{ line: 9, scope: 'TestA' }, { line: 10, scope: null }],
  classes: [{ at: [4, 0], name: 'TestA', bases: 'none', why: null }],
};
const reply = (files: Record<string, unknown>, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ protocol: 6, python: '3.12.3', supported: true, tested: true, why: null, files, ...extra });

describe('a reply that follows the protocol', () => {
  it('gives each file its facts', () => {
    const r = validateReply(reply({ a: GOOD_FILE, b: { ok: false, why: 'Python 3.12 does not compile it' } }), ['a', 'b']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reply.files.get('a')).toEqual(GOOD_FILE);
    expect(r.reply.files.get('b')).toEqual({ ok: false, why: 'Python 3.12 does not compile it' });
  });

  it('an unsupported interpreter: no files, its reason', () => {
    const why = 'Python 3.10.12 is older than the oldest supported version (3.11)';
    const r = validateReply(JSON.stringify({ protocol: 6, python: '3.10.12', supported: false, tested: false, why, files: {} }), ['a']);
    expect(r).toEqual({ ok: true, reply: { python: '3.10.12', supported: false, tested: false, why, files: new Map() } });
  });

  it('an interpreter newer than those tested: its facts, and that it is not tested', () => {
    const r = validateReply(reply({ a: GOOD_FILE }, { python: '3.16.0', tested: false }), ['a']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reply.tested).toBe(false);
    expect(r.reply.files.get('a')).toEqual(GOOD_FILE);
  });
});

describe('a reply that does not follow it, as a whole: a reason, never an exception', () => {
  it.each([
    ['not JSON', 'Traceback (most recent call last):'],
    ['empty', ''],
    ['JSON null', 'null'],
    ['a list', '[]'],
    ['another protocol', reply({ a: GOOD_FILE }, { protocol: 1 })],
    ['no python version', reply({ a: GOOD_FILE }, { python: 3.12 })],
    ['no supported flag', reply({ a: GOOD_FILE }, { supported: 'yes' })],
    ['no tested flag', reply({ a: GOOD_FILE }, { tested: undefined })],
    ['protocol 5 (no tested flag)', reply({ a: GOOD_FILE }, { protocol: 5, tested: undefined })],
    ['why not a string', reply({ a: GOOD_FILE }, { why: 7 })],
    ['files not a map', reply({ a: GOOD_FILE }, { files: [GOOD_FILE] })],
    ['fewer files than asked', reply({ a: GOOD_FILE })],
    ['more files than asked', reply({ a: GOOD_FILE, b: GOOD_FILE, c: GOOD_FILE })],
    ['another file than asked', reply({ a: GOOD_FILE, z: GOOD_FILE })],
  ])('%s', (_why, stdout) => {
    const r = validateReply(stdout, ['a', 'b']);
    expect(r.ok).toBe(false);
  });
});

describe("a file's entry out of shape: that file's reason, the others' facts", () => {
  const broken = (patch: Record<string, unknown>): unknown => ({ ...GOOD_FILE, ...patch });
  it.each([
    ['not an object', 'ok'],
    ['no ok flag', { names: {} }],
    ['ok false without why', { ok: false }],
    ['names not a map', broken({ names: [] })],
    ['a name without path', broken({ names: { pytest: { line: 1, why: null } } })],
    ['an empty path', broken({ names: { pytest: { path: [], line: 1, why: null } } })],
    ['a line not an integer', broken({ names: { pytest: { path: ['pytest'], line: '1', why: null } } })],
    ['aliases not a list', broken({ aliases: {} })],
    ['a range of 3', broken({ aliases: [{ ...GOOD_FILE.aliases[0], value: [3, 7, 3] }] })],
    ['a ref whole of another kind', broken({ aliases: [{ ...GOOD_FILE.aliases[0], refs: [{ ...GOOD_FILE.aliases[0]!.refs[0], whole: 'all' }] }] })],
    ['targets not strings', broken({ aliases: [{ ...GOOD_FILE.aliases[0], targets: [1] }] })],
    ['a method without at', broken({ methods: [{ name: 'test_t', cls: 'TestA', param: 'self', self: null, chain: null }] })],
    ['self not a string or null', broken({ methods: [{ ...GOOD_FILE.methods[0], self: false }] })],
    ['bound not integers', broken({ bound: { pytest: 'one' } })],
    ['written missing', broken({ written: undefined })],
    ['literals missing', broken({ literals: undefined })],
    ['a literal of another kind', broken({ literals: [{ at: [6, 20], kind: 'tuple', truthy: true }] })],
    ['a literal truth value not a boolean', broken({ literals: [{ at: [6, 20], kind: 'number', truthy: 0 }] })],
    ['binds missing', broken({ binds: undefined })],
    ['binds not integers', broken({ binds: { test_t: '1' } })],
    ['star not an integer or null', broken({ star: '3' })],
    ['dynamic missing', broken({ dynamic: undefined })],
    ['dynamic not a list', broken({ dynamic: 3 })],
    ['a dynamic scope not a string or null', broken({ dynamic: [{ line: 3, scope: 1 }] })],
    ['classes not a list', broken({ classes: {} })],
    ['a class with bases of another kind', broken({ classes: [{ ...GOOD_FILE.classes[0], bases: 'object' }] })],
  ])('%s', (_why, entry) => {
    const r = validateReply(reply({ a: entry, b: GOOD_FILE }), ['a', 'b']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = r.reply.files.get('a')!;
    expect(a.ok).toBe(false);
    if (!a.ok && typeof entry === 'object' && entry !== null && (entry as { ok?: unknown }).ok !== false) expect(a.why).toMatch(/does not follow its protocol/);
    expect(r.reply.files.get('b')).toEqual(GOOD_FILE);
  });
});

describe('Python decodes the bytes itself (PEP 263): only UTF-8 source is read', () => {
  const facts = async (bytes: Buffer): Promise<{ ok: boolean; why?: string }> => (await import('../src/parse/py-scopes.js')).pythonFacts(bytes);
  const body = Buffer.from('import pytest\n\n\n@pytest.mark.skip\ndef test_t():\n    pass\n', 'utf8');
  it.each([
    ['no declaration, UTF-8', body, true],
    ['a UTF-8 BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]), true],
    ['`# coding: utf8` (an alias of UTF-8)', Buffer.concat([Buffer.from('# coding: utf8\n'), body]), true],
    ['`# -*- coding: utf-8 -*-` and a BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# -*- coding: utf-8 -*-\n'), body]), true],
    ['`# -*- coding: latin-1 -*-`', Buffer.concat([Buffer.from('# -*- coding: latin-1 -*-\n'), body]), false],
    ['`# coding: cp1252`, ASCII only', Buffer.concat([Buffer.from('# coding: cp1252\n'), body]), false],
    ['a BOM and `# coding: latin-1`', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# coding: latin-1\n'), body]), false],
    ['an unknown codec', Buffer.concat([Buffer.from('# coding: no-such-codec\n'), body]), false],
    // Python's import (compile() of the bytes, as pytest and unittest load a module) reads a comment's bytes loosely
    // before 3.14, and refuses them from 3.14 on (a SyntaxError: the module does not import, pytest reports a collection
    // error): the reader says what the interpreter does.
    ['bytes that are not UTF-8 in a comment (import reads them before Python 3.14)', Buffer.concat([body, Buffer.from([0x23, 0x20, 0xe9, 0x0a])]), 'before 3.14'],
    ['bytes that are not UTF-8 in a string, no declaration', Buffer.concat([body, Buffer.from([0x78, 0x3d, 0x22, 0xe9, 0x22, 0x0a])]), false],
  ] as const)('%s', async (_why, bytes, read) => {
    const f = await facts(bytes);
    expect(f.ok).toBe(read === 'before 3.14' ? !pythonAtLeast('3.14') : read);
  });
});

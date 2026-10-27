// Python's own reading of a file's names (python/saidvsdid_scopes.py: `ast` and `symtable`), run in
// calls of at most `CALL_BYTES` of source, one interpreter each, and cached by content
// for the life of the process. The interpreter is `SAIDVSDID_PYTHON` when set, else the first of
// `python3`, `python` that runs the script; a version older than the script's minimum (3.11) is not
// supported, and one newer than those CI tests (3.11–3.15) runs as any other (the reply says it is not
// tested, and the report records it). The script receives each file's bytes and Python decodes them (PEP 263): a file whose
// encoding is not UTF-8 is not read. No interpreter, another version, a file Python does not compile
// or does not decode as UTF-8, a self-check that fails on the interpreter, or a reply that does not
// follow the protocol: the file's names are
// never certain, and the file gets one WARN (src/check.ts) — never a FAIL, never silence, never an
// exception.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { closeSync, fstatSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ASSETS } from '../assets.js';
import { ownRecord } from '../util/names.js';

// The script ships with the package (package.json "files"): python/ at its root (src/assets.ts), like the grammars.
const SCRIPT = fileURLToPath(new URL('python/saidvsdid_scopes.py', ASSETS));
const PROTOCOL = 6;
/**
 * How the files of a run are handed to the interpreter, and how long a call may take (measured; docs/rules.md, *Python*).
 * - A call holds at most `CALL_BYTES` of source (a file larger than that goes alone), so that each call is short.
 * - The script reads 3.9–6.0 s per MB of the densest content measured (unittest classes of 2 000 methods, and 2 500
 *   classes of 30; Linux, Python 3.9, 3.12 and 3.13) and 3.1–3.8 s per MB of the fixtures' 683 small files; the earlier
 *   script, slower on dense files, read ≈ 10 s/MB on Windows (Codex).
 * - The first attempt's limit is `max(MIN_LIMIT_MS, LIMIT_MS_PER_MB × MB of the call)`: 60 s for a full call, 10 to 15
 *   times the rates measured on Linux and 6 times the earlier reader's on Windows. One that reaches it is tried once more, with at least `RETRY_LIMIT_MS` (the 300 s a whole
 *   run had before), so that anything the earlier reader read within its limit is still read; a second timeout gives the
 *   call's files the WARN.
 */
export const CALL_BYTES = 1_000_000;
export const MIN_LIMIT_MS = 60_000;
export const LIMIT_MS_PER_MB = 60_000;
export const RETRY_LIMIT_MS = 300_000;
/** The last bytes of the interpreter's stderr kept to say why it failed. */
const STDERR_TAIL = 4096;

/** [line (1-based), UTF-8 column, end line, end UTF-8 column], as Python's `ast` gives them. */
export type PyRange = [number, number, number, number];

/** A name an import of pytest or unittest binds somewhere in the file, and why it is not certain (null: certain). */
export interface PyName {
  path: string[];
  line: number;
  why: string | null;
}

/** A binding whose value contains a reference rooted in a runner import (`omit = pytest.mark.skip(…)`). */
export interface PyAliasFact {
  form: string;
  line: number;
  targets: string[];
  value: PyRange;
  refs: Array<{ path: string[]; at: PyRange; call: PyRange | null; whole: 'value' | 'call' | null }>;
}

/** A function defined directly in a class body: whether its first parameter and its class are certain. */
export interface PyMethodFact {
  /** Where its `def` (or `async`) is: line, UTF-8 column. */
  at: [number, number];
  name: string;
  cls: string;
  param: string | null;
  /** Why the first parameter is not certainly the instance in the whole body (null: it is). */
  self: string | null;
  /** Why the class is not certainly a unittest.TestCase by its bases in the file (null: it is). */
  chain: string | null;
}

/** An argument of a call whose value Python's `ast.literal_eval` reads (`run=(False)`, `run=0`, `True`, `"x"`). */
export interface PyLiteral {
  at: [number, number];
  kind: 'bool' | 'none' | 'number' | 'str' | 'other';
  truthy: boolean;
}

export type PyFacts =
  | {
      ok: true;
      names: Record<string, PyName>;
      aliases: PyAliasFact[];
      methods: PyMethodFact[];
      /** Every name the file binds anywhere (any symbol table, any form), and the first line. */
      bound: Record<string, number>;
      /** Attributes the file writes on some object (`X.skipTest = …`, `setattr(X, 'skipTest', …)`). */
      written: Record<string, number>;
      /** The arguments of calls that `ast.literal_eval` reads: where (line, UTF-8 column), their kind and truth value. */
      literals: PyLiteral[];
      /** How many times the file binds each name (any scope, any form), mangled. */
      binds: Record<string, number>;
      /** The line of a star import, if any. */
      star: number | null;
      /**
       * What may rebind names at run time: builtins' `setattr`/`delattr` on a class of the file (`scope`), on the module
       * or on anything not resolved (`scope` null), a write through `globals()`/`vars()`, `exec`/`eval` (null: every name).
       */
      dynamic: Array<{ line: number; scope: string | null }>;
      /** Every class: its bases read exactly (none, or certainly unittest.TestCase), or why not. */
      classes: PyClassFact[];
    }
  | { ok: false; why: string };

/** A class of the file and its bases, read exactly (docs/rules.md, *Verdicts*, F7). */
export interface PyClassFact {
  at: [number, number];
  name: string;
  bases: 'none' | 'testcase' | null;
  why: string | null;
}

/** The interpreter that reads Python files in this process, once found. */
export type PyRuntime =
  | { known: true; command: string; version: string; tested: boolean }
  /** `remedy`: how to give saidvsdid a Python it reads, when the problem is the interpreter (none, or one too old). */
  | { known: false; why: string; version: string | null; remedy?: string };

/** The oldest Python the scope reader reads (python/saidvsdid_scopes.py, MINIMUM). */
const MINIMUM: readonly [number, number] = [3, 11];

/** How to get a Python saidvsdid reads: on GitHub Actions, and anywhere else (`SAIDVSDID_PYTHON` takes precedence when set). */
function pythonRemedy(env: string | undefined): string {
  const override = env ? `change SAIDVSDID_PYTHON (now ${JSON.stringify(env)}) to one` : 'put one first on PATH or set SAIDVSDID_PYTHON to it';
  return `on GitHub Actions, add actions/setup-python with python-version ${MINIMUM.join('.')} or later before saidvsdid; elsewhere, ${override}`;
}

/** Whether a version string (`3.10.12`) is older than MINIMUM. */
function olderThanMinimum(version: string): boolean {
  const [major, minor] = version.split('.').map(Number);
  return major! < MINIMUM[0] || (major === MINIMUM[0] && minor! < MINIMUM[1]);
}

let runtime: PyRuntime | undefined;
const cache = new Map<string, PyFacts>();
const CACHE_LIMIT = 4096;

/** A reply of the script that follows the protocol (validateReply). */
export interface PyReply {
  python: string;
  supported: boolean;
  /** Whether the interpreter is one of the versions CI tests (a newer one is read all the same). */
  tested: boolean;
  why: string | null;
  /** One entry per file asked, by id. */
  files: Map<string, PyFacts>;
}

type Check = (v: unknown) => string | null;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const strOrNull: Check = (v) => (v === null || isStr(v) ? null : 'a string or null');
const strings: Check = (v) => (Array.isArray(v) && v.every(isStr) ? null : 'a list of strings');
const path: Check = (v) => (Array.isArray(v) && v.length > 0 && v.every(isStr) ? null : 'a non-empty list of strings');
const range: Check = (v) => (Array.isArray(v) && v.length === 4 && v.every(isInt) ? null : 'a range of 4 integers');
const ints: Check = (v) => (isObject(v) && Object.values(v).every(isInt) ? null : 'a map of integers');
const listOf = (item: Check): Check => (v) => {
  if (!Array.isArray(v)) return 'a list';
  for (const [i, x] of v.entries()) {
    const why = item(x);
    if (why) return `[${i}]: ${why}`;
  }
  return null;
};
const shape = (fields: Record<string, Check>): Check => (v) => {
  if (!isObject(v)) return 'an object';
  for (const [k, check] of Object.entries(fields)) {
    const why = check(v[k]);
    if (why) return `${k}: ${why}`;
  }
  return null;
};
const NAME = shape({ path, line: (v) => (isInt(v) ? null : 'an integer'), why: strOrNull });
const REF = shape({ path, at: range, call: (v) => (v === null ? null : range(v)), whole: (v) => (v === null || v === 'value' || v === 'call' ? null : "'value', 'call' or null") });
const ALIAS = shape({ form: (v) => (isStr(v) ? null : 'a string'), line: (v) => (isInt(v) ? null : 'an integer'), targets: strings, value: range, refs: listOf(REF) });
const METHOD = shape({
  at: (v) => (Array.isArray(v) && v.length === 2 && v.every(isInt) ? null : 'a position of 2 integers'),
  name: (v) => (isStr(v) ? null : 'a string'),
  cls: (v) => (isStr(v) ? null : 'a string'),
  param: strOrNull,
  self: strOrNull,
  chain: strOrNull,
});
const LITERAL = shape({
  at: (v) => (Array.isArray(v) && v.length === 2 && v.every(isInt) ? null : 'a position of 2 integers'),
  kind: (v) => (v === 'bool' || v === 'none' || v === 'number' || v === 'str' || v === 'other' ? null : 'a literal kind'),
  truthy: (v) => (typeof v === 'boolean' ? null : 'a boolean'),
});
const CLASS = shape({
  at: (v) => (Array.isArray(v) && v.length === 2 && v.every(isInt) ? null : 'a position of 2 integers'),
  name: (v) => (isStr(v) ? null : 'a string'),
  bases: (v) => (v === null || v === 'none' || v === 'testcase' ? null : "'none', 'testcase' or null"),
  why: strOrNull,
});
const intOrNull: Check = (v) => (v === null || isInt(v) ? null : 'an integer or null');
const FACTS = shape({
  names: (v) => (isObject(v) ? (Object.entries(v).map(([k, x]) => (NAME(x) ? `${k}: ${NAME(x)}` : null)).find((w) => w) ?? null) : 'a map'),
  aliases: listOf(ALIAS),
  methods: listOf(METHOD),
  bound: ints,
  written: ints,
  literals: listOf(LITERAL),
  binds: ints,
  star: intOrNull,
  dynamic: listOf(shape({ line: (v) => (isInt(v) ? null : 'an integer'), scope: strOrNull })),
  classes: listOf(CLASS),
});

/** A file's entry of a reply, checked field by field: the facts, or why they do not follow the protocol. */
function fileFacts(v: unknown): PyFacts {
  const broken = (why: string): PyFacts => ({ ok: false, why: `the Python scope reader's reply for the file does not follow its protocol (${why})` });
  if (!isObject(v) || typeof v['ok'] !== 'boolean') return broken('no ok flag');
  if (v['ok'] === false) return isStr(v['why']) ? { ok: false, why: v['why'] } : broken('why: a string');
  const why = FACTS(v);
  if (why !== null) return broken(why);
  // Looked up by names read from the code (`facts.names[name]`): own keys only, never Object.prototype's.
  const facts = v as unknown as Extract<PyFacts, { ok: true }>;
  return { ...facts, names: ownRecord(facts.names), bound: ownRecord(facts.bound), written: ownRecord(facts.written), binds: ownRecord(facts.binds) };
}

/**
 * The script's stdout read against the protocol, for the files asked (`ids`): every field checked,
 * one entry per file asked, no more and no less. Anything else is a reason, never an exception.
 */
export function validateReply(stdout: string, ids: readonly string[]): { ok: true; reply: PyReply } | { ok: false; why: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return { ok: false, why: 'its output is not JSON' };
  }
  if (!isObject(raw)) return { ok: false, why: 'its output is not a JSON object' };
  if (raw['protocol'] !== PROTOCOL) return { ok: false, why: `protocol ${JSON.stringify(raw['protocol'])}, expected ${PROTOCOL}` };
  if (!isStr(raw['python'])) return { ok: false, why: 'no python version' };
  if (typeof raw['supported'] !== 'boolean') return { ok: false, why: 'no supported flag' };
  if (typeof raw['tested'] !== 'boolean') return { ok: false, why: 'no tested flag' };
  if (strOrNull(raw['why'])) return { ok: false, why: 'why: not a string or null' };
  if (!isObject(raw['files'])) return { ok: false, why: 'no files map' };
  const files = new Map<string, PyFacts>();
  const entries = raw['files'];
  if (raw['supported']) {
    const keys = Object.keys(entries);
    const asked = new Set(ids);
    if (keys.length !== asked.size || keys.some((k) => !asked.has(k))) return { ok: false, why: `${keys.length} files in the reply for ${asked.size} asked` };
    for (const id of ids) files.set(id, fileFacts(entries[id]));
  }
  return { ok: true, reply: { python: raw['python'], supported: raw['supported'], tested: raw['tested'], why: raw['why'] as string | null, files } };
}

/** The first attempt's limit for a call of `bytes` of source, and the retry's. */
export function callLimits(bytes: number): [number, number] {
  const first = Math.max(MIN_LIMIT_MS, Math.ceil((LIMIT_MS_PER_MB * bytes) / 1_000_000));
  return [first, Math.max(first, RETRY_LIMIT_MS)];
}

/**
 * The files of a run in calls, in order: the files of a group (a file's base and head) always go in the same call,
 * and a call holds at most `CALL_BYTES` of source, unless one group alone is larger (it then goes alone, with the limit
 * of its size: `callLimits`).
 */
export function splitCalls<T extends { source: Uint8Array }>(groups: readonly (readonly T[])[]): T[][] {
  const calls: T[][] = [];
  let call: T[] = [];
  let size = 0;
  for (const group of groups) {
    if (group.length === 0) continue;
    const bytes = group.reduce((n, f) => n + f.source.length, 0);
    if (call.length > 0 && size + bytes > CALL_BYTES) {
      calls.push(call);
      call = [];
      size = 0;
    }
    call.push(...group);
    size += bytes;
  }
  if (call.length > 0) calls.push(call);
  return calls;
}

/**
 * One call of the script: one attempt, and a second one when the first reaches its limit (a run that hangs is not
 * deterministic: docs/backlog.md). Any other failure is not tried again.
 */
function run(command: string, files: Array<{ id: string; source: Uint8Array }>): PyReply | { error: string } {
  const [first, retry] = callLimits(files.reduce((n, f) => n + f.source.length, 0));
  const one = attempt(command, files, first);
  if (!('timedOut' in one)) return one;
  const two = attempt(command, files, retry);
  if (!('timedOut' in two)) return two;
  return { error: `${two.error} (timed out twice, after ${first / 1000} s and ${retry / 1000} s)` };
}

/**
 * One attempt. The request, the reply and the interpreter's stderr go through files, never through pipes: on macOS,
 * with Node's `spawnSync` writing the request into the child's stdin, the interpreter was seen blocked in its first
 * `read()` of stdin with no end of file, under parallel runs (CI, `spawnSync python3 ETIMEDOUT`); and a file has no
 * buffer to overflow (Python 3.12 writes a `SyntaxWarning` per invalid escape). A file the child reads to its end
 * leaves nothing for the parent to write or close. Any failure here (the temporary files included) is a reason,
 * never an exception: the files get a WARN.
 */
function attempt(command: string, files: Array<{ id: string; source: Uint8Array }>, limitMs: number): PyReply | { error: string } | { error: string; timedOut: true } {
  let dir: string | null = null;
  try {
    dir = mkdtempSync(join(tmpdir(), 'saidvsdid-py-'));
    const request = join(dir, 'request.json');
    const reply = join(dir, 'reply.json');
    const errors = join(dir, 'stderr.txt');
    writeFileSync(request, JSON.stringify({ files: files.map((f) => ({ id: f.id, source: Buffer.from(f.source).toString('base64') })) }), 'utf8');
    const fds: number[] = [];
    let r: SpawnSyncReturns<Buffer>;
    try {
      fds.push(openSync(request, 'r'), openSync(reply, 'w'), openSync(errors, 'w'));
      // -I: no user site, no environment (PYTHONUTF8 is set for an interpreter that is not isolated);
      // -X utf8: UTF-8 whatever the locale. stdin and stdout are bytes on both sides.
      r = spawnSync(command, ['-I', '-X', 'utf8', SCRIPT], {
        stdio: [fds[0]!, fds[1]!, fds[2]!],
        env: { ...process.env, PYTHONUTF8: '1' },
        timeout: limitMs,
        windowsHide: true,
      });
    } finally {
      for (const fd of fds) closeSync(fd);
    }
    if (r.error) return (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? { error: r.error.message, timedOut: true } : { error: r.error.message };
    if (r.status !== 0) {
      const last = tail(errors).trim().split('\n').at(-1);
      return { error: `exit ${r.status}${last ? `: ${last}` : ''}` };
    }
    const checked = validateReply(readFileSync(reply).toString('utf8'), files.map((f) => f.id));
    return checked.ok ? checked.reply : { error: `its reply does not follow the protocol: ${checked.why}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    try {
      if (dir !== null) rmSync(dir, { recursive: true, force: true });
    } catch {
      // A temporary directory left behind is not the reader's failure.
    }
  }
}

/** The last `STDERR_TAIL` bytes of a file, as text. */
function tail(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const buf = Buffer.alloc(Math.min(size, STDERR_TAIL));
    readSync(fd, buf, 0, buf.length, size - buf.length);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** What the interpreter `command` answered, as a runtime: a version older than MINIMUM names the executable and the remedy. */
export function runtimeOf(reply: Pick<PyReply, 'python' | 'supported' | 'tested' | 'why'>, command: string, env: string | undefined): PyRuntime {
  if (reply.supported) return { known: true, command, version: reply.python, tested: reply.tested };
  if (olderThanMinimum(reply.python)) {
    // The executable actually run, so that the remedy fixes the one saidvsdid uses (SAIDVSDID_PYTHON takes precedence).
    return { known: false, why: `Python ${reply.python} (${command}) is older than ${MINIMUM.join('.')}, the oldest saidvsdid reads`, version: reply.python, remedy: pythonRemedy(env) };
  }
  return { known: false, why: reply.why ?? `Python ${reply.python} is not supported`, version: reply.python };
}

/** Finds the interpreter (once per process) and whether its version is supported. */
export function pythonRuntime(): PyRuntime {
  if (runtime) return runtime;
  const env = process.env['SAIDVSDID_PYTHON'];
  const candidates = env ? [env] : ['python3', 'python'];
  const tried: string[] = [];
  for (const command of candidates) {
    const reply = run(command, []);
    if ('error' in reply) {
      tried.push(`${command}: ${reply.error}`);
      continue;
    }
    runtime = runtimeOf(reply, command, env);
    return runtime;
  }
  runtime = { known: false, why: `no Python interpreter runs the scope reader (${tried.join('; ')})`, version: null, remedy: pythonRemedy(env) };
  return runtime;
}

/** The interpreter, when this process has looked for one; null when no Python file needed it. */
export function pythonRuntimeIfStarted(): PyRuntime | null {
  return runtime ?? null;
}

const keyOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * Reads every file (its bytes) not yet cached. An entry is a file, or a group of files read in the same call (a file's
 * base and head: src/check.ts); the calls hold at most `CALL_BYTES` of source (`splitCalls`).
 */
export function analysePython(entries: readonly (Uint8Array | readonly Uint8Array[])[]): void {
  const rt = pythonRuntime();
  const groups: Array<Array<{ id: string; source: Uint8Array }>> = [];
  const todo = new Set<string>();
  for (const entry of entries) {
    const group: Array<{ id: string; source: Uint8Array }> = [];
    for (const bytes of entry instanceof Uint8Array ? [entry] : entry) {
      const key = keyOf(bytes);
      if (cache.has(key) || todo.has(key)) continue;
      todo.add(key);
      group.push({ id: key, source: bytes });
    }
    if (group.length > 0) groups.push(group);
  }
  if (todo.size === 0) return;
  if (cache.size + todo.size > CACHE_LIMIT) cache.clear();
  if (!rt.known) {
    for (const key of todo) cache.set(key, { ok: false, why: rt.why });
    return;
  }
  for (const call of splitCalls(groups)) {
    const reply = run(rt.command, call);
    for (const { id: key } of call) {
      let facts: PyFacts;
      if ('error' in reply) facts = { ok: false, why: `the Python scope reader failed (${reply.error})` };
      else if (!reply.supported) facts = { ok: false, why: reply.why ?? `Python ${reply.python} is not supported` };
      else facts = reply.files.get(key) ?? { ok: false, why: 'the Python scope reader returned nothing for the file' };
      cache.set(key, facts);
    }
  }
}

/** Python's reading of a file's bytes: from the cache, else read on its own. */
export function pythonFacts(bytes: Uint8Array): PyFacts {
  const key = keyOf(bytes);
  if (!cache.has(key)) analysePython([bytes]);
  return cache.get(key)!;
}

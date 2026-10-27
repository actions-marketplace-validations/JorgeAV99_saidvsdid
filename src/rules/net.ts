// Final safety net against a silent OK (exit 0).
//
// Independently of the extractor, count recognised markers per kind in each
// changed test file with plain regular expressions over the code, with
// comments and string literals blanked out by tree-sitter. If some kind grows
// between base and head and the verdict would otherwise be OK (exit 0), report a WARN.
//
// Guarantees (each only when the verdict would otherwise be OK):
// - an increase in recognised markers of any kind in a test file → WARN;
// - a decrease in recognised assertion tokens across the changed test files
//   (TG004: an assertion removed from a helper or a hook) → WARN;
// - an increase in timeout/retry calls or marks in a test file beyond those
//   the extractor attributed (TG005) → WARN;
// - any change (byte-level, as git reports it) to a runner configuration
//   file on which TG005 reported nothing — for package.json, a change to the
//   watched sections (scripts and test-runner keys), strictly compared → WARN, whatever the
//   readers understood (configNet; runs whatever the verdict). The token
//   vocabulary only details the message.
// Not covered: replacing a marker or setting by another of the same kind (the
// count does not change), changing a value in place, and syntax outside the
// vocabulary.
//
// The marker vocabulary is read the way the extractor reads it (docs/rules.md,
// the closed list), each form by a plain rule: a literal subscript is a member
// access (`it['skip']`, `it[('skip')]` count as `.skip`), escapes in identifiers
// and in those subscripts are decoded, Python identifiers are NFKC-normalised
// (`pyteſt` is `pytest`), and expressions are read with parentheses and
// TypeScript's type assertions removed (`raise (unittest.SkipTest)`, `(fit as
// any)(…)`): one normalisation, src/parse/normalise.ts. Word boundaries are
// Unicode-aware: `停` or `é` is part of a name, as it is for the language.
// Aliases (a name bound to something that holds the vocabulary, its new uses)
// are the contagion net's (src/rules/contagion.ts), which runs whatever the verdict.
import type { Node } from 'web-tree-sitter';
import type { Knob, MarkerKind } from '../parse/index.js';
import { rawTopLevelMembers } from '../config/json.js';
import { testSections } from '../config/testscope.js';
import { getParser, languageForPath } from '../parse/loader.js';
import { WRAPPERS, decodeJs, isWrapper, jsString, unwrap } from '../parse/normalise.js';
import { JS_TEST_ROOTS, vocabularyForms, type VocabularyForm } from '../parse/vocabulary.js';
import type { Finding, RuleId } from './types.js';

/** vite and vitest configs (src/rules/TG005.ts: VITEST_CONFIGS, NET_ONLY_CONFIG): compared by their `test` section and root. */
const VITE_LIKE = /^(?:vitest|vite)(?:\.[\w-]+)?\.config\.[cm]?[jt]s$/i;

/** Settings of a vite/vitest config object that select no test: their bytes are blanked before comparing. */
const NOT_TEST_SETTINGS: ReadonlySet<string> = new Set(['resolve', 'define', 'plugins', 'server', 'preview', 'build', 'css', 'esbuild', 'optimizeDeps', 'ssr', 'worker', 'json', 'assetsInclude', 'publicDir', 'base', 'cacheDir', 'envPrefix', 'envDir', 'appType', 'clearScreen', 'logLevel']);

/**
 * A vite/vitest config's text with the values of its settings that select no test blanked: the top-level ones of the
 * exported object (`export default defineConfig({…})`, `export default {…}`, `module.exports = {…}`), and those of an
 * inline project in `test.projects`/`test.workspace`. Everything else — the `test` section, `root`, any statement
 * outside the object — stays byte for byte. Null when the object cannot be located with certainty.
 */
async function viteTestText(path: string, text: string): Promise<string | null> {
  const language = languageForPath(path);
  if (!language || language === 'python') return null;
  const tree = (await getParser(language)).parse(text);
  if (!tree) return null;
  try {
    if (tree.rootNode.hasError) return null;
    const configObject = (n: Node | null): Node | null => {
      let v = n ? unwrap(n) : null;
      if (v?.type === 'call_expression' && ['defineConfig', 'defineProject'].includes(v.childForFieldName('function')?.text ?? '')) {
        const args = v.childForFieldName('arguments')?.namedChildren ?? [];
        v = args.length === 1 ? unwrap(args[0]!) : null;
      }
      return v?.type === 'object' ? v : null;
    };
    let config: Node | null = null;
    for (const s of tree.rootNode.namedChildren) {
      if (s.type === 'export_statement' && s.children.some((c) => c.type === 'default')) config = configObject(s.childForFieldName('value') ?? s.namedChildren.at(-1) ?? null);
      else if (s.type === 'expression_statement') {
        const e = s.namedChildren[0];
        if (e?.type === 'assignment_expression' && e.childForFieldName('left')?.text === 'module.exports') config = configObject(e.childForFieldName('right'));
      }
    }
    if (!config) return null;
    const blank: Array<[number, number]> = [];
    const keyOf = (pair: Node): string | null => {
      const k = pair.childForFieldName('key');
      if (!k) return null;
      if (k.type === 'property_identifier') return k.text;
      return jsString(k);
    };
    const blankIn = (obj: Node, drop: (key: string) => boolean): void => {
      const children = obj.namedChildren;
      children.forEach((p, i) => {
        if (p.type !== 'pair') return;
        const key = keyOf(p);
        if (key === null || !drop(key)) return;
        // The comments right above a blanked setting go with it.
        let start = p.startIndex;
        for (let j = i - 1; j >= 0 && children[j]!.type === 'comment'; j--) start = children[j]!.startIndex;
        blank.push([start, p.endIndex]);
      });
    };
    blankIn(config, (k) => NOT_TEST_SETTINGS.has(k));
    for (const p of config.namedChildren) {
      if (p.type !== 'pair' || keyOf(p) !== 'test') continue;
      const test = unwrap(p.childForFieldName('value')!);
      if (test.type !== 'object') continue;
      for (const q of test.namedChildren) {
        if (q.type !== 'pair' || !['projects', 'workspace'].includes(keyOf(q) ?? '')) continue;
        const list = unwrap(q.childForFieldName('value')!);
        if (list.type !== 'array') continue;
        for (const el of list.namedChildren) {
          const obj = configObject(el);
          if (obj) blankIn(obj, (k) => NOT_TEST_SETTINGS.has(k));
        }
      }
    }
    // An import whose names are used only inside the blanked settings (a plugin, `fileURLToPath` for an alias) goes
    // with them; one that binds nothing (a side effect) or a name the rest of the file uses still counts.
    const kept = (from: number, to: number): string => {
      let s = '';
      let at = from;
      for (const [a, b] of [...blank].sort((x, y) => x[0] - y[0])) {
        if (b <= at || a >= to) continue;
        s += text.slice(at, Math.max(at, a));
        at = Math.max(at, b);
      }
      return s + text.slice(at, to);
    };
    const imports = tree.rootNode.namedChildren.filter((s) => s.type === 'import_statement');
    for (const imp of imports) {
      const names = imp.descendantsOfType(['identifier']).filter((id) => id.parent?.type === 'import_clause' || id.parent?.type === 'namespace_import' || (id.parent?.type === 'import_specifier' && (id.parent.childForFieldName('alias') ?? id.parent.childForFieldName('name'))?.id === id.id)).map((id) => id.text);
      if (names.length === 0) continue;
      const rest = kept(0, imp.startIndex) + kept(imp.endIndex, text.length);
      if (names.every((n) => !new RegExp(`(?<![\\w$])${n.replace(/\$/g, '\\$')}(?![\\w$])`).test(rest))) blank.push([imp.startIndex, imp.endIndex]);
    }
    blank.sort((a, b) => b[0] - a[0]);
    let out = text;
    for (const [from, to] of blank) out = `${out.slice(0, from)}\u0000${out.slice(to)}`;
    // A blanked setting goes with the whitespace before it and its comma: adding or removing one leaves no trace.
    return out.replace(/\s*\u0000\s*,?/g, '');
  } finally {
    tree.delete();
  }
}

type Vocabulary = Array<[MarkerKind, RegExp]>;

/** A character that continues an identifier, in JS or Python (Unicode-aware, unlike `\w`). */
const IDC = '[\\p{ID_Continue}$\\u200C\\u200D]';

/**
 * A pattern written with ASCII `\w` and `\b` made Unicode-aware: `\w` is an identifier character and
 * `\b` a boundary with one (an end boundary after a name or a group, a start boundary elsewhere).
 */
function uni(re: RegExp): RegExp {
  let out = '';
  let inClass = false;
  const src = re.source;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === '\\' && i + 1 < src.length) {
      const n = src[i + 1]!;
      if (n === 'w') out += inClass ? IDC.slice(1, -1) : IDC;
      else if (n === 'b') out += /[\p{ID_Continue}$)]/u.test(src[i - 1] ?? '') ? `(?!${IDC})` : `(?<!${IDC})`;
      else out += c + n;
      i++;
      continue;
    }
    if (c === '[' && !inClass) inClass = true;
    else if (c === ']' && inClass) inClass = false;
    out += c;
  }
  return new RegExp(out, re.flags.includes('u') ? re.flags : `${re.flags}u`);
}
const uniAll = (v: Vocabulary): Vocabulary => v.map(([k, re]) => [k, uni(re)]);

/** `(?:a|b)`: the members of a form, as alternatives. */
const alt = (names: readonly string[]): string => `(?:${names.join('|')})`;
/** The pattern of each form of the vocabulary (src/parse/vocabulary.ts, the one definition), by its shape. */
const SHAPE_PATTERNS: Record<VocabularyForm['shape'], (names: string[]) => RegExp> = {
  member: (ns) => new RegExp(String.raw`\.\s*${alt(ns)}\b`, 'g'),
  'test-root-member': (ns) => new RegExp(String.raw`\b${alt([...JS_TEST_ROOTS])}\s*\.\s*${alt(ns)}\b`, 'g'),
  'root-call': (ns) => new RegExp(String.raw`(?<![\w$.])${alt(ns)}\s*\(`, 'g'),
  option: (ns) => new RegExp(String.raw`\b${alt(ns)}\s*:\s*true\b`, 'g'),
  mark: (ns) => new RegExp(String.raw`\bmark\s*\.\s*${alt(ns)}\b`, 'g'),
  'pytest-call': (ns) => new RegExp(String.raw`\bpytest\s*\.\s*${alt(ns)}\s*\(`, 'g'),
  'method-call': (ns) => new RegExp(String.raw`\.\s*${alt(ns)}\s*\(`, 'g'),
  raise: (ns) => new RegExp(String.raw`\braise\s+(?:[\w.]+\.)?${alt(ns)}\b`, 'g'),
  unittest: (ns) => new RegExp(String.raw`\bunittest\s*\.\s*${alt(ns)}\b`, 'g'),
  decorator: (ns) => new RegExp(String.raw`^[ \t]*@\s*${alt(ns)}\b`, 'gm'),
};
const vocabularyOf = (lang: VocabularyForm['lang']): Vocabulary => uniAll(vocabularyForms().filter((f) => f.lang === lang).map((f) => [f.kind, SHAPE_PATTERNS[f.shape](f.names)]));
const TS_VOCABULARY: Vocabulary = vocabularyOf('js');
const PY_VOCABULARY: Vocabulary = vocabularyOf('python');

const TS_ASSERTIONS: RegExp[] = [
  /(?<![\w$.])expect\s*(?:\.\s*(?:soft|poll)\s*)?\(/g,
  /(?<![\w$.])expect\s*\.\s*(?:assertions|hasAssertions)\s*\(/g,
  /(?<![\w$])assert\s*[.(]/g,
].map(uni);
const PY_ASSERTIONS: RegExp[] = [
  /^[ \t]*assert\b(?!\s*[=(.])/gm,
  /(?<!\w)assert\w*\s*\(/gi,
  /\bpytest\s*\.\s*(?:raises|warns)\s*\(/g,
].map(uni);

/**
 * Runner timeout/retry calls and pytest marks in test files (code only). Option
 * keys such as `{ timeout: 1000 }` are not counted: they are just as often
 * test data (an HTTP client's options); test options TG005 cannot read are
 * reported by TG005 itself.
 */
const TS_SETTINGS: Array<['retry' | 'timeout', RegExp]> = [
  ['retry', /\.\s*retryTimes\s*\(/g],
  ['retry', /\bthis\s*\.\s*retries\s*\(/g],
  ['timeout', /\b(?:jest|test|it)\s*\.\s*(?:setTimeout|slow)\s*\(/g],
  ['timeout', /\bvi\s*\.\s*setConfig\s*\(/g],
  ['timeout', /\bthis\s*\.\s*timeout\s*\(/g],
  // describe.configure: only when it sets retries/timeout, or passes something we cannot read.
  ['retry', /\bdescribe\s*\.\s*configure\s*\(\s*\{[^}]*\bretries\b/g],
  ['timeout', /\bdescribe\s*\.\s*configure\s*\(\s*\{[^}]*\btimeout\b/g],
  ['timeout', /\bdescribe\s*\.\s*configure\s*\(\s*(?![\s{])/g],
].map(([k, re]) => [k, uni(re as RegExp)] as ['retry' | 'timeout', RegExp]);
const PY_SETTINGS: Array<['retry' | 'timeout', RegExp]> = [
  ['retry', /\bmark\s*\.\s*flaky\b/g],
  ['retry', /^[ \t]*@\s*flaky\b/gm],
  ['timeout', /\bmark\s*\.\s*timeout\b/g],
].map(([k, re]) => [k, uni(re as RegExp)] as ['retry' | 'timeout', RegExp]);
export type SettingCounts = Record<'scope' | 'retry' | 'timeout', number>;

/** Forms of test-file knobs that the regular expressions above also count. */
const API_FORMS = new Set(['jest.retryTimes', 'this.retries', 'jest.setTimeout', 'test.setTimeout', 'test.slow', 'vi.setConfig', 'this.timeout', 'mark.timeout', 'mark.flaky']);

/** Knobs the extractor attributed, counted the way the regular expressions count them. */
export function attributedSettings(knobs: readonly Knob[]): SettingCounts {
  const counts: SettingCounts = { scope: 0, retry: 0, timeout: 0 };
  for (const k of knobs) {
    if (k.kind !== 'options' && (API_FORMS.has(k.form) || k.form.startsWith('describe.configure.'))) counts[k.kind]++;
  }
  return counts;
}

/** Recognised timeout/retry settings in a test file. */
export async function countSettings(path: string, source: string): Promise<SettingCounts> {
  const counts: SettingCounts = { scope: 0, retry: 0, timeout: 0 };
  const code = await codeOnly(path, source);
  if (code === null) return counts;
  for (const [kind, re] of path.endsWith('.py') ? PY_SETTINGS : TS_SETTINGS) counts[kind] += code.match(re)?.length ?? 0;
  return counts;
}

export type MarkerCounts = Record<MarkerKind, number>;

const empty = (): MarkerCounts => ({ skip: 0, only: 0, todo: 0, fixme: 0, xfail: 0 });

/** The source with comments and string literals (or only `types`) replaced by spaces (newlines kept). */
async function codeOnly(path: string, source: string, types: string[] = ['comment', 'string', 'template_string']): Promise<string | null> {
  const lang = languageForPath(path);
  if (!lang) return null;
  const tree = (await getParser(lang)).parse(source);
  if (!tree) return null;
  const chars = [...source];
  for (const node of tree.rootNode.descendantsOfType(types)) {
    for (let i = node.startIndex; i < node.endIndex; i++) if (chars[i] !== '\n') chars[i] = ' ';
  }
  tree.delete();
  return chars.join('');
}

/**
 * The code of a file as the vocabulary reads it: comments and strings blanked, the no-op wrappers of
 * an expression blanked around it (src/parse/normalise.ts), a literal subscript written as a member
 * access, escapes in identifiers decoded, Python identifiers NFKC-normalised.
 */
async function markerCode(path: string, source: string): Promise<string | null> {
  const lang = languageForPath(path);
  if (!lang) return null;
  const tree = (await getParser(lang)).parse(source);
  if (!tree) return null;
  try {
    // Offsets are UTF-16 code units in tree-sitter's JS binding; work on code units.
    const units = source.split('');
    const blank = (from: number, to: number): void => {
      for (let i = from; i < to; i++) if (units[i] !== '\n') units[i] = ' ';
    };
    // `x['skip']`, `x[('skip')]`, `x['skip' as const]` → `x.skip`: read before strings are blanked.
    const members: Array<{ open: number; close: number; name: string }> = [];
    if (lang !== 'python') {
      for (const sub of tree.rootNode.descendantsOfType('subscript_expression')) {
        const index = sub.childForFieldName('index');
        const name = jsString(index);
        if (name === null || !/^[A-Za-z_$][\w$]*$/.test(name)) continue;
        const open = sub.children.find((c) => c.type === '[');
        const close = [...sub.children].reverse().find((c) => c.type === ']');
        if (open && close) members.push({ open: open.startIndex, close: close.endIndex, name });
      }
    }
    for (const node of tree.rootNode.descendantsOfType(['comment', 'string', 'template_string'])) blank(node.startIndex, node.endIndex);
    // Parentheses and type assertions do nothing at run time: `raise (X)` is `raise X`, `(it as any).skip` is `it.skip`.
    for (const n of tree.rootNode.descendantsOfType(WRAPPERS.map((w) => w.treeSitter))) {
      if (!isWrapper(n)) continue;
      const inner = unwrap(n);
      blank(n.startIndex, inner.startIndex);
      blank(inner.endIndex, n.endIndex);
    }
    // The bracket span is at least as long as `.name`.
    for (const { open, close, name } of members) {
      blank(open, close);
      const replacement = `.${name}`;
      for (let i = 0; i < replacement.length; i++) units[open + i] = replacement[i]!;
    }
    if (lang === 'python') {
      // Python reads identifiers NFKC-normalised (`pyteſt` is `pytest`): so does the vocabulary.
      for (const id of tree.rootNode.descendantsOfType('identifier')) {
        const text = id.text.normalize('NFKC');
        if (text === id.text) continue;
        units[id.startIndex] = text;
        for (let i = id.startIndex + 1; i < id.endIndex; i++) units[i] = '';
      }
    }
    const code = units.join('');
    // Escapes left in code are in identifiers (`\\u0069t.\\u0073kip`): only unicode escapes are decoded.
    return lang === 'python' ? code : code.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, (m) => decodeJs(m) ?? m);
  } finally {
    tree.delete();
  }
}

/** Recognised markers per kind in one file. */
export async function countMarkers(path: string, source: string, skipLines?: ReadonlySet<number>): Promise<MarkerCounts> {
  const counts = empty();
  let code = await markerCode(path, source);
  if (code === null) return counts;
  // Lines a finding names as a disabling marker on tests that did not exist at base (NEW_TEST): not counted.
  if (skipLines && skipLines.size > 0) code = code.split('\n').map((l, i) => (skipLines.has(i + 1) ? '' : l)).join('\n');
  for (const [kind, re] of path.endsWith('.py') ? PY_VOCABULARY : TS_VOCABULARY) counts[kind] += code.match(re)?.length ?? 0;
  return counts;
}

/** Recognised assertion tokens in one file (TG004's vocabulary, by regex). */
export async function countAssertionTokens(path: string, source: string): Promise<number> {
  const code = await codeOnly(path, source);
  if (code === null) return 0;
  let n = 0;
  for (const re of path.endsWith('.py') ? PY_ASSERTIONS : TS_ASSERTIONS) n += code.match(re)?.length ?? 0;
  return n;
}

export interface NetInput {
  /** Test files compared: base path (null if added) → head path, with the knobs the extractor attributed. */
  files: Array<{ basePath: string | null; headPath: string; base: string | null; head: string; baseKnobs?: readonly Knob[] | undefined; headKnobs?: readonly Knob[] | undefined; newTestLines?: ReadonlySet<number> | undefined }>;
  /** Changed runner configuration files: created (basePath null), deleted (headPath null), renamed or modified. */
  configs?: Array<{ basePath: string | null; headPath: string | null; base: string | null; head: string | null }>;
  rules: readonly RuleId[];
}

/** WARN findings for every test file and marker kind whose count grew, and every file that lost assertions. */
export async function markerNet(input: NetInput): Promise<Finding[]> {
  const findings: Finding[] = [];
  // Assertions are compared over all changed test files together, so a test
  // moved to another file does not look like a loss.
  if (input.rules.includes('TG004')) {
    const lost: Array<{ file: string; before: number; after: number }> = [];
    let totalBefore = 0;
    let totalAfter = 0;
    for (const f of input.files) {
      const before = f.base === null || f.basePath === null ? 0 : await countAssertionTokens(f.basePath, f.base);
      const after = await countAssertionTokens(f.headPath, f.head);
      totalBefore += before;
      totalAfter += after;
      if (after < before) lost.push({ file: f.headPath, before, after });
    }
    if (totalAfter < totalBefore) {
      for (const l of lost) {
        findings.push({
          rule: 'TG004',
          severity: 'warn',
          file: l.file,
          side: 'head',
          line: null,
          test: null,
          message:
            `Assertion removed that the analyzer could not attribute to a test: assertions in this file went from ${l.before} to ${l.after} ` +
            `(${totalBefore} → ${totalAfter} across the changed test files)`,
        });
      }
    }
  }
  if (input.rules.includes('TG005')) {
    const zero = (): SettingCounts => ({ scope: 0, retry: 0, timeout: 0 });
    const unattributed = async (path: string | null, source: string | null, knobs: readonly Knob[] | undefined): Promise<SettingCounts> => {
      if (path === null || source === null) return zero();
      const found = await countSettings(path, source);
      const known = attributedSettings(knobs ?? []);
      return { scope: found.scope, retry: Math.max(0, found.retry - known.retry), timeout: Math.max(0, found.timeout - known.timeout) };
    };
    const entries: Array<{ headPath: string; before: SettingCounts; after: SettingCounts }> = [];
    for (const f of input.files) {
      entries.push({ headPath: f.headPath, before: await unattributed(f.basePath, f.base, f.baseKnobs), after: await unattributed(f.headPath, f.head, f.headKnobs) });
    }
    for (const { headPath, before, after } of entries) {
      for (const kind of ['scope', 'retry', 'timeout'] as const) {
        if (after[kind] <= before[kind]) continue;
        findings.push({
          rule: 'TG005',
          severity: 'warn',
          file: headPath,
          side: 'head',
          line: null,
          test: null,
          message: `Setting added that the analyzer could not attribute: \`${kind}\` settings in this file went from ${before[kind]} to ${after[kind]}`,
        });
      }
    }
  }
  for (const f of input.files) {
    const before = f.base === null || f.basePath === null ? empty() : await countMarkers(f.basePath, f.base);
    const all = await countMarkers(f.headPath, f.head);
    // A disabling marker on a test that did not exist at base loses nothing (an INFO line names it); a focus always counts.
    const disabling = f.newTestLines && f.newTestLines.size > 0 ? await countMarkers(f.headPath, f.head, f.newTestLines) : all;
    for (const kind of Object.keys(all) as MarkerKind[]) {
      const after = kind === 'only' ? all[kind] : disabling[kind];
      if (after <= before[kind]) continue;
      const rule: RuleId = kind === 'only' ? 'TG002' : 'TG003';
      if (!input.rules.includes(rule)) continue;
      findings.push({
        rule,
        severity: 'warn',
        file: f.headPath,
        side: 'head',
        line: null,
        test: null,
        message: `Marker added that the analyzer could not attribute: \`${kind}\` markers in this file went from ${before[kind]} to ${after}`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Runner configuration files: a net independent of the config readers.

/**
 * Tokens of test configuration, counted in the parts of a config file that
 * can hold them (comments removed, strings kept: patterns live in strings).
 * Substrings on purpose: `timeout` also counts `testTimeout`, `ignore` also
 * counts `--ignore` and `testPathIgnorePatterns`.
 */
const CONFIG_VOCABULARY: Array<[string, RegExp]> = [
  ['retry', /retry/gi],
  ['retries', /retries/gi],
  ['timeout', /timeout/gi],
  ['ignore', /ignore/gi],
  ['exclude', /exclude/gi],
  ['include', /include/gi],
  ['testpaths', /testpaths/gi],
  ['testMatch', /testMatch/gi],
  ['testPathIgnorePatterns', /testPathIgnorePatterns/gi],
  ['passWithNoTests', /passWithNoTests/gi],
  ['-k', /(?<![\w-])-k(?![\w-])/g],
  ['--deselect', /--deselect\b/g],
  ['--ignore', /--ignore\b/g],
  ['collect_ignore', /collect_ignore/g],
  ['addopts', /addopts/gi],
  ['reruns', /reruns/gi],
  ['roots', /\broots\b/gi],
  ['bail', /\bbail\b/gi],
];

/** The text of a config file that can configure tests. */
async function configText(path: string, source: string): Promise<string> {
  if (/(?:^|\/)package\.json$/.test(path)) {
    // The raw text of the sections the net watches (PACKAGE_JSON_WATCHED).
    const located = rawTopLevelMembers(source);
    if ('members' in located) return PACKAGE_JSON_WATCHED.map((k) => located.members.get(k) ?? '').join('\n');
    {
      return source;
    }
  }
  if (/\.(?:[cm]?[jt]s|py)$/.test(path)) return (await codeOnly(path, source, ['comment'])) ?? source;
  return source.split(/\r?\n/).filter((l) => !/^\s*[#;]/.test(l)).join('\n');
}

export async function countConfigTokens(path: string, source: string): Promise<Record<string, number>> {
  const text = await configText(path, source);
  return Object.fromEntries(CONFIG_VOCABULARY.map(([token, re]) => [token, text.match(re)?.length ?? 0]));
}

/**
 * WARN for every changed runner configuration file on which TG005 reported
 * nothing. A file is in the diff because git found its bytes different; no
 * comparison is repeated here, and nothing is normalised or interpreted:
 * every normalisation is a way to hide a change (an elision comma read as a
 * trailing comma, spaces inside INI quotes, a coding declaration read as a
 * comment). The vocabulary only details the message.
 */
/**
 * What the net watches in package.json (a scope decision, see docs/rules.md):
 * every entry of `scripts` (a test script can delegate to any other) and the
 * test-runner keys. Dependencies and every other key are out of scope, or each
 * dependency bump would warn.
 */
export const PACKAGE_JSON_WATCHED = ['scripts', 'jest', 'vitest', 'mocha', 'ava', 'c8', 'nyc'] as const;

/**
 * Why a package.json change is in the net's scope, or null if it is not.
 * The watched sections are located with a positional parser and compared as
 * raw text, byte for byte: comparing parsed values is an interpretation too
 * (a BOM made JSON.parse read both sides as {}, and JSON.stringify turns both
 * 1e309 and null into null). If either side cannot be located with certainty
 * (see rawTopLevelMembers), any change to the file is in scope.
 */
/**
 * The scripts that run tests, at base: `test` and `test:*`, their `pre`/`post` hooks, and every script their text
 * names as a whole word (`npm run t`, `run-s unit e2e`), to a fixed point. Over-inclusion only adds warnings.
 */
function testScripts(scripts: ReadonlyMap<string, string>): Set<string> {
  const text = (k: string): string => {
    const raw = scripts.get(k) ?? '';
    try {
      const v: unknown = JSON.parse(raw);
      return typeof v === 'string' ? v : raw;
    } catch {
      return raw;
    }
  };
  const out = new Set([...scripts.keys()].filter((k) => /^test(?::|$)/.test(k)));
  for (let grew = true; grew; ) {
    grew = false;
    for (const k of [...out]) {
      const words = new Set(text(k).split(/[\s&|;()'"=]+/).flatMap((w) => [w, w.replace(/^[\w-]+:/, '')]));
      for (const name of scripts.keys()) {
        if (out.has(name)) continue;
        if (words.has(name) || name === `pre${k}` || name === `post${k}`) {
          out.add(name);
          grew = true;
        }
      }
    }
  }
  return out;
}

export function packageJsonChange(base: string | null, head: string): string | null {
  const b = base === null ? { members: new Map<string, string>() } : rawTopLevelMembers(base);
  const h = rawTopLevelMembers(head);
  if ('anomaly' in b) return `package.json cannot be read with certainty at base (${b.anomaly}), so any change counts`;
  if ('anomaly' in h) return `package.json cannot be read with certainty (${h.anomaly}), so any change counts`;
  const changed: string[] = PACKAGE_JSON_WATCHED.filter((k) => k !== 'scripts' && b.members.get(k) !== h.members.get(k)).map((k) => `\`${k}\``);
  // Scripts: only the ones that run tests (`test`, `test:*`) and existed at base; one the PR adds loses no test.
  const bs = b.members.get('scripts');
  const hs = h.members.get('scripts');
  if (bs !== hs && bs !== undefined) {
    const bm = rawTopLevelMembers(bs);
    const hm = hs === undefined ? { members: new Map<string, string>() } : rawTopLevelMembers(hs);
    if ('anomaly' in bm || 'anomaly' in hm) changed.push('`scripts`');
    else {
      const tests = [...testScripts(bm.members)].filter((k) => bm.members.get(k) !== hm.members.get(k));
      if (tests.length > 0) changed.push(...tests.map((k) => `the \`${k}\` script`));
    }
  }
  return changed.length > 0 ? `${changed.join(', ')} changed` : null;
}

/**
 * Every change to a watched runner config (src/rules/TG005.ts: isConfigPath, an explicit list of names,
 * compared without case) that TG005 did not report specifically. What a file contains never decides
 * whether it is watched.
 */
export async function configNet(configs: NonNullable<NetInput['configs']>, tg005Files: ReadonlySet<string>): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const c of configs) {
    const path = c.headPath ?? c.basePath!;
    if (tg005Files.has(path) || (c.basePath !== null && tg005Files.has(c.basePath))) continue;
    // Created, deleted or renamed: always a change, whatever the bytes and whatever the sections.
    const moved = c.basePath === null ? 'created' : c.headPath === null ? 'deleted' : c.basePath !== c.headPath ? `renamed from ${c.basePath}` : null;
    let why = moved ? `: ${moved}` : '';
    if (!moved && /(?:^|\/)package\.json$/i.test(path)) {
      const change = packageJsonChange(c.base, c.head ?? '');
      if (change === null) continue; // only the version, dependencies, other scripts or keys changed
      why = `: ${change}`;
    }
    // Only what affects the tests (src/config/testscope.ts): a pytest source's pytest and coverage sections; a vite or
    // vitest config with the bytes of its other settings blanked (module resolution, plugins, the dev server), so a
    // statement outside the config object (`config.test.retry = 2`) still counts. Created, deleted or renamed, or
    // not located with certainty: it counts.
    if (!moved && c.base !== null && c.head !== null) {
      const bs = testSections(path, c.base);
      const hs = testSections(path, c.head);
      if (bs !== null && hs !== null && bs === hs) continue;
      if (VITE_LIKE.test(path.slice(path.lastIndexOf('/') + 1))) {
        const bv = await viteTestText(c.basePath!, c.base);
        const hv = await viteTestText(path, c.head);
        if (bv !== null && hv !== null && bv === hv) continue;
      }
    }
    const before = c.base === null || c.basePath === null ? null : await countConfigTokens(c.basePath, c.base);
    const after = c.head === null || c.headPath === null ? null : await countConfigTokens(c.headPath, c.head);
    const grew = after === null ? [] : CONFIG_VOCABULARY.map(([t]) => t).filter((t) => after[t]! > (before?.[t] ?? 0));
    const detail = grew.length > 0 ? ` (more occurrences of ${grew.map((t) => `\`${t}\` ${before?.[t] ?? 0} → ${after![t]}`).join(', ')})` : '';
    findings.push({
      rule: 'TG005',
      severity: 'warn',
      file: path,
      side: c.headPath === null ? 'base' : 'head',
      line: null,
      test: null,
      // What the file is, when nothing more specific was found: it decides which tests run, and how much saidvsdid read of it.
      message: `Test runner config changed; review manually${why || (/(?:^|\/)conftest\.py$/i.test(path) ? ': `conftest.py` can change which tests run and how (hooks, fixtures, marks), and saidvsdid does not analyse it' : ': saidvsdid found no specific change in the settings it reads, and the file decides which tests run')}${detail}`,
    });
  }
  return findings;
}

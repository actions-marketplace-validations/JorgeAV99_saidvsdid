// Test inventory for pytest and unittest suites: forms found on tree-sitter's
// syntax tree, names read by Python itself (src/parse/py-binding.ts).
//
// Two passes. The census walks the whole module and records every marker
// token (pytest marks, unittest decorators, pytest.skip/xfail/importorskip,
// skipTest, SkipTest) with a structural site id. The extraction then attaches
// markers to tests only where they certainly apply: decorators of test
// functions and test classes, `pytestmark`, calls directly in a test body,
// calls in a test class's setUp/setup_method hooks, and module-level skips.
// Everything else (helpers, fixtures, nested functions) stays unattributed.
//
// Names are read through src/parse/py-binding.ts: an alias of a runner import is
// read under its canonical name (`skip_if` from `from unittest import skipIf as
// skip_if` is `unittest.skipIf`), and every attached marker carries a Binding —
// certain only for a module-level import that nothing in the file binds again,
// in any scope (wherever it is used: a decorator or a call in a test body), or
// `self.skipTest` inherited from unittest.TestCase with no override in the
// file. Anything else shaped like the
// vocabulary is attached as uncertain: the rules warn, never FAIL.
import type { Node } from 'web-tree-sitter';
import { classifyGuards, normaliseBody, snippet, type Guard } from './conditions.js';
import { pyAssertions, pyFileInfo, pyHelperCalls, type PyFileInfo } from './py-assert.js';
import { outerWrap, pyName, unwrap } from './normalise.js';
import { pathKind, type PyResolver } from './py-binding.js';
import type { PyFacts } from './py-scopes.js';
import { markerEffect, type MarkerEffect } from '../rules/effects.js';
import { CANONICAL, CERTAIN, firstNotCanonical, notCanonical, oneEffect, uncertain, weakest, type Binding, type MarkerForm, type Knob, type Marker, type MarkerKind, type MarkerSite, type ScopeReading, type TestCase } from './types.js';
import { PY_MARK_KINDS, PY_PLUGIN_MARKS, PY_PYTEST_CALL_KINDS, PY_TESTCASE_METHODS, PY_UNITTEST_DECORATORS, PY_UNITTEST_EXCEPTIONS } from './vocabulary.js';

const line = (n: Node): number => n.startPosition.row + 1;

/** `pytest.mark.skipif`, `(pytest.mark).skipif` → ['pytest', 'mark', 'skipif'] (NFKC, parentheses removed); null for anything but a dotted name. */
function dotted(expr: Node): string[] | null {
  const node = unwrap(expr);
  if (node.type === 'identifier') return [pyName(node)];
  if (node.type === 'attribute') {
    const object = node.childForFieldName('object');
    const attr = node.childForFieldName('attribute');
    const base = object ? dotted(object) : null;
    return base && attr ? [...base, pyName(attr)] : null;
  }
  return null;
}

interface CallParts {
  name: string[] | null;
  positional: Node[];
  keywords: Map<string, Node>;
}

function callParts(call: Node): CallParts {
  const fn = call.childForFieldName('function');
  const argList = call.childForFieldName('arguments');
  const positional: Node[] = [];
  const keywords = new Map<string, Node>();
  for (const a of argList?.namedChildren ?? []) {
    if (a.type === 'keyword_argument') {
      const k = a.childForFieldName('name');
      const v = a.childForFieldName('value');
      if (k && v) keywords.set(pyName(k), v);
    } else if (a.type !== 'comment') {
      positional.push(a);
    }
  }
  return { name: fn ? dotted(fn) : null, positional, keywords };
}

/** The name a `def` or `class` binds, NFKC-normalised ('' if none). */
function nameOf(def: Node): string {
  const id = def.childForFieldName('name');
  return id ? pyName(id) : '';
}

/** `pytestmark` as an assignment target (NFKC). */
function isPytestmark(left: Node | null): boolean {
  return left?.type === 'identifier' && pyName(left) === 'pytestmark';
}

/** The identifier that names a dotted expression: `skip` in `pytest.mark.skip` and `(pytest.mark.skip)`. */
function tokenOf(expr: Node): Node {
  const node = unwrap(expr);
  return node.type === 'attribute' ? (node.childForFieldName('attribute') ?? node) : node;
}

// ---------------------------------------------------------------------------
// Census

// The vocabulary (src/parse/vocabulary.ts, the one definition); bare decorators: unittest's, not its exceptions.
const MARK_KINDS = PY_MARK_KINDS;
const UNITTEST_KINDS = PY_UNITTEST_DECORATORS;
const PYTEST_CALL_KINDS = PY_PYTEST_CALL_KINDS;

/** The callee of a call, parentheses included: `f()`, `(f)()`. */
function isCallee(node: Node): boolean {
  const n = outerWrap(node);
  return n.parent?.type === 'call' && n.parent.childForFieldName('function')?.id === n.id;
}

/** `raise SkipTest`, `raise (unittest.SkipTest)(...)`: constructing the exception alone is not a skip. */
function isRaised(id: Node): boolean {
  let n = id;
  if (n.parent?.type === 'attribute' && n.parent.childForFieldName('attribute')?.id === n.id) n = n.parent;
  n = outerWrap(n);
  if (n.parent?.type === 'call' && n.parent.childForFieldName('function')?.id === n.id) n = outerWrap(n.parent);
  return n.parent?.type === 'raise_statement';
}

/** The decorator an expression is (`@x`, `@(x)`) or calls (`@x(…)`), or null. */
function decoratorOf(node: Node): Node | null {
  const n = outerWrap(node);
  if (n.parent?.type === 'decorator') return n.parent;
  if (n.parent?.type === 'call' && n.parent.childForFieldName('function')?.id === n.id && outerWrap(n.parent).parent?.type === 'decorator') return outerWrap(n.parent).parent;
  return null;
}

/**
 * Kind of the marker named by identifier `id` (the last name of a dotted expression), or null if
 * it is not a marker token. The path is the canonical one when the root is a runner import or a
 * one-step alias of one (`pt.mark.skip`, `skip_if`, `omit` from `omit = pytest.mark.skip`), else
 * as written (`mark.skip`, a local `skip`).
 */
function censusKind(id: Node, resolver: PyResolver): MarkerKind | null {
  const attr = id.parent;
  const tail = attr?.type === 'attribute' && attr.childForFieldName('attribute')?.id === id.id;
  if (attr?.type === 'attribute' && !tail) return null; // the object of an attribute, not its last name
  const expr = tail ? attr! : id;
  const path = resolver.dotted(expr)?.path ?? [pyName(id)];
  const last = path[path.length - 1]!;
  const exception = PY_UNITTEST_EXCEPTIONS[last];
  if (exception) return isRaised(id) ? exception : null;
  if (tail) {
    if (path[path.length - 2] === 'mark' && MARK_KINDS[last]) return MARK_KINDS[last]!;
    if (path.length === 2 && path[0] === 'unittest' && UNITTEST_KINDS[last]) return UNITTEST_KINDS[last]!;
    if (path.length === 2 && path[0] === 'pytest' && PYTEST_CALL_KINDS[last] && isCallee(attr!)) return PYTEST_CALL_KINDS[last]!;
    const method = PY_TESTCASE_METHODS[pyName(id)];
    if (method && isCallee(attr!)) return method;
    return null;
  }
  // A bare name counts where it is used as a marker (a decorator, a call, a raise), not where it is
  // bound: an imported name under another name (`@skip_if(...)`, `skip_now()`) or an alias (`@omit`,
  // `@(omit)`, `omit()`), whatever form of the vocabulary its binding gives it.
  const decorator = decoratorOf(id);
  const kind = path.length > 1 ? pathKind(path) : null;
  if (kind && (decorator !== null || isCallee(id) || isRaised(id))) return kind;
  // Bare decorators shaped like unittest's: @skip("..."), @expectedFailure
  if (decorator && UNITTEST_KINDS[pyName(id)]) return UNITTEST_KINDS[pyName(id)]!;
  return null;
}

/**
 * A docstring as Python defines it: a statement that is a str constant alone — one string literal, or an implicit
 * concatenation of them, none with an `f`, `t` (PEP 750) or `b` prefix: an f-string is a JoinedStr and a t-string a
 * TemplateStr, which evaluate their interpolations, and bytes are not str (`ast.get_docstring` reads none of them).
 */
function isDocstring(stmt: Node): boolean {
  if (stmt.type !== 'expression_statement' || stmt.namedChildren.length !== 1) return false;
  const value = stmt.namedChildren[0]!;
  const parts = value.type === 'string' ? [value] : value.type === 'concatenated_string' ? value.namedChildren : [];
  return parts.length > 0 && parts.every((p) => p.type === 'string' && /^[rRuU]*['"]/.test(p.text));
}

/** The first statement of a body, after its docstring (comments aside); null for an empty body. */
function firstStatement(body: Node): Node | null {
  const stmts = body.namedChildren.filter((c) => c.type !== 'comment');
  return (stmts[0] && isDocstring(stmts[0]) ? stmts[1] : stmts[0]) ?? null;
}

/**
 * F2 (docs/rules.md, *Verdicts*): a call in a test's body is canonical only when it is the first statement of the body
 * (after an optional docstring) and the statement is exactly the call — an expression statement whose value is the call,
 * or `raise X`/`raise X(…)` with no `from`. Anything else is a WARN that says where it is: what comes before it, or what
 * holds it, decides whether it runs.
 */
function pyFirstStatementForm(node: Node, body: Node): MarkerForm {
  const first = firstStatement(body);
  const stmt = node.type === 'raise_statement' ? node : node.parent?.type === 'expression_statement' && node.parent.namedChildren.length === 1 ? node.parent : null;
  if (node.type === 'raise_statement' && node.childForFieldName('cause')) return notCanonical('it is raised `from` another exception, which is not one of the forms the rule reads');
  if (stmt === null) return notCanonical("it is not a statement of its own in the test's body, so what holds it decides whether it runs");
  if (first === null || first.id !== stmt.id) {
    return notCanonical(stmt.parent?.id === body.id && first
      ? `it is not the first statement of the test's body (the first is at line ${first.startPosition.row + 1}), so what comes before it decides whether it runs`
      : "it is not the first statement of the test's body, so what holds it decides whether it runs");
  }
  return CANONICAL;
}

interface CensusEntry {
  site: MarkerSite;
}

class Census {
  readonly byToken = new Map<number, CensusEntry>();
  private readonly ordinals = new Map<string, number>();
  private readonly defPaths = new Map<number, string>();

  constructor(private readonly resolver: PyResolver) {}

  private next(key: string): number {
    const n = this.ordinals.get(key) ?? 0;
    this.ordinals.set(key, n + 1);
    return n;
  }

  private pathOf(def: Node, parent: string): string {
    const known = this.defPaths.get(def.id);
    if (known) return known;
    const kind = def.type === 'class_definition' ? 'class' : 'def';
    const segment = `${parent}/${kind}:${nameOf(def) || 'anon'}`;
    const n = this.next(`path\0${segment}`);
    const path = n > 0 ? `${segment}#${n}` : segment;
    this.defPaths.set(def.id, path);
    return path;
  }

  walk(node: Node, path: string): void {
    if (node.type === 'decorated_definition') {
      const def = node.childForFieldName('definition');
      const inner = def ? this.pathOf(def, path) : path;
      for (const child of node.namedChildren) this.walk(child, child.type === 'decorator' ? inner : path);
      return;
    }
    if (node.type === 'function_definition' || node.type === 'class_definition') {
      const inner = this.pathOf(node, path);
      for (const child of node.namedChildren) this.walk(child, inner);
      return;
    }
    if (node.type === 'identifier') {
      const kind = censusKind(node, this.resolver);
      if (kind) {
        const key = `${path}/${pyName(node)}`;
        const site = `${key}#${this.next(`site\0${key}`)}`;
        let context = node.parent?.type === 'attribute' ? node.parent : node;
        if (context.parent?.type === 'call' && isCallee(context)) context = context.parent;
        const text = snippet(context.parent?.type === 'decorator' ? `@${context.text}` : context.text);
        this.byToken.set(node.id, { site: { site, kind, line: line(node), text, attributed: false } });
      }
    }
    for (const child of node.namedChildren) this.walk(child, path);
  }

  /** Marks the token as attributed and returns its site id. */
  attribute(token: Node): string {
    const entry = this.byToken.get(token.id);
    if (!entry) return `${line(token)}:${token.text}`;
    entry.site.attributed = true;
    return entry.site.site;
  }

  sites(): MarkerSite[] {
    return [...this.byToken.values()].map((e) => e.site).sort((a, b) => a.line - b.line || (a.site < b.site ? -1 : 1));
  }
}

// ---------------------------------------------------------------------------
// Extraction

/** Whose test a function is (F1, F7), or why it is not certain. */
type PyRunner = { runner: 'pytest' | 'unittest' } | { runner: null; why: string };

interface MarkSpec {
  kind: MarkerKind;
  /** Whose member it is: its effect is that runner's (src/rules/effects.ts). */
  runner: 'pytest' | 'unittest';
  /** Which argument holds the condition, and whether the marker applies when it is false. */
  condition: 'none' | 'first' | 'first-negated';
  /**
   * Whether the test still runs with a checked outcome, given the mark's
   * arguments and pytest's `xfail_strict` for the file.
   */
  checked: (parts: CallParts | null, xfailStrict: boolean, truthy: (arg: Node) => boolean | null) => boolean;
}

const never = (): boolean => false;
const always = (): boolean => true;
/**
 * pytest xfail: strict makes an XPASS fail the suite; run=False does not run
 * the test at all. Without `strict=`, the mark inherits `xfail_strict`.
 */
const xfailChecked = (parts: CallParts | null, xfailStrict: boolean, truthy: (arg: Node) => boolean | null): boolean => {
  const strict = parts?.keywords.get('strict');
  const run = parts?.keywords.get('run');
  return (strict ? truthy(strict) === true : xfailStrict) && (run ? truthy(run) !== false : true);
};

/** Maps a mark/decorator name to a marker spec, or null if it is not one we track. */
function markSpec(name: string[]): MarkSpec | null {
  const last = name[name.length - 1]!;
  const prefix = name.slice(0, -1).join('.');
  const isPytestMark = prefix === 'pytest.mark' || prefix === 'mark';
  const isUnittest = prefix === 'unittest' || prefix === '';
  if (isPytestMark) {
    if (last === 'skip') return { kind: 'skip', runner: 'pytest', condition: 'none', checked: never };
    if (last === 'skipif') return { kind: 'skip', runner: 'pytest', condition: 'first', checked: never };
    if (last === 'xfail') return { kind: 'xfail', runner: 'pytest', condition: 'first', checked: xfailChecked };
    if (last === 'only' || last === 'focus') return { kind: 'only', runner: 'pytest', condition: 'none', checked: always };
  }
  if (isUnittest) {
    if (last === 'skip') return { kind: 'skip', runner: 'unittest', condition: 'none', checked: never };
    if (last === 'skipIf') return { kind: 'skip', runner: 'unittest', condition: 'first', checked: never };
    if (last === 'skipUnless') return { kind: 'skip', runner: 'unittest', condition: 'first-negated', checked: never };
    // Since Python 3.4 an unexpected success makes the run unsuccessful.
    if (last === 'expectedFailure') return { kind: 'xfail', runner: 'unittest', condition: 'none', checked: always };
  }
  return null;
}

/**
 * Guards between `node` and `stop`, with polarity: `else` applies when the
 * `if` condition (and every previous `elif`) is false; `x or skip()` applies
 * when `x` is false.
 */
function guardsBetween(node: Node, stop: Node): Guard[] {
  const guards: Guard[] = [];
  let child = node;
  for (let p = node.parent; p && p.id !== stop.id; child = p, p = p.parent) {
    if (p.type === 'if_statement') {
      const cond = p.childForFieldName('condition');
      if (!cond || cond.id === child.id) continue;
      const consequence = p.childForFieldName('consequence');
      if (consequence?.id === child.id) {
        guards.push({ text: cond.text, negated: false });
      } else {
        // An elif/else branch: the if condition and every elif before it were false.
        guards.push({ text: cond.text, negated: true });
        for (const branch of p.namedChildren) {
          if (branch.id === child.id) break;
          if (branch.type === 'elif_clause') {
            const c = branch.childForFieldName('condition');
            if (c) guards.push({ text: c.text, negated: true });
          }
        }
      }
    } else if (p.type === 'elif_clause') {
      const cond = p.childForFieldName('condition');
      if (cond && cond.id !== child.id) guards.push({ text: cond.text, negated: false });
    } else if (p.type === 'conditional_expression') {
      // `a if cond else b`: children are [a, cond, b]
      const [a, cond, b] = p.namedChildren;
      if (cond && a?.id === child.id) guards.push({ text: cond.text, negated: false });
      if (cond && b?.id === child.id) guards.push({ text: cond.text, negated: true });
    } else if (p.type === 'boolean_operator') {
      const left = p.childForFieldName('left');
      const right = p.childForFieldName('right');
      const op = p.childForFieldName('operator')?.text;
      if (left && right?.id === child.id) guards.push({ text: left.text, negated: op === 'or' });
    }
  }
  return guards.reverse();
}

/** Calls lexically owned by `body`: not inside a nested function or class. */
function ownCalls(body: Node): Node[] {
  return body.descendantsOfType('call').filter((call) => {
    let owner = call.parent;
    while (owner && owner.id !== body.id && owner.type !== 'function_definition' && owner.type !== 'class_definition') {
      owner = owner.parent;
    }
    return owner?.id === body.id;
  });
}

const HOOK_METHODS = new Set(['setUp', 'setUpClass', 'setup_method', 'setup_class', 'setup']);

/** A mark expression: `pytest.mark.x`, `pytest.mark.x(...)`, lists/tuples of them (pytestmark). */
function markExpressions(expr: Node): Array<{ name: string[]; parts: CallParts | null; node: Node }> {
  if (expr.type === 'list' || expr.type === 'tuple') return expr.namedChildren.flatMap(markExpressions);
  const parts = expr.type === 'call' ? callParts(expr) : null;
  const name = parts ? parts.name : dotted(expr);
  return name ? [{ name, parts, node: expr }] : [];
}

function markName(name: string[]): string | null {
  const prefix = name.slice(0, -1).join('.');
  return prefix === 'pytest.mark' || prefix === 'mark' ? name[name.length - 1]! : null;
}

function literalNumber(node: Node | undefined): number | null {
  if (!node || (node.type !== 'integer' && node.type !== 'float')) return null;
  const v = Number(node.text.replace(/_/g, ''));
  return Number.isFinite(v) ? v : null;
}

class PyExtractor {
  readonly knobs: Knob[] = [];

  private readonly resolver: PyResolver;

  constructor(
    private readonly census: Census,
    private readonly info: PyFileInfo,
    private readonly xfailStrict: boolean,
  ) {
    this.resolver = info.resolver;
  }

  /** Mark expressions of a decorated definition's decorators. */
  private decoratorExpressions(decorated: Node | null): Node[] {
    if (!decorated || decorated.type !== 'decorated_definition') return [];
    return decorated.namedChildren.filter((d) => d.type === 'decorator').map((d) => d.namedChildren[0]).filter((e): e is Node => Boolean(e));
  }

  /** `parametrize(...)` decorators of a decorated definition, normalised (its parameter tables). */
  paramsOf(decorated: Node | null): string[] {
    return this.decoratorExpressions(decorated)
      .filter((e) => /(?:^|\.)parametrize\s*\(/.test(e.text))
      .map((e) => normaliseBody(e.text));
  }

  /** Right-hand sides of `pytestmark = ...` directly in `block`. */
  private pytestmarkExpressions(block: Node): Node[] {
    const out: Node[] = [];
    for (const stmt of block.namedChildren) {
      const assign = stmt.type === 'expression_statement' ? stmt.namedChildren[0] : null;
      if (assign?.type !== 'assignment' || !isPytestmark(assign.childForFieldName('left'))) continue;
      const right = assign.childForFieldName('right');
      if (right) out.push(right);
    }
    return out;
  }

  /** Mark names (for `-k`) and timeout/retry knobs of a set of mark expressions. */
  marksOf(exprs: Node[], test: string | null, keyPrefix: string, decorator: boolean): string[] {
    const names: string[] = [];
    for (const e of exprs) {
      for (const m of markExpressions(e)) {
        const mark = markName(m.name);
        const bareFlaky = m.name.length === 1 && m.name[0] === 'flaky';
        if (mark) names.push(mark);
        const text = snippet(decorator ? `@${m.node.text}` : m.node.text);
        const at = m.node.startPosition.row + 1;
        if (mark === 'timeout') {
          const v = m.parts ? (m.parts.positional[0] ?? m.parts.keywords.get('timeout')) : undefined;
          this.knobs.push({ kind: 'timeout', value: literalNumber(v), form: 'mark.timeout', line: at, text, test, key: `${keyPrefix}/timeout:mark.timeout` });
        } else if (mark === 'flaky' || bareFlaky) {
          // pytest-rerunfailures: reruns=n; flaky: max_runs=n (n - 1 retries, default 2 runs).
          const reruns = m.parts?.keywords.get('reruns');
          const maxRuns = m.parts?.keywords.get('max_runs');
          const value = reruns ? literalNumber(reruns) : maxRuns ? (literalNumber(maxRuns) ?? 0) - 1 : bareFlaky ? 1 : null;
          this.knobs.push({ kind: 'retry', value, form: 'mark.flaky', line: at, text, test, key: `${keyPrefix}/retry:mark.flaky` });
        }
      }
    }
    return names;
  }

  /** Markers expressed by a mark expression: `pytest.mark.skip`, `pytest.mark.skipif(c, reason=...)`, ... */
  markersFromExpression(written: Node, scope: Marker['scope'], decorator: boolean, owner: Node | null, placed: MarkerForm): Marker[] {
    const expr = unwrap(written);
    if (expr.type === 'list' || expr.type === 'tuple') {
      return expr.namedChildren.flatMap((e) => this.markersFromExpression(e, scope, decorator, owner, placed));
    }
    const nameNode = expr.type === 'call' ? expr.childForFieldName('function') : expr;
    const resolved = nameNode ? this.resolver.dotted(nameNode) : null;
    // A one-step alias of a call (`skip_win = pytest.mark.skipif(…)`, `@skip_win`): the alias's arguments.
    const parts = expr.type === 'call' ? callParts(expr) : resolved?.aliasCall ? callParts(resolved.aliasCall) : null;
    const spec = resolved ? markSpec(resolved.path) : null;
    if (!spec || !nameNode || !resolved) return [];
    const site = this.census.attribute(tokenOf(nameNode));
    const guards: Guard[] = [];
    if (spec.condition !== 'none' && parts) {
      const cond = parts.positional[0] ?? parts.keywords.get('condition');
      if (cond) guards.push(this.guardOf(cond, spec.condition === 'first-negated', spec.runner));
    }
    const condition = classifyGuards(guards);
    const text = snippet(decorator ? `@${written.text}` : written.text);
    // skipif(False), skipUnless(True): never applies; F6 still counts it (oneEffect).
    if (condition === null) {
      this.inert.push(text);
      return [];
    }
    // A plugin's mark: pytest without the plugin runs the test; its effect is never certain.
    const last = resolved.path[resolved.path.length - 1]!;
    const plugin = resolved.path.length >= 2 && resolved.path[resolved.path.length - 2] === 'mark' && Object.hasOwn(PY_PLUGIN_MARKS, last) ? PY_PLUGIN_MARKS[last]! : null;
    const binding = plugin ? weakest(resolved.binding, uncertain(`\`mark.${last}\` takes effect only with ${plugin}, which the diff does not show; pytest without it runs the test`)) : resolved.binding;
    const call = expr.type === 'call' ? expr : (resolved.aliasCall ?? null);
    const form = firstNotCanonical(placed, this.markArgumentsForm(last, call, parts, spec));
    return [{ kind: spec.kind, condition, checked: spec.checked(parts, this.xfailStrict, this.truthy), line: line(expr), site, text, scope, binding, effect: this.markEffect(spec, parts, scope, owner), form }];
  }

  /** An argument's truth value as Python's `ast.literal_eval` reads it, or null when it is not a literal. */
  private readonly truthy = (arg: Node): boolean | null => this.resolver.literal(arg)?.truthy ?? null;

  /**
   * A mark's condition argument: its truth value when it is a literal Python reads (`True`, `0`, `(False)`) — but a
   * string, which pytest evaluates as an expression, is not one for pytest's marks.
   */
  private guardOf(arg: Node, negated: boolean, runner: MarkSpec['runner']): Guard {
    const lit = this.resolver.literal(arg);
    const value = lit && !(lit.kind === 'str' && runner === 'pytest') ? lit.truthy : undefined;
    return { text: arg.text, negated, ...(value === undefined ? {} : { value }) };
  }

  /** Whether an argument is a literal of `kind` as Python's `ast.literal_eval` reads it (and, for a bool, that value). */
  private isLiteral(arg: Node | undefined, kind: 'str' | 'bool', value?: boolean): boolean {
    const lit = arg ? this.resolver.literal(arg) : null;
    return lit !== null && lit.kind === kind && (value === undefined || lit.truthy === value);
  }

  /**
   * F5 (docs/rules.md, *Verdicts*): a mark's arguments, read by Python's `ast.literal_eval`, are one of the signatures the
   * rule reads — pytest: `skip`, `skip()`, `skip("…")`, `skip(reason="…")`; `skipif(True, reason="…")`; `xfail`,
   * `xfail(…)` with only `reason=` (a string), `strict=` and `run=` (booleans); unittest: `skip("…")`, `skipIf(True,
   * "…")`, `skipUnless(False, "…")`, a bare `expectedFailure`. Any other type, argument or combination (unpacked
   * `*`/`**` arguments, a condition, `raises=`, a number for a reason) is a WARN.
   */
  private markArgumentsForm(name: string, call: Node | null, parts: CallParts | null, spec: MarkSpec): MarkerForm {
    const positional = parts?.positional ?? [];
    const keywords = parts?.keywords ?? new Map<string, Node>();
    const written = call?.childForFieldName('arguments')?.namedChildren.filter((a) => a.type !== 'comment') ?? [];
    // Every argument is a plain positional or a keyword (no `*`/`**`): what they hold is written in the call.
    const plain = written.length === positional.length + keywords.size && positional.every((a) => a.type !== 'list_splat' && a.type !== 'dictionary_splat');
    const only = (...keys: string[]): boolean => [...keywords.keys()].every((k) => keys.includes(k));
    const str = (a: Node | undefined): boolean => this.isLiteral(a, 'str');
    let ok: boolean;
    let forms: string;
    if (spec.runner === 'pytest') {
      if (name === 'skip') {
        forms = '`skip`, `skip()`, `skip("…")` or `skip(reason="…")`';
        ok = call === null || (plain && ((positional.length === 0 && keywords.size === 0) || (positional.length === 1 && keywords.size === 0 && str(positional[0])) || (positional.length === 0 && keywords.size === 1 && str(keywords.get('reason')))));
      } else if (name === 'skipif') {
        forms = '`skipif(True, reason="…")`';
        ok = call !== null && plain && positional.length === 1 && this.isLiteral(positional[0], 'bool', true) && keywords.size === 1 && str(keywords.get('reason'));
      } else if (name === 'xfail') {
        forms = '`xfail` or `xfail(…)` with only `reason="…"`, `strict=` and `run=` (True or False)';
        const bools = ['strict', 'run'].every((k) => !keywords.has(k) || this.isLiteral(keywords.get(k), 'bool'));
        ok = call === null || (plain && positional.length === 0 && only('reason', 'strict', 'run') && (!keywords.has('reason') || str(keywords.get('reason'))) && bools);
      } else {
        return CANONICAL; // a plugin's mark (`only`, `focus`): never certain (its binding says why)
      }
    } else if (name === 'skip') {
      forms = '`skip("…")`';
      ok = call !== null && plain && positional.length === 1 && keywords.size === 0 && str(positional[0]);
    } else if (name === 'skipIf' || name === 'skipUnless') {
      forms = name === 'skipIf' ? '`skipIf(True, "…")`' : '`skipUnless(False, "…")`';
      ok = call !== null && plain && positional.length === 2 && keywords.size === 0 && this.isLiteral(positional[0], 'bool', name === 'skipIf') && str(positional[1]);
    } else {
      forms = 'a bare `expectedFailure`';
      ok = call === null;
    }
    return ok ? CANONICAL : notCanonical(`its arguments are not one of the forms the rule reads (${forms}), so what it does is not certain`);
  }

  /**
   * What a mark or decorator does to the test, when its runner guarantees it (src/rules/effects.ts):
   * - pytest's `xfail`: an argument that restricts it — a positional condition, `condition=`, `raises=` — leaves its
   *   effect to the condition or the exception raised, never certain; `run=False` does not run the test; `strict=` and
   *   `reason=` restrict nothing.
   * - unittest's `expectedFailure`: an expected failure only on a method of a class that certainly reaches
   *   `unittest.TestCase` (pytest runs a plain function as any other test; on a class it is not the method's own
   *   decorator). Its other decorators are the form's business (markerForm of decoratorMarkers).
   */
  private markEffect(spec: MarkSpec, parts: CallParts | null, scope: Marker['scope'], owner: Node | null): MarkerEffect {
    if (spec.kind === 'xfail' && spec.runner === 'pytest') {
      if (parts && parts.positional.length > 0) return { known: false, why: 'its positional condition decides whether pytest expects the failure' };
      for (const [k, why] of [
        ['condition', '`condition=` decides whether pytest expects the failure'],
        ['raises', 'pytest expects the failure only for the exceptions in `raises=`; any other one fails the test'],
      ] as const) {
        if (parts?.keywords.has(k)) return { known: false, why };
      }
      const run = parts?.keywords.get('run');
      if (run && this.truthy(run) === false) return { known: true, effect: 'not-run' };
    }
    if (spec.kind === 'xfail' && spec.runner === 'unittest') {
      if (scope !== 'test' || !owner) return { known: false, why: '`expectedFailure` makes an expected failure only of a method of a `unittest.TestCase`' };
      const method = this.resolver.testCaseMethod(owner);
      if (!method.certain) return { known: false, why: `\`expectedFailure\` makes an expected failure only of a method of a \`unittest.TestCase\`: ${method.why}` };
    }
    return markerEffect(spec.runner, spec.kind);
  }

  /** `@pytest.mark.parametrize(..., [pytest.param(1, marks=pytest.mark.skip)])` */
  paramMarkers(decoratorExpr: Node): Marker[] {
    const out: Marker[] = [];
    for (const call of decoratorExpr.descendantsOfType('call')) {
      const parts = callParts(call);
      if (parts.name?.[parts.name.length - 1] !== 'param') continue;
      const marks = parts.keywords.get('marks');
      if (marks) out.push(...this.markersFromExpression(marks, 'test', false, null, notCanonical('it is a mark of one `pytest.param` row of `parametrize`, not a decorator of the test')));
    }
    return out;
  }

  /** Markers of a definition's decorators; `placed`: the form of the definition they decorate (F1, F7 for a test). */
  decoratorMarkers(decorated: Node | null, scope: Marker['scope'], placed: MarkerForm): Marker[] {
    if (!decorated || decorated.type !== 'decorated_definition') return [];
    const out: Marker[] = [];
    for (const expr of this.decoratorExpressions(decorated)) {
      const found = this.markersFromExpression(expr, scope, true, decorated.childForFieldName('definition'), scope === 'test' ? placed : notCanonical('it decorates the class, not the test function'));
      out.push(...found);
      if (found.length === 0) out.push(...this.paramMarkers(expr));
    }
    return out;
  }

  /**
   * Whose test a function is (F1, F7): a module-level function, or a method of a class with no base whose name starts
   * with `Test`, is pytest's; a method of a class whose one base is certainly unittest.TestCase is unittest's. Any other
   * class (other bases, a keyword, a name pytest does not collect) is not read.
   */
  testRunner(cls: Node | null): PyRunner {
    if (!cls) return { runner: 'pytest' };
    const b = this.resolver.classBases(cls);
    if ('why' in b) return { runner: null, why: b.why };
    if (b.bases === 'testcase') return { runner: 'unittest' };
    return nameOf(cls).startsWith('Test') ? { runner: 'pytest' } : { runner: null, why: `class \`${nameOf(cls)}\` has no base and pytest collects only classes whose name starts with \`Test\`` };
  }

  /**
   * F1 (docs/rules.md, *Verdicts*): every decorator of a test function or of its class is the runner's — any
   * `@pytest.mark.<name>` or `@pytest.mark.<name>(…)` for pytest, one of unittest's decorators for a unittest method —
   * each certainly bound. Any other decorator may replace or wrap the test: a WARN for every marker of the function,
   * its body's included.
   */
  decoratorsForm(decorated: Node | null, runner: PyRunner, what: 'test' | 'class'): MarkerForm {
    const exprs = this.decoratorExpressions(decorated);
    if (exprs.length === 0) return CANONICAL;
    if (runner.runner === null) return notCanonical(`the ${what} is decorated and whose test it is is not certain: ${runner.why}`);
    for (const e of exprs) {
      const ex = unwrap(e);
      const nameNode = ex.type === 'call' ? ex.childForFieldName('function') : ex;
      const resolved = nameNode ? this.resolver.dotted(nameNode) : null;
      const p = resolved?.path ?? [];
      const shown = `\`@${snippet(e.text, 40)}\``;
      const ok = runner.runner === 'pytest' ? p.length === 3 && p[0] === 'pytest' && p[1] === 'mark' : p.length === 2 && p[0] === 'unittest' && Object.hasOwn(UNITTEST_KINDS, p[1]!);
      if (!ok) return notCanonical(`the ${what} also has ${shown}, which is not ${runner.runner === 'pytest' ? 'a `pytest.mark` mark' : "one of unittest's decorators"} and may replace or wrap it`);
      if (!resolved!.binding.certain) return notCanonical(`${shown} on the ${what} may not be the runner's: ${resolved!.binding.why}`);
    }
    return CANONICAL;
  }

  /** `pytest.skip()`, `self.skipTest()`, `pytest.xfail()`, `raise SkipTest`, `pytest.importorskip()` owned by `body`. */
  /**
   * F2's signatures (docs/rules.md, *Verdicts*): `pytest.skip()`, `pytest.skip("…")`, `pytest.skip(reason="…")`, the same
   * for `pytest.xfail`, `self.skipTest("…")`, `raise SkipTest` and `raise SkipTest("…")` — the arguments plain, a reason
   * a string literal Python reads. Any other argument is a WARN.
   */
  private callSignatureForm(what: 'pytest.skip' | 'pytest.xfail' | 'skipTest' | 'SkipTest' | 'other', call: Node | null): MarkerForm {
    if (what === 'other') return CANONICAL; // importorskip (a condition of its own), an alias (never certain)
    const parts = call ? callParts(call) : null;
    const written = call?.childForFieldName('arguments')?.namedChildren.filter((a) => a.type !== 'comment') ?? [];
    const positional = parts?.positional ?? [];
    const keywords = parts?.keywords ?? new Map<string, Node>();
    const plain = written.length === positional.length + keywords.size && positional.every((a) => a.type !== 'list_splat' && a.type !== 'dictionary_splat');
    const str = (a: Node | undefined): boolean => this.isLiteral(a, 'str');
    const none = positional.length === 0 && keywords.size === 0;
    const one = positional.length === 1 && keywords.size === 0 && str(positional[0]);
    let ok: boolean;
    let forms: string;
    if (what === 'pytest.skip' || what === 'pytest.xfail') {
      forms = `\`${what}()\`, \`${what}("…")\` or \`${what}(reason="…")\``;
      ok = plain && (none || one || (positional.length === 0 && keywords.size === 1 && str(keywords.get('reason'))));
    } else if (what === 'skipTest') {
      forms = '`self.skipTest("…")`';
      ok = plain && one;
    } else {
      forms = '`raise SkipTest` or `raise SkipTest("…")`';
      ok = call === null || (plain && (none || one));
    }
    return ok ? CANONICAL : notCanonical(`its arguments are not one of the forms the rule reads (${forms}), so what it does is not certain`);
  }

  /** `placed`: the form of the test function the body is (F1, its runner); a hook's or the module's calls are never canonical. */
  imperativeMarkers(body: Node, scope: Marker['scope'], moduleLevel: boolean, enclosing: MarkerForm = CANONICAL, runner: PyRunner['runner'] = null): Marker[] {
    const out: Marker[] = [];
    const placed = (at: Node, signature: MarkerForm, pytestCall = false): MarkerForm =>
      moduleLevel
        ? notCanonical("it is at module level, not in a test's body")
        : scope === 'test'
          ? firstNotCanonical(
              enclosing,
              // pytest's own calls in a unittest method: what they do depends on which runner runs the file (unittest
              // reports pytest's exceptions as errors).
              pytestCall && runner === 'unittest' ? notCanonical("it is pytest's, in a `unittest.TestCase` method: what it does depends on which runner runs the file") : CANONICAL,
              pyFirstStatementForm(at, body),
              signature,
            )
          : notCanonical("it is in a setup hook, not in the test's body");
    for (const call of ownCalls(body)) {
      const fn = call.childForFieldName('function');
      if (!fn) continue;
      const { name, keywords } = callParts(call);
      const resolved = this.resolver.dotted(fn);
      const joined = resolved?.path.join('.');
      let binding: Binding = resolved?.binding ?? uncertain(`\`${snippet(fn.text, 40)}\` is not a dotted name`);
      let kind: MarkerKind | null = null;
      let checked = false;
      let environment = false;
      let what: 'pytest.skip' | 'pytest.xfail' | 'skipTest' | 'SkipTest' | 'other' = 'other';
      if (joined === 'pytest.importorskip') {
        kind = 'skip';
        environment = true;
      } else if (joined === 'pytest.skip') {
        // At module level, pytest.skip() without allow_module_level=True is an error, not a skip.
        if (moduleLevel && keywords.get('allow_module_level')?.text !== 'True') continue;
        kind = 'skip';
        what = 'pytest.skip';
      } else if (name?.join('.') === 'self.skipTest') {
        kind = 'skip';
        what = 'skipTest';
        binding = this.resolver.selfMethod(fn.childForFieldName('object')!, 'skipTest');
      } else if (resolved?.path.at(-1) === 'SkipTest') {
        // Constructing the exception is not a skip; raising it is.
        if (outerWrap(call).parent?.type !== 'raise_statement') continue;
        kind = 'skip';
        what = 'SkipTest';
      } else if (joined === 'pytest.xfail') {
        kind = 'xfail'; // stops the test on the spot: nothing after it is checked
        checked = false;
        what = 'pytest.xfail';
      } else if (!moduleLevel && resolved?.viaAlias && pathKind(resolved.path) && !decoratorOf(fn)) {
        // A call of an alias of the vocabulary in a test or a hook (`omit()` with `omit = pytest.mark.skip`):
        // at least a WARN. Decorators are read by decoratorMarkers; module-level calls stay with the census.
        kind = pathKind(resolved.path);
        checked = kind === 'only';
      }
      if (!kind) continue;
      const site = this.census.attribute(tokenOf(fn));
      const condition = environment ? 'environment' : classifyGuards(guardsBetween(call, body));
      // Whose function it is: pytest's (`pytest.skip()`, `pytest.xfail()`, `importorskip`) or unittest's (`skipTest`, `SkipTest`).
      const runner = resolved?.path[0] === 'pytest' ? 'pytest' : 'unittest';
      // `raise SkipTest(…)`: the statement is the `raise`, whose exception is exactly the call.
      const raise = what === 'SkipTest' ? outerWrap(call).parent! : null;
      const at = raise && raise.namedChildren[0]?.id === call.id ? raise : call;
      if (condition === null) this.inert.push(snippet(call.text));
      if (condition !== null) out.push({ kind, condition, checked, line: line(call), site, text: snippet(call.text), scope, binding, effect: markerEffect(runner, kind), form: placed(at, this.callSignatureForm(what, call), what === 'pytest.skip' || what === 'pytest.xfail' || joined === 'pytest.importorskip') });
    }
    // `raise SkipTest` / `raise (unittest.SkipTest)` / `raise e` with an alias, without calling it.
    for (const raise of body.descendantsOfType('raise_statement')) {
      const written = raise.namedChildren[0];
      const expr = written ? unwrap(written) : null;
      const resolved = expr && expr.type !== 'call' ? this.resolver.dotted(expr) : null;
      if (!expr || !resolved || resolved.path.at(-1) !== 'SkipTest') continue;
      let owner = raise.parent;
      while (owner && owner.id !== body.id && owner.type !== 'function_definition' && owner.type !== 'class_definition') owner = owner.parent;
      if (owner?.id !== body.id) continue;
      const site = this.census.attribute(tokenOf(expr));
      const condition = classifyGuards(guardsBetween(raise, body));
      if (condition === null) this.inert.push(snippet(raise.text));
      if (condition !== null) out.push({ kind: 'skip', condition, checked: false, line: line(raise), site, text: snippet(raise.text), scope, binding: resolved.binding, effect: markerEffect('unittest', 'skip'), form: placed(raise, written && written.id === expr.id ? CANONICAL : notCanonical('its exception is written in parentheses, which is not one of the forms the rule reads')) });
    }
    return out;
  }

  pytestmark(block: Node, scope: Marker['scope']): Marker[] {
    const out: Marker[] = [];
    for (const stmt of block.namedChildren) {
      if (stmt.type !== 'expression_statement') continue;
      const assign = stmt.namedChildren[0];
      if (assign?.type !== 'assignment') continue;
      if (!isPytestmark(assign.childForFieldName('left'))) continue;
      const right = assign.childForFieldName('right');
      if (right) out.push(...this.markersFromExpression(right, scope, false, null, notCanonical(`\`pytestmark\` applies it to every test of the ${scope === 'file' ? 'module' : 'class'}, not as a decorator of the test`)));
    }
    return out;
  }

  /** setUp / setup_method / ... of a test class: inline hooks of that block. */
  hookMarkers(classBody: Node): Marker[] {
    const out: Marker[] = [];
    for (const stmt of classBody.namedChildren) {
      const def = stmt.type === 'decorated_definition' ? stmt.childForFieldName('definition') : stmt;
      if (def?.type !== 'function_definition' || !HOOK_METHODS.has(nameOf(def))) continue;
      const body = def.childForFieldName('body');
      if (body) out.push(...this.imperativeMarkers(body, 'suite', false));
    }
    return out;
  }

  /**
   * What F7 checks that the file shows about whether the runner collects a test, applied to every marker of it (TG001,
   * TG002, TG003): no `__test__` in the file; the function, and its class, each bound once in the file (Python's AST: no
   * other binding, inside an `if` too, no star import, no primitive that binds names at run time); the class with no
   * `__init__` or `__new__`.
   */
  private collectionForm(def: Node, cls: Node | null): MarkerForm {
    const testFlag = this.resolver.bindsAt('__test__');
    if (testFlag !== null) return notCanonical(`the file binds \`__test__\` (line ${testFlag}), which decides whether pytest collects its tests`);
    if (cls) {
      const ctor = classBindings(cls.childForFieldName('body'), ['__init__', '__new__']);
      if (ctor) return notCanonical(`class \`${nameOf(cls)}\` defines \`${ctor.name}\` (line ${ctor.line}), which decides how the runner builds it`);
      const clsOnce = this.resolver.boundOnce(nameOf(cls));
      if (clsOnce) return notCanonical(clsOnce);
    }
    const once = this.resolver.boundOnce(nameOf(def), cls ? nameOf(cls) : null);
    return once ? notCanonical(once) : CANONICAL;
  }

  /**
   * `@pytest.mark.parametrize(…, [])`: a literal empty list of values — pytest collects the test once, skipped
   * (`[NOTSET]`), whatever else is on it. A non-literal one is assumed to produce at least one case (docs/rules.md,
   * *Verdicts*, the documented assumptions).
   */
  private emptyParamForm(decorated: Node | null): MarkerForm {
    for (const e of this.decoratorExpressions(decorated)) {
      const call = unwrap(e);
      if (call.type !== 'call' || markName(callParts(call).name ?? []) !== 'parametrize') continue;
      const parts = callParts(call);
      const values = parts.positional[1] ?? parts.keywords.get('argvalues');
      const lit = values ? this.resolver.literal(values) : null;
      if (lit && lit.kind === 'other' && !lit.truthy) return notCanonical(`\`${snippet(e.text, 40)}\` has no values: pytest collects the test once, skipped`);
    }
    return CANONICAL;
  }

  /**
   * F7 (docs/rules.md, *Verdicts*): a test the file shows the runner collects, the only kind TG001 gives a FAIL for
   * deleting — (a) a module-level `def test_…` or (b) a `def test_…` method of a module-level class; and everything every
   * marker needs (`fnForm`: whose test it is, F1, a plain `def`, not a generator, no empty `parametrize`, the collection
   * checks).
   */
  private declarationForm(def: Node, cls: Node | null, path: readonly string[], fnForm: MarkerForm): MarkerForm {
    const name = nameOf(def);
    if (!name.startsWith('test_')) return notCanonical(`\`${name}\` does not start with \`test_\``);
    if (cls ? path.length !== 1 || !isModuleStatement(cls) : !isModuleStatement(def)) return notCanonical(cls ? `\`${name}\` is in a class that is not a statement of the module` : `\`${name}\` is not a statement of the module`);
    return fnForm;
  }

  /** Markers written whose literal condition never applies, gathered while a definition's markers are read (F6). */
  private inert: string[] = [];

  /** Reads `f()`'s markers, and the inert ones written beside them. */
  withInert<T>(f: () => T): [T, string[]] {
    const before = this.inert;
    this.inert = [];
    try {
      return [f(), this.inert];
    } finally {
      this.inert = before;
    }
  }

  collect(block: Node, path: string[], inherited: Marker[], out: TestCase[], cls: Node | null = null, inheritedMarks: string[] = [], inheritedParams: string[] = [], collected: Binding = CERTAIN, classForm: MarkerForm = CANONICAL, inheritedInert: string[] = []): void {
    // Whether the runner collects the tests of this block, by what the file shows (docs/rules.md, TG001).
    const blockDoubt = weakest(collected, collectionDoubt(block, cls));
    const runner = this.testRunner(cls);
    for (const stmt of block.namedChildren) {
      const def = stmt.type === 'decorated_definition' ? stmt.childForFieldName('definition') : stmt;
      if (!def) continue;
      const decorated = stmt.type === 'decorated_definition' ? stmt : null;
      const name = nameOf(def);
      if (def.type === 'function_definition' && name.startsWith('test')) {
        const body = def.childForFieldName('body');
        const assertionSites = body ? pyAssertions(body, this.resolver) : [];
        const testName = [...path, name].join('::');
        const marks = this.marksOf(this.decoratorExpressions(decorated), testName, `test:${testName}`, true);
        // F1 for every marker of the function, its decorators' and its body's: whose test it is, its decorators and
        // its classes' are the runner's, and it is a plain `def`.
        const decorators = this.decoratorsForm(decorated, runner, 'test');
        const fnForm = firstNotCanonical(
          runner.runner === null ? notCanonical(`whose test it is is not certain: ${runner.why}`) : CANONICAL,
          classForm,
          decorators,
          isAsync(def) ? notCanonical(`\`${name}\` is an \`async def\`, which the runner does not run as a plain test`) : CANONICAL,
          isGenerator(def) ? notCanonical(`\`${name}\` is a generator (it holds a \`yield\`): the runner does not run its body as a test`) : CANONICAL,
          this.emptyParamForm(decorated),
          this.collectionForm(def, cls),
        );
        const [own, inert] = this.withInert(() => [...this.decoratorMarkers(decorated, 'test', fnForm), ...(body ? this.imperativeMarkers(body, 'test', false, fnForm, runner.runner) : [])]);
        out.push({
          name: testName,
          ordinal: 1,
          line: line(def),
          body: body ? normaliseBody(body.text) : '',
          params: [...inheritedParams, ...this.paramsOf(decorated)].join(' | '),
          assertions: assertionSites.length,
          assertionSites,
          helperCalls: pyHelperCalls(def, this.info, cls),
          markers: oneEffect([...inherited, ...own], [...inheritedInert, ...inert]),
          marks: [...new Set([...inheritedMarks, ...marks])].sort(),
          // pytest and unittest collect a test by its name and class: no API binding to resolve, but the file may keep
          // it from being collected (`__test__ = False`, a pytest class with `__init__`, `load_tests`, the name rebound).
          binding: weakest(blockDoubt, reboundDoubt(block, def, name)),
          declaration: this.declarationForm(def, cls, path, fnForm),
        });
      } else if (def.type === 'class_definition' && isTestClass(def)) {
        const body = def.childForFieldName('body');
        if (!body) continue;
        const [classMarkers, classInert] = this.withInert(() => [...this.decoratorMarkers(decorated, 'suite', CANONICAL), ...this.pytestmark(body, 'suite'), ...this.hookMarkers(body)]);
        const classPath = [...path, name].join('::');
        const classMarks = [
          ...this.marksOf(this.decoratorExpressions(decorated), null, `class:${classPath}`, true),
          ...this.marksOf(this.pytestmarkExpressions(body), null, `class:${classPath}/pytestmark`, false),
        ];
        const ownForm = firstNotCanonical(this.decoratorsForm(decorated, this.testRunner(def), 'class'), this.emptyParamForm(decorated));
        this.collect(body, [...path, name], [...inherited, ...classMarkers], out, def, [...inheritedMarks, ...classMarks], [...inheritedParams, ...this.paramsOf(decorated)], blockDoubt, firstNotCanonical(classForm, ownForm), [...inheritedInert, ...classInert]);
      }
    }
  }
}

/** A generator: the function's own body holds a `yield` (outside the functions, lambdas and classes it defines). */
function isGenerator(def: Node): boolean {
  const visit = (n: Node): boolean => {
    if (n.type === 'yield') return true;
    if (n.type === 'function_definition' || n.type === 'lambda' || n.type === 'class_definition') return false;
    return n.namedChildren.some(visit);
  };
  const body = def.childForFieldName('body');
  return body ? body.namedChildren.some(visit) : false;
}

/** `async def`. */
function isAsync(def: Node): boolean {
  return def.children.some((c) => c.type === 'async');
}

/** A definition that is a statement of the module itself (decorated or not). */
function isModuleStatement(def: Node): boolean {
  const stmt = def.parent?.type === 'decorated_definition' ? def.parent : def;
  return stmt.parent?.type === 'module';
}

/** The first of `names` a class body binds (a `def`, an assignment, anywhere in the body outside nested functions and classes). */
function classBindings(body: Node | null, names: readonly string[]): { name: string; line: number } | null {
  if (!body) return null;
  let found: { name: string; line: number } | null = null;
  const visit = (n: Node): void => {
    if (found) return;
    if (n.type === 'function_definition' || n.type === 'class_definition') {
      const own = nameOf(n);
      if (names.includes(own)) found = { name: own, line: n.startPosition.row + 1 };
      return; // their bodies bind their own names
    }
    if (n.type === 'identifier' && names.includes(pyName(n))) {
      found = { name: pyName(n), line: n.startPosition.row + 1 };
      return;
    }
    for (const c of n.namedChildren) visit(c);
  };
  for (const c of body.namedChildren) visit(c);
  return found;
}

/** The names a target binds itself: an identifier, or the identifiers of a tuple or list of targets (never `a.b`, `a[k]`). */
function boundNames(target: Node): string[] {
  const t = unwrap(target);
  if (t.type === 'identifier') return [pyName(t)];
  if (t.type === 'pattern_list' || t.type === 'tuple_pattern' || t.type === 'list_pattern' || t.type === 'expression_list' || t.type === 'tuple' || t.type === 'list' || t.type === 'list_splat_pattern') return t.namedChildren.flatMap(boundNames);
  return [];
}

/** The statements of a block that bind `name` there: a `def`, a `class`, an assignment to it, a `del`. */
function blockBindings(block: Node, name: string): Node[] {
  const out: Node[] = [];
  for (const stmt of block.namedChildren) {
    const def = stmt.type === 'decorated_definition' ? stmt.childForFieldName('definition') : stmt;
    if ((def?.type === 'function_definition' || def?.type === 'class_definition') && nameOf(def) === name) out.push(stmt);
    const expr = stmt.type === 'expression_statement' ? stmt.namedChildren[0] : null;
    if (expr && (expr.type === 'assignment' || expr.type === 'augmented_assignment')) {
      const left = expr.childForFieldName('left');
      if (left && boundNames(left).includes(name)) out.push(stmt);
    }
    if (stmt.type === 'delete_statement' && stmt.namedChildren.flatMap(boundNames).includes(name)) out.push(stmt);
  }
  return out;
}

/**
 * What in a block keeps the runner from collecting its tests, as far as the file shows (docs/rules.md, TG001): a
 * `__test__` assignment (pytest reads it on the module and on a class), a pytest class with `__init__` (pytest does not
 * collect it), a module-level `load_tests` (unittest's own collection). Configuration outside the file (`conftest.py`,
 * `python_functions`, `collect_ignore`) is the documented assumption about how the runner is invoked.
 */
function collectionDoubt(block: Node, cls: Node | null): Binding {
  const testFlag = blockBindings(block, '__test__')[0];
  if (testFlag) return uncertain(`the ${cls ? 'class' : 'module'} sets \`__test__\` (line ${testFlag.startPosition.row + 1}), which decides whether pytest collects its tests`);
  if (cls) {
    const init = blockBindings(block, '__init__')[0];
    const supers = cls.childForFieldName('superclasses')?.text ?? '';
    if (init && !/\bTestCase\b/.test(supers)) return uncertain(`the class defines \`__init__\` (line ${init.startPosition.row + 1}), and pytest does not collect a class with one`);
  } else {
    const loadTests = blockBindings(block, 'load_tests')[0];
    if (loadTests) return uncertain(`the module defines \`load_tests\` (line ${loadTests.startPosition.row + 1}), which decides what unittest collects`);
  }
  return CERTAIN;
}

/** A test whose name the same block binds again (another `def`, an assignment, a `del`): what is collected under it may be something else. */
function reboundDoubt(block: Node, def: Node, name: string): Binding {
  const other = blockBindings(block, name).find((st) => st.id !== def.id && st.childForFieldName('definition')?.id !== def.id);
  return other ? uncertain(`\`${name}\` is bound again at line ${other.startPosition.row + 1}, so the runner may collect something else under that name`) : CERTAIN;
}

function isTestClass(cls: Node): boolean {
  const name = nameOf(cls);
  if (name.startsWith('Test')) return true;
  const supers = cls.childForFieldName('superclasses')?.text ?? '';
  return /\bTestCase\b/.test(supers);
}

/**
 * @param facts Python's answer for the file (`ParseOptions.pyFacts`), taken once by the caller;
 * @param xfailStrict pytest's `xfail_strict` for this file: what a bare `xfail` inherits.
 */
export function extractPyTests(root: Node, source: string, facts: PyFacts, xfailStrict = false): { tests: TestCase[]; markerSites: MarkerSite[]; knobs: Knob[]; scopes: ScopeReading } {
  const info = pyFileInfo(root, source, facts);
  const census = new Census(info.resolver);
  census.walk(root, '');
  const x = new PyExtractor(census, info, xfailStrict);
  const [fileMarkers, fileInert] = x.withInert(() => [...x.pytestmark(root, 'file'), ...x.imperativeMarkers(root, 'file', true)]);
  const fileMarks = x.marksOf(
    root.namedChildren
      .filter((st) => st.type === 'expression_statement' && st.namedChildren[0]?.type === 'assignment' && isPytestmark(st.namedChildren[0].childForFieldName('left')))
      .map((st) => st.namedChildren[0]!.childForFieldName('right')!)
      .filter(Boolean),
    null,
    'file/pytestmark',
    false,
  );
  const tests: TestCase[] = [];
  x.collect(root, [], fileMarkers, tests, null, fileMarks, [], CERTAIN, CANONICAL, fileInert);
  return { tests, markerSites: census.sites(), knobs: x.knobs, scopes: facts.ok ? { known: true } : { known: false, why: facts.why } };
}

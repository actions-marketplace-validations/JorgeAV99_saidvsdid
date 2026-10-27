# Known limitations

Constructed counterexamples from the external reviews (Codex, rounds 13–16 of PR #4): code built to make the analyser
read something the runner does not do — dead code, constructions meant to mislead it, combinations no idiomatic style
produces. Each is a fixture with the real runner's evidence (`fixtures/cases/<rule>/<name>`). Today each gives a `WARN`
for the construction itself (it matches none of the canonical forms of the whitelist, docs/rules.md *Verdicts*) — a
fixture may still carry a correct `FAIL` for another marker of the same test, as `@pytest.mark.skip` beside
`@pytest.mark.xfail` keeps its `FAIL` for the skip (`not-run`, which pytest shows) and the xfail is the `WARN` — or it
stays outside one of the documented assumptions (a canonical `FAIL` the runner does not show, pinned by
`outsideAssumption`).

Since round 16 such cases are recorded here and do not block a merge (CLAUDE.md, *Process*): a `WARN` asks a human to
look, and the real precision of the `FAIL` is measured with the benchmark on real pull requests (docs/benchmark.md).
What blocks is a defect of the measuring instrument, a false `FAIL` on code an agent or a person would plausibly write
to skip or weaken a test, a silence in the contract's combinations, a regression, a privacy leak, or documentation that
promises more than is implemented.

## Dead code and unreachable markers — `WARN`

| Example | Fixture | Runner | Verdict |
|---|---|---|---|
| `if (false) { test.skip('A', fn) }` | `TG003/codex15-skip-inside-if-false-vitest` | A never collected | `WARN` (F3: not a statement of the file) |
| `if (false) { test.only('A', fn) }` | `TG002/codex15-only-inside-if-false-vitest` | only B runs, on both sides | `WARN` (F3) |
| a deleted file that only declared tests inside `if (false)` | `TG001/codex15-deleted-file-if-false-vitest` | nothing collected | `WARN` (F3) |
| `describe('S', () => { test('live', fn); return; test.only('X', fn) })` | `TG002/codex16-describe-return-only-{vitest,jest,playwright}` | X never registered | `WARN` (F3: the callback returns) |
| the same with `test.skip('X', fn)` | `TG003/codex16-describe-return-skip-vitest` | X never registered | `WARN` (F3) |
| `def test_x(): return` then `pytest.skip()` | `TG003/codex14-pytest-skip-after-return` | passed → passed | `WARN` (F2: not the first statement) |
| `pytest.skip()` inside `for _ in []:` | `TG003/codex14-pytest-skip-in-empty-for` | passed → passed | `WARN` (F2) |
| `try: pytest.skip() except BaseException: pass` | `TG003/codex14-pytest-skip-caught` | passed → passed | `WARN` (F2) |
| `try: … finally: return` around a skip | `TG003/codex14-pytest-skip-finally-return` | passed → passed | `WARN` (F2) |
| `ctx.skip()` inside a loop over an empty array | `TG003/codex14-vitest-ctx-skip-empty-loop` | passed → passed | `WARN` (F2) |
| `ctx.skip()` after an early `return` | `TG003/canonical-node-skip-after-return` | passed → passed | `WARN` (F2) |
| `assert False` then `pytest.skip("why")` | `TG003/codex15-assert-false-before-skip` | failed → failed | `WARN` (F2) |
| a failing `expect` then `ctx.skip()` | `TG003/codex15-failing-expect-before-ctx-skip-vitest` | failed → failed | `WARN` (F2) |
| `pytest.xfail()` then `pytest.skip()` | `TG003/codex15-xfail-then-skip` | xfailed: the skip is never reached | `WARN` (F2, F6) |

## Constructions that hide the call — `WARN`

| Example | Fixture | Runner | Verdict |
|---|---|---|---|
| `assert True, pytest.skip("why")` (a message never evaluated) | `TG003/codex15-assert-message-skip` | passed → passed | `WARN` (F2: not exactly the call) |
| `result ||= ctx.skip()` with `result = true` | `TG003/codex15-logical-assign-ctx-skip-vitest` | passed → passed | `WARN` (F2) |
| `absent?.(ctx.skip())` with `absent = null` | `TG003/codex15-optional-call-ctx-skip-vitest` | passed → passed | `WARN` (F2) |
| `pytest.skip(**{"reason": "why"})` | `TG003/codex15-skip-kwargs-unpacked` | passed → skipped | `WARN` (F2: unpacked arguments) |
| `pytest.skip(123)` | `TG003/codex15-skip-int-reason` | passed → failed (pytest fails the test) | `WARN` (F2: not a string literal) |
| `self.skipTest("why")` in a method that `yield`s | `TG003/codex16-generator-unittest` | passed → passed: the body never runs | `WARN` (generator) |
| `pytest.skip("why")` in a test that `yield`s | `TG003/codex16-generator-pytest` | collection error on both sides | `WARN` (generator) |

## Decorators and bindings that replace the test — `WARN`

| Example | Fixture | Runner | Verdict |
|---|---|---|---|
| `@wrap` (returns a replacement) with `pytest.skip()` in the body | `TG003/codex15-wrap-decorator-body-skip` | passed → passed | `WARN` (F1) |
| a foreign decorator next to `@pytest.mark.skip` | `TG003/codex14-pytest-foreign-decorator` | passed → passed | `WARN` (F1) |
| `@nope` (returns `None`) on a deleted test | `TG001/codex15-decorator-returns-none` | not collected | `WARN` (F1, F7) |
| `@property` on a deleted unittest method | `TG001/codex15-unittest-property-method` | not run | `WARN` (F1, F7) |
| `test_x = None` inside `if True:` after the test, with `@pytest.mark.skip` | `TG003/codex16-skip-rebound-inside-if` | nothing collected | `WARN` (bound twice) |
| the same, deleted | `TG001/codex15-rebound-inside-if` | not collected | `WARN` (F7) |
| `TestX = None` after the class (inside an `if` too) | `TG001/codex15-class-rebound-to-none`, `TG003/codex16-skip-class-rebound-inside-if` | nothing collected | `WARN` (F7) |
| a pytest class with `__new__`, or inheriting `__init__` | `TG001/codex15-class-with-new`, `TG001/codex15-inherited-init`, `TG003/codex16-skip-class-with-new` | not collected | `WARN` (F7) |
| `__test__ = False` in a deleted module; a deleted pytest class with `__init__` | `TG001/codex14-module-test-false-deleted`, `TG001/codex14-pytest-class-init-deleted` | not collected | `WARN` (F7) |

## Contradictory arguments and options — `WARN`

| Example | Fixture | Runner | Verdict |
|---|---|---|---|
| `test.skip('X', { skip: false }, fn)` | `TG003/codex14-skip-with-skip-false-option-vitest` | passed | `WARN` (F4) |
| `test.fails('X', { fails: false }, fn)` | `TG003/codex14-fails-with-fails-false-option-vitest` | passed | `WARN` (F4) |
| `{ skip: true, skip: false }` | `TG003/codex14-duplicate-skip-keys-{vitest,node}` | passed | `WARN` (F4) |
| `{ skip: true, ...{ skip: false } }` | `TG003/codex14-spread-skip-false-{vitest,node}` | passed | `WARN` (F4) |
| node:test `test('X', fn, { skip: true })` (an object after the callback) | `TG003/codex15-node-object-after-callback` | passed | `WARN` (F3) |
| `@pytest.mark.skipif(True, condition=False, reason=…)` | `TG003/codex15-skipif-condition-keyword-false` | passed | `WARN` (F5) |
| `@pytest.mark.skipif(True)` without a reason | `TG003/codex15-skipif-true-no-reason` | passed → failed (pytest errors on the mark) | `WARN` (F5) |
| `xfail(run=0)` | `TG003/codex14-xfail-run-zero` | not run | `WARN` (F5: not a boolean) |
| `test.skip.fails('X', fn)` | `TG003/codex14-vitest-skip-fails-chain` | skipped | `WARN` (F3: two modifiers) |
| `{ only: true, fails: true }` | `TG003/codex16-only-and-fails-options-vitest` | xpassed | `WARN` (F6) |
| `@unittest.skipIf(False, …)` beside `@unittest.expectedFailure` | `TG003/codex16-skipif-false-and-expected-failure-unittest` | xfailed | `WARN` (F6) |
| `@pytest.mark.skip` beside `@pytest.mark.xfail` | `TG003/codex14-pytest-skip-and-xfail` | skipped | `FAIL` for the skip (`not-run`), `WARN` for the xfail (F6) |
| `t.todo(); t.skip()` | `TG003/codex14-node-todo-then-skip` | skipped | `WARN` for both (F2, F6) |
| `@pytest.mark.xfail` on a parametrised test one of whose cases is already `pytest.param(…, marks=pytest.mark.xfail)` | `TG003/codex17-xfail-on-parametrize-with-xfail-case` | `[1]` passed → xpassed, `[2]` xfailed on both sides | `WARN` (F6: the case's mark is another effect on the test); recoverable |
| `@pytest.mark.parametrize("x", [])` with a new skip or xfail | `TG003/codex16-empty-parametrize-{xfail,skip}` | `[NOTSET]` skipped on both sides | `WARN` |
| the same test, deleted | `TG001/codex16-empty-parametrize-deleted` | `[NOTSET]` skipped at base; at head the test is gone | `WARN` |

## Identities — `WARN`

| Example | Fixture | Runner | Verdict |
|---|---|---|---|
| two tests titled `X` and one titled `X#2` | `TG003/codex16-title-hash-collision-vitest` | three tests, kept apart | `WARN` (a repeated title) |
| a new `X` inserted before an existing `test.fails('X')` | `TG003/codex16-ordinal-shift-vitest` | the expected failure is not new | `WARN`, never credited |
| two tests titled `X`, one gaining a skip | `TG003/codex15-duplicate-titles-vitest` | | `WARN` |

## Outside a documented assumption — the canonical `FAIL` stands, the runner does not show it

| Example | Assumption | Fixture | Runner |
|---|---|---|---|
| `addopts = --runxfail` in a configuration outside the diff | the runner runs with its standard behaviour about markers | `TG003/codex14-runxfail-addopts-{mark,call,run-false}` | the xfail is ignored |
| `setUp` that fails by itself under `expectedFailure` | a test's setup does not fail by itself | `TG003/codex14-unittest-setup-fails-expected-failure` | an error, not an expected failure |
| `test.fail` on a test that never ends (`await new Promise(() => {})` with a 10 ms timeout) | the test ends before its timeout | `TG003/codex16-playwright-fail-timeout` | timedOut, unexpected |
| `builtins.globals()["pytest"] = …`, `test_adds.__globals__["pytest"] = …`, `(await import('node:test')).default.skip`, `pytest.mark.skip = …` | nobody mutates the framework at run time | `TG003/py-builtins-globals` (`WARN`: a write through `globals()`), `TG003/py-function-globals`, `TG003/node-test-dynamic-import-skip`, `TG003/py-mark-skip-assigned`, … | the test still runs |

A non-literal `parametrize` that produces no case is outside the fourth assumption; there is no fixture of it.

## What a runner does not show the recorder — an inverted status with a hidden failure

The recorder records `xfailed`/`xpassed` only from the runner's own signal, with no other failure in the same test
(docs/rules.md, *What the recorder reads*, round 20). One failure stays invisible to it, because the runner does not
report it on that test (backlog):

| Example | Runner | Recorded |
|---|---|---|
| a `todo` test whose body fails and whose `afterEach`/`after` hook (or `t.after`) then throws | node:test keeps a test's first error: `testCodeFailure` alone, the hook's error is in no event | `xfailed` (the body did fail) |

No fixture pins it: the oracle reads the same events. (Vitest's `fails` with the fixtures of an extended test API is not
a limitation: the recorder refuses it, `TG003/codex20-vitest-fails-extend-setup`.) A fixture's teardown, a hook, an assertion count, a second or soft
assertion or anything else after the body is seen (`TG003/codex20-*`, `TG003/codex20c-*`).

## Recoverable WARNs and silences outside the contract (backlog)

Named by Codex and kept as they are (docs/backlog.md):

- `assert True; pytest.skip("why")` — `WARN` (F2: not the first statement), although the statement before never fails.
- `def test_x(this): this.skipTest("why")` — `WARN`: the context is read as `self` only.
- `test.skipIf(2)('x', fn)` — `WARN`: F3 reads only the literal `true`.
- `@pytest.mark.xfail` on a parametrised test with a case already marked xfail — `WARN` (F6), although pytest shows the
  new expected failure on the other cases.
- a new `stop();` with an existing `function stop() { ctx.skip(); }` — silent: a call of a helper is outside the contract.
- `box[0]()` after `box[0] = ctx.skip` — silent: numeric keys are outside the contract.

## From WARN to OK in the noise round (PR #11)

Named by Codex (review of the commit that made TG001's changed or deleted local code context); outside the contract, kept as they are (docs/backlog.md):

- a test moved to another file that gains a call of a re-exported marker (`from tests.helpers import skip`, then
  `skip("why")` in the moved `test_adds`) — `OK` (an `info` line, `new_test`): the contagion net decides that a test
  is new by its name in the head file's own base, and a file the test was moved into does not have it there.
- a `test` script that delegates with a wildcard (`"test": "npm-run-all -p unit:*"`) and a change to `unit:a` —
  `OK`: the scripts in TG005's scope are `test`, `test:*` and those a test script names as a whole word, and a
  wildcard names none.

## A side Python does not read — the whole file is a `WARN`

Named by Codex (review of the commit that read the base and head of a file in one call of the Python scope reader, PR #5). A file is judged with both of its sides (docs/rules.md, *Python*): when
Python does not read one side, nothing in the file is a `FAIL`. So a base that Python does not compile, or that
declares an encoding other than UTF-8, turns a head's certain skip from a `FAIL` into a `WARN`, although the head is
valid and was read. This is outside the documented scope of what Python's reading makes certain: the file gets one
`WARN` `scope_unavailable` naming the side Python did not read, never silence, and never a `FAIL` beside it.

## Coverage: what "analysed" does not see

The coverage states (docs/rules.md, *Coverage*) describe the declarations saidvsdid recognised:

| Example | What the report says | Why |
|---|---|---|
| a Vitest file that also declares tests through `scenario(…)`, a helper imported from another file | analysed; the helper's tests unseen | a wrapper's tests are not recognised (*Indirection beyond the file*) |
| `assertThat(x, is(1))` (Hamjest) removed from a Vitest test | analysed; no TG004 | an assertion library saidvsdid does not know is not counted |
| a Rust unit test in `src/lib.rs` changed | no test files detected | the table of other languages is by file name (`tests/**/*.rs`) |


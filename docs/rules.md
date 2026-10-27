# Rules

`saidvsdid check` compares two commits and reports findings: from the merge
base of `--base` and `--head` to the head (*What the check compares*). Each
finding has a severity:

| Severity | Meaning | Effect on the verdict |
|---|---|---|
| `fail` | A fact about the diff's code that weakens the test suite, checkable by reading it, under the documented assumptions (see *Verdicts* and *The contract*), written in one of the whitelist's canonical forms, whose effect the base runner guarantees and the real runner shows (see *Verdicts*). TG001–TG003 only. | `FAIL`, exit code 2 |
| `warn` | Suspicious or not attributable with certainty; a human should look. | `WARN`, exit code 1 |
| `info` | Context for the reviewer (renames, moves). | none |

### Verdicts: a FAIL needs an effect the runner shows

A rule gives a `FAIL` only when **the base runner guarantees its effect and
the oracle can show it with the real runner** (`fixtures/oracle.ts`, on the
recorded evidence of every fixture). Two effects qualify, declared in data
per runner and member (`src/rules/effects.ts`) and reported as `effect` on
every `FAIL`:

- `not-run` — the runner reports the tests as not run: skipped, a body-less
  todo (Vitest, Jest), focused away, not collected; `xfail(run=False)`.
- `expected-failure` — the runner still runs the test and reports it as an
  expected failure, by its own explicit signal (xfailed when the body fails,
  xpassed when it passes): pytest's `xfail` and `pytest.xfail()`, unittest's
  `expectedFailure` on a method of a `unittest.TestCase` subclass, Vitest's
  `fails`, Jest's `failing`, Playwright's `fail`, and node:test's `todo`
  (`test.todo`, `{ todo: true }`, `t.todo()`, `describe.todo`), which runs the
  body and tolerates its failure.

Any other effect, or one that depends on a context, a condition, a plugin, a
flag or a configuration, is a `warn`. So TG004 (a test that checks less) is
never a `FAIL`: a check can be a guard that throws, a `raise` or a helper, and
a call that looks like an assertion may check nothing (`pytest.raises(X)` with
no context); `xfail(raises=…)`, `xfail(condition)` and
`xfail(condition=…)` are a `warn` (the expected failure depends on the
exception or the condition), while `strict=` and `reason=` restrict nothing
and keep the `FAIL`; `unittest.expectedFailure` on a plain function (pytest
runs it as any other test), on a class or on a method with other decorators
is a `warn`; `.only` that needs a flag (node:test's `.only` and
`t.runOnly()`) or a plugin's mark (`@pytest.mark.only`) is a `warn` (TG002).
node:test's `t.skip()` lets the rest of the body run, but Node reports the
test skipped and ignores its outcome: `not-run`, by the runner's own report.

**Canonical forms: a whitelist (round 15).** A `FAIL` is promised only for
a marker, and a test, written in one of the exact syntactic patterns below
(`Marker.form` and `TestCase.declaration`, set by the extractors); anything
that does not match one of them exactly is a `warn` whose message describes
the code and says why it "may …". Nothing is reasoned about: there is no
list of forbidden forms to complete.

- **F1 — a Python test's decorators.** Every decorator of the test function
  (and of its class) is the runner's, certainly bound: for a pytest test (a
  module-level function, or a method of a class with no base whose name
  starts with `Test`) any `@pytest.mark.<name>` or `@pytest.mark.<name>(…)`;
  for a unittest method (its class's one base is certainly
  `unittest.TestCase`) only unittest's decorators (`skip`, `skipIf`,
  `skipUnless`, `expectedFailure`). The function is a plain `def`, not
  `async def` and not a generator (a `yield` in its body: the runner gets a
  generator and never runs the body; in JS, a `function*` callback is not a
  test callback). F7's collection checks apply to every marker too (round 16):
  the function and its class each bound once in the file, with no rebinding
  (inside an `if` either), exact bases, no `__init__`/`__new__`, no
  `__test__`; and no `parametrize` with a literal empty list of values (pytest
  collects the test once, skipped). Any other decorator (`@wrap`, `@property`, a unittest
  decorator on a pytest test) may replace or wrap the test: every marker of
  that function, its body's included, is a `warn`. So
  `@pytest.mark.parametrize` + `@pytest.mark.skip` is a `FAIL` again. A
  decorator on a class, a `pytestmark` and the marks of a `pytest.param`
  row are not on the test function: `warn`.
- **F2 — a call in the test's body.** It is the first statement of the
  body (after a docstring, in Python: a str constant alone — string literals,
  none an f-string, a t-string or bytes, which are not docstrings and whose
  interpolations run: `TG003/py-fstring-before-skiptest`,
  `py314-tstring-before-skiptest`), and the statement is exactly the
  call: a Python expression statement whose value is the call, or
  `raise X` / `raise X(…)` with no `from`; in JS an expression statement
  that is the call or `await` + the call, in the callback's block body. Its
  arguments are one of the signatures the rule reads, with the right types:
  `pytest.skip()`, `pytest.skip("…")`, `pytest.skip(reason="…")`, the same
  for `pytest.xfail`, `self.skipTest("…")`, `raise unittest.SkipTest`,
  `raise unittest.SkipTest("…")`; `ctx.skip()`, `ctx.skip("…")`, `t.skip()`,
  `t.skip("…")`, `t.todo()`, `t.todo("…")` on the test's context;
  Playwright's `test.skip()`, `test.fixme()`, `test.fail()`. No `*args`, no
  `**kwargs`, no other argument. pytest's calls (`pytest.skip()`,
  `pytest.xfail()`) in a `unittest.TestCase` method are a `warn`: what they do
  depends on which runner runs the file (unittest reports them as errors);
  `self.skipTest()` and `raise unittest.SkipTest` are unittest's. F1 applies to the function around it, F3
  to the JS declaration around it. Anything else — a statement before it
  (`assert False`, a failing `expect`, `pytest.xfail()`), the call inside
  an `assert`'s message, an assignment (`result ||= ctx.skip()`), another
  call's arguments (`absent?.(ctx.skip())`), an `if` — is a `warn` that
  says where it is. A call in a hook, in a describe's body or at the module
  level is not in the test's body: `warn`.
- **F3 — a JS declaration.** `<api>[.modifier](…)` — the runner's API with
  at most one modifier (`test.skip`, `.only`, `.fails`, `.todo`, `fit`,
  `.skipIf(true)`, `.runIf(false)`, Playwright's `test.describe[.modifier]`;
  no `.each`, no `.concurrent`) — as an expression statement directly at
  the file's top level, or directly in the block body of the callback of a
  `describe` that is itself F3: no `if`, no loop, no function in between;
  and a describe's callback (or the file) whose own code holds a `return` or
  a `throw` declares nothing canonically — it may stop before the
  declaration.
  Its arguments are the runner's documented signature: the name a string
  literal (or a template with no substitution); the callback a function
  literal in its position; options (F4) only where the runner documents
  them — `test(name, { … }, fn)` for Vitest and node:test — a literal
  timeout after the callback for Vitest and Jest, no callback for a todo.
  Each modifier has the runner's documented signature (round 16, checked
  against Vitest 4.1.11, Jest 30.5.2, node:test on Node 22, Playwright
  1.64.0): Jest's `todo` takes a name alone (with a callback Jest aborts the
  file) and Jest's timeout after the callback goes only with `test`,
  `test.only`, `test.failing` and `fit` (`test.skip`, `xit`, `xtest` take
  `(name, fn)`); Vitest's `todo` takes a name or a callback it never runs, and
  every other Vitest modifier a callback; node:test's `todo` takes a name or
  a callback; every Playwright modifier a callback.
  node:test's `test('X', fn, { skip: true })` has an object after the
  callback that node:test does not read as options: `warn`.
- **F4 — options.** An object literal with unique keys written as
  identifiers or strings, only the keys the runner documents (Vitest:
  `skip`, `only`, `todo`, `fails`, `concurrent`, `sequential`, `shuffle`,
  `timeout`, `retry`, `repeats`; node:test: `skip`, `todo`, `only`,
  `timeout`, `plan`, `concurrency`), each a literal of the type it takes
  (booleans; a string where the runner documents one — node:test's `skip`
  and `todo`; numbers for the numeric ones), no spread, no computed key, no
  method; and no modifier also set by an option (`test.skip('x', { skip:
  false }, fn)`, whose precedence is the runner's).
- **F5 — a Python mark's arguments**, read by Python's own
  `ast.literal_eval` in the scope reader: pytest's `skip`, `skip()`,
  `skip("…")`, `skip(reason="…")`; `skipif(True, reason="…")` — a literal
  `True` in first position, no `condition=`, a `reason`; `xfail` or
  `xfail(…)` with only `reason=` (a string), `strict=` and `run=` (booleans):
  no `raises=`, no condition; unittest's `skip("…")`, `skipIf(True, "…")`,
  `skipUnless(False, "…")`, a bare `expectedFailure`. Any other type
  (`pytest.skip(123)`, `run=0`), argument (`condition=False`) or
  combination (`skipif(True)` with no reason, `**{…}`) is a `warn`.
- **F6 — one effect per test.** When any other marker or option is written
  for a test — whatever its form or certainty, `only` included, and one whose
  literal condition never applies (`@unittest.skipIf(False, …)`,
  `{ fails: false }`), counted before it is set aside — an expected failure on
  it is a `warn`:
  `@pytest.mark.skip` + `@pytest.mark.xfail`, `pytest.xfail(); pytest.skip()`,
  `t.todo(); t.skip()`. And an expected failure is new only on a test that
  was not one at base (`xfail(strict=True)` → `xfail()` is a `warn`).
- **F7 — TG001, a deleted test.** Deleting a file is a `FAIL` only for the
  tests that were, at base, (a) a module-level `def test_…` with F1
  decorators, or (b) a `def test_…` method with F1 decorators of a
  module-level class with no base whose name starts with `Test`, or whose
  one base is certainly `unittest.TestCase` (no keyword), with F1 class
  decorators and no `__init__` or `__new__`, or (c) in JS, an F3
  declaration; in Python, the function and its class each bound exactly
  once in the file (Python's AST: no other binding in any scope, no star
  import, and nothing that may rebind it at run time: a call of builtins'
  `setattr`/`delattr` — not a method of the same name such as
  `monkeypatch.setattr` — whose first argument is the test's class, the
  module (`sys.modules[__name__]`) or anything not resolved; a write through
  `globals()` or `vars()`; `exec`/`eval`), no `__test__` anywhere in the file,
  not `async`. Any other
  case — a class rebound to `None`, a `__new__`, an inherited `__init__`, a
  rebinding inside an `if`, a decorator that may return `None`, a unittest
  method under `@property`, a test inside `if (false) { … }` — is a `warn`.
- **F8 — TG002, a focus.** The tests a focus leaves out count only when
  they are tests of the same file, F3 declarations at base and at head,
  that ran at base: not skipped, todo or fixme by any marker, not out of the
  focus. With no such test, the new focus is a `warn` that names none
  (`.only` beside a test that was already skipped). A focus is also a
  `warn` when a describe around the focused declaration carries a modifier
  of its own (`describe.skip`, `describe.only`, `describe.todo`…): their
  interplay is the runner's.

**The oracle reads the tests a FAIL names, by identity** (rounds 15–16).
Every `FAIL` of TG001–TG003 lists the identities of the tests it is about
(`ids` in the report, `[name, ordinal]`: the tests a deleted file declared
that ran, the tests a focus leaves out, the tests a marker applies to), in
its own file. The identity is structured, never a concatenated string: the
file, the full name (the describe chain `suite > test`, pytest's node id,
`Class::test` for unittest) and the ordinal among the file's tests with that
name (`src/rules/ids.ts`); the recorder keys each test by the JSON array
`[file, name, ordinal]` (`scripts/runner-evidence.mjs`), so a title `X#2`
never collides with the second `X`. A file that repeats a full name, at base
or at head, makes the markers of those tests a `warn` (which one the runner
reports is not certain), and the oracle never credits such a name. It
credits a `FAIL` only with the status of its own tests: never another
file's, never the complement of the fixture.

**What the recorder reads.** The recorder fails closed: a result whose form
it cannot represent exactly — a retry, a test object run twice, a status it
does not know, a test that did not finish, an outcome attached to no test, a
missing or self-contradicting report — stops the recording of that fixture
with an explicit `unrecordable: <reason>`. It never approximates, merges or
reduces one, and the oracle never credits evidence that does not exist. A
fixture that pins such a form carries `"unrecordable": "<reason>"` and no
evidence (`TG003/codex18-*`, `TG003/codex19-*`). **Reconciliation with the
runner's own summary:** after rebuilding the results test by test, each
recorder holds them against what the runner itself reports in aggregate, and
refuses the fixture when the counts per status it rebuilt differ from the
runner's own, when the exit code does not agree with them, when the summary or
the results show a test run more than once or abnormally (a retry or a repeat:
Jest's `invocations` > 1, Vitest's `retryCount`/`repeatCount` > 0, more than one
Playwright `results`; a cancellation: node:test's `cancelled`, or a test Node
ended outside its body; an interrupted session: `pytest.exit` whatever its
return code, `KeyboardInterrupt`, a session that stopped early, exit 2; a test
that started with no result), when the run holds an error the runner attributes
to no test (round 20d: Vitest's `unhandledErrors` or an error of a module or
suite that has tests; Jest's `runExecError`, a file's `testExecError`, or
`numRuntimeErrorTestSuites` above the files that failed with no test, with Jest
run in band so that a crashed process leaves no report; Playwright's top-level
`errors`; node:test's failure of a file outside its tests, which its own
summary does not count; pytest's internal or collection errors, by its exit
status and its summary; unittest's error on a loader's placeholder — a class
or module fixture's error is attributed to its tests, below), or when the summary is missing or cannot be read.
The summaries read: pytest's session (its terminal reporter's categories for
each test, `testscollected`, `exitstatus`; an outcome of a collection, such as
a module skipped at collection, is no test's and is refused), node:test's
per-file `test:summary`, Jest's `num*Tests` and `success`, Vitest's JSON counts
and `success`, Playwright's `stats`, unittest's `TestResult` (`testsRun`,
`failures`, `errors`, `skipped`, `expectedFailures`, `unexpectedSuccesses`,
`wasSuccessful()`). The statuses are evidence only once the runner's own
account of the same run agrees with them; one control per runner
(`TG003/codex19-control-*`) shows it agreeing on a normal run. **No inverted
status is deduced from a generic one** (rounds 20, 20c): `xfailed` and
`xpassed` are recorded only from the runner's own signal for that exact case —
the expected failure's body failed, or its body passed — and only when the test
has exactly one error and it is the one that signal is (none other: a second or
soft assertion, an assertion count, a hook, a fixture's setup or teardown);
without that signal, or with two or more errors, the fixture is not recorded
(`<runner>: an expected failure with another failure in the same test`). Jest `failing`: `passed`, with no failure message, is the body's one
error and nothing else (Jest swallows it, and any other error — an assertion
count, a hook — fails the test); `failed` is `xpassed` only when its one failure is
Jest's own message for a passing body (`Failing test passed even though it was
supposed to fail…`, `failureDetails`). Vitest `fails` inverts the whole test
and discards its errors: an observing runner (Vitest's own, with the test's
function called as Vitest calls it) records whether the body failed and the
test's errors right after the body and at its end; `xfailed` only when the body
failed and the test had exactly one error, `xpassed` only when the body passed
and the test had none before the inversion (whose one error is Vitest's own). Vitest
sets up the fixtures of an extended test API (`test.extend`, `it.extend`, an
alias such as `base.extend`) inside the test's function, so their setup's
failure reads as the body's: a fixture side whose sources read a member
`.extend` and hold `fails` anywhere is refused by a static check of the
fixture's source (`vitest: fails with extended fixtures`).
Playwright `test.fail`: `xfailed` only with exactly one error in the test's
result (`expect.soft` adds one per failure), `xpassed` only with none; a hook
or fixture step (setup or teardown) that ended with an error, read by a step
reporter, is another failure. pytest `xfail`
(strict or not): pytest turns a failure of the setup (the body never ran) or of
the teardown into an xfail too; the signal is the call's alone. node:test
`todo`: only a failure Node attributes to the test's own code
(`testCodeFailure`). unittest records `addExpectedFailure`/
`addUnexpectedSuccess` only, which unittest gives only when the setup, the
teardown and the cleanups passed (otherwise `addError`: `failed`, no inverted
status). The reproductions and one control per changed runner:
`TG003/codex20-*` and `TG003/codex20c-*`; what the runners do not show is in
[known-limitations.md](known-limitations.md). Playwright's outcome of each test (`expected`,
`unexpected`, `skipped`): one execution per test (`--retries=0`); if the
runner retries a test all the same (`test.describe.configure({ retries })`),
the recorder refuses the fixture (`unrecordable: retries`). An expected
failure is `xfailed` only when its outcome is `expected`; a timeout or any
other unexpected end is a failure. unittest, one record per execution: a
method the suite runs more than once (`load_tests` with two instances) keeps
each execution under its own ordinal, a repeated name the oracle never
credits; one test object run twice is refused. A subtest belongs to its test
and is also recorded as a child of its own (`Class::method (x=1)`); the test
is `failed` when anything failed, its own or a subtest's, and a later skip
never overwrites it; it is `skipped` only when the whole test was skipped with
no subtest run (a test that went on running cases ran). A `SkipTest` in
`setUpClass`/`setUpModule` (unittest's `_ErrorHolder`) records each test
method of that class or module, as the loader enumerates them, as `skipped`,
any other error there as `failed`; an error in `tearDownClass`/
`tearDownModule` fails the tests that ran, and a skipped one stays skipped
(`TG003/codex17-unittest-*`). A module the loader cannot import is refused
(unittest reports its error on a placeholder, not on a test). pytest: a node
id run more than once or an exit it does not know is refused; a pytest that
stopped before its session (exit 4: a conftest it cannot import) ran no test,
and is recorded so only when the recorder's plugin had loaded. node:test: a test Node cancelled, or one with no file,
is refused. Vitest: a test that started and did not finish is refused (one
it never started did not run); its JSON report is read against its reporter
API, and any disagreement is refused. Jest: a status it does not know
(`focused`…) is refused. A file the runner could not load at all (Jest, Vitest,
a pytest collection error) contributes no test: none of its tests ran.

**Documented assumptions** (outside the contract: a case that breaks one is
not a false `FAIL`; its fixture carries `outsideAssumption` with the reason,
and the oracle requires the runner *not* to show the effect, pinning the
limit):

- nobody modifies the test framework at run time (*The contract*, below;
  reason `mutation`);
- the runner is invoked with its standard behaviour about markers: no
  `--runxfail`, no `-p no:…`, no collection hooks or ignores in
  `conftest.py` or a configuration outside the diff (reason
  `runner-invocation`; `TG003/codex14-runxfail-addopts-*`);
- a test's setup and fixtures do not fail by themselves, whatever the
  marker, and the test ends before its timeout (reason `setup-fails`;
  `TG003/codex14-unittest-setup-fails-expected-failure`,
  `TG003/codex16-playwright-fail-timeout`);
- a `parametrize` whose values are not a literal produces at least one case
  (a literal empty list is read: `warn`).

Widening the whitelist (reasoning about control flow, other decorators,
helpers, the runner's configuration), to recover some of these `FAIL`s, is
in the backlog. The constructed counterexamples of the external reviews that
give a `WARN` today, or stay outside an assumption, are listed with their
verdict in [docs/known-limitations.md](known-limitations.md).

With nothing above `info` the verdict is `OK — no issues found`, exit code
0: no problem within the scope analysed, which says nothing about what was
not analysed. It says which:

- `OK — no issues found (TG006, TG007 not evaluated)`: no `--transcript` and
  no `--evidence`. The claim rules are **not evaluated**: the report lists them
  apart (`not_evaluated` in JSON, `not evaluated:` in text and Markdown),
  never among the rules that found nothing (`rules` lists the rules
  evaluated).
- `OK — no issues found (claims not verified)`: a transcript or evidence was
  read; claims are at best *consistent with what is visible, not verified*
  (TG006).

There is **no PASS**. An agent's claims are warnings for the reviewer, never
certified: from outside the runner it cannot be known what a run really ran
(an npm script may run anything, a child process may outlive its call, a hook
may edit files, the tree may change during a run). TG006 and TG007 are at most
a `warn`, in every mode; a claim never raises another rule's severity.

Every guarantee below that says "never PASS" means **never exit 0**: never
`OK` (`test/invariant.test.ts`). The report's `mode` says where the agent's
side came from: `diff`, `transcript` or `evidence`.

Exit code 3 never counts as a pass:

- `UNVERIFIABLE`: the analysis could not see everything it needed. Today: a
  changed test file with syntax errors on either side — including a file in a
  test directory from which no test could be extracted, since parse errors are
  checked before a file is dismissed as a helper. That file is left out of the
  comparison (a partial parse could hide or invent tests), it is listed as
  `UNVERIFIABLE <file> (<side>)`, and the verdict is `UNVERIFIABLE` even if
  other files produced findings, which are still reported.
- `ERROR`: the check itself could not run (bad ref, not a git repository,
  invalid evidence file).

`saidvsdid explain <RULE>` prints the section of this file for that rule.

## What the check compares

What a pull request's "Files changed" shows: from the **merge base** of the
base and the head (`git merge-base`) to the head, in the Action and in every
command that takes `--base` (`check`, `baseline`, `evidence from-transcript`;
one helper, `selectBase` in src/git/diff.ts). A branch behind its base is
never charged with what the base did after the branch left it (in 0.2.0 the
CLI compared the tip of `--base` and could give a `FAIL` on a test the branch
never touched). `--exact-base` compares the two commits as they are. The
report records the compared commit as `repo.base` and, when that is not the
commit given, the base as given in `repo.base_ref` (`{ ref, sha }`; the Action's
`ref` is `pull_request.base.sha`). A base that is not in the clone, a history
cut by a shallow clone, and two histories with no common ancestor are each an
`ERROR` with their own message.

## Coverage: what an OK covers

Every report says what it read of the test files the pull request changes,
per file (a rename is one file, by its head path), after `exclude`:

| State | When |
|---|---|
| analysed | JS/TS or Python, parsed, at least one test recognised, every recognised test certainly a known runner's, and no import of a test library saidvsdid does not read |
| partly analysed | parsed, but no test recognised in a file named as a test, or a test whose runner is not certain (a global, a wrapper), or an import of `ava`, `tap`, `tape`, `uvu`, `zora`, `bun:test`, `mocha`, `jasmine`, `@japa/runner` |
| not analysed | a test file in a language saidvsdid does not read (below), or a supported file it could not parse or whose names were not read (these keep their own `UNVERIFIABLE` or `WARN`) |

A file's state is the worse of its sides; a side that does not exist or is
excluded does not count; each side of a rename by its own path. Test files in
other languages, by name (a closed table, `FOREIGN_TESTS` in src/coverage.ts):
Go `*_test.go`; Ruby `*_spec.rb`, `*_test.rb`; Rust `tests/**/*.rs`; Java,
Kotlin and C# `*Test.*`, `*Tests.*`; PHP `*Test.php`; Elixir `*_test.exs`; Swift
`*Tests.swift`; Dart `*_test.dart`; C/C++ `*_test.cc`, `*_test.cpp`; Bats `*.bats`.

Coverage changes no verdict, exit code or `fail-on`. It qualifies an `OK`:
`OK — no issues found` only when every changed test file was analysed;
`OK — no findings in what it read; N test files partly analysed or not
analysed` otherwise; `OK — no test files detected in the selected scope` when
there is none. The comment, the job summary, the CLI and the JSON (`coverage`)
list the files that were not wholly analysed, with why, before any finding.

The states describe the declarations saidvsdid recognised, never that it
recognised every test: a test declared through a wrapper imported from
elsewhere (`scenario(…)`) is not seen, so a file can be "analysed" with tests
it did not see; an assertion of a library it does not know (Hamjest's
`assertThat`) is not counted, so TG004 sees nothing there; a test file named
otherwise (a Rust unit test in `src/lib.rs`) is not detected. The table is
coverage, not a guarantee (docs/known-limitations.md).

## The GitHub Action: events and large reports

**Events.** The event's name decides, never the payload's shape:
`pull_request` and `pull_request_target` are analysed (a payload that cannot
be read, or lacks the pull request's numbers and commits, is an `ERROR`); any
other event (`push`, `workflow_dispatch`, `merge_group`, `schedule`,
`pull_request_review`, …) is not: a notice, `verdict=SKIPPED`, an empty
`exit-code`, no comment, and a green check whatever `fail-on` says. `SKIPPED`
is an output of the Action only, never a report's verdict. On a merge queue,
green on `merge_group` means the merge group's commit was not analysed.

**Large reports.** The comment is the whole report when it fits GitHub's limit
(65,536 characters; saidvsdid uses 65,000). Otherwise it is bounded: the totals
by kind and by file first; each list within a budget of rendered characters
(the coverage list 4,000, the findings by file 10,000, the files that could
not be analysed 4,000, a folded list of tests 2,000), each ending with "and N
more"; as many findings as fit, in order, found by binary search; the exact
number not shown ("665 of 760 findings are not shown here"); and the full
report — the same report rendered with nothing shortened, as Markdown, and its
JSON — uploaded as an artifact of the job (`saidvsdid-report-<job>-<8 hex>`)
and linked by its exact page. The upload uses the job's runtime credentials
(so it works on a pull request from a fork), sends the token only to the
artifact service, and is not attempted on GitHub Enterprise Server. When it
cannot be attached, the comment says why and how to reproduce the report
(fetch the base and `refs/pull/<n>/head`, then `npx saidvsdid@<version> check
--exact-base --base <merge base> --head <head>` with the workflow's `exclude`
globs, printed only when the command can be copied exactly). The verdict and
the gate never depend on the upload. The job summary is the comment when it
holds everything, else the full report when it fits GitHub's 1 MiB limit for a
step summary. CI checks the client against GitHub's own service on every pull
request (an upload, then a download with the REST API compared by Python's
`zipfile`).

## Rules at a glance

| Rule | What it catches | Status |
|---|---|---|
| TG001 | A test or a whole test file was removed, including "substitutions" (a test replaced by an unrelated one) | implemented |
| TG002 | New focus markers: `.only`, `fit`, `fdescribe`, `@pytest.mark.only` | implemented |
| TG003 | New `skip` / `xfail` / `todo` / `fixme` on tests that used to run | implemented |
| TG004 | Fewer assertions per test, relaxed matchers (`toEqual` → `toBeDefined`), tests left with no assertion: always `warn` (a loss of checks is not provable) | implemented |
| TG005 | Inflated timeouts (≥3×), new retries, reduced suite scope (`exclude`, `testPathIgnorePatterns`, `-k`, `--deselect`, `collect_ignore`, …) and any other runner-config change: always `warn` in V0 | implemented |
| TG006 | "All tests pass" claimed: what the visible evidence shows (no test run visible, last visible test run failed, no test run visible after the last edit, output truncated…), as a warning for the reviewer: at most `warn`, never `fail` or PASS | **experimental** (needs `--transcript` or `--evidence`; otherwise *not evaluated*) |
| TG007 | "I added a regression test" claimed in the last turn, compared with the final diff: no test, a disabled one or one asserting nothing, or (`--f2p`) one passing on base too: at most `warn` | **experimental** (needs `--transcript` or `--evidence`; otherwise *not evaluated*) |

## The contract: a FAIL is a fact about the code

A `FAIL` of TG001–TG003, in a canonical form (*Verdicts*), is **a fact about the code of the diff, checkable by
reading it**, under four documented assumptions (*Verdicts*): the runner is invoked with its standard behaviour
about markers, a test's setup does not fail by itself and the test ends before its timeout, a `parametrize` whose
values are not a literal produces at least one case, and the first, about names:

> **saidvsdid resolves exactly which declaration each name refers to by the
> language's rules of lexical scope — read by the languages' own tooling,
> Python's `ast` and `symtable` and the TypeScript compiler. It assumes that the
> test framework and its objects are not modified at run time**
> (monkeypatching, `setattr` / `__setattr__`, reflection, `__globals__`, writes
> to members, a dynamic import to mutate), **neither from other modules nor from
> the file itself.**

What the code says is then what the runner does: `it.skip` on vitest's
statically imported `it` skips the test, and `pytest.skip()` in a test body
skips it when the file binds `pytest` only by its module-level import
(*Attribution*, below).

**Mutation is outside the assumption and is not detected**: a list of
forbidden positions or identifiers never closes it (`builtins.globals()['pytest']
= …`, `test_adds.__globals__['pytest'] = …`, `(await
import('node:test')).default.skip = …`, a `conftest.py` that rebinds the
module's `pytest`). There a FAIL may be wrong, and nothing in the file can be
relied on to tell. As a **courtesy, with no guarantee**, an evident direct
write on an imported runner name makes its uses uncertain (the rule warns):
`X.member = …`, `setattr(X, …)`, `X.__setattr__(…)`, `del X.member` in Python;
`X.member = …`, `delete X.member`, `Object.defineProperty / assign(X, …)`,
`Reflect.set / defineProperty(X, …)`, and an assignment to the import itself
(`it = other`, which an ES module refuses at run time) in JS/TS; and for
`self.<method>`, a write of the method's name on any object (`Base.skipTest =
…`). Fixtures outside the assumption carry `"outsideAssumption": { "reason":
"mutation", "note": … }` in their `case.json`: `TG003/py-skip-in-body-rebound`,
`py-builtins-globals`, `py-function-globals`, `node-test-dynamic-import-skip`
(`FAIL`: the contract's expectation) and `py-mark-skip-assigned`,
`py-module-setattr-dunder`, `node-test-skip-assigned`, `py-class-mutated`,
`global-property-assigned` (the courtesy `WARN`). `test/runner-evidence.test.ts`
checks that the real runner still runs the tests there (it disagrees with the
code's reading), and that it agrees with every other fixture.

**Messages describe the code, not its effect, and count syntactic sites**: "adds
`it.skip` (skip, unconditional) to test "adds"", "adds `describe.skip` … to a
suite that declares 3 tests", "changes the condition of `it.skipIf(true)` on
test "adds"", "removes the only assertion call (`expect(sum).toBe(2)`) from
"adds"", "removes 2 of 5 assertion calls from …", "deletes the test file, which
declared 2 tests". Never "disables" and never "N executions": a `.each` row or a
loop is one site. TG001 says what head's git tree shows (renames as git detects
them): "deletes the test file" when it is gone, "removes all 2 test
declarations from tests/test_a.py (file kept)" — a `WARN` — when it is still
there, under its name or another (`TG001/file-kept-tests-removed`,
`file-renamed-tests-removed`). A `WARN` the rule emits itself because the binding is not
certain says what **may** happen and why: "…; it may skip it: `it` is a global,
not imported from a runner".

**"Never silent" is guaranteed for the direct forms of the documented
vocabulary** (the closed list in *Safety nets*, below; *The silence
guarantee*): a member used directly from its root, or through a simple alias
in the same file, either gives a finding or is caught by a net. Forms are read with **parentheses and
TypeScript's type assertions removed** (`as`, `as const`, `!`, `satisfies`,
`<T>x`, `x<T>`) — in an expression, a subscript and a computed key — by **one
normalisation** that every reader of expressions, keys, literals and strings
uses (`src/parse/normalise.ts`: the extractor, both nets, the config readers):
`raise (unittest.SkipTest)` is `raise unittest.SkipTest` (a `FAIL` on a certain
import), `(test as typeof test).skip(…)` is `test.skip(…)`, `it[('skip')]` and
`it['skip' as const]` are `it.skip`, `{ [('skip')]: omit }` takes `skip`
(`TG003/py-raise-paren-skiptest`, `ts-skip-type-assertion`,
`ts-subscript-paren-key`, `ts-subscript-as-const-key`,
`ts-context-subscript-paren-key`: `FAIL`; `ts-destructure-paren-key-alias`,
`ts-context-destructure-as-const-alias`: `WARN`). Beyond the direct forms,
**best effort** (*Best-effort detection*, below), it reads **aliases**
(*Aliases*, below): the **contagion net** marks every name a binding gives
(an attribute or a subscript too) something that holds a token of the
vocabulary or a marked name, and every name bound to a string of the
vocabulary in any container, to a fixed point, so each **new use** — a call,
a decorator, a raise whose whole callee holds a token, a string of the
vocabulary or such a name — is at least a `WARN` naming its test, even when
the definition does not change. A form outside the vocabulary, or beyond the
direct forms, that is not detected is a matter of coverage, not a broken
guarantee.

## Attribution: the runner's API by binding

**A name is looked up among a table's own keys, never its prototype.** Every
table looked up by a name read from the input — the code, a config, a
transcript, a runner's output, the Python scope reader's reply — has no
prototype (`src/util/names.ts`), so `@pytest.mark.constructor`,
`pytest.toString()`, `it.constructor` or `test.toString()` are no marker, a
tool, script or field named `toString` is nothing known
(`TG003/py-prototype-names-control`, `ts-prototype-names-control`;
`test/name-tables.test.ts` checks every table and, with the TypeScript checker,
that none escapes).

A marker, a test or an assertion is certainly the runner's only through its
**binding**, never by its name (`src/parse/ts-binding.ts`,
`src/parse/py-binding.ts`; pinned in `test/runner-binding.test.ts`; fixtures with
real-runner evidence under `TG001`–`TG004`). Anything shaped like the vocabulary
whose binding is not certain is attached all the same and the rule itself warns
("may …"), naming the test and the reason: **never a FAIL, never silence**.

saidvsdid does not resolve scopes itself: **the languages' own tooling does**.
tree-sitter still finds the forms (tests, markers, assertions); at each name it
meets, the question "which declaration is this?" goes to Python's `ast` and
`symtable` or to the TypeScript compiler, and their answer decides.

**JavaScript / TypeScript** (`src/parse/ts-program.ts`). Each file is read by
the TypeScript compiler (the `typescript` dependency, version recorded in the
report as `tool.scopes.typescript`) as a program of that file alone, with a host
that serves nothing else: no lib, no types, no module resolution, JavaScript
allowed. At each occurrence, `checker.getSymbolAtLocation` gives the **local
symbol** (never followed through the import). `FAIL` only if that symbol has
**exactly one declaration** and it is an import specifier, a namespace import or
a default import clause of a **static, not type-only `import … from`** of
`vitest`, `@jest/globals`, `@playwright/test` or `node:test` — named (`import {
it }`), aliased (`import { it as check }`: `check.skip` is `it.skip`; `import {
"it" as check }`) or a namespace (`import * as v`: `v.it.skip`), escapes decoded
(`'vitest'`, `it`). Every scope rule — blocks, functions, `var` and
function hoisting, parameters, `catch`, classes, namespaces and their merged
blocks (`namespace N.assert {}`, two `namespace Suite {}` sharing an exported
`test`), `import x = A.B`, enums — is the compiler's. A declaration merged with
the import (`namespace assert {}` beside `import assert`) is a second
declaration: uncertain (`TG004/ts-namespace-shadows-assert`,
`ts-dotted-namespace-assert`, `TG003/ts-namespace-merged-export`). A **file the
compiler rejects** — a syntax error, or an error its binder reports on the
file's declarations (a duplicate `let`, `arguments` bound in strict code) — is
read for nothing: no name in it is certain, and the file gets one `WARN`
(`reason: "scope_unavailable"`). An import binding is immutable and a namespace
object cannot be reassigned, so the file cannot change what such a name is
(mutating the object it names is outside the assumption). The form must also be
part of that runner's API:

| Runner | Tests / suites | Markers on a test | On a suite | Other forms |
|---|---|---|---|---|
| `vitest` | `it`, `test` / `describe`, `suite` | `skip`, `only`, `todo`, `fails`, `skipIf`, `runIf`; options `{ skip, only, todo, fails }` | `skip`, `only`, `todo`, `skipIf`, `runIf` | context `ctx.skip()`; hooks `beforeEach`… |
| `@jest/globals` | `it`, `test` / `describe`; `fit`, `fdescribe`, `xit`, `xtest`, `xdescribe` | `skip`, `only`, `todo`, `failing` | `skip`, `only` | hooks; no test context |
| `@playwright/test` | `test` / `test.describe` | `skip`, `only`, `fixme`, `fail` | `skip`, `only`, `fixme` | `test.skip()` / `fixme()` / `fail()` annotations; `test.beforeEach`… |
| `node:test` | `it`, `test` / `describe`, `suite` | `skip`, `todo`; options `{ skip, todo }` | `skip`, `todo` | context `t.skip()`; `only` is uncertain (it applies only with `--test-only`) |

A test or a suite is certain when its callee is, and so is every suite around
it; a test declared inside a function (a helper, a `forEach` callback) may never
be declared: uncertain. `ctx.skip()` is certain when the compiler resolves
`ctx` to the first parameter of a certain test or hook callback whose runner has
a context `skip()`, and the file never writes `ctx`.

Uncertain, with the reason in the `WARN`:

- **globals** — jest's, vitest's `globals: true`, mocha's: always `WARN` ("may
  be skipped"), never `FAIL`, whatever the configuration says (a setup file may
  install its own `it`; fixtures `TG003/global-it-control`,
  `vitest-setupfiles-global`, `jest-preset`, `jest-config-uppercase`…);
- **any other declaration** — a local `const it`, a parameter (`describe('s',
  (it) => …)`), a destructuring (`const { it } = v`), a `require` (`const v =
  require('vitest')`, even where the compiler reads it as an alias), `import v =
  require(…)`, a dynamic `import()`, a `ctx` that is not the test's context
  parameter (`TG003/local-ctx-object`, `local-it-wrapper`,
  `param-is-vitest-test`);
- **an alias** (*Aliases*, below);
- **an import that is not a static named or namespace import of a runner** — a
  project's helper or re-export (`import { it } from './support'`), a default
  import (`import test from 'node:test'`), a type-only import;
- **a form the runner does not have** — `it.failing` on vitest's `it`,
  `test.todo` on Playwright's `test`, `fit` from vitest.

**A literal subscript is a member access** (case D): `it['skip'](…)`,
`test['only'](…)`, `ctx['skip']()`, with escapes decoded (`test['only']`)
and template literals without substitutions, are the same as `it.skip`,
`test.only`, `ctx.skip` for the extractor and for the safety net.

**Assertions** (TG004): an `expect` / `assert` / `expectTypeOf` / `assertType`
is certain when statically imported under that name from a runner that exports
it or an assertion library (`chai`; `node:assert` and `assert`, also as a
default or namespace import or `{ strict as assert }`; `sinon`'s
`sinon.assert.*`), by the same rule. A global `expect` (jest's) or a local one
is an assertion call that may not assert.

**Python** (`python/saidvsdid_scopes.py`, run by `src/parse/py-scopes.ts`).
Python reads the file, cached by content, in **calls of at most 1 MB of source**,
one interpreter each; **a file's base and head always go in the same call**
(a pair larger than 1 MB goes alone, with the limit of its size). The script gets each file's
**bytes** (base64 in a JSON request, the reply in JSON; the interpreter, run
with `-I -X utf8`, reads the request from its stdin and writes the reply to its
stdout and its warnings to stderr, and all three are temporary files, never
pipes: on macOS a request written into a pipe by Node's `spawnSync` was seen
never reaching its end of file, and a pipe has a buffer to overflow — Python
3.12 writes a `SyntaxWarning` per invalid escape such as `'\d'`) and **Python
decodes them itself**, as it does on import (PEP 263). A call's first attempt
has `max(60 s, 60 s per MB of the call)`: the densest content measured
(unittest classes of 2 000 methods, and 2 500 classes of 30) reads at 3.9–6.0 s
per MB on Linux with Python 3.9, 3.12 and 3.13, and the earlier reader at ≈ 10 s
per MB on Windows, so a full call has 10 to 15 times what it needs on Linux and
6 times the earlier reader's rate on Windows. An attempt that reaches its
limit is tried once more with at least 300 s (the limit a whole run had
before), so that whatever the earlier reader read is still read. The interpreter is `SAIDVSDID_PYTHON` when set, else
the first of `python3`, `python` that runs the script, and the one used is
recorded in the report (`tool.scopes.python`).

**Python versions.** The supported versions are the CPython versions
python.org supports (devguide.python.org/versions): **3.11 to 3.15** today,
each run in CI (the oldest and the newest on every push, all of them in
`full-ci`). An interpreter **older than 3.11** is refused as a whole. There
is **no newest version**: an interpreter newer than those CI tests runs the
reader as any other — what keeps its reading certain is what keeps a tested
one certain (the self-check of every `ast` node class, below; symtable's
predicates read against closed sets; a `WARN` for anything that fails) — and
the report says so (`tool.scopes.python_untested`), with the same verdicts.
When the version moves on python.org (one reaches its end of life, a new one
is released), the minimum, the tested list and CI move with it.
An older version, no interpreter, a self-check that fails on the interpreter,
a reader that fails or reaches its limit twice, or a file that
interpreter does not compile (a syntax error, PEP 695 syntax before 3.12,
t-strings before 3.14) is a **file-level `WARN`**
(`reason: "scope_unavailable"`, one finding per file, never silence) and
nothing in the file is certain. So is:

- a file that **declares an encoding other than UTF-8** (`# coding: latin-1`,
  `cp1252`, an unknown codec; only UTF-8 and its exact aliases — `utf8`,
  `utf_8`, `U8`… — are read), or whose **BOM contradicts its declaration**
  (`TG003/py-latin1-coding-declared`, `py-bom-coding-mismatch`): the tree that
  finds the forms reads UTF-8, so another decoding would be another file.
  Bytes that are not UTF-8 inside a comment are read as Python's import reads
  them: before 3.14 it compiles the bytes and does not decode comments; from
  3.14 on it refuses them (the module does not import), so the file is a
  `WARN`. Inside code or a string the file does not compile;
- a **reply of the script that does not follow its protocol** — not JSON, a
  field missing or of another type, another protocol, more or fewer files than
  asked, one file's entry out of shape — a `WARN` for each file it concerns,
  never an exception (`test/py-protocol.test.ts`).

**A file is judged with both of its sides, read once.** In each analysis,
Python's answers for a file's base and head are taken **once**, where
src/check.ts puts them together, and the rules read exactly those answers: the
parser and its resolver receive them as values and cannot ask the reader (a
type-only import; `test/py-reader-cache.test.ts` counts the reader's calls),
so the reader's cache, emptied when it is full, never makes a file be read
again nor changes what was decided about it. When Python does not read the
base or the head of a file — the reader fails on the call, or that side is one
of the cases above — **both sides are read as if Python had not answered**:
the file has one `WARN` `scope_unavailable` naming the side Python did not
read, and no rule (TG001, TG002, TG003, nor any other that reads Python's
names) gives a `FAIL` on it, whichever side failed and however the run was
split into calls (`test/py-reader-pair.test.ts`, with real Python processes).
A base Python does not read so turns a valid head's `FAIL` into a `WARN`
(docs/known-limitations.md).

A Python file that **breaks lines with a lone CR** (`\r` not followed by
`\n`) is not analysed on either side: Python reads a lone CR as a new line and
the tree-sitter grammar that finds the forms does not, so its tree is not the
file Python runs. It is one **file-level `WARN`** (`reason: "lone_cr"`, "the
file is not analysed: …"; `TG003/py-lone-cr-line-breaks`), never a reading of
the wrong tree and never silence; its tests are not compared.

The rule is about **the whole file, not about one occurrence**:
a name an import of pytest or unittest binds (`pytest`, `pt` in `import pytest
as pt`, `skip_if` in `from unittest import skipIf as skip_if`, read under its
canonical name) is certain only when all of these hold:

1. **the AST shows exactly one binding of the name in the file**, and it is an
   `import` of pytest or unittest that is a statement of the module itself — not
   inside an `if`, a `try`, a class or a function (`import pytest` twice, or
   `import unittest` beside `import unittest.mock`, is two bindings);
2. **symtable's classification, trusted as it is, never reinterpreted**: in
   every symbol table other than the module's — functions, classes, lambdas,
   comprehensions, annotation and type-parameter scopes — the name is absent, or
   **global** (declared with `global`, or implicit) **and nothing else**:
   `is_global()` true and no other predicate of the symbol true but
   `is_declared_global()` and `is_referenced()`. Free, local, a parameter,
   nonlocal, assigned, imported, annotated, a namespace — or a predicate a later
   Python adds — is a `WARN` (`class TestA[pytest]:` binds it in the scope its
   methods see: `TG003/py-class-type-param-pytest`; in a generic method
   `__classdict__` is free, the class's namespace:
   `TG003/py-classdict-generic-method`). A `global pytest` declaration that
   binds nothing leaves the name the module's;
3. **the name does not start with `__`**: Python binds such names on its own —
   `__class__` in methods, `__classdict__` in generic methods,
   `__type_params__`, a module's `__name__`… — and mangles the private ones in a
   class (`__omit` is `_Class__omit`), today and in versions to come, so an
   imported runner name of that form is never certain, used anywhere
   (`TG003/py-dunder-import-name`, `py-mangled-import-in-class`,
   `py-dunder-class-implicit`, `py-dunder-class-function-control`,
   `py-mangle-name-no-class-control`: `WARN`); no list of implicit names is kept.
   It is **not a builtin** (a use before the import would be the builtin:
   `py-builtin-shadowed-direct`), and the file has **no star import**;
4. as the courtesy above, the file writes on none of its members.

Then **every occurrence of the name in the file refers to that import**, and a
use is certain **wherever it is**: a decorator, `pytestmark`, a class's bases, a
module-level `pytest.skip(..., allow_module_level=True)`, a call inside a test
or any function — `pytest.skip()`, `pytest.xfail()`, `raise unittest.SkipTest`,
`pytest.raises()`. Otherwise every occurrence is a `WARN`, even one Python's
scoping keeps away from the other binding: a local `pytest` in another function,
a parameter of a helper, a comprehension variable, a class attribute `pytest`
(`TG003/py-local-name-elsewhere-control`, `py-class-binds-pytest-control`), a
fixture named `pytest`, an import inside a block (`py-skiptest-unicode-alias`;
`try: import pytest`; `global unittest` then `import unittest` in a class body:
`py-skiptest-global-import-in-class`), a second binding before or after the use
(`TG003/py-skip-in-body-rebound-*`, `TG004/py-raises-removed-rebound-*`,
`py-pytest-long-s-rebound`, where `pyteſt = …` rebinds `pytest`: CPython reads
identifiers NFKC-normalised). Annotations, keyword arguments and `with … as x`
use `pytest` without binding it (`py-monkeypatch-annotation-control`,
`py-param-marks-skip-control`, `py-pytestmark-slow-control`,
`py-raises-use-control`: `FAIL`).

**`self.skipTest()`** (case B) is certain only when: the closest method around
it (a function Python lists directly in a class body) has `self` as its first
parameter, is undecorated, and binds `self` nowhere else in its body, nested
scopes included; the class reaches `unittest.TestCase` (or
`IsolatedAsyncioTestCase`) through bases that are certain — `unittest.TestCase`
on a certain `unittest`, a certain `TestCase` from `from unittest import
TestCase`, or classes of the module bound once (mixins on `object` allowed); no
class of that chain is decorated or created with a keyword (a metaclass); and
**the file binds `skipTest` (or `__getattribute__`) nowhere, in any symbol
table, by any form** — an override anywhere, even in a class outside the chain,
is a `WARN` (`TG003/py-skiptest-class-import`, `py-skiptest-def-in-if`,
`py-skiptest-match-capture`, `py-self-skiptest-own-override`). A base read
through anything else (`Scope.unittest.TestCase`:
`py-skiptest-base-class-attribute`; a class imported from another module) is a
`WARN`; so is, as the courtesy above, a write of `skipTest` on any object
(`py-class-mutated`). `self.assertX()` / `self.fail()` are read the same way for
TG004; Python's `assert` statement is always certain. Python tests are collected
by name and class (NFKC-normalised, as pytest and unittest see them), so their
declarations are certain.

### Aliases

Any binding makes its name a **one-step alias** when its value, normalised,
**contains** a form of the vocabulary — even inside a call
(`pytest.mark.skip(reason=…)`, `unittest.SkipTest("x")`, `test.skipIf(true)`,
`t.skip.bind(t)`). The bindings, as the languages define them:

- **Python**: an assignment (plain, annotated, augmented), a walrus, an
  unpacking, a `for` or comprehension target, `with … as`, a parameter's
  default (`def`, `lambda`), `except … as`, a match capture, a `type` alias, a
  decorated `def` or `class` (the name holds what the decorator returns);
- **JavaScript / TypeScript**: a declaration with an initializer, a parameter's
  default, a destructuring default (`const { omit = it.skip } = …`), any
  assignment operator (`=`, `||=`, `&&=`, `??=`, `+=`…), a destructuring — a
  declaration or an assignment — with a literal key, computed or not (`const {
  skip: omit } = it`, `const { ['skip']: omit } = it`, `({ skip: omit } = it)`),
  `for … of / in`, a class decorator; and the **test context as an origin**: the
  first parameter of a test or hook callback (vitest's `ctx`, node:test's `t`),
  destructured in the parameter list (`({ skip: omit }) => omit()`, `({ skip })
  => skip()`).

**One reading of the origin** for every binding form: a value is an alias when
it contains a form of the vocabulary rooted **at a runner import or at the test
context** (`it.skip`, `t.skip`, `ctx.skip.bind(ctx)`, `t` itself) — the same
function (`aliasForms`, `src/parse/ts.ts`) whatever binds the name: a copy
(`const s = ctx.skip`, `const c = ctx`), a destructuring default (`const [omit
= t.skip.bind(t)] = []`: `TG003/node-test-context-default-alias`), a logical
assignment (`let omit; omit ||= t.skip.bind(t)`:
`node-test-context-logical-alias`), any operator. **Python names are compared
as Python reads them**: inside a class, `__omit` is `_Class__omit` for the
target and for the use alike (`_TestX__omit = pytest.mark.skip` then `@__omit`
in `class TestX`: `TG003/py-mangled-alias-use`), in the extractor and in the
net.

The extractor reads the one-step alias precisely, for its messages; behind it,
best effort, stands the **contagion net** (*Safety nets*, below), which reads
tokens instead of meanings: a name is marked when any statement that binds it
(its target an attribute or a subscript too) holds a token or a marked name,
and it holds a string when the value holds a string of the vocabulary, in any
container — to a fixed point, so an **alias of an alias** is marked too (`later =
omit`: `TG003/py-transitive-alias`, `ts-transitive-alias`), and so is `omit =
pt.skip.__call__` (`py-call-dunder-alias`), `omit = stop.__call__` after `from
pytest import skip as stop` (`py-from-import-call-dunder-alias`), `omit =
getattr(pytest, "skip")` (`py-getattr-string-alias`), `const key = 'skip'`
then `it[key](…)` (`ts-variable-key-string-alias`), `k = "skip"` then
`getattr(pytest, k)(…)` (`py-getattr-variable-name`), `const key = 'skip'`
then `Reflect.get(it, key)(…)` (`ts-reflect-get-variable-key`), `keys =
["skip"]` then `getattr(pytest, keys[0])(…)` or `ctx[keys[0]]()`
(`py-getattr-key-from-list`, `ts-context-key-from-array`), `omit =
pytest.skip` in a class body then `Actions.omit(…)`
(`py-class-attribute-alias-member`), `self.omit = self.skipTest` then
`self.omit(…)` (`py-self-attribute-alias`), `d["k"] = pytest.skip` then
`d["k"](…)` (`py-subscript-target-alias`). `"skip"` passed as the final
argument of a call (`procesar(kind)`) is not a use (`py-process-kind-control`,
`ts-process-kind-control`), nor is a call of a function whose defaults hold it
(`py-skip-string-as-data-control`). **A normal call is an opaque frontier**:
what enters it as an argument counts neither in a binding's value nor in a
callee — `expect(statusOf(kind)).toBe(…)` (`ts-skip-string-as-data-control`),
a table of `it.each([['skip', …]])(…)` (`ts-each-table-skip-data-control`),
`r = check(GOOD)` then `expect(r.ok)` or `r.get("ok")`
(`ts-call-result-data-control`, `py-call-result-data-control`) — while its
callee always counts (`pytest.mark.skip(reason=…)`, `t.skip.bind(t)`,
`unittest.SkipTest("x")`). Only the by-name access primitives are transparent:
getattr/hasattr/setattr/delattr, Reflect.get/Reflect.has (with a dot or a
literal subscript), subscripts and computed keys.

Each **new use** of the alias — a call, a decorator, a raise — is read as the
form and is at least a `WARN`, even when the definition does not change
(`TG003/py-mark-alias-new-use`, `py-mark-call-alias-new-use`,
`py-skiptest-instance-alias-raise`, `py-paren-decorator-alias`,
`py-paren-alias-value`, `py-walrus-alias`, `py-unpack-alias`, `py-for-alias`,
`py-raise-paren-unicode-alias`, `js-skip-alias-new-use`,
`ts-alias-type-assertion`, `ts-destructuring-default-alias`,
`ts-logical-assignment-alias`, `ts-computed-key-alias`,
`ts-context-skip-destructured-alias`). A container counts like any value
(`box = [it.skip]` marks `box`, so `box[0](…)` is a use; `const { a: { skip:
omit } } = { a: it }` marks `omit`). **Coverage, not a guarantee**: **values
that enter a function** — behind the opaque frontier of a call: `run(omit)`
where `run` calls its parameter, `omit = wrap(it.skip)`, `k =
os.environ.get("MODE", "skip")` — a call's result called at once
(`make()(…)`; the by-name primitives are not such calls:
`getattr(pytest, "skip")("x")` and `Reflect['get'](ctx, 'skip')()` are uses,
`TG003/py-getattr-call-at-once`, `ts-reflect-bracket-get`), and a name built at
run time (`"sk" + "ip"`, a template or an f-string with a substitution, what a
function returns: `key = lambda: "skip"` holds no string).

### Exhaustiveness: against the languages' own definitions

- **Python**: the script classifies **every node class of the running
  interpreter's `ast`** (binders, with what gives the name its value, or
  none), and a class with an `identifier` or a target field is a binder or
  says why not; `--self-check` verifies it, the script refuses a supported
  version where it fails, and a node it does not know in a file makes the file
  a `WARN`. Every `Name` stored or deleted must be explained by a binder the
  script reads; one that is not makes its name uncertain.
  The self-check runs on every interpreter, one newer than those tested
  included: a node class a later Python adds, or a field that may bind a name
  on a class the script reads as binding none, refuses that version as a
  whole (a `WARN` per Python file) until the script classifies it.
  `test/py-exhaustive.test.ts` runs the self-check on the interpreter that reads
  the files and on every other supported one found, and a probe for each form
  that binds a name (it makes `pytest` uncertain) and for each binding with a
  value (it makes an alias).
- **JavaScript / TypeScript**: `TS_DECLARATIONS` classifies every kind of
  declaration the compiler has (`import`, `value`, `none`); a kind it does not
  know is read as a value of unknown shape. Every assignment operator
  (`FirstAssignment`…`LastAssignment`) is a binding with a value.
  `test/ts-exhaustive.test.ts` holds the map to the compiler's SyntaxKind list
  and runs a probe for each operator and each binding form with a value, rooted
  at a runner import and at a test context (node:test's `t`, vitest's `ctx`).
- **Python versions**: CI runs the Python resolver tests and every fixture
  with a Python file on the oldest and the newest supported version on every
  push (`ci.yml`), and on each of 3.11, 3.12, 3.13, 3.14 and 3.15 before a
  merge (`full-ci.yml`, `python-versions`); the suite and the runner-evidence
  recorder run on the newest. A fixture whose syntax is newer carries
  `minPython` (PEP 695: 3.12; t-strings, `except A, B:`: 3.14; lazy imports:
  3.15) and stands down on an older interpreter there (outside those steps,
  CI refuses to stand down).
- **Positions** between the parsers are exact: Python's `ast` gives UTF-8
  columns on its own lines (`\r\n`, `\r`, `\n`), tree-sitter and the TypeScript
  compiler UTF-16 code units (`src/parse/positions.ts`,
  `test/positions.test.ts`); where the parsers disagree on a node, it is not
  read as certain.

**Known limits of attribution** (each a `WARN`, never a `FAIL`; backlog):
default imports (`import test from 'node:test'`, `import test from
'@playwright/test'`), `require`, mocha and `bun:test` (not in the list of
runners), `test.extend(…)` and helpers that re-export the runner, a describe
factory's parameter (vitest passes its `test`), tests declared in a helper
function called at the top level, a module-level import inside a block
(`try: import pytest`), any second binding of a runner name in a Python file
(the rule is about the file), Python older than 3.11. Python 3.15's **lazy
imports** (PEP 810, `lazy import pytest`): Python reads them, but
tree-sitter-python (0.25.0, its newest release) has no `lazy` keyword, so the
file has syntax errors for the tree that finds the forms and its comparison
is `UNVERIFIABLE` (`TG003/py315-lazy-import-unverifiable`; backlog). Where compilers disagree
(esbuild, which vitest uses, does not share a namespace's exported names across
its blocks as `tsc` does: `TG003/ts-namespace-merged-export`), the reading is
not certain. Setup files, `conftest.py` and code in the file itself that mutate
the framework are outside the assumption: a FAIL there may be wrong.

## Certainty and the marker invariant

Skip and focus markers (TG002, TG003) follow one design principle:

- **FAIL only with certainty.** A marker is *attributed* to tests only where it
  certainly applies: on the test or describe declaration itself
  (`it.skip(...)`, `describe.only(...)`, Vitest options
  `it('x', { skip: true }, fn)`, decorators, `pytestmark`), directly in a test
  body, directly in a describe body, directly in an inline hook of the same
  block (`beforeEach(() => { test.skip() })`, a test class's `setUp` /
  `setup_method`), or at the file top level.
- **Runner API calls must resolve.** `ctx.skip()` (and `skip()` from
  `({ skip }) =>` or `({ skip: s }) =>`) is the context's only if the receiver
  resolves, through the enclosing block, loop, catch and function scopes
  (shadowing and hoisted `var` included), to the first parameter of the test or
  inline-hook callback. Any other `x.skip()` or bare `skip()` in a test — a
  closer declaration that shadows it (`{ const ctx = { skip() {} } }`), a
  variable from outside the callback — is attached to the test as an uncertain
  marker: the rule warns that it may skip the test, never drops it (see
  *Attribution*). `unittest.SkipTest` counts only when raised (`raise SkipTest`,
  `raise unittest.SkipTest(...)`), not when merely constructed.
- **WARN when attribution is uncertain.** A marker inside a helper function
  (called or not), a function passed by reference to a hook
  (`test.beforeEach(setup)`), an object method, a callback passed to another
  call (`xs.forEach(() => test.skip())`), a `.each` table
  (`describe.each([it.only])`), an IIFE, a nested function, a pytest fixture,
  or an `x.skip()` whose receiver cannot be resolved is not attributed. When
  the diff adds one, it is reported as `warn`: *new skip marker `…` in
  <file>:<line> that could not be attributed to a specific test*. Helpers are
  never resolved across calls.
- **Every new marker site is at least WARN**, except a disabling marker on
  tests that did not exist at base or in a test file the PR creates (one
  `info` line, reason `new_test`: nothing that existed is lost; see TG003).
  Every syntactic occurrence of a marker in a test file is recorded in a
  census with a structural id. A marker site that is new at head either
  produces an attributed finding (`warn` or `fail`) or — unattributable, a
  constant condition such as `skipIf(false)`, a test that was already
  disabled, a `.fails` replacing a `.skip` — a `warn` of its own. The
  invariant test (`test/invariant.test.ts`) accepts an OK only when every
  added marker stands on a line the report names as a new test's.

### Safety nets

**The contagion net** (`src/rules/contagion.ts`) runs after the rules, whatever
the verdict. In each changed test file, on both sides:

- **Tokens** are the names of the vocabulary's members and functions, as
  imported from the runner packages too — JS/TS: `skip`, `skipIf`, `runIf`,
  `only`, `todo`, `fixme`, `fails`, `failing`, `fit`, `fdescribe`, `xit`,
  `xtest`, `xspecify`, `xdescribe`, `xcontext`; Python: `skip`, `skipif`,
  `skipIf`, `skipUnless`, `importorskip`, `xfail`, `SkipTest`, `skipTest`,
  `expectedFailure`, `only`, `focus` — read as **whole identifiers, never
  substrings** (`skip_reason`, `onlyOnce`, `skipped` are not tokens:
  `TG003/py-token-substring-names-control`, `ts-token-substring-names-control`).
  The runner's packages themselves (`pytest`, `it`, `test`) are not tokens: a
  new test is not a use. A **bare name** spelled like a token (an identifier,
  not a member, a key or an imported export) is the vocabulary only when the
  file does not bind it itself — a runner's global, `fit`, `xit` — or binds
  it to something that bears the vocabulary (an import from a runner, an
  alias): a variable, a parameter or a function of the file named `fail`,
  `skip` or `only` is not (`for (const fail of …)`, a local helper `only`:
  `TG003/variable-named-fail-control`, `TG002/only-lookalikes`). A member of a
  name bound to an **assertion library**'s import or `require` — `assert`,
  `node:assert`, `assert/strict`, `chai`, `power-assert`, `uvu/assert`,
  `should`, `expect`, `@std/assert`, a closed list — asserts: `assert.fail(…)`,
  chai's `expect.fail(…)` are not uses (`TG003/node-assert-fail-control`,
  `chai-assert-fail-control`).
- A **string of the vocabulary** is a string literal exactly equal to a token
  (escapes decoded, adjacent literals joined), or one whose value is not
  certain (a legacy octal escape).
- A statement that binds names — an assignment of any operator, a
  declaration, a class field, a default, a destructuring (its keys too), a
  walrus, `for`, `with`/`except … as`, an import, a decorated definition, a
  match capture — binds **every name of its target**; a member target binds
  every name of its receiver chain, a literal subscript the same member as a
  dot in any position (`self.omit = …` binds `self` and `omit`, `this['omit']
  = …` binds `this` and `omit`, `this.a['b'] = …` binds `this`, `a` and `b`,
  `d['k'] = …` binds `d` and `k`: one reader, `memberChain` in
  src/parse/normalise.ts). Where the code names something — an identifier,
  `this`, a member however written — a dot, a literal subscript, or a by-name
  primitive that returns it with a literal name (`it['skip']` is `it.skip`,
  `this['omit']` is `this.omit`, `Reflect.get(box, 'omit')` and
  `Reflect['get'](box, 'omit')` are `box.omit`, `getattr(self, "stop")` and
  `getattr(self, "stop", None)` are `self.stop`; `memberStep` in
  src/parse/normalise.ts, every step of a receiver chain read the same way) —
  the name is read as a token and looked up among the marked names.
  `hasattr`/`setattr`/`delattr`/`Reflect.has` return no member: they stay
  transparent (their literal name is read as a string of the vocabulary) but
  are never a step of a chain. Read after normalisation (NFKC and
  mangling in Python, escapes decoded, parentheses and type assertions read
  away):
  - its names are **marked** when its value or its pattern holds a **token**
    or a **name already marked** (the body of a function it defines counts as
    its value);
  - its names **hold a string** when its value holds a **string of the
    vocabulary** or a **name that holds one** — directly, in any container
    (a list, a tuple, a dict, a set, an object, at any depth), a condition,
    a subscript — read outside the functions it defines: a function is not a
    container, what it returns is computed when it runs.

  **A normal call is an opaque frontier**, here and in a callee: what enters
  it as an argument is not part of the value that holds the call (`r =
  f(GOOD)` holds nothing); its callee is (`omit = pytest.mark.skip(reason=…)`,
  `omit = t.skip.bind(t)`, `stop = unittest.SkipTest("x")` are marked). Only
  the by-name access primitives are transparent — `getattr`/`hasattr`/
  `setattr`/`delattr` and `Reflect.get`/`Reflect.has`, with a dot or a literal
  subscript after normalisation (`omit = getattr(pytest, k)` holds what `k`
  holds) — as subscripts and computed keys are.

  All to a fixed point within the file, whatever the scope.
- A **use** is a call, a decorator or a raise — read identically: what is
  called, applied or raised — whose **callee** — the
  expression before the final argument list, its subscripts and keys
  included (a decorator's or a raise's by-name access read whole:
  `@getattr(pytest.mark, "skip")`, `raise getattr(unittest, "SkipTest")`), the calls it holds read across the opaque frontier (their callee,
  never their arguments, except the by-name primitives') — holds a token, a
  string of the vocabulary, a marked name or a name that holds a string, as
  an identifier or as a member's name (`omit()`, `Actions.omit()`,
  `self.omit()`, `@later`, `raise stop`, `pt.skip(…)`, `it[key](…)`,
  `ctx[keys[0]]()`, `getattr(pytest, k)(…)`, `Reflect['get'](ctx, 'skip')()`,
  `it.skip.each([…])(…)`). The **final arguments never count**:
  `procesar(kind)` is not a use, `handlers[kind]()` is; nor do the arguments
  of the calls a callee holds: `expect(statusOf(kind)).toBe(…)`,
  `it.each([['skip']])(…)` are not uses. A token is a key of the vocabulary's
  own table (`toString`, `constructor` are not tokens). `SkipTest` is an
  exception class: a raise of it is a use, a call is not.
- Each **new use** at head — one base does not have, counted by its form, its
  callee and its test (a test renamed or moved keeps its identity, by TG001's
  matching) — is at least a `WARN` naming its test ("Adds a call of `omit` to
  test "adds": `omit` is bound at line 3 to a value that holds `skip`, a token
  of the skip/focus vocabulary; it may skip it"), under TG002 when every token
  behind it is a focus, TG003 otherwise; once per line, and not when a finding
  of the extractor already stands on the use.

#### The silence guarantee: direct forms

What blocks a merge is deliberately small. Agents that weaken tests write the
**direct forms** — `test.skip(…)`, `it.only`, `@pytest.mark.skip`,
`self.skipTest()` — not contrived ones; widening and grouping more adds noise
with no evidence that it is needed. So the guarantee is these forms, and it
grows only with data from real pull requests (`docs/backlog.md`; a proposal
that is not implemented: `docs/design/silence-net-v2.md`). It is kept in one
place (`src/rules/guarantee.ts`) and rendered here:

<!-- silence-guarantee:start -->
Two things block a merge, and nothing else:

- **No false `FAIL`** — unchanged: a `FAIL` is a fact about the code, under the four documented assumptions (*Verdicts* and *The contract*, above), for the canonical forms of the whitelist (*Verdicts*).
- **No silence for the direct forms** — a new use of one of these, at head, is at least a `WARN` naming its test:
  - **a member of the vocabulary used directly from its root**, a runner import or the test context:
    - Vitest (`import { test, describe } from 'vitest'`; the context, the test callback's first parameter `ctx`) — on the test root: `test.skip(…)`, `test.only(…)`, `test.todo(…)`, `test.fails(…)`, `test.skipIf(…)`, `test.runIf(…)`; on the suite root: `describe.skip(…)`, `describe.only(…)`, `describe.todo(…)`, `describe.skipIf(…)`, `describe.runIf(…)`; options of a test: `{ skip: true }`, `{ only: true }`, `{ todo: true }`, `{ fails: true }`; the test context: `ctx.skip()`
    - Jest (`const { it, describe, fit, … } = require('@jest/globals')`) — on the test root: `it.skip(…)`, `it.only(…)`, `it.todo(…)`, `it.failing(…)`; on the suite root: `describe.skip(…)`, `describe.only(…)`; roots that are a marker: `fit(…)`, `fdescribe(…)`, `xit(…)`, `xtest(…)`, `xdescribe(…)`
    - Playwright (`import { test } from '@playwright/test'`; the context, the test callback's second parameter `testInfo`) — on the test root: `test.skip(…)`, `test.only(…)`, `test.fixme(…)`, `test.fail(…)`; on the suite root: `test.describe.skip(…)`, `test.describe.only(…)`, `test.describe.fixme(…)`; annotations in a test's body: `test.skip()`, `test.fixme()`, `test.fail()`; the test context: `testInfo.skip()`, `testInfo.fixme()`, `testInfo.fail()`
    - node:test (`import { test, describe } from 'node:test'`; the context, the test callback's first parameter `t`) — on the test root: `test.skip(…)`, `test.only(…)`, `test.todo(…)`; on the suite root: `describe.skip(…)`, `describe.only(…)`, `describe.todo(…)`; options of a test: `{ skip: true }`, `{ only: true }`, `{ todo: true }`; the test context: `t.skip()`, `t.todo()`, `t.runOnly()`
    - Jest's globals, with no import (at least a `WARN`, never a `FAIL`: *Attribution*) — on the test root: `test.skip(…)`, `test.only(…)`, `test.todo(…)`, `test.failing(…)`, `it.skip(…)`, `it.only(…)`, `it.todo(…)`, `it.failing(…)`; on the suite root: `describe.skip(…)`, `describe.only(…)`; roots that are a marker: `fit(…)`, `fdescribe(…)`, `xit(…)`, `xtest(…)`, `xdescribe(…)`
    - pytest (`import pytest`) — marks: `@pytest.mark.skip`, `@pytest.mark.skipif`, `@pytest.mark.xfail`, `@pytest.mark.only`, `@pytest.mark.focus`; functions: `pytest.skip(…)`, `pytest.xfail(…)`, `pytest.importorskip(…)`
    - unittest (`import unittest`, `from unittest import skip`; the context, `self` in a `unittest.TestCase` method) — decorators: `@unittest.skip`, `@unittest.skipIf`, `@unittest.skipUnless`, `@unittest.expectedFailure`; decorators imported by name (`from unittest import skip`): `@skip`, `@skipIf`, `@skipUnless`, `@expectedFailure`; the exception: `raise unittest.SkipTest`; the `TestCase` method: `self.skipTest(…)`
  - **a simple alias in the same file**: a name bound once, by a plain declaration or assignment, to one of those members — the member itself, not a call of it — and used as the member would be (`const later = test.skip; later('x', …)`, `later = pytest.mark.skip` then `@later`, `stop = unittest.SkipTest` then `raise stop("x")`, `omit = self.skipTest; omit("x")`); for every form above but an option and a decorator imported by name.

Each combination — runner × form × member, direct and through the alias: 159, generated from the runners' API (src/parse/ts-binding.ts) and the vocabulary (src/parse/vocabulary.ts) — has a fixture with the real runner's evidence (`test/contract-fixtures.test.ts`).

Everything else the nets catch is *Best-effort detection* (below), with no guarantee.
<!-- silence-guarantee:end -->

#### Best-effort detection

Beyond the direct forms, the contagion net reads every form below — what is
implemented today — **with no guarantee**: a form it misses is coverage, not a
broken guarantee, and widening it is backlog. Listed in
`src/rules/guarantee.ts` and rendered here:

<!-- best-effort:start -->
- **Uses**, read identically (one extraction of the callee, the same transparent by-name primitives):
  - a call (`omit(…)`)
  - a decorator (`@omit`, `@omit(…)`; Python)
  - a raise (`raise omit`, `raise omit(…)`; Python, the `SkipTest` member)
- **Forms of the vocabulary** — every member of its table (*Safety nets*, src/parse/vocabulary.ts) — rooted at
  - a runner import (`import pytest`, `import unittest`, `import pytest as pt`, `from pytest import mark`, `import { it } from 'vitest'`, `import { test as t2 } from 'node:test'`)
  - the test context (`self` in a `unittest.TestCase` method, the test callback's `ctx`/`t`)
  and written as
  - a member with a dot (`pytest.skip`, `pytest.mark.skip`, `unittest.SkipTest`, `self.skipTest`, `it.skip`, `test.fail`, `ctx.skip`, `t.skip`)
  - a literal subscript, normalised (`it['skip']`, `test['fail']`, `ctx[('skip')]`, `it['skip' as const]`, `pytest.__dict__["skip"]`)
  - a by-name access with a literal name — returning the member, the same member as a dot (a step of a chain that is called or raised): `getattr(pytest, "skip")`, `getattr(pytest, "skip", default)`, `Reflect.get(it, 'skip')`/`Reflect['get'](it, 'skip')`; testing or writing it, transparent (its literal name marks, never a step of a chain): `hasattr(pytest, "skip")`, `setattr(pytest, "skip", v)`, `delattr(pytest, "skip")`, `Reflect.has(it, 'skip')`/`Reflect['has'](it, 'skip')`
- **Aliases** (one step or in a chain) bound by
  - a declaration or an assignment (`omit = V`, `const omit = V`, `let omit; omit = V`, an annotated `omit: T = V`)
  - an augmented or logical assignment (`+=`, `||=`, `??=`, `&&=`…)
  - a walrus (`(omit := V)`)
  - a simple destructuring — object, array, tuple — with literal keys, computed literal keys and defaults (`(omit, x) = (V, 1)`, `const [omit] = [V]`, `const { skip: omit } = it`, `const { ['skip']: omit } = ctx`, `const { omit = V } = {}`)
  - a parameter default (`def f(omit=V)`, `(omit = V) => …`)
  - an import under another name (`from pytest import skip as omit`, `import pytest as pt`, `import { it as each } from 'vitest'`)
  - an assignment to a member — a dot or a literal subscript — of a receiver below: `box.omit = V`, `this['omit'] = V`, `this.a['b'] = V`, `self.omit = V`, `d["k"] = V`
  - an alias of an alias (`later = omit`), through any of the forms above
  - a name that holds a string of the vocabulary, used as a key or a by-name access's name (`k = "skip"; getattr(pytest, k)`, `const k = 'skip'; it[k]`, `Reflect.get(ctx, k)`)
- **Receivers** of a member target and of the member a use reads:
  - an identifier (`box.omit`, `box['omit']`, `d["k"]`, `Reflect.get(box, 'omit')`)
  - `this` (JS/TS) or `self` (Python) (`this.omit`, `this['omit']`, `self.omit`, `self["omit"]`, `getattr(self, "omit")`)
  - a chain on either, every step a member access however written (`a.b.omit`, `this.a['b']`, `a['b'].c`, `getattr(this.a, 'k')`, `Reflect.get(a['b'], 'k')`, `self.a["b"].c`)
- **Runner globals** with no import (Jest's, Vitest's globals, Mocha's): a form of the vocabulary on them is always a `WARN` "may be skipped", never a `FAIL`.
- **Outside the matrix** — read by the net best effort, with no test against regressions:
  - class fields and members, static or not, with a computed name or not (`static ['omit'] = it.skip`, `static 'omit' = ctx.skip`, `static [field] = ctx.skip`)
  - a member written through a call (`setattr(R, "omit", V)`, `Reflect.set(R, 'omit', V)`, `Object.defineProperty`, `Object.assign`): only an assignment to a dot or a literal subscript binds
  - a member target or a member read through a receiver outside the ones above: a call (`f().omit`, `getBox()['omit']`) or a subscript computed at run time (`a[k].omit`)
  - enums and their members (`enum K { S = 'skip' }`, `class K(Enum): S = "skip"`)
  - non-literal containers (a `Map`, a value built by a call)
  - values that enter a function or leave it (`run(omit)`, `r = f(GOOD)`, `key = lambda: "skip"`, a call's result called at once, a function declared with `def`/`function`)
  - names built at run time (`"sk" + "ip"`, a template or an f-string with a substitution)
  - a module imported from another file
<!-- best-effort:end -->

These lists are **protected against regressions**, not guaranteed, by a
**cartesian matrix generated from them** (`test/guarantee-matrix.ts`): binding
form × member of the vocabulary × root × access form of the value (a dot, a
literal subscript, each by-name primitive in each callee form and arity) ×
receiver (`BEST_EFFORT_RECEIVERS`: bare, and chains of 1 or 2 steps of every
member access) × access form of a member target × access form of the read ×
use — in Python and in JS/TS, through the whole pipeline, the definition
already at base: each case at least a `WARN`, and its control (the use
replaced by a harmless call) nothing above `INFO`. Every combination it does
not run is in an explicit list with its reason (`MATRIX_EXCLUSIONS`: a JS
decorator or raise, a JS walrus, a call of an exception class, a by-name
primitive as an assignment target or as a read that returns no member,
imports under another name where none exists, a destructuring's key forms, a
dot that holds no name); `test/guarantee-matrix.test.ts` checks that the axes
are the sources' lists and every exclusion excludes something. The **full
matrix** (777 936 cases) runs in the CI job `guarantee matrix (full)`
(`scripts/guarantee-matrix.ts`, 8 shards), which fails closed: it runs on
every pull request unless git answered and every changed path is in an
explicit exclusion list (`scripts/guarantee-matrix-paths.mjs`: `docs/**`,
`*.md` at the root, `LICENSE`, `.github/ISSUE_TEMPLATE/**`; any other path,
a new or unknown one included, runs it; a rename counts as both of its
paths), and it passes only when every shard
reported once, none ran zero cases, none failed, and their cases add up to
the total the generator counts without running anything; the **test suite**
runs its slice (`test/silence-guarantee.test.ts`, 25 472 cases), leaving out
two more slices, each listed with its reason (`SUITE_EXCLUSIONS`: receiver
chains of 2 steps; a member target's value by anything but a dot). A form
outside these lists that is caught is caught best effort too
(`TG003/ts-class-computed-field`, `ts-enum-member-key`, `py-enum-member-key`).

Its price is a `WARN` for a name exactly equal to a token that is not the
runner's (`TG002/only-lookalikes`: a local helper named `only`), and for
names shared by different declarations or marked through an attribute
(`self.x = it.skip` marks `self`): names spread by name, whatever the scope
(reading scopes is in the backlog). A value that enters a call marks and uses
nothing, and TypeScript's types hold nothing at run time and mark nothing
(`kind?: 'skip'`).

**The count net** (`src/rules/net.ts`) re-checks a verdict that would exit 0
(`OK`) with a separate, deliberately simple counter: tree-sitter blanks
out comments and string literals, and regular expressions count the
recognised markers of each kind in every changed test file at base and at
head. The guarantee is exactly:

> **An increase in recognized markers of any kind in a test file never ends in
> OK** (never exit 0). The same net also covers assertions (TG004) and timeout, retry and
> scope settings (TG005); see those rules.

When a count grows and nothing else was reported, the net adds a `warn`:
*marker added that the analyzer could not attribute*. The recognised
vocabulary — **the closed list "never silent" applies to** — per kind:

<!-- vocabulary:start -->
| Kind | JS/TS | Python |
|---|---|---|
| skip | `.skip`, `.skipIf`, `.runIf`, `xit(`, `xtest(`, `xspecify(`, `xdescribe(`, `xcontext(`, `skip: true` | `mark.skip`, `mark.skipif`, `pytest.skip(`, `pytest.importorskip(`, `.skipTest(`, `raise … SkipTest`, `unittest.skip/skipIf/skipUnless`, `@skip/@skipIf/@skipUnless` |
| only | `.only`, `.runOnly`, `fit(`, `fdescribe(`, `only: true` | `mark.only`, `mark.focus` |
| todo | `.todo`, `todo: true` | — |
| fixme | `.fixme` | — |
| xfail | `.fails`, `.failing`, `it.fail`/`test.fail`/`specify.fail`, `fails: true` | `mark.xfail`, `pytest.xfail(`, `unittest.expectedFailure`, `@expectedFailure` |
<!-- vocabulary:end -->

The table is rendered from `src/parse/vocabulary.ts`, the one definition of the
vocabulary: the extractor's tables, this net's patterns, the contagion net's
tokens and the best-effort matrix all derive from it, never from a list
of their own (`test/vocabulary.test.ts`: every member, in each language, is a
token of the contagion net, marks a name bound to it, and is counted here).

Markers inside `.each` tables are covered (they are code, not strings). Each
form is also read written another way, by a plain rule: a literal subscript is
a member access (`it['skip']`, `ctx['skip']`, ``test[`only`]`` count as
`.skip` / `.only`), escapes in identifiers and in those subscripts are decoded
(`\u0069t.\u0073kip`, `test['\u006fnly']`), Python identifiers are
NFKC-normalised (`pyteſt.skip(` is `pytest.skip(`), word boundaries are
Unicode-aware (`停` or `é` is part of a name, as for the language: `éxit(` is
not `xit(`), and parentheses and TypeScript's type assertions are blanked
(`raise (unittest.SkipTest)`, `(fit as any)(…)`, `it[('skip')]`), by the one
normalisation. Names imported under another name and aliases are the contagion
net's (above).

**What the guarantee does not cover:**

- **Replacing a marker by another of the same kind.** Moving `.skip` from one
  test to another, or swapping `.skip` for `.skipIf(...)`, keeps the count; the
  attributed rules may still catch it (e.g. TG003 when a test that ran is now
  skipped), but the net does not.
- **Syntax outside the vocabulary.** A function declared with `def` or
  `function` that calls `it.skip` (the extractor's helper rules see it; its
  calls are not uses), values that enter a function (a call is an opaque
  frontier: `run(omit)`, `wrap(it.skip)`), a call's result called at once (`make()(…)`), a name built at run time,
  options objects
  built elsewhere (`it('x', opts, fn)`), options with a non-literal value (`{
  skip: flag }` is only seen by the extractor), custom runner APIs, and markers
  in files that are not recognised as test files.

The test suite checks the guarantee on every fixture and on ~500 seeded
random marker insertions (`test/invariant.test.ts`). Because that check uses
the product's own vocabulary, fixture expectations are additionally grounded
in the real runners: fixtures with a `"runner"` record the status of every
test as reported by Vitest, Jest, node:test, Playwright, pytest or unittest (`scripts/runner-evidence.mjs`,
re-verified in CI), and `test/runner-evidence.test.ts` asks the runner for
the evidence of each `FAIL`'s **effect**, declared in data
(`src/rules/effects.ts`, *Verdicts*, reported as `effect` on every `FAIL`),
**in the status of the tests the `FAIL` names alone** (its test, the tests
it lists, or for a focus the tests it leaves out: a `FAIL` is never credited
with another test's evidence, `TG003/codex14-real-and-fake-skip`):
`not-run` (TG001, TG002, TG003's skip, Vitest's and Jest's todo, fixme and
`xfail(run=False)`) needs tests that ran at base and the runner no longer runs
— an expected failure ran, so passed → xpassed is never that evidence
(`TG003/oracle-control-node-todo-runs`); `expected-failure` (TG003's `xfail`,
`pytest.xfail()`, `expectedFailure`, `fails`, `failing`, `fail`, node:test's
todo) needs the runner's own signal of a new expected failure — xfailed or
xpassed, on a test that was not one at base (xpassed → xfailed is the same
one, `TG003/codex14-oracle-control-fails-already-present-vitest`) — pytest's `wasxfail`, unittest's expected failure or unexpected
success, Vitest's `fails` mode (its reporter API: the JSON report does not
say it), Jest's `failing`, Playwright's expected status, Node's todo; pytest's
read from its structured results, never a reason's text: an `xfail` whose
evaluated `run` is false never ran (skipped), a strict `xfail` whose call did
not raise is XPASS(strict) (xpassed) — never a
bare `failed`, which a test broken by the code gives too
(`TG003/oracle-control-broken-code-vitest`, `-jest`, `-pytest`, `-unittest`:
passed → failed, refused as evidence). The oracle reads each side's statuses
by own property: a test titled `constructor` or `toString` is a test, and none
is inherited from `Object.prototype` (`TG003/oracle-constructor-title-vitest`,
`oracle-control-constructor-renamed-vitest`,
`oracle-control-to-string-appears-vitest`). A loss of tests is never `OK`; a fixture marked `selectionChanges` must show the runner running a
different set of tests at head.

**Structural identity.** A marker's identity is the chain of enclosing
describes, tests, hooks and functions by name, plus an ordinal — e.g.
`suite:"login"/test:"shows the form"/test.skip#0` — never its line or text.
Reformatting and line shifts do not create new markers, and two
`describe.only` written on the same line stay distinct. A marker counts as new
when its id does not exist in the same file (following git renames) at base.
A test-level marker on a renamed or moved test (paired by TG001) that carried
the same marker at base is not new.

## Grouped findings

Several `warn` findings with **the same cause in the same file** are
reported as one (`src/rules/group.ts`): same rule, severity, file, side and
reason, and the same message once the test it names is left out (*removes test
"a"*, *removes test "b"* → *Removes 2 tests ("a", "b")*). The grouped finding
points at the first one's line, counts them, and lists every test in `tests`
(the Markdown report folds the list when it is long). A `fail` is never grouped:
each one names, in `ids`, the tests whose status the runner-evidence oracle
reads; an `info` line is not a warning and stays one per site, at its own
line (`TG001/removed-tests-grouped`).

## How tests are identified

Test files are found by name (`*.test.*`, `*.spec.*`, `*.e2e.*`, files under
`__tests__/`, `test_*.py`, `*_test.py`) and, for JavaScript/TypeScript files
under `test/`, `tests/`, `spec/` or `e2e/`, by containing at least one test
declaration or marker (or failing to parse). Only files changed between base
and head are parsed.

Files are parsed with tree-sitter (TypeScript, TSX — also used for plain
JavaScript — and Python). A test's identity is its file plus its full name:

- JS/TS: the `describe` chain joined with ` > `, e.g. `math > divides by zero`.
  Recognised: `it`, `test`, `specify`, `describe`, `suite`, `context`, `fit`,
  `fdescribe`, `xit`, `xtest`, `xdescribe`, Playwright's `test.describe`, and
  the modifiers `.only .skip .todo .fixme .fails .failing .fail .skipIf(c)
  .runIf(c) .each .for .concurrent .sequential .parallel .serial`. Tests
  declared inside helper functions are still inventoried (for TG001), but
  markers on them are not attributed.
- Python: pytest-style ids, `test_name` or `Class::test_name`, for
  `test*` functions, `Test*` classes and `unittest.TestCase` subclasses.

Base and head tests are paired in three passes:

1. **Same file (following git renames) and same name.**
2. **Renames and moves**: an unmatched base test pairs with an unmatched head
   test if the bodies are identical, if the name changed but the body token
   similarity (Jaccard) is ≥ 60%, or if the same name appears in another file
   with ≥ 40% similarity. Best score first; ties broken by path and line.
3. **Substitutions**: a still-unmatched base test and an unrelated test added
   to the same file.

Whitespace, comments and strings do not create or hide tests: `// it.only(...)`
in a comment and `"it.only"` in a string are ignored, which a grep cannot do.

## TG001 Test or test file removed

**Why it matters.** Deleting the test that fails is the cheapest way to get a
green run.

**Fires when**

- a whole test file is deleted and none of its tests reappear elsewhere →
  one `fail` finding for the file, *deletes the test file, which declared N
  tests: …* (`warn` if every one of them was unconditionally skipped at base:
  nothing that ran was removed; `warn` too, *they may not have been the
  runner's tests*, when no test of the file was declared certainly through the
  runner's API — a global `it`, a helper's `test`, a test inside a function:
  see *Attribution*; `warn` too for a test that was not, at base, one of F7's
  exact forms — a module-level `def test_…` or a method of a module-level
  test class with exact bases, F1 decorators, bound once in the file, no
  `__test__`, `__init__` or `__new__`, or a JS F3 declaration (*Verdicts*,
  F7: `TG001/codex14-module-test-false-deleted`,
  `codex14-pytest-class-init-deleted`, `codex15-class-rebound-to-none`,
  `codex15-deleted-file-if-false-vitest`…). The `fail` names, in `ids`, the
  tests of F7's forms that ran: the oracle reads their status alone);
- every test declaration of a file is gone but the file is still in head's git
  tree, under its name or renamed (git's rename detection) → one `warn` for the
  file, *removes all N test declarations from <file> (file kept)* or *(file
  kept, renamed to <path>)*: the file's tests may live on elsewhere under
  another shape; the diff alone cannot prove they were lost
  (`TG001/file-kept-tests-removed`, `file-renamed-tests-removed`);
- a test present at base has no counterpart at head while its file survives →
  `warn` (`info` for a body-less `todo`). The test may have been merged into
  another one; the diff alone cannot prove it was lost;
- a test is removed and an unrelated test is added in the same file (a
  *substitution*) → `warn`, with body similarity and assertion call counts, e.g.
  `Removes test "rejects negative amounts" and adds "validateAmount is defined"
  in its place (body similarity 22%, assertion calls 2 → 1)`. A test renamed *and*
  rewritten in one commit looks exactly like this, which is why it is not a
  `fail`.
- **Context, never a verdict:** when a removed test (any of the cases above
  but the substitution) used local code and that code changed or is gone in
  the PR, the finding's message adds *; the local code … also changed or is
  gone in this PR* (`src/rules/withcode.ts`), worded for what the finding
  names: *this test* for one removed test, *it* or *they* for a file whose
  tests all used it, *N of them* when only some did, *these tests* in a
  grouped warning (*Grouped findings*), whose message then ends with the
  list of names. Local means a
  name imported from a module the repository holds at base (a relative JS/TS
  import or `require`; a Python module resolved relative to the file, from the
  root or `src/`, or at one unique place); the sentence is added when the test
  used at least one such name and **every** one of them is no longer in its
  base module at head (the module deleted, or the name no longer exported or
  defined there), read by the file's text. It says nothing about what the test
  checked: the code may survive under another name or in another path (a
  rename, a move git does not detect), so the finding keeps exactly the
  severity it has without the sentence — the same FAIL of F7, the same `warn`
  — and the assertion net counts the test's assertions as usual
  (`TG001/code-renamed-file-deleted-js`, `code-renamed-file-deleted-py`,
  `code-moved-file-deleted`, `code-moved-test-removed`,
  `code-rewritten-file-deleted`, `deleted-with-its-module-js`,
  `deleted-with-its-module-py`, `removed-test-symbol-gone`; control, no
  sentence: `deleted-module-other-kept`).

**Does not fire (hard legitimate cases)**

- renamed test with the same or a similar body → `info`;
- test moved to another file → `info`;
- test file renamed with `git mv` (git rename detection, `-M`);
- `it.todo('x')` implemented as `it('x', ...)`;
- snapshot files (`__snapshots__/*.snap`) updated or pruned — they are not
  tests.

**Known limits.** A test renamed *and* heavily rewritten in one commit looks
like a substitution (`warn`). Tests generated dynamically (loops calling
`it()` with computed names) are identified by the raw source of the name
expression, so every generated test is one inventory entry.

## TG002 New focused test (.only / fit)

**Why it matters.** `.only` silently turns a 500-test run into a 1-test run
that passes.

**Fires when** a focus marker (`it.only`, `test.only`, `describe.only`,
`test.describe.only`, `fit`, `fdescribe`, `@pytest.mark.only` /
`@pytest.mark.focus` from pytest plugins) is new at head (its structural id,
see *Certainty and the marker invariant*, did not exist at base). It is a
`fail` only when the file's focus certainly leaves out a test that ran at base
(F8: a test of the same file, an F3 declaration at base and at head, not
skipped, todo or fixme by any marker and not out of the focus at base),
*adds `it.only` (focus, test) to test "x"; the file's focus now leaves out 1
test that ran at base: "y"* (its `ids` name those tests, which the oracle
reads alone), and the new marker, every
focus marker of the file at base and at head, and the tests left out are
certainly the runner's (see *Attribution*: a static import; `node:test`'s
`only` and `t.runOnly()` need `--test-only` and `@pytest.mark.only` / `focus`
need a plugin, so they are never certain: below), each in a canonical form
with no modifier on a describe around the focused declaration (*Verdicts*,
F8: a `warn` that does not say which tests are left out,
`TG002/codex14-only-inside-describe-skip-jest`, `-vitest`). A focus whose
left-out tests were already skipped or not canonical at base is a `warn` that
names none (`TG002/codex15-only-with-skipped-other-vitest`, `-jest`). Otherwise — the file was
already focused and nothing else drops out, the focus only adds tests, the
file is new, the marker cannot be attributed, or its binding is uncertain (*it
may focus it: …*) — it is a `warn`. The comparison is per marker
site, not per test, so a new `it.only` inside an existing `describe.only` is
caught even though the test was already "focused" by its suite, and a second
`describe.only` on the same line as the first is a distinct site. A focused
`describe` is reported once, at the marker, listing every test it focuses.

**A member whose effect the base runner does not guarantee is never a
`fail`.** A member of the vocabulary gives a `fail` only when the runner itself,
with nothing the diff does not show, gives it its effect; when the effect
depends on a plugin, a command-line flag or a configuration outside the diff,
it is a `warn` that says on what (*it may focus it: …*). The scope is explicit,
never deduced: a requirements file or a conftest that names the plugin does not
make it certain. `@pytest.mark.only` and `@pytest.mark.focus` are not pytest's
API: they focus only with a plugin (pytest-only and the like), and without it
pytest runs every test, with an unknown-mark warning (`TG002/contract-pytest-mark-only-direct`,
`contract-pytest-mark-focus-direct`: the real pytest 8.4.2 runs both tests at
base and at head; `TG002/pytest-mark-only`). `node:test`'s `only` (a modifier
or `{ only: true }`) takes effect only with `--test-only`
(`TG002/contract-node-test-test-only-direct`, `contract-node-test-option-only-direct`).
The data: `PY_PLUGIN_MARKS` in src/parse/vocabulary.ts, `focusNeedsFlag` in
the runners' API (src/parse/ts-binding.ts). Every other member's effect is the
base runner's: pytest's `skip`, `skipif`, `xfail`, `pytest.skip()`,
`pytest.xfail()`, `pytest.importorskip()` (conditional: already a `warn`);
unittest's `skip`, `skipIf`, `skipUnless`, `expectedFailure`, `SkipTest`,
`skipTest()`; Vitest's `skip`, `only`, `todo`, `fails`, `skipIf`, `runIf`, its
options and `ctx.skip()`; Jest's `skip`, `only`, `todo`, `failing`, `fit`,
`fdescribe`, `xit`, `xtest`, `xdescribe`; Playwright's `skip`, `only`, `fixme`,
`fail` and their annotations; `node:test`'s `skip`, `todo`, their options and
`t.skip()`. A configuration that forbids a focus in CI (Vitest without
`allowOnly`, Playwright's `forbidOnly`) makes the run fail instead: the tests
left out still do not run, and the `fail` stands (checked with Vitest 4.1.11
under `CI=true`: the other test is skipped and the run fails; Playwright 1.64.0
with `forbidOnly`: the run stops with an error before any test). Mocha's `xspecify` and
`xcontext` are globals, never a `fail`.

The finding also lists the previously running tests of that file that no
longer run, computed from the effective focus:

- JS/TS (vitest, mocha, Playwright): a nested `.only` narrows its focused
  ancestor (`describe.only` with an inner `it.only` runs only that test). Jest
  keeps every test under a `describe.only`; the narrowing model is the stricter
  one and is what is reported.
- Python (pytest-only style plugins): every marked test runs; no narrowing.

If the focus changes leave tests out without any new marker (e.g. a test moved
out of a `describe.only`), a file-level `fail` is reported (`warn` when a
focus marker or a test of the file is not certainly the runner's).

**Does not fire**

- the same focus markers already existed at base (only bodies changed);
- a test that already had `.only` is renamed or moved (paired by TG001);
- removing a `.only`;
- a new test added inside an existing `describe.only`;
- `.only` inside comments, strings or test names;
- look-alikes: `test.step(...)`, `test.describe.configure(...)`,
  a local helper called `only`.

**Known limits.** Aliases (`const focus = it.only`) are not followed; a new
`focus.only(...)`-style call is still a new `.only` occurrence and warns.
Playwright's `.only` applies across files; the effective set is computed per
file. Runner flags such as `--testNamePattern` belong to TG005.

## TG003 New skip / xfail / todo / fixme

**Why it matters.** Skipping or marking as expected-failure the test that fails
keeps the run green while the bug stays.

**Markers:** `.skip`, `xit`/`xtest`/`xdescribe`, `.todo`, `.fixme`,
`.fails`/`.failing`/`.fail`, `.skipIf(c)`/`.runIf(c)`, Playwright
`test.skip()/fixme()/fail()` annotations (in a test, a hook, a `describe` or
the file), vitest `ctx.skip()`, node:test `t.skip()`/`t.todo()`, Playwright
`testInfo.skip()/fixme()/fail()` (the second parameter: always a `warn`),
`@pytest.mark.skip/skipif/xfail`,
`pytest.param(..., marks=...)`, `pytestmark = ...`, `pytest.skip()` /
`pytest.xfail()` in a body or at module level, `pytest.importorskip()`,
`@unittest.skip/skipIf/skipUnless/expectedFailure`, `self.skipTest()`.

**Two dimensions, not one level.** Each marker either *hides* the test
(skip, todo, fixme, non-strict `xfail`, `xfail(run=False)`, imperative
`pytest.xfail()`: nothing is verified) or *inverts* it (strict expected
failure: `it.fails`, jest `failing`, Playwright `fail`, `xfail(strict=True)`,
`unittest.expectedFailure`: the test still runs and an unexpected pass fails
the suite). TG003 fires when a test becomes more hidden than at base, or more
inverted than it was hidden or inverted at base. So `it.fails` → `it.skip` and
`xfail(strict=True)` → `xfail()` fire, while `it.skip` → `it.fails` does not.

**`xfail_strict`.** An `xfail` without `strict=` inherits pytest's
`xfail_strict` option, read from the configuration that applies to the test
file: the first directory, walking up from the file, that has `pytest.ini`,
`.pytest.ini`, `pyproject.toml` with `[tool.pytest.ini_options]`, `tox.ini`
with `[pytest]` or `setup.cfg` with `[tool:pytest]` (in that order of
precedence, as pytest does). Values follow pytest's boolean parsing (`true`,
`1`, `yes`, `on`, …). So with `xfail_strict = true`, `xfail(strict=True)` →
`xfail()` is not a finding, and a bare `xfail` → `xfail(strict=False)` or
`xfail(run=False)` is. Each side of the diff uses its own configuration.
Changing only the configuration (turning `xfail_strict` off) does not bring
the affected test files into the diff and is not reported yet.

**Polarity and constants.** `runIf(c)`, `skipUnless(c)`, the `else`/`elif`
branch of an `if`, the alternative of a ternary and the right side of `||` /
`or` apply when their condition is *false*. A guard that is constant after
polarity decides the marker outright: `skipIf(false)`, `runIf(true)`,
`skipUnless(True)`, `xfail(False)`, `if (false) ctx.skip()` never apply;
`runIf(false)` and `skipUnless(False)` are unconditional.

**Effect.** An unconditional, certain marker is a `fail` only when its runner
guarantees its effect (*Verdicts*; `src/rules/effects.ts`): otherwise a `warn`
that says why. pytest's `xfail` with an argument that restricts it — a
positional condition (even `xfail(True)`), `condition=`, `raises=` — is a
`warn`; with `strict=`, `reason=` or nothing it is a `fail` (an expected
failure), with `run=False` a `fail` whose effect is `not-run`.
`@unittest.expectedFailure` is a `fail` only on a method of a class that
certainly reaches `unittest.TestCase` through bases of the module (the chain
`self.skipTest` uses), and as the method's only decorator; on a plain
function, a class or a decorated method it is a `warn`. node:test's todo is
an expected failure (Node runs the body and reports it todo); Vitest's and
Jest's `todo` are not run.

**Attribution.** Only markers in the certain positions listed in *Certainty
and the marker invariant* are attached to tests. A skip in a helper — called
or not, even if its name is shadowed by a harmless local function of the same
name — in a method, in a callback, or in a hook passed by reference is a
`warn` (*could not be attributed to a specific test*), never a `fail`. An
attached marker whose binding is not certain (*Attribution: the runner's API by
binding*: a global, a local wrapper, a parameter, a helper's export,
`pytest` rebound in the module, an overridden `self.skipTest`) is a `warn` of
TG003 itself that names the test: *adds `it.skip` (skip, unconditional) to test
"adds"; it may skip it: `it` is a global, not imported from a runner*. A test
hidden at base only by such markers and now by a certain one at the same site
is a `warn` too (*now certainly the runner's*).

Each attributed marker is classified by its condition:

| Condition | Example | Severity |
|---|---|---|
| unconditional and certainly the runner's, on a test that ran at base (certainly declared) | `it.skip(...)` with `import { it } from 'vitest'`, `@pytest.mark.skip` with `import pytest` | `fail` |
| unconditional, not certainly the runner's | jest's global `it.skip(...)`, `pytest.skip()` with `pytest` rebound in the module | `warn` (*may skip*) |
| unconditional, on a new test | `it.todo('handles emoji')` | `warn` |
| opaque condition | `it.skipIf(legacyMode)` | `warn` |
| platform / runtime / environment | `skipIf(process.platform === 'win32')`, `skipif(sys.platform == "win32")`, `importorskip` | `warn` (usually legitimate, never `fail`) |
| new marker that disables nothing new | `skipIf(false)`, `.skip` → `.fails` | `warn` |

Findings are grouped per marker site: a `describe.skip` is one finding that
lists every test the suite declares (*adds `describe.skip` … to a suite that
declares 3 tests: …*). A marker site that existed at base with another
condition is reported as *changes the condition of `it.skipIf(true)` … on test
"adds"* (`skipIf(false)` → `skipIf(true)`).

**Does not fire**

- a disabling marker (skip, todo, fixme, an expected failure, `skipIf(c)`,
  `runIf(c)`, …) on tests that **did not exist at base** — no counterpart by
  name, rename or move, and no test of that name in the file at base (with a
  repeated title which test is which is not certain) — or in a test file the
  PR creates: nothing that existed is lost, so it is one `info` line, *adds
  `it.skip` … to new test …, which did not exist at base* (reason `new_test`;
  `TG003/new-test-skip-vitest`, `new-test-skipif-unittest`, `new-file-todo`,
  `new-todo`). The nets read that line: the marker net does not count a marker
  on it, the contagion net reports a disabling use in a new test as an `info`
  line of its own. A focus (`.only`, `fit`) on a new test is TG002's and never
  `info`: it leaves other tests out. A test that replaced a removed one is
  TG001's substitution (`warn`);
- the same marker already existed at base (e.g. only the skip reason changed);
- a skip is removed;
- `skip` in comments, strings, test names or unrelated identifiers
  (a fixture called `skip_db`).

**Known limits.** Early `return` statements and `if (...) return` guards inside
a test body are not skips syntactically; they are TG004's concern (assertions
that no longer run). Condition classification is lexical: a platform check
hidden behind a helper (`if (onWindows())`) is reported as opaque. Skips
performed by helpers imported from other files are invisible; same-file
helpers are only ever a `warn`.

## TG004 Assertion loss and relaxed matchers

**Why it matters.** Deleting the `expect` that fails, or turning
`toEqual(expected)` into `toBeDefined()`, keeps the test "passing" while it no
longer checks the behaviour.

**Always a `warn`, never a `fail`** (*Verdicts*). That a test checks less is
not something the diff proves nor a runner shows: a check can be written as a
guard that throws, a `raise`, a helper, and a call that looks like an
assertion may check nothing (`pytest.raises(X)` with no context and no
callable). The finding describes the code (*removes the assertion call `X`
from test "Y"; it may check less*) and leaves the judgement to the reviewer
(`TG004/guard-instead-of-expect-vitest`, `guard-instead-of-assert-pytest`,
`bare-pytest-raises-pytest`).

**What counts as an assertion** (per test, in its body and the callbacks
inside it):

- JS/TS: `expect(...)` followed by a matcher (`.toBe(1)`, `.not.toBeNull()`,
  `.resolves.toEqual(x)`, chai's `.to.be.true`), `expect.soft/poll(...)` with a
  matcher, `expect.assertions(n)` / `expect.hasAssertions()`, snapshot
  matchers (`toMatchSnapshot`, `toMatchInlineSnapshot`), `assert(...)`,
  `assert.*(...)`, `sinon.assert.*(...)`. A bare `expect(x)` without a matcher
  asserts nothing and is not counted.
- Python: the `assert` statement, `self.assert*(...)` and any other
  `assert*` call (mock `assert_called_with`, `np.testing.assert_allclose`),
  `self.fail(...)`, `pytest.raises(...)`, `pytest.warns(...)`.

Each one carries its binding (*Attribution*): certain for an `expect` /
`assert` statically imported from a runner or an assertion library, Python's
`assert` statement, `pytest.raises()` / `pytest.warns()` through a
module-level import of pytest that nothing in the module rebinds, and
`self.assertX()` / `self.fail()` inherited from `unittest.TestCase` with no
override in the file; uncertain for a global `expect`, a local one,
`pytest.raises()` with `pytest` rebound anywhere in the module, a mock's
`assert_called_with()`, `np.testing.*`.

**Fires when** (per test paired at base and head, following renames and
moves):

| Change | Severity |
|---|---|
| Fewer assertions than at base; lists the ones that are gone (*removes 2 of 5 assertion calls from …*) | `warn` |
| A matcher relaxed on the same subject: `toEqual`/`toStrictEqual`/`toBe(x)` → `toBeDefined`/`toBeTruthy`/`not.toBeNull`; `toHaveBeenCalledWith` → `toHaveBeenCalled`; `toThrow(E)` → `toThrow()`; `assertEqual` → `assertTrue`/`assertIsNotNone`; `== x` → `is not None` / truthiness; `pytest.approx` with a wider `rel` or `abs` | `warn` |
| No assertion left at all, and the body calls something that may assert for it | `warn`: *it calls `<name>`, which may assert for it* |
| No assertion left at all, and the body calls nothing that could assert for it | `warn`: *removes the only assertion call (…) from "x" and leaves no call that looks like one; it may check less* — and why, when the test or the removed assertions are not certainly the runner's (a global `it` / `expect`, `pytest.raises` with `pytest` rebound in the module, an overridden `self.assertEqual`) |
| The assertion calls left are no longer certainly assertions (the runner's `expect` replaced by a local one, even with the same body) | `warn`: *the 1 assertion call left in "x" may not assert: …* |

"Could assert for it" is decided conservatively, from the file alone: a
same-file helper that asserts or calls something unknown (followed
transitively), anything imported from a test-support module (a path with
`test`, `spec`, `helpers`, `fixtures`, `support`, `testing`, `setup`,
`conftest`, `mocks`, … or an assertion library), names like
`expectX`/`assertX`/`checkX`/`verifyX`/`shouldX`, functions that receive
`expect`, `this.x()`, `self.x()` not defined in the class, pytest fixtures
called as functions, and any name that resolves to nothing in the file. Code
imported from elsewhere (the code under test) and language builtins are not.
When in doubt it is a helper, and the message names it.

The matcher comparison is per subject (the argument of `expect(...)`, the
first argument of `assertX(...)`, the left side of `assert a == b`): only a
subject still asserted at head with a weaker matcher is a relaxation. Matchers
are ranked within families (value, calls, throws); anything unranked is not
compared.

**Does not fire (hard legitimate cases)**

- `toEqual` → `toStrictEqual` (stricter), weak → strong matchers;
- a snapshot updated (`.snap` file or `toMatchInlineSnapshot` contents) with
  the same matcher;
- a test split in two: assertions that leave one test and reappear in a test
  added to the same file are not lost; a removed test whose assertions all
  reappear across two or more new tests is reported by TG001 as a split
  (`info`);
- assertions moved into a same-file helper: the `warn` names the helper (the
  test still asserts, through the helper);
- a test turned into a body-less `it.todo` (TG003's finding).

**Safety net.** After all rules, a verdict that would exit 0 is re-checked
with a regex count of assertion tokens (`expect(`, `assert`, `pytest.raises`,
… outside comments and strings) summed over the changed test files. If the
total drops, each file that lost assertions gets a `warn`. This catches
assertions removed from helpers or hooks, which no per-test comparison sees.
Moving a test between changed files keeps the total.

**Known limits.** Helpers imported from other files are not opened (a helper
from `tests/support/` is assumed to assert; one from `src/` is assumed not
to). Loops that generate tests are counted once. Subjects are compared
textually: renaming the variable asserted on hides a relaxation. A loss offset
by unrelated assertions added elsewhere in the same test is not a net loss.

## TG005 Inflated timeouts, retries and reduced suite scope

**Why it matters.** A test that fails because it hangs passes with a 10×
timeout; a flaky or broken test passes on its third retry; and the surest way
to get a green run is to stop running the tests that fail — through the
runner's configuration rather than the test files.

**Files read:** `package.json` (the `test` script and the `jest` field),
`vitest.config.*`, `jest.config.*`, `playwright.config.*`, `pytest.ini`,
`.pytest.ini`, `pyproject.toml` (`[tool.pytest.ini_options]`), `setup.cfg`
(`[tool:pytest]`), `tox.ini` (`[pytest]`), `conftest.py`, plus timeout/retry
settings in the changed test files. JS/TS configs are read statically with
tree-sitter: the exported object through `defineConfig(...)`,
`module.exports`, a top-level `const`, `satisfies`/`as`; only literals are
understood (`...configDefaults.exclude` is expanded to Vitest's defaults).

### Suite scope

> **V0: TG005 never FAILs on scope.** Every reduction of the suite's scope is
> a `warn`. Three rounds of external review with the real runners kept finding
> configurations where the selection model was confidently wrong: a file named
> in `addopts` that pytest runs despite a matching `--ignore`, a Jest
> `--testPathIgnorePatterns` on the command line that replaces the configured
> list, pytest's last `-k` winning over `addopts`, a quoted INI value, a string
> escape, a file whose tests were all skipped anyway. Each of those produced a
> false `fail`. The model stays, but only to make the `warn` specific
> (*likely excludes N test files / tests that ran at base: …*). The `fail`
> will be re-enabled if the benchmark shows the model is right often enough to
> justify it.

| Change | Severity |
|---|---|
| A test file or test that ran at base is, according to the model, no longer selected | `warn`, *likely excludes …* |
| An exclusion is added (`exclude`, `testPathIgnorePatterns`, a file filter in the script, `--passWithNoTests`, `-k`, `-m`, `--deselect`, `--ignore`, `--ignore-glob`, `collect_ignore`, `norecursedirs`, …) | `warn` |
| The inclusion changes (`include`, `testMatch`, `roots`, `testpaths`, `python_files`, script paths) and its effect cannot be evaluated | `warn` |
| Any other change to what affects the tests — a runner configuration file (comments and whitespace included) outside the parts below, the `test`/`test:*` scripts that existed at base and the scripts they run, the test-runner and coverage keys of `package.json` (see *Safety net, configuration files*) | `warn`, *review manually* |
| A change that affects no test: `package.json`'s version, dependencies, other scripts or a script the PR adds; a `package.json` inside a test fixture directory; the project metadata of `pyproject.toml`, `setup.cfg`, `tox.ini` (outside their pytest, coverage and tox sections); a vite or vitest config's module resolution, plugins or dev server (outside `test` and `root`), and an inline project's own `resolve`/`define`/`plugins` | — |

**How the model estimates a loss.** For each changed configuration file, the
runner's selection is computed three times over the real file tree
(`git ls-tree`): at base, at base with only this file taken from head, and at
head. A test file is likely lost when it is selected at base, not selected with
the change alone, not selected at head (following renames), and both versions
contain tests. For pytest's `-k` and `--deselect`, the same is done per test.
Only tests that ran at base count: no skip/todo/fixme/xfail marker of any kind
and not left out by a `.only`; excluding a file whose tests were all skipped
says so instead. Each runner is modelled on its own semantics:

- **Vitest**: `test.include` / `test.exclude` (defaults
  `**/*.{test,spec}.?(c|m)[jt]s?(x)` and `**/node_modules/**`, `**/.git/**`)
  as picomatch globs with `dot: true` relative to the config's directory;
  `--exclude` on the command line is added to `exclude`; positional filters
  keep files whose lower-cased relative path contains the filter.
- **Jest**: `testMatch` (default
  `**/__tests__/**/*.?([mc])[jt]s?(x)`, `**/?(*.)+(spec|test).?([mc])[jt]s?(x)`),
  `roots`, and `testPathIgnorePatterns` (default `/node_modules/`) as regular
  expressions; `<rootDir>` is anchored to the project directory.
- **pytest**: paths in `addopts`, else `testpaths`, else the rootdir;
  `python_files` (default `test_*.py *_test.py`) and `norecursedirs` with
  fnmatch; `--ignore` (a path and everything below it), `--ignore-glob`,
  `collect_ignore` / `collect_ignore_glob` of every `conftest.py` (relative to
  the conftest); `--deselect` as a node-id prefix; `-k` with pytest's grammar
  (`and`, `or`, `not`, parentheses; case-insensitive substring match against
  the directories below the rootdir, the module file, classes, the function
  and its marks).

**The model gives up — a plain `warn` without a count — when it cannot tell:**
a value that is not a literal (`exclude: getExcludes()`), a config built with
`mergeConfig`, `projects`/`workspace`/`root`/`dir`/`preset`/`testRegex`,
globs with `!(…)` or ranges, `testMatch` patterns that are neither `**/…`
nor `<rootDir>/…`, Jest positional patterns (regular expressions over
absolute paths), `-t`/`--testNamePattern`, `-m` expressions, an `addopts`
word we cannot classify, a `collect_ignore` computed under a condition, a
`-k` identifier that matches nothing we can see while a `conftest.py` exists
or the test is parametrized, a runner not known to run the project at base,
Playwright's `testDir` / `testMatch` / `testIgnore` / `grep` / `projects`, the
test script passing the same option on the command line as the configuration
that changes, a `package.json` test script that runs pytest with its own
`-k`/`-m`/`--deselect`/`--ignore`/paths, a JS string with an escape we do not
decode (octal; `\u…`, `\x…` and the simple escapes are decoded), and an INI
list value with quotes or backslashes. `--passWithNoTests` alone excludes
nothing: it warns because an empty selection would now pass.

**Assumptions.** pytest is run from its rootdir (the directory of the
configuration) without extra path arguments, so `testpaths` and relative
`--ignore` paths resolve there; the test script's arguments are those of the
`test` script (a script that calls another script is treated as having no
arguments).

### Timeouts and retries

Neither changes which tests run, so both are `warn` only.

| Setting | Where | Default compared against |
|---|---|---|
| Test timeout raised to ≥ 3× (or to `0`, no timeout) | `it('x', fn, ms)`, `{ timeout }` options, `jest.setTimeout`, `vi.setConfig({ testTimeout })`, `test.setTimeout`, `test.describe.configure({ timeout })`, `this.timeout`, `testTimeout` in Vitest/Jest configs and CLI, Playwright `timeout`, `@pytest.mark.timeout(s)`, pytest-timeout `timeout` / `--timeout` | the base value, else 5 s (Vitest, Jest), 30 s (Playwright files and config), 2 s (`this.timeout`); pytest-timeout and node:test (a file that imports or requires `node:test`; its default is Infinity) have no default, so a timeout set there with no base value is a limit where there was none, not reported (a new pytest timeout is compared only with the ini `timeout`) |
| `test.slow()` added | Playwright | always (it triples the timeout) |
| Retries added or raised | `{ retry }` options, `jest.retryTimes`, `test.describe.configure({ retries })`, `this.retries`, Vitest `retry` / `--retry`, Playwright `retries`, `@pytest.mark.flaky(reruns=n)`, `@flaky(max_runs=n)`, `--reruns`, `reruns` | the base value, else 0 |

A test-level setting is compared with the same test at base (following
renames); file- and suite-level settings with the same structural position.

**Values that cannot be read** are reported by TG005 itself (`warn`) when
they are new or change: test options passed through a variable
(`it('x', opts, fn)`), `jest.setTimeout(TIMEOUT)`, `it('x', fn, TIMEOUT)`,
`retries: process.env.CI ? 2 : 0`.

**Safety net, test files.** Before an exit 0 (`OK`), runner timeout/retry calls and
pytest marks (`jest.setTimeout(`, `test.slow(`, `.retryTimes(`,
`mark.flaky`, `mark.timeout`, …) are counted by regex in each changed test
file, minus those the extractor attributed; an increase is a `warn`. Option
keys such as `{ timeout: 1000 }` are not counted: they are just as often test
data (an HTTP client's options).

**Safety net, configuration files.** Two separate decisions:

- **What the net watches** is an explicit, documented scope decision. Every
  recognised runner configuration file as a whole — `vitest.config.*`,
  `jest.config.*`, `playwright.config.*`, `pytest.ini`, `.pytest.ini`,
  `pyproject.toml`, `setup.cfg`, `tox.ini`, `conftest.py`; vitest's other
  configuration, which TG005 does not read: `vitest.workspace.*` (`ts`, `js`,
  `mts`, `cts`, `mjs`, `cjs`, `json`), project configs `vitest.<name>.config.*`
  (what `test.projects` points at), and `vite.config.*` / `vite.<mode>.config.*`
  **always**: neither what the file contains nor what the repository depends on
  decides it (a dependency can be written `"\u0076itest"`, a monorepo may name
  vitest only at its root) — and, in
  `package.json`, the scripts that run tests: `test` and `test:*` as they were
  at base, their `pre`/`post` hooks and every script their text names, to a
  fixed point (`"test": "npm run t"` watches `t`); and the test-runner and
  coverage keys `jest`, `vitest`, `mocha`, `ava`, `c8`, `nyc`. The rest of
  `package.json` (the version, dependencies, `type`, `engines`, other scripts,
  a script the PR adds: it loses no test) is out of scope, as is a
  `package.json` inside a test fixture directory (`fixtures/`, `fixture/`,
  `__fixtures__/` at any depth: test data). That exclusion relies on locating
  the sections with certainty; when that fails, the whole file is watched.
- **Only what affects the tests** (noise round, `src/config/testscope.ts`).
  In `pyproject.toml`, `setup.cfg` and `tox.ini`, only their pytest and
  coverage sections (`[tool.pytest.*]`, `[tool.coverage.*]`, a root
  `tool.` key; `[tool:pytest]`, `[coverage:*]`; `[pytest]`, `[tox]`,
  `[testenv*]`) are compared, as written; a key before any section in an
  INI file makes the whole file count. In a vite or vitest config, the
  values of the settings that select no test — `resolve`, `define`,
  `plugins`, `server`, `build`, `css`, … at the top of the exported object,
  and the same keys of an inline project in `test.projects`/`test.workspace`
  — are blanked with the comments right above them, and so is an import
  whose names are used only inside them (a plugin, `fileURLToPath` for an
  alias; an import that binds nothing still counts); the rest is compared
  byte for byte: the `test` section,
  `root`, and any statement outside the object (`config.test.retry = 2` after
  `defineConfig` still counts). A config whose object cannot be located with
  certainty (not `export default defineConfig({…})`, `export default {…}` or
  `module.exports = {…}`, a syntax error) is compared whole. TG005 compares
  `test.projects` the same way (an inline project's `resolve.alias` selects
  nothing).
- **Names are compared without case**, on every platform: on a
  case-insensitive file system (Windows, macOS) `PYTEST.INI`, `VITEST.CONFIG.TS`,
  `Jest.Config.js`, `CONFTEST.PY` or `PACKAGE.JSON` is the runner's file
  (checked with the real runners there: fixtures `TG005/case-*`).
- **How it compares what it watches**: within the scope above, nothing is
  normalised or interpreted to save warnings. A watched file **created, deleted or renamed**
  is always a change (whatever its bytes and whatever its sections: a
  `package.json` renamed with identical bytes, created with no watched key, or
  deleted with its scripts all warn), in every net — vitest, vite, jest,
  playwright, pytest, `conftest.py`, `package.json`. A watched file that stays
  in place is compared byte for byte within its scope, as git reports it:
  comments and whitespace count. In `package.json`, the
  watched sections are located with a positional parser and their **raw
  text** is compared byte for byte between base and head (whitespace and key
  order inside them count). If the sections cannot be located with certainty
  on either side — the file does not parse as strict JSON, starts with a
  byte-order mark, has a duplicate key at any depth, a key written with
  escapes, content after the object, or bytes that are not valid UTF-8 — the
  net falls back to the dumb rule: any byte change to `package.json` warns.

  Comparing parsed values is an interpretation too. An earlier version
  compared the sections as `JSON.parse`d values; external review found two
  changes with a real effect that it hid: a byte-order mark on both sides
  (npm accepts it, `JSON.parse` rejects it, and both sides were read as
  `{}` while the delegated script `t` changed and tests stopped running),
  and c8's `lines` threshold going from `1e309` to `null` (`JSON.stringify`
  writes both as `null`).

A watched change on which TG005 reported nothing is a `warn` *test runner
config changed; review manually*, whatever the verdict.

Why bytes and not content: every normalisation is a way to hide a change with
a real effect. An earlier version compared the files without comments and
insignificant whitespace; external review then showed, with the real runners,
three changes it hid — `config.test.retry = [].length` → `[,].length` (the
elision comma read as a trailing comma: one retry), `norecursedirs =
"legacy  tests"` → `"legacy tests"` (spaces inside INI quotes: pytest stops
collecting a directory), and `# coding: latin-1` → `# coding: utf-8` in
`conftest.py` (a coding declaration read as a comment: the file decodes
differently and `collect_ignore` changes). Format-only changes to test
configuration are rare, so a `warn` for them costs little. The price is a
`warn` for every harmless change to a watched file too (a new reporter, a
`coverage.exclude`, a stricter timeout, a new `build` script).

The counts of `retry`, `retries`, `reruns`, `timeout`, `ignore`, `exclude`,
`include`, `roots`, `testpaths`, `testMatch`, `testPathIgnorePatterns`,
`passWithNoTests`, `-k`, `--deselect`, `--ignore`, `collect_ignore`,
`addopts` and `bail` only detail the message; they never decide whether to
warn.

**Hard legitimate cases (fixtures):** all of them `warn`, never `fail`,
and the runner evidence confirms nothing stopped running: test files moved
together with `include`, an exclusion that matches no test (a directory of
JSON fixtures, an `--ignore` of a data directory), a file whose tests were
all skipped, a Jest or pytest option on the command line that overrides the
configuration, unrelated config changes (`environment`, `reporters`). A
timeout doubled in a test file is no finding. A change of comments or
whitespace only in a config is a `warn` (the net compares bytes).

**Known limits.** `vite.config.*` (Vitest's fallback config), Vitest
workspaces and projects, Jest `projects`, tox `commands`, CI workflow files
and environment variables (`CI=true` options, `VITEST_*`) are not read.
Changing a pytest config that is not the effective one (a `setup.cfg` next to
a `pytest.ini`) has no effect on the selection and is not reported.

## TG006 Suite claimed to pass: what the visible evidence shows

Needs the agent's session: `check --transcript <file> [--agent auto|claude|codex]`
(a Claude Code JSONL or stream-json, a Codex `exec --json` stream or rollout
from `~/.codex/sessions`) or `check
--evidence <evidence.json>` ([evidence/v2](evidence.md)). Without either, TG006
and TG007 are *not evaluated*. **Experimental.**

**Claims are warnings for the reviewer.** Whether a claim is true cannot be
certified from outside the runner: an npm script may run anything, a child
process may outlive its call, a hook may edit files, the tree may change while
the tests run. Ten rounds of review showed that certainty deduced from what a
transcript shows does not converge, and on real session history the FAILs it
allowed never fired. So TG006 is **at most a `warn`, in every mode** — a
transcript and `--evidence` alike, `saidvsdid run`'s evidence included —
and **never a PASS**:

- `warn`: what the visible evidence shows, described as facts, without
  accusing — "last visible test run failed: `npm test` (exit 1, 5 passed, 1
  failed)", "no test run visible after the last edit: `src/a.ts` was edited
  after `npm test` (…)", "no test run visible", "output truncated: …", a run
  in another directory, a filtered run, an edit in flight at the claim. What
  holds only in some orders of the events says why it is not certain;
- `info` *consistent_unverified*: "consistent with what is visible, not
  verified: the last visible test run … came after the last edit";
- `info` *disclosed*: the agent said the tests were not rerun, and edits after
  the last run are all there is.

Only a recorder inside the runner could verify a claim (backlog: a vitest
reporter and a pytest plugin that hash the files the run really loaded).

**Every end of turn is read.** An end of turn is the agent's last message
before the next user input (or before the end of the transcript). Each one
that claims the suite passes gets its own TG006 finding (*End of turn 2 of
3: …* when there are several), read with the runs and edits recorded **up
to that message** — the granularity of a Stop hook.

A subagent ends only with its definitive completion event; a child event (one
of its records in this transcript) does not end it; without that event — no
format records one — it lasts to the end of the trace. An MCP tool is opaque
whatever it declares (`readOnlyHint` is the server's word, not the harness's).

Each finding carries a machine-readable `reason`: its first warn reason,
`consistent_unverified` or `disclosed`.

### Evidence about other code: not evaluated

An evidence file is about some code; `check` reviews `base..head`. Before any
rule reads it, `--evidence` is compared with the reviewed code (`bindEvidence`,
`src/check.ts`; `test/evidence-binding.test.ts`, fixtures `TG006/evidence-*`):
a `repo.base` or `repo.head` (non-null) that is not the reviewed commit, or a
run whose `tree_sha` (non-null) is not head's tree, makes TG006 and TG007 **not
evaluated**: a `warn` each, reason `evidence_mismatch`, with what differs; no
rule reads the evidence (no claim context on the diff's findings). One run on
another tree is enough, even beside one on head's tree. Evidence that matches
is read like a transcript: nothing in it verifies a claim. `saidvsdid run`
records `tree_sha` (the working copy's tree) and `repo.head` only when the
working copy is exactly HEAD's tree, so a mismatch can be seen.

### The certainty principle, applied to claims and to evidence

What the agent said and what the runs showed are read with the same
principle. It decides the wording, never more than a `warn`. It is
**symmetric**:

- a claim is **promoted** to certain only with certainty; in doubt, it is
  possible;
- a claim is **annulled or qualified** only with certainty; in doubt, it does
  not disappear: it becomes possible. A claim is never dropped because of
  ambiguity;
- a possible claim with contradicting evidence is a `warn`, like a certain one.

So no ambiguity silences a warning.

**Claims: a monotonic extractor.** Each end of turn is searched for a suite
claim, in English and Spanish ([evidence.md](evidence.md#claims) has the
format). The extractor is **monotonic**: adding text to a message can only
lower a claim's certainty, never remove it, so added text never turns a `warn`
into silence (`test/claims-adversarial.test.ts` checks this
property over every adversarial phrase of the reviews). The one exception is
a disclosure, below, and it only excuses what it discloses.

Sentences are read as written, not as lines: a line that does not end a
sentence (`.`, `!`, `?`) or introduce a block (`:`) continues on the next
one, so `Please verify that\nall tests pass.` is one sentence (code lines join
only among themselves; when a heading, quote, list or code marker keeps two
lines apart in the middle of a sentence, the joined reading is also read, as
a possible claim; a sentence also ends at a closing quote after `.`/`!`/`?`).

- **certain** only in a strict **canonical form**: the whole sentence is the
  global claim and nothing else ("All tests pass.", "All 12 tests passed.",
  "The test suite passes.", "12/12 tests pass.", "Todos los tests pasan.",
  "Pasan los 12 tests.", "La suite completa pasa."), and
  - it is alone on its line: no other sentence, no list marker, not the end
    of a sentence that started on the line before;
  - it has no parentheses, dashes, quotes or backticks;
  - no heading comes anywhere before it: a line ending in `:` or a Markdown
    `#` heading, however many blank lines follow;
  - the **message** contains no marker of a condition, a quotation, an
    example or another time anywhere: "if", "provided", "as soon as", "once",
    "when", "unless", "should", "expected", "example", "e.g.", "says",
    "before", "earlier", "initially", "si", "en cuanto", "cuando", "una vez
    que", "debería", "esperada", "ejemplo", "dice", "antes",
    "anteriormente", "previous", "anterior", a blockquote, a code fence,
    double or angle quotes… (`This was the result before the edit.\nAll tests
    passed.` is possible), nor a **request or a verification** addressed to
    the reader: "please", "verify", "check", "make sure", "ensure",
    "confirm", "por favor", "comprueba", "verifica", "revisa", "asegúrate",
    "confirma" (`All tests pass.\nPlease check the README wording.` is
    possible);
  - no other sentence says tests are failing now.
- **possible**: anything else that reads like a suite claim. Counts ("7
  passed", "En local pasan los 562 tests", "148/148 tests superados"),
  partial scopes ("all unit tests", "pruebas seleccionadas"), the past
  ("passed before the refactor"), hedges, conditions, requirements, quotes,
  headings, and **negations, exceptions or asides in the same sentence** ("All
  tests pass except one.", "All tests pass and no production files were
  changed.", "Not sure, but all tests pass."): a claim is never dropped, only
  lowered.
- **disclosed**: the message says explicitly that the tests were not run
  again ("not rerun", "I did not run/execute them after the last edit", "the
  test status is unverified", "untested", "no los he vuelto a ejecutar", "no los
  ejecuté después", "sin verificar"). An exemption about something else ("I did
  not run the production migration") discloses nothing.
- **none**, only for a **direct negation of the claim's own predicate**,
  attached to the tests and bearing on **passing or failing**: "not all tests
  pass", "not every test passes", "no todos los tests pasan", "no pasan todos", "2 tests fail", "fallan 2 tests", a count with a
  fail verb whose subject is the tests of the same sentence ("6 tests pass; 1
  fails because…", "331 pruebas aprobadas; 2 fallan": tests counted before it,
  nothing after the verb giving it another subject), or a ratio below its
  total attached to the tests or their verb ("6
  of 7 tests pass", "1/2 tests passed", "Tests: 1/10 passed", "Pasan 1 de 2
  pruebas"); or a question. With another predicate the claim stays: "All tests
  pass; not all tests are integration tests.", "All tests pass; 1/2 tests are
  integration tests." are possible claims. A negation or a ratio about something else keeps the claim: "All
  tests pass and not all documentation is updated.", "All tests pass; 1/2 of
  the documentation is translated.", "All tests pass on 1/10." are possible
  claims (not canonical: the sentence says more than the claim); so is a fail
  verb in another sentence or with another subject ("All tests pass, but 1
  fails intermittently in lint.", "1 failed lint rule remains").

The certainty shows in the statistics and in the wording, not in the
severity. A **disclosed** claim is `info` *disclosed* when the only thing to
report is edits after the last run (what it discloses); anything else (no run
at all, a failed run, a run with no summary) is still reported, as a `warn`.

**Runs: what a run proves, the runner says.** Only the runner's own summary
says what a run showed; an exit status alone proves nothing (a command that
was not found, `CI=1 npm test` in PowerShell, a crash before the runner
started all exit non-zero):

- **failed** only when its output holds a recognised runner summary (vitest,
  jest, pytest) that reports failures — whatever its exit status (`vitest run
  || exit 0`);
- **passed** only when the summary is complete and **coherent** (each count
  line adds up to its own total: vitest's `Tests  2 passed | 3 skipped (5)`,
  jest's `Tests: 5 passed, 5 total`), at least one test passed, none failed,
  and the exit status is 0 or unknown only because of a pipe (`npm test 2>&1 |
  tail -20`, the usual shape of Claude Code's runs);
- **partial** when the summary itself shows that not every test was selected
  (pytest's `3 deselected`, `no tests ran`): a `warn`, like a filtered run;
  so is a run from a **subdirectory** of the repository: which project and
  which tests it ran depend on the runner's configuration lookup (the nearest
  `package.json`, vitest's root, pytest's collection from the working
  directory), which is not modelled — only a run from the repository's root
  proves the whole suite (a failure anywhere is still a failure);
- **unknown** otherwise: no recognised summary (a script that `echo`es, `vitest
  list`, a command not found, output truncated before its summary), zero tests
  run, a green summary with a failing exit status, or an exit status decided by
  another command (`pytest; git diff`), backgrounded or lost. Unknown shows
  nothing either way.

**There was no run** only when every call before the claim is certainly not
one: a non-execution from a closed list (reading, listing, searching, `git
status`/`diff`/`log`, `cd`…) or a tool that neither runs nor edits, and no
opaque call. Any other call — a script (`bash verify.sh`, `./check.ps1`), a
command outside the read-only list, an MCP tool, a subagent — is a **possible
run** whose result is unknown: *no recognised test run*, a `warn` that says so.

The claim is judged against the runs and edits of the transcript, **in the
order they appear in it** — never by timestamps: clocks in transcripts are
coarse, per-machine and sometimes missing, while the order of the agent's tool
calls is exact.

**A run and an edit each have a start and an end.** A tool call starts where
the agent made it and ends where its result appears: Claude Code's `tool_use`
and `tool_result`, Codex `exec`'s `item.started` and `item.completed`. A
Codex rollout records an item only when it completes, so it may have started
anywhere inside the model's `exec` call that ran it (from the earliest call
still open; with none open, a command that outlived its call, anywhere in the
turn). A background command, or one that never reported a result, may run
until the end. The files a Bash command reports changing (`bashEditDiff`)
take the whole interval of its call: which segment wrote them is not known.

**One temporal model.** Every run and every edit is an interval
`[seq, seq_end]`; the claim is a point `c`. For a claim at `c`:

- only what **ends** before `c` certainly came before it;
- what starts before `c` and ends after it was **in flight**: it may be on
  either side of the claim;
- nothing that **starts** after `c` bears on it — no future evidence, nothing
  retroactive.

The claim is judged in **every order of the events compatible with their
intervals** (an event can come before another only if it starts no later than
the other ends). In one order the claim is true when the last run before it
passed and no relevant edit lies between that run and the claim. Then:

- a `warn` stated as a fact (`contradicted`) only when the claim is false in
  **every** order ("last visible test run failed");
- `info` (consistent, not verified) only when it is true in every order;
- a `warn` that says why it is not certain when the orders disagree: runs that overlap with different results
  (A starts, B starts and passes, A ends failing), a run or an edit in flight
  at the claim, an edit that overlaps the last run (calls made in parallel, a
  patch and the tests in one Codex `exec` program, a shell command that
  reported changing files around or inside the run's call).

`test/temporal-property.test.ts` holds this as a property: thousands of
random traces (fixed seed) of 4–6 events with overlapping intervals and shared
endpoints, each compared with a brute-force oracle that enumerates every
compatible order. If the claim is false in some order TG006 never says
"consistent"; if it is true in some order it never states a contradiction as
a fact; it is never more than a `warn`.

**Which files matter** is an explicit list, never interpreted: only
documentation is irrelevant — `*.md`, `*.rst`, `docs/**`, `LICENSE*`,
`CHANGELOG*` — and never inside a test or fixtures directory (`test/`,
`tests/`, `__tests__/`, `spec/`, `specs/`, `fixtures/`, `__fixtures__/`,
`testdata/`, `__snapshots__/`), where any file may be test data. Any other
file in the repository (`.txt`, `.json`, images, CI files, test data) is a
relevant edit — once it is placed in the repository (below).

### Location: certainty only inside a closed grammar; the oracle is the real system

A run or an edit counts for the repository under review only when exact,
deterministic resolution proves where it happened, and only when its form is
in a **closed, explicit grammar**. Everything outside it is **unplaced**:
uncertain: its result is unknown for the repository, never stated as a fact. Shell
commands and file systems are not interpreted from a list of dangerous forms
(each review found a new one): the grammar says what is understood, and it is
widened only with data and a test against the real system.

- **Runs** (src/transcript/grammar.ts). A shell call places a test run only if
  the **whole call** is

  `[cd <literal path> &&] [VAR=value ...] <runner> <args> [2>&1] [| tail|head|grep|tee ...]`

  where the literal path has no variable, `~`, glob, `$( )` or backquote; a
  `VAR=value` prefix is allowed only in POSIX shells and only for a closed list
  of variables that change no test selection or configuration: `CI` and
  `FORCE_COLOR`, the prefixes the local Claude Code and Codex history shows
  before a test runner (176 and 4; the others, `PYTEST_ADDOPTS`, `VITEST_*`,
  `NODE_OPTIONS`, change what runs) — in PowerShell `VAR=v cmd` is not an assignment but a command
  named `VAR=v`, so it is outside; a filter reads **only from the pipe**: `head`
  and `tail` take only numeric flags (`-20`, `-n 5`, `--lines=5`), `grep` takes
  exactly one pattern and the flags `-E -F -i -v -w -x`, `-A/-B/-C/-m N`,
  `-e PAT`, `--color`, `tee` takes files and `-a` — a file argument (`tail -5
  old.log`) reads that file instead, so the run is outside; PowerShell's
  `Set-Location`/`cd` without `-LiteralPath` reads `[`, `]`, `*`, `?` as a
  wildcard (`cd 'sub[1]'` enters `sub1`), so such a path is outside; the
  runner is a recognised test command (`npm`/`pnpm`/`yarn`/`bun test` or a
  script, `npx vitest`, `vitest`, `jest`, `pytest`, `py.test`, `python -m
  pytest`, `playwright test`); its arguments are flags from the runner's
  allow-list (`-t`, `-k`, `-m`, `-x`, `-q`, `-v`, `--run`, `--reporter`,
  `--project`, `--tb`, …) and positional paths that resolve inside the
  repository. Quotes are read as the shell reads them: single quotes are
  literal; inside double quotes an escape makes the next character literal
  (`grep -E "a\|b"`, `"say \"hi\""`) while `$` and a backquote expand, so
  they leave the call outside. The grammar is read only for the shells the
  real-system oracle runs: bash, and PowerShell (pwsh 7 and Windows
  PowerShell 5.1, which Codex uses on Windows). In PowerShell the escape is a
  backquote, and before a letter or a digit it is a special character (``n`,
  ``r`…), so it leaves the call outside; typographic quotes and dashes, `@`
  (splatting) and `,` (arrays) leave it outside too. `cmd.exe`, which no
  oracle runs, is entirely outside. Any other flag (`--prefix`, `--rootdir`, `-C`, `--config`,
  `--root`, `--dir`, `-c`, an unknown one) and anything else in the call
  (`;`, `||`, another `&&`, subshells, `pushd`/`popd`, conditionals, other
  redirections, more than one runner) leave the run unplaced: its result is
  unknown (*ran in a directory saidvsdid cannot establish*). The run's
  directory is the call's, then its `cd`; it must be inside the repository's
  root.
- **The session's working directory.** Claude Code's Bash keeps its working
  directory from one call to the next (its documentation: "the working
  directory persists between commands"), so it is followed call by call: a
  `cd <literal path>` in the grammar that succeeded (exit 0) moves it; a call
  outside the grammar that may move it (`cd`, `pushd`, `popd`, `source`,
  `eval`, a subshell, an expansion) leaves it **unknown** until a `cd` to an
  absolute literal path. A Codex rollout records the working directory of each
  command (as a `file:` URI, read exactly); a `cd` inside a command lasts only
  for it. Codex `exec --json` records none — its shell tool may run a command
  in another `workdir` — so its runs are **always unplaced, even with
  `--cwd`**; `--cwd` places only what the stream records relative to the
  session (the paths of its patches). `codex exec` also writes the session as
  a rollout (`~/.codex/sessions/…/rollout-…-<session id>.jsonl`): check that.
- **Roots.** Only paths under the repository's root (`--repo`, as git
  reports it; the `<REPO>` marker of recorded sessions) are placed: no
  matching by suffix, and the session's working directory is not a root. The
  root's own components must match exactly, except the drive letter.
- **Path components.** Every component must be **ordinary on Linux, macOS and
  Windows**, from a closed set of characters: letters, digits, `.`, `_` and `-`
  (`[A-Za-z0-9._-]`, widened only with data). Spaces, brackets, `*?` (wildcards
  in PowerShell paths), `:` (a stream on Windows), `~` (short names), `\`,
  unicode and control characters are outside; within the set, a trailing dot
  (Windows drops it: `docs.` is `docs`) and reserved device names (`CON`,
  `NUL`, `COM1`, … with any extension) are outside too. A path is placed only if it names the same file on a
  case-sensitive and a case-insensitive file system, resolved one component at
  a time in base and in head, with no symlink or submodule on the way and no
  `..` after something that is not a known directory.
- **Opaque calls.** Every tool call that is not in a closed list of known
  tools that do not edit (Claude Code's `Read`, `Grep`, `Glob`, …; Codex's
  `wait`, `sleep`, …) is opaque — an MCP tool, a subagent (`Task`,
  `spawn_agent`), Codex's `js`, an unknown tool. It is an uncertain edit and a
  possible run that spans from its call **to the end of the trace**: its
  result is not its end (an MCP server or a subagent may go on working; a
  response may be a handle — an id, `status: running`), and no tool is on a
  list of synchronous tools yet (one would need the format's documentation to
  say so). A subagent ends only with its completion event, and the formats
  record none. TG006 sees it that way: it may change the files after the claim.

**Unknown is a type, not a null.** A working directory, a run's location and
a run's outcome are each known or unknown with a reason (a discriminated
union), never defaulted to something else: a rollout call whose directory
cannot be decoded as a local path (`file://host/…`) is unknown, never the
session's. `test/no-unknown-fallback.test.ts` fails if `??` or `||` is applied
to one of them in the source.

An unplaced edit is an **uncertain** edit: between the last run and the claim
it is a `warn`. Symlinks and submodules are read from git, so they are known
only when `check` runs on a repository; without one (`scan-history`,
`evidence from-transcript` with no commits) no directory is known, so any `..`
is unplaced, and each session's own working directory is its root.

**Oracles.** Model-based property tests check the code against an enumeration
(`test/location-property.test.ts`: random repositories and paths resolved the
POSIX way on both kinds of file system; `test/temporal-property.test.ts`).
Because a model shares the code's assumptions, two more tests take the
**real system** as the oracle:

- `test/shell-cwd-real.test.ts` runs sequences of calls generated from a
  grammar much wider than the one placed (subshells, `;`, `||`, pushd/popd,
  variables, conditional `cd`, `cd -`, several calls in a row) in one real
  bash, with the runners replaced by scripts that record where they ran:
  every run must be unplaced or placed exactly there (Linux, macOS, and
  Windows with Git Bash). A PowerShell mode does the same with a real `pwsh`
  on the three systems and Windows PowerShell 5.1 on Windows, generating
  Set-Location/cd/Push-Location/Pop-Location, `;`, `&&`, `||`, single and
  double quotes, backquote escapes, `$var` and `$( )` in double quotes,
  scriptblocks (`& { }`, `. { }`), typographic quotes, `@` and `,`;
- `test/location-fs-real.test.ts` writes through generated paths (`.`, `..`,
  case variants, trailing dots and spaces, reserved names, short names,
  streams, a directory symlink) on the real file system of each OS in the
  matrix — on Windows through Node's fs and through cmd.exe, which normalise
  paths differently — and looks up the file that really changed: every path
  must be unplaced or name exactly that file.

And one takes reality as the oracle **end to end**:

- `test/e2e-real.test.ts` generates random sessions of 3–8 steps on real toy
  repositories (`bench/toy`: vitest and pytest), runs them for real in bash
  and in pwsh — runners with and without flags, `CI`/`PYTEST_ADDOPTS`/
  `VITEST_*` variables, filters with and without a file, scripts that call the
  runner, commands that do not exist, `cd` into another checkout, a nested
  project and odd directory names, edits that break or fix the tests,
  documentation edits, `git stash`/`checkout`, logs holding old summaries,
  subagents that act out of sight and Codex calls recorded on another host —
  and writes what really happened as a Claude Code transcript (persistent
  shell) and a Codex rollout (a directory per call) ending in "All tests
  pass.". The truth is R's full suite, run clean at the claim and judged by
  the runner's own record of that run (exit 0, ≥ 1 passed, 0 failed; never by
  reading its output, which a CI may colour); the runners
  also record every real run (a vitest reporter, a pytest hook). Whatever
  really happened, TG006 and TG007 never FAIL (at most a `warn`), never say a
  claim is verified, a TG006 `info` is *consistent_unverified* or *disclosed*,
  the verdict is never PASS, and a FAIL in the report comes from a diff rule
  alone (the same diff without the transcript fails too). Its sessions include
  the shapes that once FAILed on purpose: nothing run, an edit and nothing
  after, a failing run exactly as the runner — with real failures, and with a
  test that prints a forged summary, green or red — and hooks and
  background processes as categories: a PostToolUse hook that really runs the
  suite after each edit, a Stop hook, recorded or not (Claude Code's stream
  with or without --include-hook-events; Codex never), and a call that sends
  the suite to the background with `&`. CI runs a fixed
  seed (2 sessions per toy × agent × shell);
  `SAIDVSDID_E2E_SESSIONS=<n>` runs more, `SAIDVSDID_E2E_LOG=<file>` records
  each session and the totals. Each session also draws **its environment**,
  the same wherever the test runs: no agent, an agent vitest detects
  (`CLAUDECODE`, `AI_AGENT`: its `agent` reporter, the format of real agents'
  transcripts), forced colours, a CI, and pytest's `PY_COLORS`; and **its
  shape**: free, the shape of a consistent claim (a full green run in R after
  the last edit), or near it with the suite really failing
  (a green partial run, an old log, a subdirectory, the other checkout, a
  remote call, an edit or a shell write after the run, a failing run as the
  environment prints it). A monthly job (`.github/workflows/
  monthly.yml`, the first Sunday after main changed) runs the long mode (96
  sessions) on Linux, macOS and Windows with a new seed each time,
  printed in its log and summary; `workflow_dispatch` reruns a given seed.

### What TG006 says

| Visible evidence | TG006 |
|---|---|
| No test run visible before the claim: every call is certainly not one (see *There was no run*) | `warn` *no_test_run* |
| The last visible test run failed: its runner's summary reports failures | `warn` *last_run_failed* |
| A certain edit of any file but documentation between the last test run and the claim in every order | `warn` *edited_after_last_run* ("no test run visible after the last edit") |
| The last run's output was cut by the harness | `warn` *output_truncated* |
| Overlapping runs with different results, or a run still running at the claim | `warn`, with why it is not certain |
| The last run is uncertain (see above), or unplaced: its call outside the closed grammar, its working directory unknown (Codex `exec` without `--cwd`, a Claude Code shell moved outside the grammar) or outside the repository | `warn` |
| A certain edit that overlaps the last run, or one still in flight at the claim | `warn` |
| Only **uncertain** edits after or during the last run: a shell command that may write, a tool whose effects the transcript does not show, an unplaced edit | `warn` |
| The last run was filtered, its selection is unknown, its summary shows a deselection, or it ran in a subdirectory | `warn` |
| Only possible runs: calls that are not certainly non-executions (`make test`, `tox`, a script, an unknown command, an opaque tool) | `warn` |
| The transcript has content the adapter cannot see into (an unknown record, item or tool, an MCP tool, a subagent whose calls are in another file) | `warn` *incomplete_transcript* |
| The last run of the whole suite is consistent with the claim, after the last edit | `info` *consistent_unverified* |

The claim's certainty changes the wording, not the severity; with a
**disclosed** one, edits after or during the last run are `info` and the rest
is a `warn`. Edits to documentation (see above) after the run are ignored.

Recognised test commands: `npm test` (always: it is the project's test
command), `npm run x` / `yarn x` / `pnpm x` when the script calls vitest,
jest, playwright or pytest (following `npm run` delegation), `npx vitest`,
`vitest`, `jest`, `playwright test`, `pytest`, `py.test`, `python -m pytest`
(`python3`, `py`, a venv's python). The launcher agents wrap commands in (`bash
-lc`, `powershell.exe -Command`, `cmd /c`) is removed first.

### Claim context on tampering findings

When the agent's **last turn** says the suite passes (any certainty) and the
same diff has a finding attributed **with certainty** of

- TG001: a test deleted — not renamed, moved, split or substituted — or a test
  file deleted;
- TG003: an unconditional skip / todo / fixme / non-strict xfail on a test
  with a body;
- TG004: assertions removed or relaxed (not "assertions may live in a helper"),

that finding **keeps its own severity** and adds, as context, *(the agent also
claimed tests pass: "…")*. A claim never raises another rule's severity (there
is no escalation), and an earlier turn's claim, which may describe another
state, adds nothing. In a Codex rollout, a message whose `phase` is
`commentary` is what the agent says on its way, not the end of its turn: it is
never the final claim.

### Limits

- Claims are read from each end of turn, in English and Spanish, with
  patterns; paraphrases they do not cover are missed (no claim, no finding).
- A test run inside a script the adapter cannot see into (`make test`) is at
  most a `warn`; so is a subagent's run when its transcript is a separate file.
- Codex `exec --json` does not record the agent version (its rollout does).
- MCP tools and subagents are opaque: a session that uses them is at most a
  `WARN` for TG006 (except the Claude desktop app's own inert tools, named by
  the harness; an MCP server's `readOnlyHint` is its own word, not a fact).
- Nothing proves a claim true: not a transcript, not `saidvsdid run` (backlog:
  a recorder inside the runner).
- The files a Bash command reported changing (`bashEditDiff`) span the whole
  call: which segment changed them is not known, so `format && npm test` with
  a reported change is a `warn`.
- Symlinks and submodules are known only with a repository: `scan-history`
  and `--evidence` without one judge a path through a symlink by its
  spelling.
- Codex `exec --json` records no working directory per command: its runs are
  unplaced (with or without `--cwd`), so TG006 is at most a `warn` there;
  check the session's rollout instead.
- A transcript recorded at another path than the repository's (another
  machine, another checkout) places nothing: there is no mapping of roots yet.

## TG007 Regression test claimed: what the final diff shows

Needs `--transcript` or `--evidence`, like TG006 (otherwise *not
evaluated*). **Experimental.** A warning for the reviewer, never a verdict on
the claim: **at most a `warn`**, never a `fail` or a PASS, whatever the
claim's certainty. Only the **last turn's** claim (or a PR body's) is compared
with the final diff; an earlier turn's is `info` *superseded* ("superseded by
later turns"): it may describe a state the agent later changed.

Claims are read under TG006's certainty principle:

- **certain** only in the canonical form: first person, past or perfect, the
  sentence alone on its line, plain (no parenthesis, dash, quote, comma,
  colon or semicolon), with no negation, exception or doubt in it, and no
  condition, quote, example, request or time marker anywhere in the message
  ("I added a regression test.", "I have added a regression test for the
  empty string.", "He añadido un test de regresión.", "Añadí un test de
  regresión.");
- **possible**: anything else that reads like one — a modal or the future
  ("I can add regression tests", "I'll add one", "Deberíamos añadir…"), a
  plan ("Next steps: - Add regression tests.", "TODO", "Plan:"), a
  condition, a request, a bare participle without a subject ("Added
  regression tests.", "Regression test added."), a qualified, quoted, listed
  or dated sentence;
- **none** only for a question or a direct negation of adding in the claim's
  own sentence ("I did not add a regression test", "No regression tests were
  added", "Fixed it without adding a regression test", "No añadí…"); a
  negation of anything else ("…without changing the API") leaves the claim
  possible.

The corpus and the monotonic property (adding text never turns a WARN into
silence; a line break inside a sentence never raises the severity) are
`test/claims-tg007-adversarial.test.ts`.

The candidates are the tests the diff adds or modifies: new tests, tests
substituted or split (TG001's matching), and existing tests whose body or
parameter table changed — a row added to `it.each` / `describe.each` /
`test.for` or to `@pytest.mark.parametrize` (of the test or its class) is a
modified test.

| Evidence | Severity |
|---|---|
| No test added or modified | `warn` *no_test_in_diff* ("final diff contains no test") |
| Every candidate is disabled (skip, todo, fixme, any xfail — TG003's markers), has no assertion and calls nothing that could assert (TG004's test), or is uncertain (a conditional skip, assertions only through a helper) | `warn` *no_valid_test* |
| Test-like files changed that could not be analysed, and no other candidate | `warn` *unanalysed_tests* |
| Valid candidates, `--f2p` not given | `info` *not_run* |

With **`--f2p`** (opt-in), the valid candidates are run: two detached git
worktrees are created in a temporary directory, at base and at head; the head
version of each test file with a candidate is copied into the base worktree
(nothing else from head); only those test ids are run on both sides with the
repository's own runner (vitest or jest from its `node_modules`, linked into
the worktrees; pytest with `python`/`python3` or `$SAIDVSDID_PYTHON`) and a
timeout (`--f2p-timeout`, 120 s per run by default).

| Outcome | Result |
|---|---|
| At least one candidate fails on base and passes on head | `info` *fails_on_base* (a fact for the reviewer, not a certificate) |
| Every candidate passes on base (and on head) | `warn` *passes_on_base* |
| Candidates only error on base (collection or setup, not an assertion) | `warn` *error_on_base* |
| A candidate does not pass on head, is not collected, the runner is missing, crashes or times out | `warn` *f2p_inconclusive* |

> **`--f2p` runs code from the repository**: its tests, its runner
> configuration and everything they import, on both commits. Use it on code
> you would run anyway. The worktrees are removed afterwards; `node_modules`
> links are removed without following them.

### Limits

- Only candidates in files the parser reads (JS/TS, Python). A test added in
  another language is *unanalysed_tests*.
- Parametrised tests (`it.each`, `describe.each`, `parametrize`) are compared
  by the ids the runner reports per row (vitest/jest titles generated from the
  template, pytest `test[id]`): a failing row on base with every row passing on
  head is *fails_on_base*; every row passing on base is *passes_on_base*. When
  the rows cannot be told apart (a template without placeholders gives every
  row the same title) or differ between base and head: *f2p_inconclusive*.
- Two tests with the same full name in one file cannot be told apart by the
  runners' reports: *f2p_inconclusive*.

## baseline The deliberately simple rival

`saidvsdid baseline --base <ref> [--head <ref>] [--format text|json|md]
[--output <file>]` analyses the same diff with plain regular expressions over
the lines of `git diff --unified=0`: no syntax tree, no test extractor, no
safety net, no configuration files. Same report format and exit codes as
`check` (`0` OK, `1` WARN, `2` FAIL).

For every changed file whose name looks like a test (`*.test.*`, `*.spec.*`,
`__tests__/`, `test_*.py`, `*_test.py`):

| Signal | Regular expression (roughly) | Reported as |
|---|---|---|
| test file deleted | `deleted file mode` | TG001 `fail` |
| more removed than added test declarations | `it(`, `test(`, `def test_` | TG001 `fail` |
| more added than removed focus markers | `.only`, `fit(`, `fdescribe(`, `mark.only` | TG002 `fail` |
| more added than removed skip markers | `.skip`, `.todo`, `.fixme`, `xit(`, `mark.skip/skipif/xfail`, `pytest.skip(`, `skipTest(` | TG003 `fail` |
| fewer `expect(` / `assert` on added than on removed lines | | TG004 `warn` |
| the largest number on added lines mentioning `timeout` (or ending `, 30000)`) is ≥ 3× the largest on removed ones | | TG005 `warn` |

**Why it is deliberately simple.** It is the yardstick for the benchmark: what
a reviewer gets from a ~100-line grep script, the approach several existing
tools take. The value of the real rules is measured as the difference —
`.only` in a comment or a string, renamed and moved tests, platform-conditional
skips, `runIf`/`skipUnless` polarity, relaxed matchers, assertions moved into
helpers, scope reduced in configuration files, `xfail_strict`. Improving
`baseline` would shrink that difference artificially, so it must stay the way
it is: no AST, no reuse of `src/parse`, `src/rules/net.ts` or the config
readers (a test enforces the imports). On the fixture suite it gets 45 of 120
verdicts right, against 120 of 120 for `check`; those fixtures were written for
the rules, so the number is an illustration, not the benchmark.

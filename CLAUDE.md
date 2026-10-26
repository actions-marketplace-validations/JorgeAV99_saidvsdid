# saidvsdid — working rules

## Project rules (every milestone)

- **FAIL only with certainty about the runner's API; WARN when in doubt; never a
  silent OK.** The safety net in `src/rules/net.ts` stays on and must cover
  any new marker a milestone introduces. There is no PASS verdict.
- **A FAIL of TG001–TG003 is a fact about the code of the diff, checkable by
  reading it, under four documented assumptions; the first: saidvsdid resolves exactly which
  declaration each name refers to by the language's rules of lexical scope —
  read by the languages' own tooling (Python's ast/symtable, the TypeScript
  compiler) — and assumes that the test framework and its objects are not modified at run time
  (monkeypatching, setattr/__setattr__, reflection, __globals__, writes to
  members, a dynamic import to mutate), neither from other modules nor from the
  file itself.** Mutation is out of scope and not detected (a list of forbidden
  forms never closes it); as a courtesy, an evident direct write on an imported
  runner name is a WARN, with no guarantee. A fixture outside the assumption
  carries `outsideAssumption: { reason: "mutation", note }`: its expectation is
  the contract's (FAIL, or the courtesy WARN), and the runner evidence must show
  the tests still running. Messages describe the code, not its
  effect, and count syntactic sites ("adds `.skip` to test 'X'", "removes 2
  assertion calls from 'X'", "changes the condition of …"); never "disables",
  never "N executions". "Never silent" is guaranteed for the direct forms of
  the documented vocabulary (the closed list in docs/rules.md) and a simple
  alias of them; beyond them it is best effort, and an undetected form is
  coverage, not a broken guarantee.
- **The guarantee is small on purpose** (round 12): agents that weaken tests
  write direct forms, and widening and grouping more adds noise with no
  evidence that it is needed. Only two things block a merge: **no false
  FAIL** (unchanged), and **no silence for the direct forms** — a member of
  the vocabulary used directly from its root, a runner import or the test
  context (`test.skip(…)`, `it.only`, `test.fail`, `@pytest.mark.skip`,
  `pytest.skip()`, `self.skipTest()`, `raise unittest.SkipTest`…), Jest's
  globals with no import too (`it.skip`, `test.failing`, `fit`, `xdescribe`…:
  at least a WARN, never a FAIL; a disabling marker on a test that did not exist at base is
  an INFO line, reason `new_test`, since nothing that existed is lost — a focus always warns), and a simple alias in the same file (`const s = test.skip; s()`, `skip =
  pytest.mark.skip`). Its combinations — runner × form × member, direct and
  through the alias — are generated from the runners' API and the vocabulary
  (`contractCases` in src/rules/guarantee.ts, rendered in docs/rules.md), and
  each has a fixture with the real runner's evidence
  (`test/contract-fixtures.test.ts`; a combination waiting on a FAIL-side
  decision is in CONTRACT_PENDING with its reason, and in the backlog). A
  member gives a FAIL only when the base runner guarantees its effect; one that
  needs a plugin, a flag or a configuration outside the diff is a WARN
  (`@pytest.mark.only`/`focus`, `node:test`'s `only`). **A rule gives a FAIL
  only if the base runner guarantees its effect and the oracle can show it with
  the real runner** (round 13, docs/rules.md *Verdicts*): the effects are
  `not-run` and `expected-failure`, declared in data per runner and member
  (`src/rules/effects.ts`; node:test's todo runs the body: an expected failure);
  any other effect (TG004: a test that checks less, always a WARN), or one that
  depends on a context, a condition (`xfail(raises=…)`, `xfail(cond)`), a
  plugin, a flag or a configuration, is a WARN. The runner-evidence oracle
  (`fixtures/oracle.ts`, statuses read by own property) asks the real runner
  for that effect's evidence, in the status of the tests the FAIL names alone
  — an expected failure only by the runner's explicit signal (xfailed/xpassed,
  which also count as run) on a test that was not one at base, never a bare
  failure. **A FAIL is promised only for the canonical forms of a whitelist**
  (round 15, docs/rules.md *Verdicts*, `Marker.form`, `TestCase.declaration`):
  exact syntactic patterns, never a list of forbidden forms — F1 a Python
  test's decorators all the runner's marks (pytest.mark.*, or unittest's on a
  unittest method), F2 a call that is the first statement of the test's body,
  exactly the statement, with an allowed signature, F3 a JS declaration
  `<api>[.modifier](…)` that is a statement of the file or of an F3 describe's
  callback with the runner's documented arguments, F4 options with documented
  keys and literal values, F5 a mark's arguments by `ast.literal_eval`, F6 one
  effect per test, F7 TG001 only for a test the file shows collected (bound
  once, F1, exact bases; that the local code the test used changed or is gone
  in the PR is a sentence of context in the message, never a lower verdict:
  the code may survive under another name or path — `src/rules/withcode.ts`,
  Codex review of the noise round), F8 TG002's losses only F3 tests of the file that ran
  at base. Anything that does not match exactly is a WARN ("may …"). Every
  FAIL of TG001–TG003 lists its tests' identities (`Finding.ids`,
  `src/rules/ids.ts`: `[name, ordinal]`, structured, never a concatenated
  string); the recorder keys tests by the JSON array `[file, name, ordinal]`,
  a repeated full name in a file is a WARN, and the oracle reads the FAIL's
  tests alone, in its file, never a repeated name. F7's collection checks,
  generators, an empty literal `parametrize`, pytest's calls in a unittest
  method, a describe that returns or throws and each runner's per-modifier
  signature are part of the whitelist (round 16). Documented
  assumptions, outside the contract (`outsideAssumption` reasons `mutation`,
  `runner-invocation`, `setup-fails`): nobody mutates the framework, the runner
  runs with its standard behaviour about markers (no `--runxfail`, no plugins
  disabled, no collection hooks outside the diff), a test's setup does not fail
  by itself and the test ends before its timeout, a non-literal `parametrize`
  produces at least one case. The pytest recorder reads pytest's structured results, never a
  reason's text. Everything else the nets catch is
  *Best-effort detection* (docs/rules.md), described as implemented today,
  with no guarantee; the matrix protects it against regressions. Widening
  either is backlog, prioritised with data from real pull requests (a
  proposal: docs/design/silence-net-v2.md, not implemented).
- **The runner's API by binding, never by name** (docs/rules.md,
  *Attribution*; `test/runner-binding.test.ts`), **read by the languages' own
  tooling, never by hand-written scope code**; tree-sitter only finds the forms.
  JS/TS (src/parse/ts-program.ts: a program of the one file, no lib, no types,
  no module resolution, allowJs): at each occurrence the compiler's local symbol
  (`getSymbolAtLocation`, never followed through the import); FAIL only if it has
  exactly one declaration, an import specifier, namespace import or default
  clause of a static, not type-only `import … from` of vitest, @jest/globals,
  @playwright/test or node:test, in a form that runner's API has; `require`,
  `import x = require`, a dynamic import, a merged declaration are WARN; a file
  the compiler rejects (syntax, binder errors) is one file-level WARN. Python
  (python/saidvsdid_scopes.py, one interpreter per call of at most 1 MB of
  source, a file's base and head in the same call and judged together on
  answers taken once per analysis, which the parser receives as values (one
  side unread → both read as unread: one WARN, no FAIL), cached by content; the file's bytes, decoded by Python itself (PEP
  263), under `-X utf8`, stdin, stdout and stderr files, never pipes; the versions python.org supports
  (3.11–3.15 today), each run in CI, recorded in the report; a newer one runs as any other (no upper
  bound; recorded as untested); no interpreter, an older version, a self-check that fails, a file it does not compile, a
  declared encoding other than UTF-8 or a BOM against the declaration, a reply
  out of protocol, a lone CR line break (`lone_cr`, not analysed) → one
  file-level WARN, never silence, never an exception): the rule is about the whole file — a runner name is certain only if
  the AST shows exactly one binding of it, a module-level import of
  pytest/unittest; symtable's classification, trusted and never reinterpreted,
  says in every table other than the module's (annotation and type-parameter
  scopes too) that it is absent or global (declared or implicit) and nothing
  else (free, local, a parameter, nonlocal, assigned… or a predicate a later
  Python adds → WARN); it does not start with `__` (Python binds and mangles
  such names on its own: no list of implicit names); it is not a builtin; and
  there is no star import; then every occurrence refers to the import (a use in
  a test body included). `self.skipTest` is FAIL only through a certain
  unittest.TestCase chain of the module, an undecorated method whose `self` is
  bound nowhere else, in a file that binds `skipTest` nowhere (case B).
  **Exhaustiveness against the languages** (`test/py-exhaustive.test.ts`,
  `test/ts-exhaustive.test.ts`): every `ast` node class of the running
  interpreter and every TypeScript declaration kind and assignment operator is
  classified in an explicit map, with a probe per binding form; an unknown node
  or kind is WARN, never FAIL. Positions between parsers are exact (Python UTF-8
  columns, UTF-16 for tree-sitter and TypeScript; `test/positions.test.ts`).
  Expressions, subscripts and computed keys are read with parentheses and TS
  type assertions removed (as, as const, !, satisfies, <T>x, x<T>) by ONE
  normalisation (src/parse/normalise.ts) that every reader of expressions,
  keys, literals and strings uses: the extractor, the nets, the config readers.
  Any binding (assignment of any
  operator, annotated, walrus, unpacking, for, with-as, a default, a
  destructuring with a literal key, a decorator; the test context's first
  parameter destructured) whose normalised value contains a form of the
  vocabulary rooted at a runner import or at the test context (`t`, `ctx`) —
  one function for every binding form, in the extractor and the net; Python
  names compared mangled (`__x` in class C is `_C__x`) — even in a call, makes
  the name an alias (`omit =
  pytest.mark.skip(reason=…); @omit`, `stop = unittest.SkipTest("x"); raise
  stop`, `const { skip: omit } = it`, `({ skip: omit }) => omit()`): each new
  use as a decorator, a call or a raise is at least a WARN, even when the
  definition does not change. **The contagion net reads beyond the
  guarantee, best effort** (src/rules/contagion.ts, whatever the verdict; the
  extractor words the messages): tokens are the vocabulary's member and function names as whole
  identifiers (never substrings; a bare name only when the file does not bind it itself or binds it to
  the vocabulary, never a variable's name; a member of an assertion library's import, `assert.fail`, is
  not a use) — every member of src/parse/vocabulary.ts,
  the one definition the extractor, the nets, the docs' table and the
  best-effort matrix all derive from (`test/vocabulary.test.ts`) — and a
  string of the vocabulary is a string literal equal to a token (or whose
  value is not certain); a binding binds every name of its target, a member
  target every name of its receiver chain (an identifier, `this`/`self`, a
  chain of member steps), one member access however written — a dot, a
  literal subscript, a by-name primitive that returns the member with a
  literal name (`getattr(R, 'k'[, d])`, `Reflect.get`/`Reflect['get'](R,
  'k')`) — in any position, in the target and in a read (`self.omit = …`
  binds `self` and `omit`, `this['omit'] = …` binds `this` and `omit`,
  `Reflect.get(box, 'omit')` reads `box.omit`; `memberStep`/`memberChain` in
  src/parse/normalise.ts; hasattr/setattr/delattr/Reflect.has are transparent
  but never a step); its names are marked when its
  value holds a token or a marked name (a function's body counts), and they
  hold a string when its value, read outside the functions it defines, holds
  a string of the vocabulary or a name that holds one, in any container — to
  a fixed point in the file; each new use — a call, decorator or raise whose
  callee (the expression before the final argument list, its subscripts and
  keys included) holds a token, a string of the vocabulary, a marked name or
  a name that holds a string, as an identifier or a member's name — is at
  least a WARN naming its test — best effort, with no guarantee: the uses
  (call, decorator, raise, read identically), forms of the vocabulary and
  binding forms it reads today are listed in one place
  (src/rules/guarantee.ts, rendered in docs/rules.md, *Best-effort
  detection*) and **protected against regressions** by a cartesian matrix
  generated from the sources — `test/guarantee-matrix.ts`, every exclusion
  in an explicit list with its reason, a harmless control per case — run
  whole by the CI job `guarantee matrix (full)` (fails closed) and in its
  suite slice by `test/silence-guarantee.test.ts`; no axis is widened and no
  case removed without a decision. **A normal call is an opaque frontier**, when
  marking and in a callee: its arguments never count (`r = f(GOOD)` holds
  nothing; `expect(statusOf(kind)).toBe(…)` is not a use), its callee always
  does (`pytest.mark.skip(reason=…)`, `t.skip.bind(t)`); only the by-name
  access primitives (getattr/hasattr/setattr/delattr, Reflect.get/has, with a
  dot or a literal subscript) are transparent, as subscripts and computed keys
  are. Class fields and members, enums, non-literal containers, values that
  enter or leave a function, a function declared with def/function, and a
  name built at run time are coverage. Globals without import
  (jest, vitest globals, mocha) are always WARN "may be skipped", never FAIL. Any
  uncertain binding or recognised form that cannot be attributed is a WARN
  emitted by the rule itself ("may …"): a form of the vocabulary never ends in
  silence. A literal subscript (`ctx['skip']()`, `test['only']`, escapes
  decoded) is the member access (case D).
- **Claims are warnings for the reviewer, never certified.** What a run really
  ran cannot be known from outside the runner (an npm script may run anything,
  a child may outlive its call, a hook may edit, the tree may change during a
  run), and the FAILs on claims never fired in real history. TG006 and TG007
  are at most WARN in every mode (transcript and `--evidence`/`saidvsdid
  run`), never FAIL, never PASS, never "verified" or "backed by"; a TG006 INFO
  is *consistent_unverified* or *disclosed*. WARNs describe facts for the
  reviewer ("last visible test run failed", "no test run visible after the
  last edit", "final diff contains no test", "output truncated"), without
  accusing. No escalation: a tampering finding keeps its own severity and adds
  "the agent also claimed tests pass" when the last turn says so. TG007 judges
  only the last turn's claim against the final diff (earlier ones: INFO
  *superseded*); `--f2p` that cannot conclude is a WARN. The only future way to
  verify is a recorder inside the runner (backlog).
- **The same certainty applies to what agents say and to what runs show, in
  both directions.** A claim is promoted to certain only with certainty
  (global, present, unqualified in its sentence and immediate context); it is
  annulled or qualified only with certainty too: in doubt, it does not vanish,
  it becomes possible. A claim is never dropped because of ambiguity. The
  certainty shapes the wording, never more than a WARN. The claim
  extractor is **monotonic**: certain only for the strict canonical sentence
  ("All tests pass.") alone on its line (a sentence, not a line), with no
  heading before it and no condition, quote, example or time marker anywhere
  in the message; anything else that reads like a claim is possible; only a
  direct negation attached to the tests whose predicate is passing or
  failing ("not all tests pass", "2 tests fail", "1/2 tests passed"; not
  "not all tests are integration tests") or a question leaves no claim; a
  request or a verification anywhere ("please", "check", "verifica") makes
  it possible. Adding text to a message
  never turns a WARN into silence, and a line break inside a sentence never
  raises the severity (`test/claims-adversarial.test.ts`); the one exception
  is an explicit disclosure that the tests were not rerun, which makes
  staleness INFO and nothing else. One temporal model: every run and edit
  (shell-reported edits included: the whole call) is an interval, the claim a
  point; only what ends before the claim counts, what is in flight at it is
  uncertain, nothing that starts after it bears on it. A fact ("contradicted")
  only if the claim is false in every order compatible with the intervals,
  "consistent, not verified" only if true in every one, a WARN that says why
  it is not certain otherwise (`test/temporal-property.test.ts`, a
  brute-force oracle). **Ubicar es
  certeza o no es** (src/location.ts, `test/location-property.test.ts`): a run
  or an edit counts for the repository only if exact, deterministic
  resolution places it — working directory known (the transcript's, or
  `--cwd`) and inside the repo's root, no suffix matching, the same file on a
  case-sensitive and a case-insensitive file system, resolved component by
  component in base and head with no symlink, submodule, or `..` over an
  unknown directory. Any heuristic leaves it unplaced: uncertain, never stated
  as a fact. **Certainty only
  inside a closed grammar; the oracle is the real system** (src/transcript/
  grammar.ts): a run is placed only if the whole call is `[cd LIT &&] [VAR=v]
  runner allowed-args [2>&1] [| tail|head|grep|tee]`; Claude Code's shell cwd
  is followed call by call (unknown after anything outside the grammar that
  may move it); path components must be ordinary on Linux, macOS and Windows;
  any tool outside the closed list of non-editing tools is opaque from call to
  result (or the end). The grammar is widened only with data and a test
  against the real system (`test/shell-cwd-real.test.ts`: bash, pwsh and
  Windows PowerShell; a shell no oracle runs, like cmd.exe, is not read;
  `test/location-fs-real.test.ts`), never by adding a dangerous form to a list.
  **What a run proves,
  the runner says:** FAILED only with a recognised summary that reports
  failures (whatever the exit); PASSED only with a complete, coherent summary
  (counts add up to its total), ≥ 1 test, 0 failures, exit 0 or hidden only by
  a pipe; a summary showing deselection, or a run from a subdirectory (another
  project's config may apply), is partial (WARN); anything else —
  an exit status alone, a command not found — is UNKNOWN. `VAR=v` only for a closed list of innocuous variables (CI,
  FORCE_COLOR, from the history) and only in POSIX shells; filters read only
  the pipe (a file argument leaves the run unplaced). **Unknown is a type,
  not a null:** cwd, location and outcome are discriminated unions (known |
  unknown with a reason), never defaulted (`test/no-unknown-fallback.test.ts`
  forbids `??`/`||` on them); "no run" only if every call is a non-execution
  from a closed list and nothing is opaque — anything else is a possible run
  (WARN). **Closed lists have no back doors:** a table looked up by a name
  read from the input has no prototype (src/util/names.ts: `nameTable`,
  `ownRecord`, Map, Set; `test/name-tables.test.ts` with the TypeScript
  checker), so `constructor` or `toString` is never a token, a marker, a
  runner or a key; path components only
  `[A-Za-z0-9._-]`; PowerShell `cd` on a wildcard path is unplaced; opaque
  tools last to the end of the trace (a response with an id or `running` is
  not an end). **The end-to-end oracle is reality** (`test/e2e-real.test.ts`):
  random sessions run for real on the toy repos in bash and pwsh; whatever
  really happened, TG006/TG007 never FAIL, never say "verified", the verdict
  is never PASS, and a FAIL comes from a diff rule alone. Recorded transcripts keep
  only what the adapters read (no system prompt, tools, environment; the
  privacy test enforces it). Fix review findings by applying
  these principles, not by patching the phrase that triggered them.
- **TG007's claim under the same certainty.** Certain only in the canonical
  form (first person, past or perfect, the sentence alone and plain: "I added
  a regression test."); modals, the future, plans, questions, conditions and a
  bare participle ("Added regression tests.") are possible; only a question or
  a negation of the adding verb in its own sentence drops it
  (`test/claims-tg007-adversarial.test.ts`, with the monotonic property). No
  prefix (heading, quote, list, code fence) and no closing quote may erase a
  claim: blocked line joins are also read joined, as possible.
- **Report states, without ambiguity.** OK ("no issues found") is the verdict
  with nothing above INFO, exit 0; there is no PASS. Without a transcript or
  evidence, TG006/TG007 are `not_evaluated`, never among the rules that found
  nothing. "Never PASS" in a guarantee means never exit 0. TG006/TG007 are
  marked experimental in the docs and the output.
- **Evidence about other code is not evaluated.** `--evidence` whose base,
  head or any run's `tree_sha` is not the reviewed one: TG006/TG007 not
  evaluated (WARN `evidence_mismatch`), no claim context. Matching evidence is
  read like a transcript: it verifies nothing.
- **The config net is the product, scoped to what affects the tests** (noise
  round, src/config/testscope.ts, docs/rules.md *Safety net, configuration
  files*). A byte change inside that scope is a WARN: `test`/`test:*` scripts
  as at base and the scripts they run, the runners' and coverage keys of
  package.json, the pytest/coverage/tox sections of pyproject.toml, setup.cfg
  and tox.ini, a vite/vitest config with the values of its non-test settings
  (resolve, define, plugins, server…) blanked; out of scope: the version,
  dependencies, other or new scripts, a package.json in a test fixture
  directory. A watched file created, deleted or renamed always counts, in every
  net; vite configs are always watched; watched names compare without case on
  every platform; anything not located with certainty is compared whole. The
  net is explicit scope, never deduction from the repository's dependencies.
  Each case is contrasted with the real runner
  (`selectionChanges` in `case.json`: the runner runs a different set of tests).
- **No test depends on luck.** A randomised oracle carries a guaranteed set
  that covers what it asserts; thresholds on random counts are not
  assertions.
- **Fixtures first.** Write the fixtures, show them failing against the current
  code, then fix the code.
- **Real runner evidence.** If a rule depends on which tests run, its fixture
  carries evidence from the real runner (`"runner"` in `case.json`, recorded by
  `node scripts/runner-evidence.mjs`, re-checked in CI with `--check`).
- **What a net watches is an explicit, documented scope decision. How it
  compares what it watches, within that scope, is never "smart":** no
  normalising or interpreting to save warnings.
- **Closed scope.** Anything outside a milestone's acceptance criteria goes to
  [docs/backlog.md](docs/backlog.md); it is not implemented.

## Workflow

1. One branch per milestone, from `main`.
2. Fixtures (`fixtures/cases/<RULE>/<case>/{base,head,case.json}`) → failing
   output → fix → `npm run typecheck && npm test && npm run build`.
3. Open a PR; the fast CI (`.github/workflows/ci.yml`, Linux: the suite, the
   fixtures against the real runners, Python 3.11 and 3.15, the dogfood) runs on
   every push to it and must be green.
4. External review with Codex on the PR; findings are fixed or moved to the
   backlog with a reason.
5. Before merging a milestone, every item marked "backlog" in the external
   (Codex) reviews or in Claude's summaries is in `docs/backlog.md`.
6. **No PR is merged without `full-ci` green on its last commit, and that
   commit up to date with `main`.** GitHub enforces it: a ruleset on `main`
   requires the checks `full-ci` and `test, fixtures vs. real runners, Python
   3.11/3.15, dogfood (ubuntu, node 22)` (ci.yml) on the PR's head, the branch
   up to date with `main` before merging, and allows no force-push and no
   deletion. `.github/workflows/full-ci.yml` runs on every push to every PR, no
   label needed:
   macOS (what depends on it), Windows (the test files that depend on Windows,
   listed in the workflow, and every fixture against the real runners when the
   PR touches anything the recorder reads), Node 20 and 24, Python 3.11–3.15,
   and the full guarantee matrix when the PR may change what it reads (the
   path filters fail closed: an unknown path runs the job). Before merging, `node
   scripts/full-ci-status.mjs <PR>` must pass: `main` an ancestor of the PR's
   last commit (the PR is 0 commits behind it), a `full-ci` pass on that
   commit, and that pass covering the diff against `main` as it is now (the
   script reads the scope again with the workflow's own filter: the guarantee
   matrix must have run if the diff needs it, the platform jobs if it is not
   documentation alone, Windows' fixtures against the real runners if it
   touches what they read; a PR retargeted after its run does not keep its
   green). If the PR is behind, rebase it on `main`, push, and pass `full-ci`
   again. `full-ci` checks out the PR's head commit itself, never the
   temporary merge with the base it had when it ran; so, up to date with
   `main`, the squash writes exactly the tree `full-ci` tested.
   Merge right after the check, one PR at a time, with the command it prints
   (`gh pr merge <PR> --squash --match-head-commit <sha>`), which fails if a
   commit was pushed after the check. The ruleset cannot see the third
   condition (a run that covers the diff against `main` as it is now): the
   script is still the check before every merge.
7. **No CI runs on a push to `main`, and nothing reaches `main` but a PR.**
   What a PR brings in passed `full-ci` on exactly that tree (6); the ruleset's
   required checks reject a direct push, so documentation goes through a PR
   too.
8. **Monthly on `main`** (`.github/workflows/monthly.yml`: the first Sunday of
   the month, only if `main` changed since the last monthly run that ran; by
   hand with `workflow_dispatch`, for example before publishing a version). It
   looks for changes of the environment (a runner image, Node, Python, git, a
   shell), not of the code — every merged tree already passed `full-ci` — so it
   runs only what depends on the platform: on macOS and on Windows the whole
   suite, every fixture against the real runners and the packed CLI (all that
   each system ran on every push before the tiers), Node 20 and 24, Python
   3.11–3.15, and the long e2e sessions on the three systems. Not the guarantee matrix: it is deterministic on the code and
   passed in `full-ci` before the merge.
9. **Dependabot** (`.github/dependabot.yml`). A Dependabot pull request that
   touches only CI workflows (`.github/**`) or development dependencies
   (`devDependencies`) is merged without asking when `ci` and `full-ci` are
   green on its last commit, up to date with `main` (`node
   scripts/full-ci-status.mjs <PR>`, as in 6), and the test of pins by SHA
   (`test/pinned-actions.test.ts`, in the suite) passes; one at a time,
   rebased on `main` before each (`@dependabot rebase`). One that touches
   anything that goes into the npm package or `dist/action/` — a runtime
   dependency (`dependencies`: typescript, `web-tree-sitter`), the grammars —
   needs a notice to the owner (Jorge) and a new version: until it is
   published, it is listed in `docs/unreleased.md`. When it changes what the
   Action's bundle is built from, `dist/action/` is rebuilt and committed on
   its branch (`npm run build:action`): `check-dist` rejects a stale bundle,
   and it says nothing about the rest of the package. A Dependabot pull
   request that fails only on `check-dist`, or only on the README's pins
   (`test/readme-ci.test.ts`: every `uses:` of the README is exactly, SHA and
   comment, the workflows' pin of that action), gets from the agent the
   commit that regenerates `dist/action/` or updates the README's pins, on
   the pull request's own branch; then the rule above applies as to any other
   (green `ci` and `full-ci` on that last commit, and the notice and version
   when it reaches the package).

## Process

- **Design review before implementing.** Every rule that decides a FAIL or a
  silence is first described in one paragraph, and Codex attacks it before any
  code is written.
- **One principle per task.** Small changes, nothing done "while at it".
- **Proportional verification.** Focused tests while iterating; one full
  battery plus the CI at the end.
- **Merge criterion.** `full-ci` green on the PR's last commit (Workflow, 6),
  and no NO-GO in what the PR touches; pre-existing failures
  are recorded and go to their own PR. From round 16 of PR #4 on, Codex's
  review blocks a merge only for: (a) defects of the measuring instrument
  (recorder, oracle, fixtures, CI) that make the tests assert something
  false; (b) a false FAIL on code an agent or a person would plausibly write
  when skipping or weakening a test in a normal PR; (c) silences in the
  contract's combinations; (d) regressions, privacy leaks, or documentation
  that promises more than is implemented. Constructed counterexamples (dead
  code, constructions designed to mislead the analyser, combinations no
  idiomatic style would produce) are recorded in `docs/known-limitations.md`
  and do not block. The real precision of the FAIL is measured with the
  benchmark on real PRs.
- **A runner shape never ends in silence; FAIL only with certainty.**
- **Commit identity.** Commits use the owner's GitHub noreply address
  (`<id>+<login>@users.noreply.github.com`), never a personal email: check
  `git config user.email` before every commit.

## Where things are

- [docs/rules.md](docs/rules.md) — what each rule catches, severities, limits
  (`saidvsdid explain <RULE>` prints it; keep it in sync with the code).
- [docs/evidence.md](docs/evidence.md) — the `evidence/v2` format and the transcript adapters.
- `fixtures/sessions/` — real Claude Code and Codex sessions
  (`scripts/record-session.mjs`); `test/transcripts.test.ts` is their contract.
  TG006/TG007/CLAIM-CONTEXT fixtures derived from them come from
  `scripts/derive-transcripts.mjs`, never edited by hand
  (`npx tsx fixtures/diff-expect.ts [filter] [--write]` shows, then rewrites,
  expectations that changed — review the diff first).
- [docs/benchmark.md](docs/benchmark.md) — how results will be reported.
- [docs/backlog.md](docs/backlog.md) — deferred work.
- [docs/known-limitations.md](docs/known-limitations.md) — constructed
  counterexamples of the reviews, with their current verdict; they do not
  block a merge.
- `test/invariant.test.ts` — the "added marker never ends in OK" guarantee.
- `test/contract-fixtures.test.ts` — the silence guarantee against the real
  runners: every runner × form × member, direct and through a simple alias,
  has a fixture with runner evidence.
- [docs/design/silence-net-v2.md](docs/design/silence-net-v2.md) — a design
  proposal (the term table v2), not implemented; priority by the benchmark.
- `test/claims-adversarial.test.ts` — every adversarial phrase of the Codex
  reviews with its verdict, and the "added text never silences a WARN" property;
  `test/claims-tg007-adversarial.test.ts` — the same for TG007.
- `test/evidence-binding.test.ts` — evidence about other code is not evaluated.
- `test/readme-ci.test.ts` — the README's examples are the tool's output on
  `fixtures/action/demo`, and its workflow is the CI's dogfood step (the Action).
- `test/action.test.ts` — the GitHub Action (`action.yml`, `src/action/`): the PR
  comment on `fixtures/action/`, one comment per PR, `fail-on`.
- `test/privacy.test.ts` — no versioned file (docs, README, scripts, sources,
  fixtures) names a real home directory, an email outside the reserved example
  domains, an account id or a token. Versioned means in git's index (tracked or
  staged, `git ls-files --cached`); untracked files are not read, so stage a
  new file before running it locally.

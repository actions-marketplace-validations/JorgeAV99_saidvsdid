# Backlog

Work that is deliberately out of scope for the milestone that found it. Each
item says where it came from. Nothing here is implemented.

## From the 0.2.0 usability audit: what is left

From the PR that made the CLI compare the merge base, qualified an OK by its coverage, skipped events that are not a
pull request's and bounded large comments (the audit: synthetic and real pull requests, the README followed
literally). Deliberately not in it:

- **The backtick look-alike (U+02CB) in the comment.** Text copied from a message (`check out with ˋfetch-depth: 0ˋ`)
  does not paste as it reads. The code-span design that needs it was reviewed against GitHub's renderer; changing it
  (a double-backtick span, `<code>`) is a design change with the GFM oracle, not text.
- **An ERROR with `fail-on: none` is a green check.** A checkout without `fetch-depth: 0` says so in the comment, but
  the check list shows green. Making a configuration ERROR fail whatever `fail-on` says changes the documented
  default: a decision for the owner.
- **`.mocharc.*` in the configuration net.** Mocha's rc files (JS, YAML, JSON) are not watched; a change of `spec`
  there narrows the suite silently. Watching them is a scope decision of the net (CLAUDE.md, *The config net*).
- **`comment: on-findings`.** An input to post no comment when nothing was found (a docs-only pull request).
- **Renamed parametrised tests.** A TG001 INFO names a template-literal test as written
  (`JSON.stringify(t.input)` renamed to `joinURL(${…})`): noise to group or leave out.
- **Analysing `merge_group`.** It is SKIPPED: a merge group can hold several pull requests, and its comment would have
  nowhere to go. Analysing `merge_group.base_sha..head_sha` needs a design.
- **A pull request from a fork, live.** Not exercised in the audit: it needs a second account as the fork's owner
  (CLAUDE.md, *Before anything else*). The read-only token's warning was checked on a pull request of the repository.
- **The artifact on GitHub Enterprise Server.** Not attempted there (no v4 artifacts): the comment gives the
  reproduction. A client for GHES's own artifact service would need its own round trip.
- **The GFM oracle in CI.** `scripts/check-gfm-render.mjs` is run by hand. Running it in the public repository's CI,
  with the job's `GITHUB_TOKEN` for GitHub's `POST /markdown`, and failing the job when the API does not answer (never a
  green run that rendered nothing), would make it a check of every pull request that touches the comment (from the
  independent review of this PR).
- **Three payloads of the GFM oracle without a tag.** In `FOLDED`, `CODEX`, `LONG` and `last` carry no identity tag of
  their own (every other payload does): `CODEX` and `LONG` are unique as written and `last` is short, but tagging them
  too would make every payload's identity explicit (from the independent review of this PR).
- **The Action's version between releases.** The reproduction names `npx saidvsdid@<version>`, the Action's version
  string, always qualified: a bundle built between releases may differ from npm's package. A build identity in the
  bundle (the commit it was built from) would remove the qualification.

## Python versions: what is left

From the PR that read the versions python.org supports (3.11–3.15, no upper bound) and its Codex design review:

- **Lazy imports (Python 3.15, PEP 810).** `lazy import pytest` is read by Python, but tree-sitter-python 0.25.0 (its
  newest release) has no `lazy` keyword: the file has syntax errors for the tree and its comparison is UNVERIFIABLE
  (`TG003/py315-lazy-import-unverifiable`). When the grammar parses them, read a module-level lazy import of a runner
  as the import it is (the name is bound once, to the module, loaded at its first use), with a fixture and the real
  runner's evidence.
- **Interpolations of a t-string that read the vocabulary** (`t"{pytest.mark.skip}"`) are WARNs of the census of
  markers, as any other read of them (`TG003/py314-tstring-interpolation-control`). Telling a read from a call inside an
  interpolation needs data from real pull requests first.

## The GitHub Action: what is left

From the PR that added `action.yml` (src/action/, test/action.test.ts). Deliberately not in it:

- **Two runs at once can post two comments.** Each run lists the comments and then creates one; the README's
  workflow has a `concurrency` group per pull request, which avoids it. Without one, the next run updates the
  oldest and leaves the other.
- **Forks.** A pull request from a fork gets a read-only token, so no comment (a warning; the job summary has the
  report). Commenting there needs `pull_request_target` or a second workflow on `workflow_run`, both of which hand
  a write token to a run triggered by untrusted code: a design review first.
- **Transcripts.** TG006/TG007 are not evaluated in the Action (no transcript reaches it). An input for an
  evidence file produced by the agent's job, bound to the reviewed commits like `--evidence`, would bring them.
- **Inline review comments** on each line, instead of links from one comment: more noise on every push; wait for
  what reviewers ask for.

From the security review of the Action before the Marketplace (PR #12, after the fix that writes the report's text
in the comment only as code). None of them is a way to run code, raise permissions, leak the token or abuse the
comment in a repository that uses the Action as the README says:

- **`persist-credentials: false`** in the README's checkout: saidvsdid needs no credentials in `.git/config`, and
  nothing it runs reads them; defence in depth for workflows that add steps after it.
- **`pull_request_target`.** The Action reads any event with a `pull_request` and does not run the pull request's
  code, but on that event the comment would be posted for forks too: say in the job (a warning) that the event is
  not the README's, or refuse it.
- **`check --format md`** (src/report/md.ts) writes the findings' text into a Markdown table as it is (only `|` and
  line breaks escaped). The Action does not use it, but a workflow that posts its output would carry the pull
  request's text as Markdown: write it with the comment's `literal`.

From Codex's GO on the comment's rendering (scripts/check-gfm-render.mjs, GitHub's `POST /markdown` as the oracle):

- **The GFM oracle in the public CI.** It runs by hand today (it needs `gh` signed in). In a public repository the
  job's `GITHUB_TOKEN` can call `POST /markdown`: run it in `ci.yml` on every change to `src/report/comment.ts` (and
  what it calls), failing closed when the API cannot be reached.
- **Attributes of the allowed elements.** The oracle checks which elements GitHub's HTML holds and the links' `href`;
  `<g-emoji>` and `<svg>` (with its `<path>`) are allowed by name with any attribute. Check theirs too: a `<g-emoji>`
  only for the comment's own icons (its `alias` and `fallback-src`), an `<svg>` only as a heading anchor's octicon.
- **Each case's verdict, asserted** (Codex, review of the PR that made the oracle run the bundle; already so on main).
  The oracle prints each case's verdict but does not check it: a case whose comment is an analysis error (a grammar
  missing from the bundle, say) would render inert and pass without the hostile names in it. Give each case its
  expected verdict and the findings it must show, and fail otherwise.

## The Python scope reader's hang on macOS: what is left

`spawnSync python3 ETIMEDOUT` on macOS CI (PR #4, rounds 10 and 20d; main as of the commit that recorded this hang) was reproduced: under
parallel runs, the interpreter sat in its first `read()` of stdin, 0 % CPU, with no end of file from Node's
`spawnSync` (1 call in 837 in parallel; 0 in 837 in sequence). Fixed by structure (the request, the reply and
stderr are files) and bounded (calls of at most 1 MB; `max(60 s, 60 s/MB)` per attempt, then a retry with at
least 300 s, before the WARN `scope_unavailable`). Left:

- why Node did not deliver the end of file (libuv on macOS, a socketpair as stdin): not established; a
  synthetic stress of 3 000 calls through a pipe did not reproduce it;
- 0 hangs in 1 674 parallel calls with files is not, by itself, proof at that rate: the WARN (never OK,
  never a FAIL) is what holds if it is ever seen again; then measure it before changing anything;
- a single file with thousands of functions or classes in one scope still reads in more than linear time:
  the standard library's `symtable` looks a name up among all the children of its table (≈ 32 s/MB for a
  class of 40 000 methods). The earlier reader was slower on such files; a fix replaces `symtable`'s lookup;
- (Codex, review of the commit that made the reader-failure test parse with tree-sitter, not blocking) the stand-in for `spawnSync` checks the three descriptors but not
  that each is the file it should be; no test makes the temporary files fail, nor a real interpreter write a
  large stderr when the reply fails;
- (Codex, review of the commit that sent the Python scope reader's stderr to a file and capped its calls at 1 MB, not blocking) descriptors can stay open in `attempt` (src/parse/py-scopes.ts):
  `fds.push(openSync(…), openSync(…), openSync(…))` loses the ones already opened when a later `openSync`
  throws, and a `closeSync` that throws leaves the rest of the list open. The failures injected so far still
  end in the WARN `scope_unavailable`; the leak is a resource, not a verdict.

## A recorder inside the runner: the only future way to verify a claim

Decided after the review of the commit of milestone 3's external audit: claims cannot be certified from outside
the runner — an npm script may run anything (N1), a child process may outlive
its call (N2), a hook may edit files (N3), the tree may change while the tests
run (N7) — and on real history the claim FAILs never fired (0 in 90 turns).
TG006 and TG007 are warnings for the reviewer (docs/rules.md, TG006); neither a
transcript nor `saidvsdid run` verifies anything. Verification needs:

- a **vitest reporter** and a **pytest plugin** (registered by entry point)
  that record each run from inside the runner: root, configuration, selection,
  counts, exit status, and the **hash of every file the run actually loaded**
  (test files, the code they import, the configuration), so a run is tied to
  exact file contents, not to a working tree that may change during it;
- the evidence tied to the transcript's calls (which call ran which recorded
  run), so a claim can be checked against a run the recorder saw;
- until then nothing is a PASS, and the closed grammar of a placed run is not
  widened (below).

Removed with this decision, to come back only with the recorder if it needs
them: the rigid FAILs of transcript mode (`no_activity`,
`edited_without_activity`, `last_run_failed_rigid`), the escalation of
tampering findings by a claim, and the harness facts that only fed them in
`evidence/v2` (`shell_calls`, `hook_events`, `transcript.hooks_recorded`).

## Recovering FAILs the whitelist leaves as WARN (rounds 14–15, to prioritise with the benchmark)

Since round 15 a `FAIL` is promised only for the exact canonical forms of a whitelist (docs/rules.md, *Verdicts*,
F1–F8); anything that does not match one exactly is a `WARN` that says why. None of these is implemented; each needs
data from real pull requests that it matters, fixtures with the real runner, and a design review before it can give a
`FAIL` again:

- **Control flow**: a call that is not the first statement of the test's body (F2) — after a statement that may raise
  (a failing `assert`, a call that throws), after an early exit, inside an `if`, a loop, a `try` — and dead code
  (`if (false) return; t.skip();`, Codex round 15: the skip runs, but only reasoning about the condition shows it).
- **Other decorators**: a decorator that is not the runner's next to a marker (`@functools.wraps`, a known identity
  decorator, `@pytest.mark.usefixtures` on a unittest method) — today it makes every marker of the function a WARN (F1).
  Any `@pytest.mark.<name>` is F1 since round 15, so `@pytest.mark.parametrize` + `@pytest.mark.skip` is a `FAIL` again.
- **Truthy literals in a condition** (Codex round 15): `test.skipIf(2)('x', fn)`, `skipif(1, reason=…)` — the runner
  skips, but F3 and F5 read only the literal `true`/`True` (`false`/`False` for `runIf`/`skipUnless`).
- **The context by its role** (Codex round 15): `def test_x(this): this.skipTest("…")` in a `unittest.TestCase`
  method — the first parameter is the instance whatever its name; today only `self` is read, so it is a WARN.
- **Signatures beyond the whitelist**: `self.skipTest(reason="…")`, `pytest.skip(msg="…")` (older pytest), Playwright's
  `test.skip(true, "…")`, a describe's or a test's Playwright details object, `.each`/`.for` declarations (their tests
  are named by a format), `.concurrent`/`.sequential`, tests whose name is not a plain string literal — WARN today.
- **Recoverable WARNs named by Codex in round 16**: `assert True; pytest.skip("why")` (the skip is not the first
  statement, F2, although the statement before it never fails) and `def test_x(this): this.skipTest("why")` (the
  context read by its role, above).
- **An xfail beside a case's own marks** (Codex round 17, conservative): `@pytest.mark.xfail` on a parametrised test
  one of whose cases is already `pytest.param(…, marks=pytest.mark.xfail)` is a WARN (F6: the case's mark is another
  effect on the test), although pytest reports the other cases as new expected failures
  (`TG003/codex17-xfail-on-parametrize-with-xfail-case`). Recoverable: read F6 per case.
- **Skips at collection in the recorder** (round 19): represent in the recorder the skips pytest reports at collection
  (`pytest.skip(..., allow_module_level=True)`), an outcome of no test that the recorded statuses cannot hold today, so
  the fixture is refused (`TG003/py-module-skip-control`). Needed if that marker should one day give a FAIL.
- **Hidden failures of an expected failure** (round 20): node:test keeps a test's first error, so an `afterEach`/`after`
  hook that throws after a `todo` test's body failed is in no event, and it is recorded `xfailed` today
  (docs/known-limitations.md); refusing it needs a signal Node does not give (an observer of its hooks). (Vitest's
  `fails` with an extended test API is refused since round 20b.)
- **TG005 on node:test's trailing object** (round 15): `test('X', fn, { skip: true })` is read by TG005 as a timeout
  argument after the callback (*sets a timeout that cannot be read*), Vitest's and Jest's position; node:test has none.
  A WARN either way; the wording is to be made per runner.
- **Python collection beyond F7**: a `test*` name without the underscore, classes nested in a class, a class whose base
  is another test class of the module, `IsolatedAsyncioTestCase`, a local binding elsewhere in the file with the same
  name as a test (counted as a second binding) — WARN today.
- **The runner's configuration**: `addopts` (`--runxfail`, `-p no:skipping`), `conftest.py` collection hooks and
  ignores, read from the repository to decide whether markers behave as standard — today an assumption.
- **Markers off the test function**: a decorator on a class, `pytestmark`, Playwright's `test.skip()` in a describe's
  body or at file level, a skip in a setup hook — certainly applied by the runner, but not the canonical form.
- **node:test subtests**: `t.test('x', { skip: true })` declares a subtest with options of the vocabulary; today the
  census WARNs that it cannot attribute it to a test.

## Priority for the benchmark (round 13)

Measured first when the benchmark runs on real pull requests, in this order:

- **Silences outside the contract, named by Codex in round 16**: a new call of an existing helper `stop()` whose body is
  `ctx.skip()` (below), and `box[0]()` after `box[0] = ctx.skip` (numeric literal keys, below). Neither is a direct
  form nor a simple alias: best effort, prioritised with the benchmark.
- **A skip through a helper function** (Codex, rounds 13, 15 and 16; considered common): `function stop() { ctx.skip(); }`
  defined once, then a new `stop();` in a test. The helper's own `ctx.skip()` is not attributed to a test
  (a WARN where it is written, when it is new); a new call of an existing helper is silent, because a normal
  call is an opaque frontier (docs/rules.md, *Best-effort detection*). The candidate: a same-file function
  whose body holds a form of the vocabulary marks its name, and a new call of it is a WARN naming the test —
  with the matrix's axes and the noise it adds measured on real pull requests.
- **Numeric literal keys**: below, under *Best-effort improvements* (round 11), unchanged (re-confirmed in round 15).
- **TG004 verified with Jest's `numPassingAsserts`** (future): TG004 is always a WARN since round 13, as a
  loss of checks is not provable from the diff. Jest's test results report `numPassingAsserts` per test: a
  recorder could show a test that ran fewer assertions at head than at base, which might one day let TG004
  give a FAIL in that runner alone — if the oracle can show it and the base runner guarantees it.
- **`test.info().skip()` in Playwright** (round 13, found auditing the contexts): the guarantee covers the
  test context as the callback's `testInfo` parameter; `test.info()` reaches the same object through a call
  and is best effort.

## Best-effort improvements, to prioritise with data from the benchmark (round 12)

The silence guarantee is the direct forms and a simple alias (docs/rules.md, *The silence guarantee*):
agents that weaken tests write `test.skip(…)`, `it.only`, `@pytest.mark.skip`, not contrived forms, and
widening and grouping more adds noise with no evidence it is needed. What follows would widen
*Best-effort detection*; none of it blocks a merge, and each waits for real pull requests that show it
matters.

- **Numeric literal keys** (Codex P1, round 11, on the commit that split the guarantee matrix into a suite slice and a CI job): a member step accepts only a string key, so
  `const box = {}; const alias = box; alias[0] = ctx.skip;` then a new `box[0]()` is silent, as are
  `alias[0]` → `box['0']()` and `alias['0']` → `box[0]()`; in Python `box = {}; alias = box;
  alias[0] = self.skipTest` then `box[0]("later")`. The fix would read every literal key (numbers,
  BigInt, `true`/`false`/`null`, Python's atomic constants) in `memberStep`, with the matrix's key-form
  axis and its mixed crossings.
- **The term table v2** ([docs/design/silence-net-v2.md](design/silence-net-v2.md)): a closed meaning
  for every term of the best-effort lists — name sets that match when they intersect, numeric keys, the
  documented approximations (Python's attribute and subscript, numeric types, `?.`, `Reflect.get`'s
  receiver, `getattr`'s default, `#k`), WARN roots and FAIL roots apart, a closure rule — with Codex's
  design review of v1 and the decisions taken on it. Not implemented, not reviewed as v2.
- **A marked member's name held by a variable** (Codex, round 11): after `alias.omit = ctx.skip`,
  `key = 'omit'; Reflect.get(box, key)()` (and Python's `key = "omit"; getattr(box, key)("x")`) is
  silent. The `string-key` binding form covers names that hold a string of the vocabulary (`'skip'`),
  not names that hold the name of a member the file marked.

## From the Codex NO-GO of the commit that made the agent's claims warnings for the reviewer

- **Configs imported from a watched config.** `vitest.config.ts` importing
  `./selection.js` (or a vite config spreading a shared file): a change to the
  imported file changes the selection, but only the watched file is in the
  net. Watching the relative imports of first level of every watched config
  (as plain files, any byte change) is the candidate; it needs fixtures with
  the real runner first.
- **The e2e has no INFO session in the CI seed.** The fixed seed's sessions
  end in WARN only; a session consistent with what is visible (INFO
  *consistent_unverified*) is not exercised in CI, only in the long mode. A
  guaranteed set, as in the other real-system oracles, would cover it.

## Milestone "launchable": the runner resolver

**Done in the resolver v2.1 PR** (design reviewed twice by Codex; a new branch
from main, with m3-resolver used only as the source of fixtures and cases): the
contract (a FAIL of TG001–TG004 is a fact about the code under the assumption
that neither the test framework nor the test modules are modified at run time
from other modules; messages describe the code), attribution by binding
(JS/TS: a static import of vitest, @jest/globals, @playwright/test or
node:test with no enclosing declaration; Python: a module-level import that
nothing in the module rebinds, before or after the use, certain wherever it is
used — the first design's "a use inside a function is WARN" (case A) was
dropped before review: it turned almost all of Python's vocabulary inside tests
into WARNs, and what it guarded against, another module rebinding the test
module's names (`TG003/py-skip-in-body-rebound`), is now outside the
assumption; `self.skipTest` through unittest.TestCase with no override — case
B; globals
always WARN; a literal subscript is a member access — case D), and the false
FAILs of main it fixes (`it.skip` on a local object, `self.skipTest` inherited
or overridden). The Codex cases of the three rounds of milestone 3 that ended in a NO-GO that
fall in that scope are fixtures with real-runner evidence (TG001–TG004),
including those of the review of the commit that never silenced a runner shape and made a FAIL need a certain, immutable binding: a shadowed `require`
(`TG003/shadowed-require`), `import *` in Python (`TG003/py-star-import`), a
local helper named `it` in TG004 (`TG004/local-it-helper`). Its other two cases,
escaped keys in a jest config (`'injectGlob\u0061ls'`) and an npm script that
delegates `--injectGlobals=false`, need no reading of the configuration any
more: a global is never certain, whatever the configuration says.

**Done in the same PR after the Codex NO-GO of the commit that made Python names certain wherever used unless rebound in the module** (a list of forbidden
positions or identifiers never closes run-time mutation): the assumption is now
"names resolve by exact lexical scope; the framework and its objects are not
modified at run time, from other modules or from the file itself". Python
resolves names by exact lexical scope (NFKC; module, class, function, lambda and
comprehension scopes; global/nonlocal; every binding form in any scope; class
names not visible in methods), so a binding in another scope no longer makes a
use uncertain; reflection (`globals()`, `sys.modules`, …) is mutation, outside
the assumption, no longer a WARN; `self.skipTest` checks every binding of
`skipTest` in the scopes of the class chain; one-step aliases of the
vocabulary are read (WARN), in Python and JS/TS, and the net counts their uses;
the net's word boundaries are Unicode-aware and Python names NFKC; TG001 says
"removes all N test declarations from <file> (file kept)" when the file is
still in head's tree. Mutation fixtures carry `outsideAssumption: { reason:
"mutation" }`; an evident direct write on an imported runner name is a courtesy
WARN.

**Left from that round** (coverage, not guarantees; each a WARN or a FAIL
under the assumption, as documented):

- **Mutation detection beyond the courtesy check.** Out of scope by the
  assumption: `builtins.globals()`, `__globals__`, a dynamic import, writes on
  an alias of the import (`m = pytest.mark; m.skip = …`), a conftest or setup
  file. Only the recorder inside the runner (above) could see them.
- **Transitive aliases** (`b = a` where `a` is an alias of the vocabulary):
  read under their own name, never as the vocabulary; the net counts only
  one-step aliases.
- **An alias of a call result raised later** (`err = unittest.SkipTest("x");
  raise err`): the parser reads it (`raise err` resolves to the alias of the
  call), the net does not count `raise err` for an alias of a call.
- **A module-level import inside a block** (`try: import pytest` / `except
  ImportError`): always WARN, even when the block certainly runs.
- **PEP 695 annotation scopes** (`def f[T]()`, `class C[T]`): type parameters
  are read as bindings of the function's or the class's scope, an
  approximation that only makes uses more uncertain.
- **`unittest.case.skip` and other submodule paths** of the runners
  (`from unittest.case import skip`): not in the vocabulary.
- **A class used as a base when it is defined in a nested block** (`if
  True: class Base(TestCase)`): `self.skipTest` through it is WARN.

**Done after the Codex NO-GO of the commit that made lexical scope exact** (every finding was a lexical-scope or alias error, fixed
with structural protections, not case by case): an explicit map of every node type of the grammars
(src/parse/binding-forms.ts) checked against their node-types.json and WASM with a probe per binding
type (test/binding-forms.test.ts); an unknown context is a WARN; implicit bindings (`__class__` in
methods, module and class-body globals, `arguments`, the CommonJS wrapper); TypeScript's namespaces
(also as top-level expression statements), `import x = A.B`, function signatures and merged namespace
blocks; expressions read with parentheses and TS type assertions removed, in the extractor and the
net; any binding whose value contains a form of the vocabulary is an alias.

**Left from that round:**

- **Aliases of aliases** (`b = omit`) and **a value that holds a callable form without calling it
  inside a container** (`(now,) = (pytest.skip,)` is counted, `(now,) = (skip,)` with `from pytest
  import skip` is not): coverage, not guarantees.
- **An alias of the vocabulary used outside a decorator, a call or a raise** (`marks=omit` in a
  `pytest.param`): read when the extractor reads that position, not counted by the net.
- **The CommonJS wrapper's names** (`require`, `module`, …) make a runner import under that name
  uncertain even in an ES module, where the wrapper does not exist: a WARN where a FAIL would hold.
- **Python 2 statements** (`print "x"`, `exec "x"`) are a syntax error in Python 3: the file does not
  import; `exec` makes every name uncertain, `print` is read as a statement that binds nothing.

**For the launchable milestone: the contagion net's names by scope** (round 7, option 2 of the noise
decision). The contagion net (src/rules/contagion.ts) marks names by name, whatever the scope: a
`kind = 'skip'` in one function makes every `kind` of the file hold a string, `self.x = it.skip` marks
every `self`, and a local helper named exactly like a token (`only`) is a token. Reading which declaration each name is — with
the compilers, as the extractor does (symtable, the TypeScript checker) — would mark a declaration,
not a name, and spread only along real references. It must keep the net's guarantee (never silence
for a new use): a name the compilers cannot resolve stays marked by name.

**Next PR (B): the vocabulary** (out of the v2.1 PR on purpose):

- **`node:test`'s default import as documented API.** `import test from
  'node:test'` is node's own documented form (the default export is `test`),
  as is `@playwright/test`'s `import test from '@playwright/test'`; today a
  default import is uncertain (WARN), because the reviewed list of forms is
  named, aliased and namespace imports. Make the default export of those two
  packages certain, with fixtures and node's runner.

- **Condition changes** as their own finding: a marker whose condition changes
  in place (`skipIf(a)` → `skipIf(b)`, `if (c) ctx.skip()` with another `c`)
  when the level does not rise (today: the level decides; the marker count does
  not move).
- **Rows of `.each` / `parametrize`**: a row removed or a `pytest.param(…,
  marks=skip)` row added is one site each, never "N executions".
- **A test deleted or rebound** by `del test_x`, `test_x = None`, a later `def
  test_x` (Python), or a later declaration with the same name.
- **`@pytest.fixture` on a test** (it stops being collected as a test).
- **`__init__` / `__new__` in a pytest test class** (pytest does not collect it).
- **`load_tests`** in a unittest module (it decides what runs).
- **`__test__ = False`** on a module, a class or a function.

**Left from the attribution itself** (each a WARN today, never a FAIL):

- **Default imports** of the other runners: none of vitest and
  @jest/globals has one (see PR B above for node:test and Playwright).
- **mocha and `bun:test`**: not in the list of runner packages; `import { it }
  from 'mocha'` is uncertain.
- **`node:test`'s `only`**: it applies only with `--test-only`, which the code
  does not show; reading the test script could make it certain.
- **Following re-exports and `test.extend(…)`** through relative files down to
  a runner import (`TG003/reexport-support-skipif`, `imported-helper-test`).
- **A describe factory's parameter** (vitest passes its `test`:
  `TG003/param-is-vitest-test`, where the real runner does skip).
- **Tests declared inside a helper function** called at the top level
  (`function suite(name) { it(name, …) }`), or in a `forEach` over a literal
  array: uncertain, so their file's deletion is a WARN.
- **The context of a node:test test** used as an assertion root (`t.assert.ok`)
  is uncertain for TG004.
- **`x.skip()` on any receiver in a test** is attached as an uncertain marker
  (never dropped); a call with no argument (`query.skip()`) makes the test
  "possibly hidden", so deleting its file is a WARN, not a FAIL.
- **Pre-existing, from the earlier list**: a parenthesised decorator
  `@(pytest.mark.skipif)(…)`; `getattr(pytest.mark, 'skipif')`; setup files and
  `conftest.py` that patch the runner (`setupFiles`, a conftest assigning
  `TestCase.skipTest`: outside the contract's assumption, mutation);
  `expect.extend` replacing a built-in matcher.

## From the review of the commit of milestone 3's external audit

- **N4: a clarification in another sentence does not lower the claim.** "All
  tests pass.\n\nThis describes a requirement, not an observed result." and
  "Todos los tests pasan.\n\nEsto expresa un requisito, no un resultado
  observado." are extracted as **certain** suite claims: the canonical sentence
  is alone, and the next paragraph says it is a requirement, not an observed
  result. Reading such a clarification (a requirement, a specification, "not
  observed") anywhere in the message as a marker that makes the claim possible
  needs its own adversarial cases and the monotonic property. Since claims are
  warnings, it can no longer lead to a FAIL (TG006 at most WARN). Pinned in
  `test/claims-adversarial.test.ts`.
- **N5: the object of "added" is not a test.** "I added a regression test
  description." and "He añadido una descripción de un test de regresión."
  (with a diff that only touches the README) read as TG007's canonical claim
  (certain): the canonical form checks the verb and that the sentence mentions
  a regression test, not that the test is what was added. Requiring the test to
  be the head of the object ("a regression test", "un test de regresión", not
  "a regression test description", "una descripción de…") needs its own
  adversarial cases. At most a WARN today ("final diff contains no test").
  Pinned in `test/claims-tg007-adversarial.test.ts`.
- **`selectionChanges` for the other fixtures.** The new config-net fixtures
  pin that the real runner (Vitest, Jest, pytest) runs a different set of tests
  at head; older TG005 fixtures with runner evidence check only that a lost
  test is never OK. Marking the ones whose selection really moves would make
  the contrast uniform.
- ~~**A vite config in a repository without a package.json naming vitest.**~~
  Superseded after the Codex NO-GO of the commit that made the agent's claims warnings for the reviewer: vite configs are always watched.

## Marker safety net and attribution

- **Ignore sites the extractor already resolved as "not the runner".** When a
  receiver certainly is not the runner context (e.g. `ctx.skip()` on a local
  object named `ctx`), the extractor drops it, but the regex net in
  `src/rules/net.ts` still counts `.skip` and reports a noise WARN. The net
  should subtract sites the extractor proved are not markers. *(M1 review)*
- **Replacing a marker by another of the same kind** (moving `.skip` to a
  different test, `.skip` → `.skipIf(...)`) keeps the per-kind count, so the
  net cannot see it; only the attributed rules can. Documented gap. *(M1)*
- **Follow helpers imported from other files** (skip helpers, assertion
  helpers, wrappers around `it`). Today only same-file code is inspected. *(M1)*

## Escape hatch

- `// saidvsdid-allow TGxxx: <reason>` on the line of a finding, to accept it
  explicitly with a reason that shows up in the report. For the GitHub Action
  milestone. *(M1)*

## Found during milestone 2

- **TG005: `vite.config.*`** as Vitest's fallback configuration (its `test`
  section), Vitest workspaces/`projects`, Jest `projects`, tox `[testenv]
  commands`, CI workflow files and environment variables (`CI=true` options,
  `VITEST_*`) are not read.
- **TG005: evaluate Playwright's selection** (`testDir`, `testMatch`,
  `testIgnore`, `grep`, `projects`) with runner evidence, so it can `fail`;
  today any change is a `warn`.
- **TG005: Jest positional patterns and `--testPathPattern`** are regular
  expressions over absolute paths; evaluating them needs a model of the
  absolute prefix. Today: `warn`.
- **TG005: `-m` marker expressions** and `-t`/`--testNamePattern` are not
  evaluated (`warn`).
- **TG003: `xfail_strict` turned off in the configuration alone.** The test
  files with bare `xfail` are not in the diff, so the relaxation is not seen.
  Needs TG005-style reading of unchanged test files.
- **TG004: merged tests.** Two tests merged into one look like a deletion
  (TG001 `warn`) plus a gain; the inverse of the split detection.
- **TG004: relaxations through a renamed subject** (`expect(result)` →
  `expect(res)`) are not paired.
- **Benchmark.** `baseline` is in place; the benchmark itself needs an
  independent corpus (not our own fixtures) and a scoring script.

## Found in the Codex review of M2

- **Playwright arguments in `package.json`** (`playwright test --retries 2`,
  `--grep`, `--project`, `--timeout`) are not analysed; only the
  configuration net sees new tokens.
- **Quoted INI list values.** Runner evidence shows pytest splits
  `testpaths = "tests"` like a shell (quotes removed). Today it is a `warn`;
  decoding it with `shellWords` could make it certain.
- **INI continuation after a blank line** (`addopts = -q`, blank line,
  indented `--ignore=...`): pytest applies it; the INI reader drops it. Today
  only the configuration net sees it.
- **CLI vs. config precedence** (Jest `--testPathIgnorePatterns` replaces the
  configured list; pytest's last `-k` wins): modelling it would let these be
  `fail` instead of `warn`.

## V0 decisions to revisit (last round of the M2 review)

- **Re-enable `fail` for TG005 scope reductions** if the benchmark shows the
  selection model is right often enough. In V0 every reduction is a `warn`.
- **Selection model improvements** before that: CLI vs. config precedence
  (Jest options replace, pytest's last `-k` wins), explicit paths in
  `addopts` that `--ignore` does not remove, quoted INI values decoded like
  pytest (shell-style), INI continuations after blank lines.
- **WARN noise from harmless config changes.** The configuration net warns on
  any content change TG005 does not report: a new reporter, a
  `coverage.exclude`, a stricter timeout. Recognise known-harmless keys
  (with fixtures and runner evidence) to silence them.
- **Config files with names we do not recognise** (`vite.config.*`,
  `vitest.workspace.*`, `jest.config.base.js`, a file passed with
  `--config`/`-c`) are not read and not covered by the net.

## Found in the verification of the commit that made TG005's scope reductions always WARN

- **The `--ignore` estimate lists a file pytest does run.** With
  `addopts = tests/legacy/test_old.py --ignore=tests/legacy`, the WARN's
  *likely excludes …* names `tests/legacy/test_old.py`, which pytest runs
  because it is named explicitly. The estimate should drop explicitly named
  paths from what `--ignore` removes.
- **`--reruns` fixture with a test that fails first.** The current
  `--reruns` fixtures only check the finding; add one whose test fails on
  the first attempt and passes on a rerun, with runner evidence from
  pytest-rerunfailures, to show the effect the WARN is about.
- **Dogfood policy.** The CI job that runs saidvsdid on its own PRs now fails
  only on FAIL/UNVERIFIABLE/ERROR (approved); WARNs go
  to the job summary. Revisit when the GitHub Action milestone defines how
  WARNs are reviewed (the `saidvsdid-allow` escape hatch).

## Out of the package.json scope (M2 decision)

- The net watches `scripts` and `jest`/`vitest`/`mocha`/`ava`/`c8`/`nyc`
  only. Other keys can change how tests run — `type` (ESM vs. CommonJS),
  `imports`/`exports`, `overrides`/`resolutions` (a runner or plugin
  version), `workspaces`, `engines` — and are not watched. Revisit with
  fixtures and runner evidence if one of them turns out to be a tampering
  vector.

## Found in the verification of the commit that scoped package.json to its scripts and test-runner keys

- **Raw-text comparison of `package.json` sections warns on changes that do
  not change execution**: reordering entries of `scripts`, reformatting the
  `jest` field, re-indenting. Accepted cost of not interpreting; revisit only
  with evidence that it is noise in practice.

## Found in the verification of the commit that compared package.json's sections as raw text

- **The c8 fixture has no coverage evidence.** `TG005/package-json-c8-overflow`
  runs `vitest run`, not c8: nothing records automatically what the `lines`
  threshold (`1e309` → `null`) does to a coverage check.
- **Expected noise of the conservative package.json design.** Format-only
  changes inside a watched section, `2` → `2e0`, and dependency bumps in a file
  with a BOM (the sections cannot be located, so any byte change counts) all
  warn without changing what runs.

## Accepted limits and risks

- **TG002: nested `.only` follows Vitest/Mocha.** A `it.only` inside a
  `describe.only` narrows the focus to that test. In Jest it does not narrow
  any further, so TG002 can report a false FAIL in Jest repositories (tests it
  counts as excluded still run). Conscious M1 decision; revisit with Jest
  runner evidence. *(M1)*
- **TG005/pytest assumptions.** pytest is assumed to run from its rootdir
  without extra path arguments. In `-k`, a name that matches nothing we can
  see counts as false when there is no `conftest.py`; a plugin that adds marks
  at run time would break that. *(M2)*
- **Suite time.** Every fixture builds its own git repository. Watch the
  suite's duration and reuse repositories if it goes over ~2 minutes in CI.
  *(M1)*

## Found during milestone 3

- **Claims outside the ends of turn.** Claims are read from the agent's last
  message of every turn (each judged with the evidence up to it). A claim made
  mid-turn (between tool calls) and not repeated at the end of the turn, or in
  the PR body (`source: "pr_body"` exists in the schema), is not read.
- **Claims in other phrasings and languages.** "Tests pass" without "all",
  "every", "the full suite" or a count is not a suite claim (conservative
  choice); other languages than English and Spanish are not read.
- **A rule for `tests_added`.** The claim is extracted but no rule checks it;
  TG007 checks `regression_test_added` only.
- **More test commands.** `uv run pytest`, `poetry run pytest`, `tox`,
  `python -m unittest`, `node --test`, `bun test`, `make test` are at most
  "might have been a test run" (`warn`). Recognising them needs fixtures and
  real transcripts.
- **Opaque desktop-app tools.** Codex Desktop's `codex_app.*` MCP tools
  (`open_in_codex`, `load_workspace_dependencies`, `attach_artifact`) carry no
  `readOnlyHint`, so sessions using them are opaque (TG006 at most WARN); they
  are the most common reason a Codex Desktop session is opaque. Classifying
  them needs their documented behaviour, not a guess from the name.
- **Subagent session files.** Codex subagents write their own rollout
  (`source: subagent`); linking them to the parent (`agent_thread_id`) would
  turn those sessions from opaque into complete.
- **Codex rollout, older formats.** Only the 0.158 rollout (items in
  `event_msg`/`item_completed`) is read. Older rollouts (`function_call`
  `shell`, `exec_command_end` events) are reported as unrecognised, never read
  wrong.
- **Subagent transcripts in separate files.** Claude Code keeps a subagent's
  calls in `<session>/subagents/*.jsonl`; a `Task`/`Agent` call without its
  calls in the main file makes the transcript incomplete (TG006 at most
  `warn`). Reading those files would restore the order of runs and edits.
- **Merging wrapper and transcript evidence.** `check --evidence` compares a
  recorder run's `tree_sha` with head's tree (another tree is a mismatch: not
  evaluated); a matching one verifies nothing. `check` still takes
  `--evidence` or `--transcript`, not both: a transcript's claims with the
  recorder's runs would need merging their orders.
- **`run -o` appends.** Each `saidvsdid run` overwrites the evidence file.
- **Background runs.** A Bash call with `run_in_background` has an unknown
  exit status even when a later `BashOutput` shows it.
- **Shell parsing.** Command substitution (`$(…)`), subshells, `xargs` and
  scripts are opaque: they count as possible edits, never as runs.
- **--f2p for unittest-only repositories and for Playwright.** pytest runs
  unittest tests, but a repository without pytest installed is
  `UNVERIFIABLE`; Playwright tests are not run.
- **Recorder email pattern.** `scripts/record-session.mjs` recognises emails
  by a list of top-level domains (so `@pytest.mark.x` is not an email); an
  address under an unlisted generic TLD would only be caught by the leak check
  on the git identity. Found when the first recording of `codex-regression`
  lost a `@pytest.mark.parametrize` line in `diff.patch` (restored from the
  trees, whose SHAs reproduce).
- **Benchmark corpus and scoring script** (see docs/benchmark.md).

## Found in the eighth Codex review of #3 (what a run proves; unknown is a type)

- **PowerShell mojibake.** Windows PowerShell 5.1 (and pwsh with a legacy
  console code page) can write a runner's UTF-8 output in another encoding
  (`âœ“`, `Ã—`): a summary line that is otherwise complete may not be
  recognised, so the run is unknown (never a PASS or a FAIL). Decoding it would
  need the code page the agent's shell used, which no transcript records.
- **Synchronous tools.** Every opaque tool now spans to the end of the trace.
  A closed list of synchronous tools (an MCP tool whose server documents that
  its result is its end) would need that documentation per format.
- **Subagent completion events.** `spawn_agent` would end at its completion
  event, but neither Codex format records one today; Claude Code's sidechains
  are in other files.
- ~~**The e2e guarantee for FAILs**~~ — superseded after the review of
  the commit of milestone 3's external audit: TG006/TG007 never FAIL; the e2e checks that.
- **The e2e harness's model of the agents.** Claude Code's shell reset (a `cd`
  outside the allowed directories) is not reproduced; pwsh's exit status in a
  persistent call is read by a trailer (0 if `$?`, else `$LASTEXITCODE` or 1).
- **The e2e sessions' environment.** The runners inherit the test's
  environment: run from an agent (CLAUDECODE, AI_AGENT…) vitest uses its
  `agent` reporter and no colours; in CI the `default` reporter. The same seed
  explores a different output format locally and in CI. Recording the agent
  each transcript stands for (Claude Code sets CLAUDECODE; Codex
  CODEX_SANDBOX/CODEX_THREAD_ID) would make it the agent's, not the machine's.

## Found in the seventh Codex review of #3 (closed grammar)

- **Widening the grammar, with data** (superseded by the recorder inside the
  runner, above: the grammar is no longer widened). On the local history (scan-history,
  2026-10-02), 84% of the calls with a recognised test run are outside the
  grammar: chains with `;`/`||`/newlines, subshells and command
  substitution, another command joined by `&&` before or after the runner,
  variables, flags outside the allow-lists, pipes to other programs. Each form
  to add needs its data and a case in `test/shell-cwd-real.test.ts`.
- **`cd -`** returns to the previous directory; it is unplaced even when it
  restores the repository (following `OLDPWD` would need the directory stack).
- **`pytest --rootdir` without a path of selection** still runs the local tests
  in pytest; it is unplaced (the flag is outside the allow-list). A local file
  with `--rootdir` likewise.
- **Locating a Codex exec stream's rollout.** `check --transcript` takes the
  file it is given; for an exec stream it points at the rollout in its message.
  Finding it by the thread id under `~/.codex/sessions` would be implicit
  (another file, on the user's machine): an explicit `--rollout` could do it.
- **Claude Code resetting its shell.** When a `cd` leaves the allowed
  directories, Claude Code resets the shell ("Shell cwd was reset to …" in the
  result). The cwd is then followed as the `cd` said (outside, so unplaced):
  conservative; reading the reset message would place the next runs.
- **Subagents' shells** (sidechains) are not followed separately from the
  main session's.
- **Non-blocking points of the review:** `npm --prefix OTHER test` and
  `npm test --prefix OTHER` are both unplaced now; incomplete traces,
  symlink/submodule cwd, unknown cwd, drive-relative paths and `..` over an
  unknown directory stay WARN as intended; physical Linux symlink traversal is
  now exercised by `test/location-fs-real.test.ts` on the CI's Linux and macOS.

## Found in the sixth Codex review of #3 (location)

- **Transcripts recorded at another path.** Only paths under the repository's
  root (or the `<REPO>` marker) are placed, so a transcript from another
  machine or checkout places nothing and TG006 is at most a WARN. An explicit
  mapping (`--transcript-root <path as recorded>`) would place them without
  guessing.
- **The root's own spelling.** Its components must match exactly (only the
  drive letter's case is folded): on Windows, a transcript that writes
  `C:\Users\Alice` for a repository git reports as `C:/Users/alice` places
  nothing. Asking git how the repository's file system treats case
  (`core.ignorecase`) would be a fact, not a guess, for paths under the root.
- **Runs in a subdirectory.** `cd packages/a && npm test` is placed and backs
  the claim like a run at the root; which part of the suite it ran is not
  modelled (it may be one package of a monorepo).
- **Opaque content without a place.** A line the adapter cannot read becomes an
  uncertain edit spanning the whole transcript; an unknown item with a place
  could be kept at its place.

## Found in the fourth Codex review of #3

- ~~**Escalation attributes by file, not by hunk.**~~ Superseded: there is no
  escalation (claims are warnings; a tampering finding only adds the claim as
  context).
- **Files a Bash command reported changing** (`bashEditDiff`) span the whole
  call (fifth review), so `format && npm test` with a reported change is a
  WARN that says it is not certain. Attributing them to the segment that
  wrote them would state the common cases as facts.
- **Segments of a call that overlaps others.** When other calls ran between a
  call's start and its end, each of its segments ends at the call's end, so
  `npm test && sed -i …` in such a call is a WARN rather than a FAIL: evidence/v2
  intervals do not keep the order of segments inside one call.
- **Symlinks are known only with a repository.** `check` reads the symlinks
  and submodules of base and head from git; `scan-history` and `--evidence`
  without a repository cannot, so a path through a symlink there is judged by
  its spelling.
- **Rollout items completed with no call open** (91 of 2750 in the local
  history: commands that outlived their `exec` call) are taken to have
  started anywhere in the turn. Linking them to the call that launched them
  (`process_id`) would narrow that.
- **Claude `toolUseResult.timedOutAfterMs`** (a Bash call that hit its
  timeout) is an unknown field for the adapter: the only adapter gap left in
  the local history (found by scan-history while checking this round). A
  timed-out command's exit status should be unknown, like `interrupted`; add
  it with a synthetic fixture.

## Found in the third Codex review of #3

- **"Not all tests pass, but all tests pass now."** The sentence starts with
  a direct negation of the predicate, so the monotonic extractor finds no
  claim in it, although its second clause claims the suite passes. Reading
  the claim back would need clause-level parsing of a negation followed by a
  correction; until then such a message is a silent pass (pinned in
  `test/claims-adversarial.test.ts`).
- **"1 prueba superada".** A Spanish singular count is no claim ("1 test
  passed" is a possible one): the count patterns only know "pruebas". Add the
  singular forms, as possible claims (pinned in
  `test/claims-adversarial.test.ts`).
- **"Tests pass." with no quantifier** is not a suite claim. Anchoring it at
  the start of the sentence breaks the monotonic property (a sentence placed
  before it on the same line would remove it), and matching it anywhere also
  reads "the new tests pass"; decide the scope before adding it as possible.

## Found in the second Codex review of #3

- ~~"Tests: 1/10 passed" is a possible claim.~~ Fixed in the third round: a
  ratio below its total is a direct negation of the predicate, no claim.
- **Concatenated `codex exec --json` streams.** Several `exec` runs appended
  into one file look like one turn: claims of the earlier runs are lost (only
  the last agent message ends a turn). No real capture of that shape exists
  yet; record one before handling `thread.started` as a turn boundary.

## Found in the Codex review of #3

- **Privacy scan of fixtures.** `test/transcripts.test.ts` scans recorded and
  derived transcripts for home paths, emails, tokens and the organisation id.
  Extend it to account, user and device identifiers (`accountUuid`, `userID`,
  `deviceId`, `creator_user_id`, `creator_account_id`, …), as the recorder's
  sanitiser does, so a new recording cannot bring one in unnoticed.

## Found in the external audit (before the Codex review of #3)

- **Regression claims without the word.** "I added a test that reproduces the
  bug" is a *tests added* claim but not a *regression* one, so TG007 says
  nothing (pinned in `test/claims-tg007-adversarial.test.ts`). Widening REGRESSION_NOUN ("reproduces the bug", "covers the fix")
  needs the same corpus and monotonic property first.
- **A function call in the canonical sentence.** "I added a regression test
  for median()." is possible, not certain (the parentheses): a code span in
  backticks is already plain; reading a bare call as plain would need its own
  adversarial cases (a parenthetical that qualifies vs. a call).
- **Spanish modals for "tests added".** "Deberías añadir un test de
  regresión." gives a possible *regression* claim but no *tests added* one:
  the TESTS_ADDED patterns do not read Spanish modals. Recall only.
- **Mixed code states in one evidence file.** Recorder evidence with one run
  on an older tree and one on head's tree is a mismatch (not evaluated).
  Judging only the runs on head's tree would need a merged, ordered evidence
  file (see *Merging wrapper and transcript evidence*).

**Done in round 5 (the languages' own tooling replaces the hand-written scope resolver):** Python's
`ast` and `symtable` (python/saidvsdid_scopes.py, one interpreter per run, every file in a batch,
3.9–3.13) and the TypeScript compiler (a program of the one file) decide which declaration a name
is; the rule for Python is about the whole file; exhaustiveness is checked against the interpreter's
`ast` classes and the compiler's SyntaxKinds; positions between parsers are exact. This resolves the
PEP 695 approximation and the CommonJS-wrapper entry above (the compiler knows an ES module has no
wrapper), and removes the tree-sitter node-type map (src/parse/binding-forms.ts).

**Left from round 5:**

- **Python's whole-file rule is strict by design**: `import unittest` beside `import unittest.mock`,
  `import pytest` twice, a builtin's name (`from unittest import skipIf as print`), or any other
  binding of the name anywhere (a parameter `pytest` of a helper, a class attribute) make every use a
  WARN, even where Python's scoping keeps it away from the use (`TG003/py-local-name-elsewhere-control`,
  `py-class-binds-pytest-control`, `py-builtin-shadowed-direct`, FAIL before round 5).
- **Python 3.14 and later**: not in the supported list until the script's `ast` map is checked
  against them (`--self-check`); until then every Python file is one WARN on those interpreters.
- **Nested destructuring out of a container** (`const { a: { skip: omit } } = { a: it }`) and values
  that escape (passed to a function, returned): coverage, not probed.
- **Compilers that disagree**: esbuild (vitest) does not share a namespace's exported names across
  its blocks as `tsc` does (`TG003/ts-namespace-merged-export`); saidvsdid reads TypeScript's
  semantics, uncertain there.
- **The courtesy for an assignment to an imported name** (`it = other`) reads every write the compiler
  resolves to the import's symbol; writes through `eval` or `with` are mutation, outside the
  assumption.
- **A fixture suite on an older Python**: fixtures with `minPython` (PEP 695 syntax) are skipped below
  it outside CI; CI runs Python 3.12. *(Round 6: CI's `python-versions` job runs the Python tests
  and fixtures on 3.9–3.13; `minPython` fixtures stand down below their version there.)*
- **Git blob reads in one process** (`git cat-file --batch`): saidvsdid spawns `git` once per blob it
  reads. Loading the TypeScript compiler raises the process's memory (about 47 → 126 MB) and each
  spawn costs more (measured 3.6 → 6.1 ms per `git` call), so a full check over the fixtures is
  slower end to end (≈ 45 s → 65–72 s) although the analysis itself is not (parsing the fixtures'
  1324 files: 2.5–3.1 s before, 2.6 s cold and 1.7–2.1 s cached after).

**Done in round 6 (Codex NO-GO of the commit that replaced the hand-written scope resolver with the languages' own tooling):** the Python script gets the bytes and Python decodes them
(PEP 263; another declared encoding or a BOM against the declaration is a file-level WARN); mangled
names in Python aliases; one reading of a vocabulary form rooted at a runner import or at the test
context for every binding form (extractor and net); a reply out of protocol is a WARN per file; CI
runs Python 3.9–3.13; a lone CR line break in a Python file is an explicit WARN (`lone_cr`).

**Left from round 6:**

- **Files in another encoding are not read**: a Python file declaring `latin-1`, `cp1252`… is one
  WARN and nothing in it is analysed. Reading it would need tree-sitter to see the text Python
  decodes and positions mapped back to its bytes.
- **Files with a lone CR are not read**: tree-sitter's Python grammar does not break lines at a lone
  `\r`; the file is one WARN on either side and its tests are not compared. Reading it would need
  the forms found on Python's own tree, or a grammar that agrees on line breaks.
- **Bytes that are not UTF-8 in a comment** are read, as Python's import (pytest, unittest) reads
  them; `python file.py` refuses such a file. A runner that runs the file as a script would not run
  it at all; saidvsdid reads it as imported.
- **Two findings for one context alias**: `const [omit = t.skip.bind(t)] = []` + `omit()` warns at
  the definition (`t.skip` is a site of the vocabulary) and at the use. Never silence, one more line
  than needed.
- **Python 3.14**: still outside the supported list (see round 5).

**Done in round 7 (Codex review of the commit that gave Python its files' bytes (PEP 263) and read mangled and context aliases):** Python's FAIL trusts symtable's classification as it is
(absent, or global and nothing else, in every table other than the module's; `global` declarations
bind nothing), and an imported runner name starting with `__` is never certain (no list of implicit
names); the alias net is replaced by a token-level contagion net (marking to a fixed point, every
new call, decorator or raise of a token or a marked name a WARN naming its test, whatever the
verdict); one normalisation (src/parse/normalise.ts) for every reader of expressions, keys, literals
and strings, computed keys included.

**Left from round 7:**

- **The contagion net's price**: a name exactly equal to a token that is not the runner's — a local
  helper `only` (`TG002/only-lookalikes`), RxJS's `skip(1)` operator, a query builder's `.skip(10)`,
  Django's `.only()` — makes its new calls a WARN. Strings: since the noise decision (option 1,
  refined), a string equal to a token marks a name only where a member's name is read (a subscript, a
  computed or literal key, `getattr`/`hasattr`/`setattr`/`delattr`/`Reflect.get`/`Reflect.has`'s
  name), directly or through a name the file uses there; as data it marks nothing. Measured: on the
  499 fixtures before round 7, 2 new WARN (one such helper, one real `guard.stop()` now named),
  unchanged by the refinement; on this PR's own tests, 26 contagion WARN before the refinement, 0
  after. Option 2 (names by scope, with the compilers) is in the launchable milestone above.
- **Coverage of the contagion net**: values that enter a function — a normal call is an opaque frontier,
  when marking and in a callee (`run(omit)`, `omit = wrap(it.skip)`, `k = os.environ.get("MODE",
  "skip")`, `r = f(GOOD)`); only getattr/hasattr/setattr/delattr, Reflect.get/has, subscripts and
  computed keys are transparent — a call's result called at once (`make()()`), a name built at run time
  (`"sk" + "ip"`, templates, f-strings, what a function returns: `key = lambda: "skip"` holds no string,
  so neither does a lambda that reads `getattr(pytest, KEY)` and returns it), a `def`/`function`
  declaration that calls the vocabulary (the extractor's helper rules see it), a module imported from
  another file.
- **Rounds 7c–7d (Codex review of the commit that made a string mark a name only where a member's name is read, then the noise decision)**: 7c read a callee whole, the
  arguments of the calls it holds included, and let a name hold a string through the calls it is passed
  to: 18 contagion WARN on this PR's own diff (6 `it.each` tables, 10 `expect(r.…)` after `r =
  validateReply(reply({ a: GOOD_FILE }))`, 2 `expect(f(kind))`-like). 7d makes a normal call an opaque
  frontier on both sides (only the by-name access primitives are transparent): the six 7c silences stay
  closed, `TG003/local-ctx-object` and `ts-skip-string-as-data-control` return to their pre-7c
  expectations, and the PR's own diff has **0** contagion WARN again. Left as the net's price: names
  shared by different declarations (option 2 above) and `self.x = it.skip` marking every `self`.
- **Prototype keys read as names — done in round 7e, in this PR** (found in round 7d): a lookup by an
  arbitrary name in a plain-object table found `Object.prototype`'s members. The extractor read
  `@pytest.mark.constructor` and `pytest.toString()` as markers whose kind was a function, and threw on a
  Python file that names `constructor`; the evidence reader took a field `constructor` for a known one;
  a transcript tool, a package.json script or a conftest variable of such a name was looked up the same way.
  Every table looked up by a name read from the input is now a `nameTable` (no prototype; src/util/names.ts),
  a Map or a Set, and parsed records are read through `ownRecord` or `Object.hasOwn`;
  `test/name-tables.test.ts` walks every registered table, has the TypeScript checker refuse any object
  literal typed with a string index, or looked up by an arbitrary string, outside them, and checks every
  entry point with the eight names (`TG003/py-prototype-names-control`, `ts-prototype-names-control`).
- **Round 8 (Codex review of the commit that made names read from the input never answer from Object.prototype): the silence guarantee is a closed list.** The FAIL side was clean
  for the third round in a row. A decorator and a raise are read like a call (one extraction of the
  callee, the same transparent by-name primitives: `@getattr(pytest.mark, "skip")`, `raise
  getattr(unittest, "SkipTest")` were silent); what is guaranteed is the list of src/rules/guarantee.ts,
  rendered in docs/rules.md and checked combinatorially (`test/silence-guarantee.test.ts`, 447 cases, each
  with a harmless control). Class fields and members and enums are coverage, read best effort (a literal
  computed name, an enum member). Measured: 0 existing fixtures change; on this PR's own diff, 19
  contagion WARN, all in the new `test/silence-guarantee.test.ts` (it holds the vocabulary as data): 14
  from lambda parameters `v`/`use` named like loop variables bound to that table (names by scope, option
  2 above), 5 by the rule (methods of the table, `PY_VOCAB.map`, `v.expr` on its elements).
- **Round 9 (Codex review of the commit that made the silence guarantee a closed list): one vocabulary, subscript ≡ dot in any position.** Two silences
  inside the guaranteed list: Playwright's `test.fail` was missing from the contagion net's tokens (a
  list kept by hand next to the extractor's), and a member target `this['omit'] = ctx.skip` bound no
  name (`this` and a literal key are not identifiers). The vocabulary is now one definition
  (src/parse/vocabulary.ts) from which the extractor's tables, the marker net's patterns, the contagion
  tokens, docs/rules.md's table and the matrix's vocabulary axis derive; the by-name primitives and the
  guaranteed receivers live in src/rules/guarantee.ts, read by the net and by the matrix. A literal
  subscript is the same member as a dot in any position of a receiver chain and of a target
  (`memberChain` in src/parse/normalise.ts). The matrix runs every member × every form × every use ×
  every binding form, and every receiver × a dot or a literal subscript in the target and in the use:
  9630 cases, each with a control, none sampled, analysed in batches (≈ 60 s on one worker); against
  the commit that made the silence guarantee a closed list, it fails on 1140 cases, all JS/TS: 582 `fail` (Codex P1, its `test[key]()` and
  `Reflect.get(test, 'fail')()` included), 558 `this` with a literal subscript in the target or the
  read (Codex P2, and its two halves: `this.omit = V; this['omit']()` and `this['omit'] = V;
  this.omit()`); no other gap. Fixtures: the two reproductions, their subscript variants and a control
  each, against the real runners (Playwright 1.64, now in `scripts/runner-evidence.mjs`; Vitest).
  Measured: 0 existing fixtures change; 0 contagion WARN on this PR's own diff (19 in round 8: the
  matrix held the vocabulary as data; it now reads it from the sources).
- **`fail` is a token everywhere in the contagion net** (round 9): the net reads tokens, not
  receivers, so a new `assert.fail(…)` or `expect.fail(…)` in a test is a WARN ("may turn into an
  expected failure"). The census and the marker net still count `x.fail` only on a test root
  (`it`/`test`/`specify`, the vocabulary's `testRootOnly`); narrowing the contagion net the same way
  would let `const t2 = test; const m = t2.fail; m()` go silent, so it stays as the net's price unless
  a decision says otherwise.
- **Static class fields with a computed or a string-literal name** (Codex, round 9; coverage, not the
  guarantee): `class Actions { static [field] = ctx.skip; }` and a new `Actions[field]()`, and
  `class Actions { static 'omit' = ctx.skip; }` and a new `Actions.omit()`, are silent. A field's name
  is read only as an identifier or a literal computed name; a string name and a name computed at run
  time are not.
- **`test/invariant.test.ts`, random marker insertions, is slow** (round 9; pre-existing): one test, ≈ 72 s
  alone and 77 s in the full suite on 4 cores, against its own 120 s limit — most likely the one timeout
  of Codex's full run of the commit that made the silence guarantee a closed list, a test that passed alone (that commit's matrix was 447 tests of under a second
  each). One `analyze` and one Python interpreter per mutation; batching the mutations into one
  `analyze` each (as test/silence-guarantee.test.ts now does) or splitting the test per fixture would
  hold under load. Its own PR. Round 12b: with 142 more fixtures it took ≈ 105 s alone and passed the 120 s
  limit on Windows (CI of the commit that made plugin marks WARN and added Jest's globals to the guarantee, a timeout, not a violation); its work now runs in a `beforeAll` hook
  under its own 900 s limit, and the test reads what it found. Making it faster stays here.
- **Round 10 (Codex review of the commit that made one vocabulary and a literal subscript a dot): a by-name access with a literal name is a member step.**
  `Reflect.get(box, 'omit')()`, `Reflect['get'](…)`, `raise getattr(self, "stop")` and
  `getattr(self, "omit")()` were silent after `alias.omit = …`: the by-name read was compared with the
  vocabulary's tokens only, never with the marked names. `memberStep` (src/parse/normalise.ts) now reads
  the primitives that return the member (`getattr(R, 'k'[, d])`, `Reflect.get`/`Reflect['get'](R, 'k'[,
  r])`, the list and its `reads` flag in src/rules/guarantee.ts) as `R.k`, in a read, a use and every step
  of a receiver chain; `hasattr`/`setattr`/`delattr`/`Reflect.has` stay transparent, never a step. The
  matrix is the cartesian product of the sources' axes (test/guarantee-matrix.ts): 761 311 cases, run
  whole by the CI job `guarantee matrix (full)` (8 shards) and as a 25 023-case slice by the suite; every
  exclusion is listed with its reason. Against the commit that made one vocabulary and a literal subscript a dot, the full matrix fails on 6 648 cases and the
  suite's slice on 872, all the same hole (a target written through an alias of a bare receiver, read by a
  primitive that returns the member); no other gap. The Playwright evidence recorder kept a test named
  `__proto__` in a plain object and lost it: every recorder keeps test names in a Map.
- **One unexplained failure on macOS** (round 10, the commit that added a member target through an alias of the receiver's root): the scope reader's hang, reproduced and fixed
  later (see *The Python scope reader's hang on macOS: what is left*, at the top).
- **`guarantee matrix (full)` as a required check** (round 10): the workflow has one job of that name
  that passes when the paths need no run and fails when a shard fails; making it required for the merge
  is a branch-protection setting of the repository.
- **A marked member's name held by a variable** (Codex, round 11): moved to *Best-effort improvements*, above.
- **Round 11, the CI job fails closed** (Codex review of the commit that split the guarantee matrix into a suite slice and a CI job, P2 ×2): the path filter read `git diff
  --name-only`, which reports a rename by its new path only and quotes names outside ASCII, so a watched
  file moved out of `src/parse/` or a new `src/parse/ñ.ts` skipped the matrix; and a shard that ran no case
  passed. The filter is `scripts/guarantee-matrix-paths.mjs` (`--no-renames -z`, `core.quotePath=false`,
  run on any doubt, `src/`, `python/`, the matrix and the package files watched), the runner fails on an
  empty shard, and the final check verifies the shards' reports against the generator's count
  (`test/guarantee-matrix-ci.test.ts`). Round 13 (Codex): a list of watched paths missed what it did not name
  (a renamed `grammars/tree-sitter-python.wasm` skipped the matrix); the filter is now an exclusion list —
  the matrix runs unless every changed path is under `docs/**`, a root `*.md`, `LICENSE` or
  `.github/ISSUE_TEMPLATE/**`.
- **Marking `this` spreads to other objects** (Codex, round 10; noise, not a silence): a member target
  binds every name of its receiver chain, `this` included, so after `this['omit'] = ctx.skip` an
  unrelated new call `this.ping()` is a WARN even when both sides pass. It is the same price as
  `self.x = it.skip` marking every `self` (names by file); it goes with marking by scope (option 2).
- **A member written through a call** (round 10; coverage, documented): `setattr(R, "omit", V)`,
  `Reflect.set(R, 'omit', V)`, `Object.defineProperty`, `Object.assign` bind nothing; only an assignment
  to a dot or a literal subscript does (MATRIX_EXCLUSIONS `target-not-assignable`).
- **The count net still runs only before an exit 0** and still reports per file (line null): kept as
  the second, independent net for the direct forms.
- **TG001 says "Removes test 'b'" (a WARN)** when a test is declared through a name the extractor does
  not read (`later('b', …)` with `later = omit`): it could say the test may have been redeclared.
- **Python strings whose value is not certain** (`\N{…}`) and JavaScript legacy octal escapes count as
  possible tokens in the contagion net (more WARN), and as unknown values in the config readers.

## Found in the Codex review of #7 (privacy test)

- **Read staged content from the index, not the working tree.** The privacy
  test takes its paths from git's index (`git ls-files --cached`) but reads
  each file's content from the working tree, so an email staged with
  `git add` can be hidden if the local copy is cleaned afterwards. Read the
  content from the index instead (`git show :<path>`). No effect in CI, where
  the working tree matches the commit.

## From the noise round (pilot on 50 real agent PRs)

- **TG004 when a test loses assertion calls but checks more.** `expect(text).toContain('A')`,
  `expect(text).not.toContain('b')`, `expect(JSON.parse(text)).toMatchObject({…})` replaced by
  `expect(JSON.parse(text)).toEqual({…})` and `expect(text).not.toMatch(/A|b/)` counts as "removes 1 of
  4 assertion calls", a WARN, though the exact `toEqual` is stricter. Recognising a stricter matcher
  (exact equality over a partial match, a negated pattern over a negated substring) needs its own
  certainty model; until then it stays a WARN.
- **A new test born skipped, in a PR that claims a regression test.** Since the noise round a
  disabling marker on a test that did not exist at base is an INFO line (`new_test`). Without a
  transcript nothing warns when the agent adds its "regression test" already skipped; with one, TG007
  still warns (`TG007/claude-skipped-test`). Measure how often it happens in real PRs before deciding
  whether a new test's marker should warn when a regression test is claimed.
- **The invariant's OK for new tests reads the report's own lines** (Codex review of the noise round).
  `test/invariant.test.ts` accepts an OK when every added marker stands on a line the report names
  `new_test`; it does not check by itself that the test was new. Give it an oracle of its own: the
  test's name does not appear in the file at base.
- **Grouping keeps one line and unique names** (Codex review of the noise round). A grouped finding
  (`src/rules/group.ts`) points at its first member's line, and a name repeated by two tests of the
  file appears once in `tests`. Keep every member's line (and the ordinal of a repeated name) in the
  JSON output.
- **TG005's scope in `pyproject.toml` leaves out tox and hatch** (Codex review of the noise round).
  `[tool.tox]` (tox 4's native configuration, `legacy_tox_ini`) and `[tool.hatch.envs.*.scripts]`
  run the tests but are outside `testSections`, while `tox.ini`'s `[tox]` and `[testenv*]` count.
  Add them to the scope, each with a fixture contrasted with the real runner.
- **An inline vite plugin can set `test`** (Codex review of the noise round). A plugin's `config()`
  hook may return `test.exclude`; the config net blanks `plugins` as a setting that selects no test.
  Constructed for now; decide with data whether an inline plugin object (not a call) stays in scope.
- **Measure the TG001 context sentence** (Codex review of the noise round). The noise round first
  lowered a test deleted with its local code to INFO; the review showed the code may survive renamed
  or moved, so it is now a sentence of context with the same verdict. Measure on real PRs how often a
  deletion carries it, and whether a certain "the code is gone" exists (no definition of the deleted
  body anywhere at head) before any verdict depends on it.
- **Group by cause without the context sentence** (Codex review of the commit that made TG001's changed or deleted local code context). Grouping
  (`src/rules/group.ts`) compares the whole message, so TG001's sentence about the local code a
  removed test used splits one cause in two groups (`Removes 13 tests; the local code these tests used
  …` beside `Removes 3 tests`, pilot #18). Leave the context out of the cause and keep it per member,
  or say how many of the grouped tests it applies to.

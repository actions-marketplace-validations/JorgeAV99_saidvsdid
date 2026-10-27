# saidvsdid

**What your coding agent did with the tests, in one comment.**

**[See a live example →](https://github.com/JorgeAV99/saidvsdid/pull/5)**: a pull request that weakens the tests of
[`examples/demo`](examples/demo/) on purpose (it is never merged), and the comment the Action left on it:

[![The comment saidvsdid's Action left on the example pull request](docs/img/comment.png)](https://github.com/JorgeAV99/saidvsdid/pull/5)

For whoever reviews pull requests written by coding agents. A suite can turn
green because the code was fixed, or because a test was deleted, skipped,
focused away, asserted less, or left out by a configuration change. saidvsdid
reads the pull request's diff and posts one comment that says which of those
happened, with a link to each line, before you read the rest of the change.

- Reads the code, does not run it: the syntax tree of each test file and the
  runner's configuration, at the base and at the head of the pull request.
- JavaScript/TypeScript (Vitest, Jest, Playwright, node:test, mocha-style) and
  Python (pytest, unittest). A `FAIL` needs the runner's API imported from it;
  with Jest's or Mocha's globals (`it.skip` with no import) a skip is a `WARN`.
  Every report says how many of the changed test files it read, in part or
  not at all (a Go test, a runner it does not know): an `OK` covers only them.
- Deterministic and offline: no network, no telemetry, no LLM. The Action uses
  only the job's `GITHUB_TOKEN`, to post its comment.
- It does not block by default: the check is green whatever it finds, until
  you ask it to block.

## Example

The comment the Action posts on [`fixtures/action/demo`](fixtures/action/demo/),
a synthetic pull request that deletes a test, skips another, drops an
assertion and excludes a test file in `vitest.config.ts` (on GitHub every
location links to its line):

<!-- example:comment -->
> ### saidvsdid: what this pull request does to the tests
>
> **Coverage:** 1 test file analysed
>
> **Tests removed or replaced**
>
> - ⚠️ **WARN** `src/cart.test.ts:18` (base) — `Removes test "total > rounds to cents"` <sub>TG001</sub>
>
> **Tests skipped, focused or marked to fail**
>
> - ❌ **FAIL** `src/cart.test.ts:13` — `Adds ˋit.skipˋ (skip, unconditional) to test "total > rejects a discount above 100%"` <sub>TG003</sub>
>
> **Assertions removed or relaxed**
>
> - ⚠️ **WARN** `src/cart.test.ts:5` — `Removes 1 of 2 assertion calls from "total > adds up the lines" (ˋexpect(total([])).toBe(0)ˋ); it may check less` <sub>TG004</sub>
>
> **Configuration, timeouts and retries changed**
>
> - ⚠️ **WARN** `vitest.config.ts:6` — `Test scope reduced by ˋexcludeˋ entry ˋsrc/checkout.test.tsˋ: likely excludes 1 test file that ran at base: "src/checkout.test.ts"` <sub>TG005</sub>
>
> ---
>
> **Verdict: FAIL** · 1 fail · 3 warn · 0 info — this check does not block the merge, whatever the verdict (`fail-on` not set).
>
> <sub>saidvsdid 0.3.0 · base `d2025824aa4f` → head `5b530048dd1f` · FAIL: a fact about the code, checkable by reading it · WARN: for a human to look at · `npx saidvsdid explain <RULE>` says what each rule catches and what it does not · TG006, TG007 (experimental, the agent's claims): not evaluated, the Action reads no transcript</sub>
<!-- /example:comment -->

The same pull request from the command line:

<!-- example:cli -->
```text
saidvsdid 0.3.0 — base d2025824aa4f → head 5b530048dd1f
rules: TG001, TG002, TG003, TG004, TG005 · 1 test file analysed
not evaluated: TG006 (experimental) — no transcript or evidence (--transcript, --evidence)
not evaluated: TG007 (experimental) — no transcript or evidence (--transcript, --evidence)

FAIL  TG003  src/cart.test.ts:13
      Adds `it.skip` (skip, unconditional) to test "total > rejects a discount above 100%"
WARN  TG001  src/cart.test.ts:18 (base)
      Removes test "total > rounds to cents"
WARN  TG004  src/cart.test.ts:5
      Removes 1 of 2 assertion calls from "total > adds up the lines" (`expect(total([])).toBe(0)`); it may check less
WARN  TG005  vitest.config.ts:6
      Test scope reduced by `exclude` entry `src/checkout.test.ts`: likely excludes 1 test file that ran at base: "src/checkout.test.ts"

Verdict: FAIL (1 fail, 3 warn, 0 info) — exit 2
```
<!-- /example:cli -->

Both are generated from the fixture by the test suite
([`test/readme-ci.test.ts`](test/readme-ci.test.ts)), so they stay what the
tool prints.

## Install

### GitHub Action

Add `.github/workflows/saidvsdid.yml`:

<!-- example:workflow -->
```yaml
name: saidvsdid
on: pull_request

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: saidvsdid-${{ github.workflow }}-${{ (github.event_name == 'pull_request' || github.event_name == 'pull_request_target') && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}
  cancel-in-progress: true

jobs:
  saidvsdid:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
      - uses: JorgeAV99/saidvsdid@4435bfdd2782a42bfe85ad6028eb8a595485ff48 # v0.3.0
```
<!-- /example:workflow -->

On every push to the pull request it updates the same comment (it never adds
a second one) and writes the same report to the job summary. A pull request
too large for one comment (GitHub's limit is 65,536 characters) gets the totals
by kind and by file first, as many findings as fit, the exact number it does
not show, and the full report (Markdown and JSON) attached to the job as an
artifact, linked from the comment; the job summary holds the full report too.

- **Pin it by its full commit SHA**, with the release as a comment, as
  above: a commit cannot change, so your job runs the code of the release
  you chose. Dependabot (`package-ecosystem: github-actions`) updates the SHA
  and the comment together. The SHA of each release is on its
  [release page](https://github.com/JorgeAV99/saidvsdid/releases).
- `JorgeAV99/saidvsdid@v0` is the convenient alternative: `v0` is a tag this
  repository moves to every 0.x release, so you get them without a change.
  The risk is that a tag can be moved: whoever can push tags here decides
  what code runs in your job, with its token's `pull-requests: write`.
- `fetch-depth: 0`: the diff runs from where the pull request left its base
  branch to its head, so both must be in the clone.
- Other events: on `push`, `workflow_dispatch`, `merge_group` or any event that
  is not `pull_request` or `pull_request_target`, the step writes a notice
  ("saidvsdid runs on pull_request events; nothing to check here"), sets
  `verdict` to `SKIPPED` and stays green whatever `fail-on` says. So adding it
  to a workflow that also runs on pushes is harmless. With a merge queue and
  saidvsdid as a required check, add `merge_group` to `on:` so that the queue
  sees the check: green there means the merge group's commit was not analysed;
  the analysis is the pull request's own run.
- `pull-requests: write` is only for the comment. A pull request from a fork
  gets a read-only token: the comment is not posted (a warning says so) and
  the report is still in the job summary.
- From v0.2.0 the Action runs on GitHub's own Node.js 24 and installs
  nothing: it is one bundle (`dist/action/`) with what it reads (v0.1.0
  builds itself with `npm ci` on the runner's Node.js 20 or later). Python is
  the runner's (`python3`, else `python`): any CPython that python.org
  supports (3.11–3.15 today, each tested in CI). `ubuntu-latest`, `macos-latest`
  and `windows-latest` have one; `ubuntu-22.04`'s `python3` is 3.10, so add
  `actions/setup-python` with `python-version: '3.11'` or later before saidvsdid
  (the comment says so when it finds an older one).
  A newer Python is used as it is: saidvsdid does not refuse it, and if its
  reader fails on a file, that file is a `WARN` (`scope_unavailable`), never
  `OK` and never a `FAIL`. Without Python, or with one older than 3.11, each
  Python file is a `WARN` and nothing in it is a `FAIL`.

| Input | Default | |
|---|---|---|
| `fail-on` | `none` | `none`: the check is green whatever the verdict. `fail`: it fails on `FAIL` or worse. `warn`: it fails on `WARN` or worse. |
| `exclude` | | Paths to leave out, one glob per line (test data that holds deliberately broken tests, for example). |
| `comment` | `true` | `false`: the job summary only. |
| `github-token` | the job's `GITHUB_TOKEN` | From v0.2.0. The token that posts the comment; keep the default. |

Outputs: `verdict` (`OK`, `WARN`, `FAIL`, `UNVERIFIABLE`, `ERROR`, or
`SKIPPED` on an event that is not a pull request's), `exit-code` (the CLI's;
empty when `SKIPPED`) and `comment-url`.

### Make it block

```yaml
      - uses: JorgeAV99/saidvsdid@4435bfdd2782a42bfe85ad6028eb8a595485ff48 # v0.3.0
        with:
          fail-on: fail   # or: warn
```

`fail-on: fail` fails the check on a `FAIL` and on a check that could not be
completed (`UNVERIFIABLE`, `ERROR`); `fail-on: warn` also on a `WARN`. Then
make the check required in the branch protection rules. A `WARN` is something
for a human to look at, often legitimate (a platform-conditional skip, a test
replaced by a better one), so blocking on it fits a repository where a
reviewer is expected to acknowledge it.

### Command line

Requires Node.js 20 or later and git.

```bash
npx saidvsdid check --base origin/main
```

| Command | What it does |
|---|---|
| `check --base <ref> [--head <ref>]` | Analyse what the branch changes since it left `<ref>`: the diff from their merge base to the head, as a pull request's "Files changed" and the Action show it (`--exact-base` compares the two commits as they are). `--format text\|json\|md`, `--output <file>`, `--rules TG001,TG002`, `--exclude <glob>`; `--transcript <file>` or `--evidence <file>` for the experimental claim rules (below) |
| `explain <RULE>` | What a rule catches, what it deliberately ignores, and its limits |
| `baseline --base <ref>` | The same diff through plain regular expressions, the [deliberately simple rival](docs/rules.md#baseline-the-deliberately-simple-rival) the rules are compared with |

Exit codes: `0` OK, `1` WARN, `2` FAIL, `3` UNVERIFIABLE or ERROR.

## What it detects

| Rule | What happened to the tests |
|---|---|
| [TG001](docs/rules.md#tg001-test-or-test-file-removed) | A test file or a test deleted, or replaced by an unrelated one. Renames, moves and splits are recognised. |
| [TG002](docs/rules.md#tg002-new-focused-test-only--fit) | A new focus (`.only`, `fit`, `fdescribe`…), with the tests it leaves out. |
| [TG003](docs/rules.md#tg003-new-skip--xfail--todo--fixme) | A new `skip`, `xfail`, `todo`, `fixme` or expected failure (`test.fail`, `it.fails`, `@pytest.mark.skip`, `pytest.skip()`, `self.skipTest()`…). |
| [TG004](docs/rules.md#tg004-assertion-loss-and-relaxed-matchers) | Fewer assertions in a test, or a weaker one (`toEqual` → `toBeDefined`, `== x` → `is not None`, a wider `pytest.approx`). |
| [TG005](docs/rules.md#tg005-inflated-timeouts-retries-and-reduced-suite-scope) | Inflated timeouts, new retries, and a narrower suite in the runner's configuration (`exclude`, `testPathIgnorePatterns`, `-k`, `--deselect`, `--ignore`…); any other change to what decides which tests run is a `WARN` too. |

**Verdicts.** There is no PASS: saidvsdid can say what a diff does to the
tests, never that the tests are good.

- `FAIL`: a fact about the diff's code, checkable by reading it — a test that
  ran at base and that the runner will now skip, leave out or expect to fail —
  stated only when it is certain: the marker is the runner's own (imported
  from it, not a global or a wrapper), written in one of the exact forms
  whose effect the runner guarantees, and checked against the real runner on
  the fixtures. [The contract](docs/rules.md#the-contract-a-fail-is-a-fact-about-the-code)
  says exactly when, and under which assumptions.
- `WARN`: something for a human to look at. What it reads and cannot state
  with certainty is a `WARN`: a skip through a global, a deleted test, a lost
  assertion, a configuration change. Known gaps (a skip through a helper
  function, among others) are listed in
  [docs/known-limitations.md](docs/known-limitations.md).
- `OK`: no findings in what saidvsdid read; nothing more. When some changed
  test files were read only in part or not at all, the `OK` says so and lists
  them; with none detected, it says that instead.
- `UNVERIFIABLE` / `ERROR`: the check could not be completed; never a pass.

Messages describe the code ("adds `it.skip` to test 'x'", "removes 2
assertion calls from 'x'"), not intentions.

## What it does not detect

- **Cheating in production code**: a function that special-cases the test
  input, a mock that replaces the unit under test, a hard-coded return value.
  The tests are intact; the code lies. Mutation testing and review are the
  tools for that.
- **Tests that were weak from the start**: saidvsdid compares base and head;
  it does not judge whether a new test is meaningful.
- **Indirection beyond the file**: skip or assertion helpers imported from
  another file, tests generated in loops, a framework modified at run time.
- **Changes outside what it reads**: CI workflows, environment variables,
  configs passed with `--config`, `Makefile`s and the like (the files it reads
  are below).
- **Languages other than JavaScript/TypeScript and Python.**

The full list, with the constructed counterexamples that give a `WARN` today
or fall outside an assumption, is in
[docs/known-limitations.md](docs/known-limitations.md); each rule's limits are
in [docs/rules.md](docs/rules.md).

### Files it reads

| Runner | Test files | Configuration |
|---|---|---|
| Vitest | `*.test.*`, `*.spec.*`, `test/`, `__tests__/` (JS/TS) | `vitest.config.*`, `vite.config.*`, `vitest.workspace.*`, `package.json` `vitest` |
| Jest | same | `jest.config.*`, `package.json` `jest` |
| Playwright | same | `playwright.config.*` |
| mocha / ava | same | `package.json` `mocha`, `ava` |
| pytest / unittest | `test_*.py`, `*_test.py`, `tests/` | `pytest.ini`, `pyproject.toml`, `tox.ini`, `setup.cfg`, `conftest.py` |
| any | — | `package.json` `test` scripts and what they run, `c8`, `nyc` |

A watched file created, deleted or renamed always counts. Names compare
without case (`PYTEST.INI` is pytest's file on Windows and macOS).

## How it was tested

Every rule is tested against synthetic git repositories in
[`fixtures/cases/`](fixtures/cases/), with positive, negative and hard
legitimate cases (a renamed test, a test moved between files, a
platform-conditional skip, a `.only` in a comment, an assertion moved into a
helper). Each `FAIL` fixture carries the status of its tests as the real
runner (Vitest, Jest, node:test, Playwright, pytest, unittest) reports it, and
CI checks it again on every change. saidvsdid has also been tried on real
public pull requests written by coding agents.

## The agent's claims (experimental)

Given the agent's own transcript (`--transcript`: Claude Code JSONL or
stream-json, Codex `exec --json` or its session logs), the CLI also compares
what the agent said ("all tests pass", "I added a regression test") with what
the transcript and the final diff show: "last visible test run failed", "no
test run visible after the last edit", "final diff contains no test". These
rules (TG006, TG007) are at most a `WARN`: from outside the runner nothing can
verify what a run really ran. The Action does not read transcripts. See
[docs/rules.md](docs/rules.md#tg006-suite-claimed-to-pass-what-the-visible-evidence-shows)
and [docs/evidence.md](docs/evidence.md).

## Development

```bash
npm ci
npm test           # vitest: unit tests and every fixture case
npm run typecheck
npm run build
npx tsx fixtures/show.ts TG005/   # the report of check on some fixtures
```

Fixture runner evidence is re-recorded with `npm run fixtures:runner` (add
`--check` to verify it); it needs Python with `pytest` for the Python
fixtures. The working rules of the project are in [CLAUDE.md](CLAUDE.md), the
deferred work in [docs/backlog.md](docs/backlog.md).

## License

[MIT](LICENSE). The vendored tree-sitter grammars are MIT-licensed by their
authors (`grammars/*.LICENSE`).

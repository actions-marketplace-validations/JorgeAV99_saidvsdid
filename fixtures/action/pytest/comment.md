<!-- saidvsdid:pr-comment -->
### saidvsdid: what this pull request does to the tests

**Coverage:** 1 test file analysed

**Tests removed or replaced**

- ⚠️ **WARN** [`tests/test_parse.py:20` (base)](https://github.com/octo/demo/blob/63ed3f001139150661d162eebb53ff283fb818da/tests/test_parse.py#L20) — `Removes test "test_empty_input"` <sub>TG001</sub>

**Tests skipped, focused or marked to fail**

- ❌ **FAIL** [`tests/test_parse.py:12`](https://github.com/octo/demo/blob/6fa300d202b7bce24eddc512b56342b17e5e29d9/tests/test_parse.py#L12) — `Adds ˋ@pytest.mark.skip(reason="flaky")ˋ (skip, unconditional) to test "test_ignores_empty_parts"` <sub>TG003</sub>

**Assertions removed or relaxed**

- ⚠️ **WARN** [`tests/test_parse.py:18`](https://github.com/octo/demo/blob/6fa300d202b7bce24eddc512b56342b17e5e29d9/tests/test_parse.py#L18) — `Changes ˋassert parse("ñandú, café") == ["ñandú", "café"]ˋ to ˋassert parse("ñandú, café") is not Noneˋ in "test_unicode_names": a weaker matcher on the same subject (ˋ==ˋ → ˋis not Noneˋ)` <sub>TG004</sub>

**Configuration, timeouts and retries changed**

- ⚠️ **WARN** [`pyproject.toml:7`](https://github.com/octo/demo/blob/6fa300d202b7bce24eddc512b56342b17e5e29d9/pyproject.toml#L7) — `Test scope reduced by ˋ-k "not unicode"ˋ: likely excludes 1 test that ran at base: "tests/test_parse.py::test_unicode_names"` <sub>TG005</sub>

---

**Verdict: FAIL** · 1 fail · 3 warn · 0 info — this check does not block the merge, whatever the verdict (`fail-on` not set).

<sub>saidvsdid 0.3.0 · base `63ed3f001139` → head `6fa300d202b7` · FAIL: a fact about the code, checkable by reading it · WARN: for a human to look at · `npx saidvsdid explain <RULE>` says what each rule catches and what it does not · TG006, TG007 (experimental, the agent's claims): not evaluated, the Action reads no transcript</sub>

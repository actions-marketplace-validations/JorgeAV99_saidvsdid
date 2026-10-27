<!-- saidvsdid:pr-comment -->
### saidvsdid: what this pull request does to the tests

**Coverage:** 1 test file analysed

**Tests removed or replaced**

- ⚠️ **WARN** [`src/cart.test.ts:18` (base)](https://github.com/octo/demo/blob/d2025824aa4fe47be52e79308067c3a27f40f412/src/cart.test.ts#L18) — `Removes test "total > rounds to cents"` <sub>TG001</sub>

**Tests skipped, focused or marked to fail**

- ❌ **FAIL** [`src/cart.test.ts:13`](https://github.com/octo/demo/blob/5b530048dd1f6e342527356048475428ac43a5e0/src/cart.test.ts#L13) — `Adds ˋit.skipˋ (skip, unconditional) to test "total > rejects a discount above 100%"` <sub>TG003</sub>

**Assertions removed or relaxed**

- ⚠️ **WARN** [`src/cart.test.ts:5`](https://github.com/octo/demo/blob/5b530048dd1f6e342527356048475428ac43a5e0/src/cart.test.ts#L5) — `Removes 1 of 2 assertion calls from "total > adds up the lines" (ˋexpect(total([])).toBe(0)ˋ); it may check less` <sub>TG004</sub>

**Configuration, timeouts and retries changed**

- ⚠️ **WARN** [`vitest.config.ts:6`](https://github.com/octo/demo/blob/5b530048dd1f6e342527356048475428ac43a5e0/vitest.config.ts#L6) — `Test scope reduced by ˋexcludeˋ entry ˋsrc/checkout.test.tsˋ: likely excludes 1 test file that ran at base: "src/checkout.test.ts"` <sub>TG005</sub>

---

**Verdict: FAIL** · 1 fail · 3 warn · 0 info — this check does not block the merge, whatever the verdict (`fail-on` not set).

<sub>saidvsdid 0.3.0 · base `d2025824aa4f` → head `5b530048dd1f` · FAIL: a fact about the code, checkable by reading it · WARN: for a human to look at · `npx saidvsdid explain <RULE>` says what each rule catches and what it does not · TG006, TG007 (experimental, the agent's claims): not evaluated, the Action reads no transcript</sub>

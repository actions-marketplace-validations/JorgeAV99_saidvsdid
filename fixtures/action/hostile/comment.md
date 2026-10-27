<!-- saidvsdid:pr-comment -->
### saidvsdid: what this pull request does to the tests

⚠️ **Coverage:** 3 test files analysed · 1 partly analysed

- `src/globals.test.js` — partly analysed: `base and head: a runner saidvsdid is not certain of (ˋitˋ is a global, not imported from a runner)`

**Tests removed or replaced**

- ❌ **FAIL** [`src/dˋˋˋoˋˋˋˋc.test.ts` (base)](https://github.com/octo/demo/blob/f0a1b39341c6a0d996b760d9e994dd70f29f191c/src/d%60%60%60o%60%60%60%60c.test.ts) — `Deletes the test file, which declared 1 test: "kept too"` <sub>TG001</sub>
- ❌ **FAIL** [`src/l)[o]ˋk.test.ts` (base)](https://github.com/octo/demo/blob/f0a1b39341c6a0d996b760d9e994dd70f29f191c/src/l%29[o]%60k.test.ts) — `Deletes the test file, which declared 1 test: "kept"` <sub>TG001</sub>

**Tests skipped, focused or marked to fail**

- ❌ **FAIL** [`src/names.test.ts:3`](https://github.com/octo/demo/blob/e57e4420edf3a6c77da5b9fd13e637dd9744c985/src/names.test.ts#L3) — `Adds ˋtest.skipˋ (skip, unconditional) to test "ˋˋˋ <img src=x> @octo-org/everyone ˋ"` <sub>TG003</sub>
- ❌ **FAIL** [`src/names.test.ts:7`](https://github.com/octo/demo/blob/e57e4420edf3a6c77da5b9fd13e637dd9744c985/src/names.test.ts#L7) — `Adds ˋtest.skipˋ (skip, unconditional) to test "[Verdict: OK](https://evil.example)"` <sub>TG003</sub>
- ❌ **FAIL** [`src/names.test.ts:11`](https://github.com/octo/demo/blob/e57e4420edf3a6c77da5b9fd13e637dd9744c985/src/names.test.ts#L11) — `Adds ˋtest.skipˋ (skip, unconditional) to test "![](https://evil.example/pixel.png)"` <sub>TG003</sub>
- ❌ **FAIL** [`src/names.test.ts:15`](https://github.com/octo/demo/blob/e57e4420edf3a6c77da5b9fd13e637dd9744c985/src/names.test.ts#L15) — `Adds ˋtest.skipˋ (skip, unconditional) to test "\\\\ˋ<b>bold</b>ˋ fixes octo/repo#1, see https://evil.example"` <sub>TG003</sub>
- ❌ **FAIL** [`src/names.test.ts:19`](https://github.com/octo/demo/blob/e57e4420edf3a6c77da5b9fd13e637dd9744c985/src/names.test.ts#L19) — `Adds ˋtest.skipˋ (skip, unconditional) to test "ˋ ˋ"` <sub>TG003</sub>
- ⚠️ **WARN** [`src/globals.test.js:1`](https://github.com/octo/demo/blob/e57e4420edf3a6c77da5b9fd13e637dd9744c985/src/globals.test.js#L1) — `Adds ˋit.skipˋ (skip, unconditional) to 6 tests; it may skip them: ˋitˋ is a global, not imported from a runner ("ˋˋˋ <img src=x1> @octo-org/everyone ˋ #1", "ˋˋˋ <img src=x2> @octo-org/everyone ˋ #2"…` <sub>TG003</sub>
  <details><summary>6 tests</summary><code>``` &lt;img src=x1&gt; @octo-org/everyone ` #1</code><br><code>``` &lt;img src=x2&gt; @octo-org/everyone ` #2</code><br><code>``` &lt;img src=x3&gt; @octo-org/everyone ` #3</code><br><code>``` &lt;img src=x4&gt; @octo-org/everyone ` #4</code><br><code>``` &lt;img src=x5&gt; @octo-org/everyone ` #5</code><br><code>``` &lt;img src=x6&gt; @octo-org/everyone ` #6</code></details>

---

**Verdict: FAIL** · 7 fail · 1 warn · 0 info — this check does not block the merge, whatever the verdict (`fail-on` not set).

<sub>saidvsdid 0.3.0 · base `f0a1b39341c6` → head `e57e4420edf3` · FAIL: a fact about the code, checkable by reading it · WARN: for a human to look at · `npx saidvsdid explain <RULE>` says what each rule catches and what it does not · TG006, TG007 (experimental, the agent's claims): not evaluated, the Action reads no transcript</sub>

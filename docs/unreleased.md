# Unreleased

What `main` holds since the last published version that reaches its users — the npm package or the Action's bundle
(`dist/action/`) — and so waits for the next version (CLAUDE.md, *Workflow*, 9). Emptied when a version is published.

Since v0.2.0:

- **web-tree-sitter 0.27.0 → 0.27.1** (#24, Dependabot's npm minor-and-patch group): the tree-sitter runtime, a runtime
  dependency of the package and inside the Action's bundle (`dist/action/web-tree-sitter.wasm`, rebuilt on the pull
  request). The same group brought `@playwright/test` 1.64.1 and `vitest` 4.1.12, development dependencies only.

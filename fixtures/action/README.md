# Action fixtures

Synthetic repositories for the GitHub Action's PR comment (`test/action.test.ts`): each case is a `base/` and a
`head/` tree, built into a two-commit repository by `fixtures/build.ts`. `demo` is the README's example. These are
not rule fixtures (those are in `fixtures/cases/`, with the real runner's evidence): they pin how a report reads.

`hostile` holds test names and paths written to become HTML, a mention, a link or an image in the comment; the test
reads its comment with CommonMark's reference parser. The criterion is GitHub's own renderer, which differs from it
(a backtick run longer than 80 is not a fence there): `node scripts/check-gfm-render.mjs` builds the hostile pull
requests (runs of 1 to 100 backticks, mentions, references, a SHA, schemes, HTML, `|`, `)`, `]`, 10,000 characters),
runs the Action's bundle (`dist/action/index.js`) on each against a local fake GitHub API, renders the comment it posts
with `POST /markdown` (`gh api`, mode `gfm`) and fails if the HTML
holds anything the Action does not write itself. It needs `gh` signed in, so it is not part of the suite or the CI:
run it on every change to `src/report/comment.ts`.

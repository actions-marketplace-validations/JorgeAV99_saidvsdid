// Where the package's own files are: grammars/, python/, package.json and docs/rules.md. In the package they are at
// its root, one level above this module (src/assets.ts in the tests, dist/assets.js in the CLI). The GitHub Action
// runs one bundle, dist/action/index.js (scripts/build-action.mjs), which defines SAIDVSDID_BUNDLE: its files are
// copied next to it, in dist/action/, so the Action reads nothing outside its own directory.
declare const SAIDVSDID_BUNDLE: boolean | undefined;

export const ASSETS: URL = typeof SAIDVSDID_BUNDLE !== 'undefined' && SAIDVSDID_BUNDLE ? new URL('./', import.meta.url) : new URL('../', import.meta.url);

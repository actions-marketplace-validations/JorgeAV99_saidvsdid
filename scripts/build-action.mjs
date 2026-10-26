#!/usr/bin/env node
// Builds the GitHub Action (action.yml: `runs: using: node24`, `main: dist/action/index.js`) into dist/action/: one
// ES module bundle of src/action/main.ts and everything it imports (typescript and web-tree-sitter included), and the
// files it reads next to it (src/assets.ts): the tree-sitter grammars, web-tree-sitter's runtime, the Python scope
// reader and a package.json with the version. dist/action/ is versioned, so that the Action installs and compiles
// nothing in the user's repository; full-ci's `check-dist` job rebuilds it and fails if the versioned copy differs.
//
//   node scripts/build-action.mjs
//
// The output depends only on the sources, the lockfile's packages and this script: no timestamps, no absolute paths,
// LF line endings (a source file checked out with CRLF is read as Git stores it, LF).
import { build } from 'esbuild';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist', 'action');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

await build({
  absWorkingDir: ROOT,
  entryPoints: ['src/action/main.ts'],
  outfile: 'dist/action/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  // src/assets.ts: the files are next to the bundle.
  define: { SAIDVSDID_BUNDLE: 'true' },
  // The CommonJS packages bundled (typescript) call require() for Node's own modules, and typescript's `sys` reads
  // __filename and __dirname: an ES module has none of them.
  banner: {
    js: [
      "import { createRequire as saidvsdidCreateRequire } from 'node:module';",
      "import { dirname as saidvsdidDirname } from 'node:path';",
      "import { fileURLToPath as saidvsdidFileURLToPath } from 'node:url';",
      'const require = saidvsdidCreateRequire(import.meta.url);',
      'const __filename = saidvsdidFileURLToPath(import.meta.url);',
      'const __dirname = saidvsdidDirname(__filename);',
    ].join('\n'),
  },
  legalComments: 'eof',
  charset: 'utf8',
  logLevel: 'warning',
});

// Every file is written anew, never copied: a copy keeps its source's mode (npm's tarball has web-tree-sitter.wasm
// executable, so Linux's copy differed from Windows' in Git's eyes), and the versioned files are all 644.
/** A binary file's bytes. */
const copyBytes = (from, to) => writeFileSync(to, readFileSync(from));
/** A text file as Git stores it (LF), whatever the checkout did to it. */
const copyText = (from, to) => writeFileSync(to, readFileSync(from, 'utf8').replace(/\r\n/g, '\n'));

mkdirSync(join(OUT, 'grammars'));
for (const f of readdirSync(join(ROOT, 'grammars')).sort()) {
  if (f.endsWith('.wasm')) copyBytes(join(ROOT, 'grammars', f), join(OUT, 'grammars', f));
  else copyText(join(ROOT, 'grammars', f), join(OUT, 'grammars', f));
}
copyBytes(join(ROOT, 'node_modules', 'web-tree-sitter', 'web-tree-sitter.wasm'), join(OUT, 'web-tree-sitter.wasm'));
mkdirSync(join(OUT, 'python'));
copyText(join(ROOT, 'python', 'saidvsdid_scopes.py'), join(OUT, 'python', 'saidvsdid_scopes.py'));
// The version (src/version.ts), and `type: module` for the bundle, whatever is above it.
writeFileSync(join(OUT, 'package.json'), `${JSON.stringify({ name: 'saidvsdid-action', version: pkg.version, private: true, type: 'module' }, null, 2)}\n`);

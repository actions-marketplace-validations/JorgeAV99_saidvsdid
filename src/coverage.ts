// What the check read of the test files a pull request changes (docs/rules.md, *Coverage*): an OK never reads as a
// guarantee when some of them were read only in part or not at all. The states describe the declarations saidvsdid
// recognised, never that it recognised every test of a file: a test declared through a wrapper imported from elsewhere,
// or an assertion of a library it does not know, is not seen (docs/known-limitations.md).
//
// Coverage changes no verdict, exit code or `fail-on`: it qualifies the OK's label and puts a notice before the findings.
import type { FileChange } from './git/diff.js';
import type { TestFile } from './parse/index.js';

export type CoverageState = 'analysed' | 'partly-analysed' | 'not-analysed';

export interface CoverageFile {
  /** Head path, or base path for a deleted file. */
  path: string;
  base_path: string | null;
  state: CoverageState;
  /** Why it is not `analysed`, each naming its side (`head: no test recognised`); empty when it is. */
  reasons: string[];
}

export interface Coverage {
  analysed: number;
  partly_analysed: number;
  not_analysed: number;
  /** Changed files whose every side is left out by `exclude`. */
  excluded: number;
  /** Every changed test file, sorted by path. */
  files: CoverageFile[];
}

/**
 * Test files in a language saidvsdid does not read, by naming convention: a closed table (rendered in docs/rules.md).
 * Coverage, not a guarantee: a test file named otherwise (a Rust unit test in `src/lib.rs`) is not detected.
 */
export const FOREIGN_TESTS: readonly { language: string; pattern: RegExp }[] = [
  { language: 'Go', pattern: /(?:^|\/)[^/]+_test\.go$/i },
  { language: 'Ruby', pattern: /(?:^|\/)[^/]+_(?:spec|test)\.rb$/i },
  { language: 'Rust', pattern: /(?:^|\/)tests\/(?:[^/]+\/)*[^/]+\.rs$/i },
  { language: 'Java', pattern: /(?:^|\/)[^/]*Tests?\.java$/ },
  { language: 'Kotlin', pattern: /(?:^|\/)[^/]*Tests?\.kt$/ },
  { language: 'C#', pattern: /(?:^|\/)[^/]*Tests?\.cs$/ },
  { language: 'PHP', pattern: /(?:^|\/)[^/]*Test\.php$/ },
  { language: 'Elixir', pattern: /(?:^|\/)[^/]+_test\.exs$/i },
  { language: 'Swift', pattern: /(?:^|\/)[^/]*Tests\.swift$/ },
  { language: 'Dart', pattern: /(?:^|\/)[^/]+_test\.dart$/i },
  { language: 'C/C++', pattern: /(?:^|\/)[^/]+_test\.(?:cc|cpp)$/i },
  { language: 'Bats', pattern: /\.bats$/i },
];

/** The language of a test file saidvsdid does not read, or null. */
export function foreignTestLanguage(path: string): string | null {
  const p = path.replace(/\\/g, '/');
  return FOREIGN_TESTS.find((f) => f.pattern.test(p))?.language ?? null;
}

/**
 * Test libraries saidvsdid does not read (closed list): a file that imports or requires one is partly analysed, whatever
 * else it declares (an AVA test under another name is not recognised at all).
 */
export const UNREAD_TEST_LIBRARIES: readonly string[] = ['ava', 'tap', 'tape', 'uvu', 'zora', 'bun:test', 'mocha', 'jasmine', '@japa/runner'];

const LIBRARY_IMPORT = new RegExp(
  `(?:\\bfrom\\s*|\\brequire\\s*\\(\\s*|\\bimport\\s*\\(\\s*|\\bimport\\s+)(['"])(${UNREAD_TEST_LIBRARIES.map((m) => m.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})(?:\\/[^'"]*)?\\1`,
);

/** The unread test library a JS/TS source imports, if any (a string match: it only ever adds a notice). */
export function unreadLibraryOf(source: string): string | null {
  return LIBRARY_IMPORT.exec(source)?.[2] ?? null;
}

/** One side of a changed file, as the check met it. */
export type SideReading =
  | { kind: 'absent' }
  | { kind: 'excluded' }
  /** Not a test file: no coverage for this side. */
  | { kind: 'other' }
  | { kind: 'foreign'; language: string }
  /** Parsed (or tried): the file, and its source for the library check (null for Python). */
  | { kind: 'parsed'; file: TestFile; source: string | null; named: boolean };

const RANK: Record<CoverageState, number> = { analysed: 0, 'partly-analysed': 1, 'not-analysed': 2 };

function sideState(r: SideReading): { state: CoverageState; reason: string | null } | null {
  if (r.kind === 'absent' || r.kind === 'excluded' || r.kind === 'other') return null;
  if (r.kind === 'foreign') return { state: 'not-analysed', reason: `${r.language}, a language saidvsdid does not read` };
  const f = r.file;
  if (f.parseErrors) return { state: 'not-analysed', reason: `syntax errors` };
  if (f.notAnalysed) return { state: 'not-analysed', reason: `${f.notAnalysed.why}` };
  if (!f.scopes.known) return { state: 'not-analysed', reason: `its names were not read (${f.scopes.why})` };
  const library = r.source === null ? null : unreadLibraryOf(r.source);
  if (library) return { state: 'partly-analysed', reason: `it imports ${library}, a test library saidvsdid does not read` };
  if (f.tests.length === 0) return r.named ? { state: 'partly-analysed', reason: `no test recognised` } : null;
  const uncertain = f.tests.find((t) => !t.binding.certain);
  if (uncertain && !uncertain.binding.certain) return { state: 'partly-analysed', reason: `a runner saidvsdid is not certain of (${uncertain.binding.why})` };
  return { state: 'analysed', reason: null };
}

/**
 * The coverage of the changed files: each file's state is the worse of its included sides (a clean head never erases an
 * incomplete base); a side that does not exist or is excluded does not count; each side of a rename by its own path.
 */
export function coverageOf(entries: readonly { change: FileChange; base: SideReading; head: SideReading }[]): Coverage {
  const files: CoverageFile[] = [];
  let excluded = 0;
  for (const { change, base, head } of entries) {
    const present = [base, head].filter((r) => r.kind !== 'absent');
    if (present.length > 0 && present.every((r) => r.kind === 'excluded')) {
      excluded++;
      continue;
    }
    const sides = (['base', 'head'] as const).flatMap((side) => {
      const s = sideState(side === 'base' ? base : head);
      return s === null ? [] : [{ side, ...s }];
    });
    if (sides.length === 0) continue;
    const state = sides.reduce<CoverageState>((w, s) => (RANK[s.state] > RANK[w] ? s.state : w), 'analysed');
    const why = sides.flatMap((s) => (s.reason === null ? [] : [{ side: s.side, reason: s.reason }]));
    // One reason for both sides when they agree; each side's own otherwise.
    const reasons = why.length === 2 && why[0]!.reason === why[1]!.reason ? [`base and head: ${why[0]!.reason}`] : why.map((w) => `${w.side}: ${w.reason}`);
    files.push({
      path: (change.headPath ?? change.basePath)!,
      base_path: change.basePath,
      state,
      reasons,
    });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const count = (s: CoverageState): number => files.filter((f) => f.state === s).length;
  return { analysed: count('analysed'), partly_analysed: count('partly-analysed'), not_analysed: count('not-analysed'), excluded, files };
}

/** "2 test files analysed · 1 partly analysed · 3 not analysed", the counts every report prints. */
export function coverageCounts(c: Coverage): string {
  const parts = [`${c.analysed} test file${c.analysed === 1 ? '' : 's'} analysed`];
  if (c.partly_analysed > 0) parts.push(`${c.partly_analysed} partly analysed`);
  if (c.not_analysed > 0) parts.push(`${c.not_analysed} not analysed`);
  if (c.excluded > 0) parts.push(`${c.excluded} changed path${c.excluded === 1 ? '' : 's'} excluded`);
  return parts.join(' · ');
}

/** Whether something the pull request changes was read in part or not at all. */
export const incomplete = (c: Coverage): boolean => c.partly_analysed + c.not_analysed > 0;

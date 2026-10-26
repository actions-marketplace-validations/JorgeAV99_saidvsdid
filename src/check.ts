import type { Evidence } from './evidence/schema.js';
import { evidenceFromSession, type FromTranscriptOptions } from './evidence/from-transcript.js';
import { packageScripts, type Scripts } from './transcript/commands.js';
import { parseTranscript, type AgentOption } from './transcript/index.js';
import { optionBool, pytestConfigFor } from './config/pytest.js';
import { changedFiles, compareStr, listFiles, listTree, readBlob, readBlobBytes, repoRoot, resolveCommit, treeOf, type FileChange } from './git/diff.js';
import { analysePython, isLooseTestPath, isTestPath, languageForPath, parseTestFile, pythonFacts, pythonRuntimeIfStarted, type PyFacts, type TestFile } from './parse/index.js';
import ts from 'typescript';
import { EXIT_CODES, REPORT_SCHEMA_ID, verdictFor, type FileSummary, type Mode, type NotEvaluated, type Report, type Unverifiable } from './report/model.js';
import { matchTests } from './rules/match.js';
import { contagionNet, netTests } from './rules/contagion.js';
import { configNet, markerNet } from './rules/net.js';
import { RULES, type CheckContext, type F2pOptions, type Finding, type RuleId, type Severity } from './rules/index.js';
import { isConfigPath } from './rules/TG005.js';
import { EMPTY_MODEL, type RepoModel } from './location.js';
import { globToRegExp, matchesAny } from './util/glob.js';
import { VERSION } from './version.js';
import { RULE_FAIL_EFFECT } from './rules/effects.js';
import { NEW_TEST } from './rules/util.js';
import { groupFindings } from './rules/group.js';

export interface CheckOptions {
  repo: string;
  base: string;
  head: string;
  /** Restrict to these rules; defaults to every implemented rule. */
  rules?: RuleId[];
  /** Paths to ignore entirely (gitignore-style globs). */
  exclude?: string[];
  evidence?: Evidence | null;
  /** What findings about the evidence point at (the transcript or evidence file name). */
  evidenceLabel?: string;
  /** --f2p: run the claimed regression tests on base and head. */
  f2p?: F2pOptions | null;
  /** A Claude Code or Codex transcript to build the evidence from (instead of `evidence`). */
  transcript?: { text: string; agent: AgentOption; label: string } | null;
  /** --cwd: the agent's working directory, for a transcript that does not record one (Codex `exec --json`). */
  cwd?: string | null;
}

/** The rules that judge the agent's claims: they need its side (a transcript or evidence). */
const CLAIM_RULES: ReadonlySet<RuleId> = new Set<RuleId>(['TG006', 'TG007']);

const SEVERITY_ORDER: Record<Severity, number> = { fail: 0, warn: 1, info: 2 };

function compareFindings(a: Finding, b: Finding): number {
  return (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    compareStr(a.rule, b.rule) ||
    compareStr(a.file, b.file) ||
    (a.line ?? 0) - (b.line ?? 0) ||
    compareStr(a.test ?? '', b.test ?? '') ||
    compareStr(a.message, b.message)
  );
}

/** Python's answer for a Python file of the analysis, taken once (see `analyze`): the parsing reads exactly it. */
type PyReading = (side: 'base' | 'head', path: string, bytes: Uint8Array) => PyFacts;

/** Parses a file with the settings that apply to it on that side (pytest's xfail_strict), and, for Python, its bytes and Python's answer. */
function parseOn(read: SourceReader, readBytes: BytesReader, reading: PyReading, side: 'base' | 'head', path: string, source: string): Promise<TestFile> {
  const xfailStrict = path.endsWith('.py') ? optionBool(pytestConfigFor(path, (p) => read(side, p))?.options.get('xfail_strict')) === true : false;
  const bytes = languageForPath(path) === 'python' ? readBytes(side, path) : null;
  return parseTestFile(path, source, { xfailStrict, ...(bytes ? { bytes, pyFacts: reading(side, path, bytes) } : {}) });
}

async function load(read: SourceReader, readBytes: BytesReader, reading: PyReading, side: 'base' | 'head', path: string): Promise<TestFile | null> {
  const source = read(side, path);
  if (source === null) return null;
  const file = await parseOn(read, readBytes, reading, side, path, source);
  // Parse errors first: a broken file may have lost exactly the tests that
  // would have made it a test file. Otherwise, files in a test/ directory with
  // neither tests nor skip/focus markers are plain helpers.
  if (file.parseErrors || file.notAnalysed) return file;
  if (!isTestPath(path) && file.tests.length === 0 && file.markerSites.length === 0) return null;
  return file;
}

export async function runCheck(options: CheckOptions): Promise<Report> {
  const repo = repoRoot(options.repo);
  const base = resolveCommit(repo, options.base);
  const head = resolveCommit(repo, options.head);
  const listings = new Map<'base' | 'head', string[]>();
  // Each blob is read once, as bytes: Python decodes its own (PEP 263), the rest reads UTF-8.
  const stored = new Map<string, Buffer | null>();
  const blobBytes = (side: 'base' | 'head', path: string): Buffer | null => {
    const key = `${side}\0${path}`;
    if (!stored.has(key)) stored.set(key, readBlobBytes(repo, side === 'base' ? base : head, path));
    return stored.get(key)!;
  };
  // --cwd as given (absent: none); the adapter uses it only for a format that records no directory.
  const context = { ...transcriptContext(repo, base, head), ...(options.cwd ? { cwd: options.cwd } : {}) };
  let evidence = options.evidence ?? null;
  let mode: Mode = evidence ? 'evidence' : 'diff';
  // --evidence is a file about some code: about the reviewed commits, or not evaluated.
  const binding = evidence ? bindEvidence(evidence, base, head, treeOf(repo, head)) : null;
  if (options.transcript) {
    const session = parseTranscript(options.transcript.text, options.transcript.agent);
    // The adapter places every path in the reviewed trees: about the reviewed code by construction.
    evidence = evidenceFromSession(session, context);
    mode = 'transcript';
  }
  return analyze({
    base,
    head,
    changes: changedFiles(repo, base, head),
    read: (side, path) => {
      const data = blobBytes(side, path);
      return data === null ? null : data.toString('utf8');
    },
    readBytes: (side, path) => blobBytes(side, path),
    list: (side) => {
      let files = listings.get(side);
      if (!files) listings.set(side, (files = listFiles(repo, side === 'base' ? base : head)));
      return files;
    },
    ...(options.rules ? { rules: options.rules } : {}),
    exclude: options.exclude ?? [],
    evidence,
    mode,
    ...(binding ? { binding } : {}),
    model: context.model!,
    ...(options.transcript ? { evidenceLabel: options.transcript.label } : options.evidenceLabel ? { evidenceLabel: options.evidenceLabel } : {}),
    repoDir: repo,
    f2p: options.f2p ?? null,
  });
}

/**
 * Whether an evidence file (`--evidence`) may be about the reviewed code: a
 * commit or a tree it records that is not the reviewed one (mismatch) makes
 * TG006/TG007 not evaluated (WARN). Nothing ties evidence to the code beyond
 * that: what a run loaded is known only inside the runner (backlog).
 */
export type EvidenceBinding = { kind: 'consistent' } | { kind: 'mismatch'; reasons: string[] };

export function bindEvidence(ev: Evidence, base: string, head: string, headTree: string): EvidenceBinding {
  const short = (sha: string): string => sha.slice(0, 12);
  const reasons: string[] = [];
  if (ev.repo.base !== null && ev.repo.base !== base) reasons.push(`its repo.base ${short(ev.repo.base)} is not the reviewed base ${short(base)}`);
  if (ev.repo.head !== null && ev.repo.head !== head) reasons.push(`its repo.head ${short(ev.repo.head)} is not the reviewed head ${short(head)}`);
  for (const r of ev.runs) {
    if (r.tree_sha !== null && r.tree_sha !== headTree) reasons.push(`run ${r.id} (${r.command}) ran on tree ${short(r.tree_sha)}, not the reviewed head's tree ${short(headTree)}`);
  }
  return reasons.length ? { kind: 'mismatch', reasons } : { kind: 'consistent' };
}

/**
 * What the transcript adapter needs from the repository: where it is (its
 * root: only paths under it are placed), its trees at base and head (files,
 * symlinks, submodules: paths are resolved in them, src/location.ts) and the
 * package.json scripts at head (to follow `npm run x`).
 */
export function transcriptContext(repo: string, base: string, head: string): FromTranscriptOptions {
  const scripts = new Map<string, Scripts>();
  return {
    base,
    head,
    roots: [repo],
    model: { trees: [listTree(repo, base), listTree(repo, head)] },
    scripts: (dir) => {
      if (!scripts.has(dir)) scripts.set(dir, packageScripts(readBlob(repo, head, dir ? `${dir}/package.json` : 'package.json')));
      return scripts.get(dir)!;
    },
  };
}

/** Reads a file's contents on one side of the diff; null if it does not exist there. */
export type SourceReader = (side: 'base' | 'head', path: string) => string | null;
/** Reads a file's bytes on one side of the diff, as stored; null if it does not exist there. */
export type BytesReader = (side: 'base' | 'head', path: string) => Uint8Array | null;

export interface AnalyzeInput {
  base: string;
  head: string;
  changes: FileChange[];
  read: SourceReader;
  /** The files' bytes (Python decodes its own, PEP 263); absent: what `read` gives, encoded as UTF-8. */
  readBytes?: BytesReader;
  /** Every file at a side; without it, rules that need the whole tree (TG005 scope) stay uncertain. */
  list?: (side: 'base' | 'head') => string[];
  rules?: RuleId[];
  exclude?: string[];
  evidence?: Evidence | null;
  evidenceLabel?: string;
  /** Where the evidence came from; absent: `transcript` for a transcript's evidence, `evidence` otherwise, `diff` without. */
  mode?: Mode;
  /** Whether `evidence` may be about the reviewed code (`--evidence`); absent: it is (the caller built it for this diff). */
  binding?: EvidenceBinding;
  /** The repository's trees at base and head: evidence paths are resolved in them (src/location.ts). */
  model?: RepoModel;
  repoDir?: string | null;
  f2p?: F2pOptions | null;
}

/** The git-independent core of `check`: also used by tests to analyse in-memory sources. */
export async function analyze(input: AnalyzeInput): Promise<Report> {
  const { base, head } = input;
  const given = input.evidence ?? null;
  const mode: Mode = input.mode ?? (given === null ? 'diff' : given.transcript.format !== null ? 'transcript' : 'evidence');
  const binding: EvidenceBinding = input.binding ?? { kind: 'consistent' };
  // Evidence about other code backs nothing: no rule reads it.
  const evidence = binding.kind === 'mismatch' ? null : given;
  const blobs = new Map<string, string | null>();
  const read: SourceReader = (side, path) => {
    const key = `${side}\0${path}`;
    if (!blobs.has(key)) blobs.set(key, input.read(side, path));
    return blobs.get(key)!;
  };
  const bytes = new Map<string, Uint8Array | null>();
  const readBytes: BytesReader = (side, path) => {
    const key = `${side}\0${path}`;
    if (!bytes.has(key)) {
      const text = input.readBytes ? null : read(side, path);
      bytes.set(key, input.readBytes ? input.readBytes(side, path) : text === null ? null : Buffer.from(text, 'utf8'));
    }
    return bytes.get(key)!;
  };
  const exclude = (input.exclude ?? []).map(globToRegExp);
  const candidate = (p: string | null): boolean =>
    p !== null && !matchesAny(p, exclude) && (isTestPath(p) || isLooseTestPath(p));

  const changes = input.changes.filter((c) => candidate(c.basePath) || candidate(c.headPath));
  const baseFiles = new Map<string, TestFile>();
  const headFiles = new Map<string, TestFile>();
  const renames = new Map<string, string>();
  const summaries: FileSummary[] = [];
  const unverifiable: Unverifiable[] = [];
  /** Files whose names the language's tooling did not read (no FAIL in them; one WARN each). */
  const scopeIssues = new Map<string, { side: 'base' | 'head'; why: string; reason: 'scope_unavailable' | 'lone_cr' }>();

  // Python reads the Python files of the run from their bytes, a file's base and head in the same call
  // (src/parse/py-scopes.ts). A file is judged with both sides: its two answers are taken once, here, and when Python
  // did not read one side (the reader failed, or does not compile or decode it), both are read as if Python had not
  // answered, so nothing in the file is certainly the runner's (no FAIL from any rule) and the file has one WARN
  // scope_unavailable, for that side. The parsing reads exactly these answers (`readings`), never the reader again:
  // the reader's cache may be emptied during the analysis, and it no longer bears on a file already decided.
  const pyPairs: Array<Array<{ side: 'base' | 'head'; path: string; bytes: Uint8Array }>> = [];
  for (const change of changes) {
    const pair: Array<{ side: 'base' | 'head'; path: string; bytes: Uint8Array }> = [];
    for (const [side, p] of [['base', change.basePath], ['head', change.headPath]] as const) {
      if (p && candidate(p) && languageForPath(p) === 'python') {
        const bytes = readBytes(side, p);
        if (bytes !== null) pair.push({ side, path: p, bytes });
      }
    }
    if (pair.length > 0) pyPairs.push(pair);
  }
  if (pyPairs.length > 0) analysePython(pyPairs.map((pair) => pair.map((f) => f.bytes)));
  const readings = new Map<string, PyFacts>();
  const unreadSide = new Map<string, { side: 'base' | 'head'; why: string }>();
  for (const pair of pyPairs) {
    const answers = pair.map((f) => ({ f, facts: pythonFacts(f.bytes) }));
    const failed = answers.find(({ facts }) => !facts.ok);
    for (const { f, facts } of answers) {
      if (failed && !failed.facts.ok && facts.ok) {
        readings.set(`${f.side}\0${f.path}`, { ok: false, why: `Python did not read the file's ${failed.f.side} side (${failed.facts.why})` });
      } else readings.set(`${f.side}\0${f.path}`, facts);
      if (failed && !failed.facts.ok) unreadSide.set(f.path, { side: failed.f.side, why: failed.facts.why });
    }
  }
  // A Python file outside the pairs (a rule may parse another file of the repository): its answer is taken once too.
  const reading: PyReading = (side, path, bytes) => {
    const key = `${side}\0${path}`;
    let facts = readings.get(key);
    if (facts === undefined) readings.set(key, (facts = pythonFacts(bytes)));
    return facts;
  };

  for (const change of changes) {
    const b = change.basePath && candidate(change.basePath) ? await load(read, readBytes, reading, 'base', change.basePath) : null;
    const h = change.headPath && candidate(change.headPath) ? await load(read, readBytes, reading, 'head', change.headPath) : null;
    // A file that does not parse may hide or invent tests on either side: keep
    // both sides out of the comparison and make the verdict UNVERIFIABLE.
    for (const [file, side] of [[b, 'base'], [h, 'head']] as const) {
      if (file?.parseErrors) {
        unverifiable.push({ file: file.path, side, reason: 'syntax errors; test extraction may be incomplete' });
      }
    }
    // A file not analysed (lone CR line breaks): an explicit WARN, and both sides out of the comparison.
    const notAnalysed = [[h, 'head'], [b, 'base']].find(([file]) => (file as TestFile | null)?.notAnalysed) as [TestFile, 'base' | 'head'] | undefined;
    if (notAnalysed && !b?.parseErrors && !h?.parseErrors) {
      const [file, side] = notAnalysed;
      scopeIssues.set(file.path, { side, why: file.notAnalysed!.why, reason: file.notAnalysed!.reason });
    }
    if (!b?.parseErrors && !h?.parseErrors && !notAnalysed) {
      for (const [file, side] of [[h, 'head'], [b, 'base']] as const) {
        if (file && !file.scopes.known && !scopeIssues.has(file.path)) {
          // A Python side read as unread because of the other side: the WARN names the side Python did not read.
          const failed = unreadSide.get(file.path);
          scopeIssues.set(file.path, failed ? { ...failed, reason: 'scope_unavailable' } : { side, why: file.scopes.why, reason: 'scope_unavailable' });
        }
      }
      if (b) baseFiles.set(b.path, b);
      if (h) headFiles.set(h.path, h);
      if (b && h && b.path !== h.path) renames.set(b.path, h.path);
    }
    if (b || h) {
      summaries.push({
        path: (h ?? b)!.path,
        base_path: b?.path ?? null,
        base_tests: b?.tests.length ?? 0,
        head_tests: h?.tests.length ?? 0,
        parse_errors: Boolean(b?.parseErrors || h?.parseErrors),
      });
    }
  }

  const allChanges = input.changes.filter((c) => [c.basePath, c.headPath].some((p) => p !== null && !matchesAny(p, exclude)));
  const parsed = new Map<string, Promise<TestFile | null>>();
  const ctx: CheckContext = {
    base: { sha: base, files: baseFiles },
    head: { sha: head, files: headFiles },
    changes,
    allChanges,
    configChanges: allChanges.filter((c) => [c.basePath, c.headPath].some((p) => p !== null && isConfigPath(p) && !matchesAny(p, exclude))),
    repo: {
      read,
      list: (side) => (input.list ? input.list(side).filter((p) => !matchesAny(p, exclude)) : null),
      parse: (side, path) => {
        const key = `${side}\0${path}`;
        let p = parsed.get(key);
        if (!p) {
          const source = read(side, path);
          p = source === null || !languageForPath(path) ? Promise.resolve(null) : parseOn(read, readBytes, reading, side, path, source);
          parsed.set(key, p);
        }
        return p;
      },
    },
    renames,
    matching: matchTests(baseFiles, headFiles, renames),
    evidence,
    evidenceLabel: input.evidenceLabel ?? 'evidence',
    model: input.model ?? EMPTY_MODEL,
    repoDir: input.repoDir ?? null,
    f2p: input.f2p ?? null,
    unverifiable,
  };

  const selected = RULES.filter((r) => !input.rules || input.rules.includes(r.id));
  const findings: Finding[] = [];
  for (const r of selected) findings.push(...(await r.run(ctx)));
  // Every FAIL says what it does to the tests (src/rules/effects.ts); TG003 says it by its marker.
  for (const f of findings) {
    const effect = RULE_FAIL_EFFECT[f.rule];
    if (f.severity === 'fail' && f.effect === undefined && effect !== undefined) f.effect = effect;
  }
  // A file whose names the language's tooling did not read: nothing in it is certain, and it says so once.
  const scopeRule = (['TG003', 'TG004', 'TG002', 'TG001'] as const).find((id) => selected.some((r) => r.id === id));
  if (scopeRule) {
    for (const [file, { side, why, reason }] of scopeIssues) {
      findings.push({
        rule: scopeRule,
        severity: 'warn',
        file,
        side,
        line: null,
        test: null,
        message:
          reason === 'lone_cr'
            ? `The file is not analysed: ${why}. Its tests, markers and assertions are not compared on either side`
            : `The file's names could not be read by the language's own tooling (${why}): no marker, test or assertion in it is certainly the runner's, so nothing in it is a FAIL`,
        reason,
      });
    }
  }
  // The claim rules: not evaluated without the agent's side, or with evidence about other code.
  const claimRules = selected.filter((r) => CLAIM_RULES.has(r.id)).map((r) => r.id);
  const notEvaluated: NotEvaluated[] = [];
  if (given === null) {
    for (const rule of claimRules) notEvaluated.push({ rule, reason: 'no transcript or evidence (--transcript, --evidence)' });
  } else if (binding.kind === 'mismatch') {
    const why = `the evidence is not about the reviewed code: ${binding.reasons.join('; ')}`;
    for (const rule of claimRules) {
      notEvaluated.push({ rule, reason: why });
      findings.push({ rule, severity: 'warn', file: ctx.evidenceLabel, side: 'head', line: null, test: null, message: `Not evaluated: ${why}`, reason: 'evidence_mismatch' });
    }
  }
  // Final safety net: a verdict that would be OK is re-checked against a
  // plain count of recognised markers per kind (see rules/net.ts).
  // Config files: a net independent of the readers, whatever the verdict.
  // Every change counts, deletions included (a created, deleted or renamed watched file is always a change).
  const configs = ctx.configChanges.map((ch) => ({
    basePath: ch.basePath,
    headPath: ch.headPath,
    base: ch.basePath ? read('base', ch.basePath) : null,
    head: ch.headPath ? read('head', ch.headPath) : null,
  }));
  if (selected.some((r) => r.id === 'TG005') && configs.length > 0) {
    findings.push(...(await configNet(configs, new Set(findings.filter((f) => f.rule === 'TG005').map((f) => f.file)))));
  }
  const baseOf = new Map([...renames].map(([b, h]) => [h, b] as const));
  // The contagion net (src/rules/contagion.ts): every new use of the vocabulary is at least a WARN naming
  // its test, whatever the verdict, unless a finding of the extractor already stands on it.
  if (selected.some((r) => r.id === 'TG002' || r.id === 'TG003')) {
    // A finding stands on a use when it warns; the INFO line of a disabling marker on new tests (NEW_TEST) stands on a
    // use that holds no focus.
    const marks = findings.filter((f) => (f.rule === 'TG002' || f.rule === 'TG003') && f.side === 'head' && f.line !== null && (f.severity !== 'info' || f.reason === NEW_TEST));
    const covered = (file: string, from: number, to: number, focus: boolean): boolean =>
      marks.some((f) => f.file === file && f.line! >= from && f.line! <= to && (f.severity !== 'info' || !focus));
    // A base test is known at head by the name the matching gives it (a renamed test keeps its uses).
    const headName = new Map(ctx.matching.pairs.map((p) => [`${p.base.file}\0${p.base.test.name}`, p.head.test.name] as const));
    const contagion = [...headFiles.entries()].map(([headPath, h]) => {
      const basePath = baseOf.get(headPath) ?? (baseFiles.has(headPath) ? headPath : null);
      const baseTests = basePath ? netTests(baseFiles.get(basePath)?.tests ?? [], (name) => headName.get(`${basePath}\0${name}`) ?? name) : [];
      return { basePath, headPath, base: basePath ? read('base', basePath) : null, head: read('head', headPath) ?? '', baseTests, headTests: netTests(h.tests) };
    });
    findings.push(...(await contagionNet(contagion, selected.map((r) => r.id), covered)));
  }
  if (EXIT_CODES[verdictFor(findings, unverifiable)] === 0) {
    const files = [...headFiles.keys()].map((headPath) => {
      const basePath = baseOf.get(headPath) ?? (baseFiles.has(headPath) ? headPath : null);
      return {
        basePath,
        headPath,
        base: basePath ? read('base', basePath) : null,
        head: read('head', headPath) ?? '',
        baseKnobs: basePath ? baseFiles.get(basePath)?.knobs : undefined,
        headKnobs: headFiles.get(headPath)?.knobs,
        newTestLines: new Set(findings.filter((f) => f.reason === NEW_TEST && f.file === headPath && f.line !== null).map((f) => f.line!)),
      };
    });
    findings.push(...(await markerNet({ files, rules: selected.map((r) => r.id) })));
  }
  // Several findings with the same cause in one file are one (src/rules/group.ts), after the nets have read them.
  const grouped = groupFindings(findings);
  findings.splice(0, findings.length, ...grouped);
  addClaimContext(findings, evidence);
  findings.sort(compareFindings);
  // Claims are never certified from outside the runner: nothing above INFO is OK, never a PASS.
  const verdict = verdictFor(findings, unverifiable);
  const counts: Record<Severity, number> = { fail: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;

  return {
    schema: REPORT_SCHEMA_ID,
    tool: { name: 'saidvsdid', version: VERSION, scopes: scopeTools() },
    repo: { base, head },
    mode,
    rules: selected.map((r) => r.id).filter((id) => !notEvaluated.some((n) => n.rule === id)),
    not_evaluated: notEvaluated,
    verdict,
    exit_code: EXIT_CODES[verdict],
    counts,
    unverifiable,
    files: summaries.sort((a, b) => compareStr(a.path, b.path)),
    findings: findings.map(({ tampering: _, ...f }) => f),
  };
}

/** The tools that read the files' names in this run: the TypeScript compiler, and Python when it ran. */
function scopeTools(): NonNullable<Report['tool']['scopes']> {
  const py = pythonRuntimeIfStarted();
  return {
    typescript: ts.version,
    python: py === null ? null : py.known ? py.version : null,
    ...(py !== null && !py.known ? { python_unavailable: py.why } : {}),
    // Read as any other version (docs/rules.md, *Python*): recorded, never a change of verdict.
    ...(py !== null && py.known && !py.tested ? { python_untested: `Python ${py.version} is newer than the versions saidvsdid's CI tests; it reads the files as any other version, and anything it fails on is a WARN` } : {}),
  };
}

/**
 * The agent says the suite passes, in its last turn, while the diff deletes a
 * test, skips one unconditionally or removes/relaxes its assertions (findings
 * attributed with certainty, see Finding.tampering): the finding keeps its own
 * severity and says so, as context for the reviewer.
 */
function addClaimContext(findings: Finding[], evidence: Evidence | null): void {
  const claim = evidence?.claims.find((c) => c.kind === 'suite_passed' && c.source !== 'turn_end');
  if (!claim) return;
  const said = claim.text.length > 100 ? `${claim.text.slice(0, 99)}…` : claim.text;
  for (const f of findings) if (f.tampering) f.message = `${f.message} (the agent also claimed tests pass: "${said}")`;
}

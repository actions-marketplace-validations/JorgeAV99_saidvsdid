#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runBaseline } from './baseline.js';
import { runCheck, transcriptContext } from './check.js';
import { evidenceFromSession, type FromTranscriptOptions } from './evidence/from-transcript.js';
import { EVIDENCE_SCHEMA_ID, parseEvidence, validateEvidence, type Evidence } from './evidence/schema.js';
import { repoRoot, selectBase } from './git/diff.js';
import { runWrapped } from './run.js';
import { packageScripts } from './transcript/commands.js';
import { assertKnown, parseTranscript, type AgentOption } from './transcript/index.js';
import { explainRule } from './explain.js';
import { renderJson } from './report/json.js';
import { renderMarkdown } from './report/md.js';
import { EXIT_CODES, verdictLabel, type Report } from './report/model.js';
import { renderText } from './report/text.js';
import { RULES, isRuleId, type RuleId } from './rules/index.js';
import { VERSION } from './version.js';

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
}

const HELP = `saidvsdid ${VERSION}
Did the agent do what it said? Checks test tampering in a diff; warns the reviewer where an agent's
claims and the visible evidence disagree (TG006/TG007, experimental: warnings, never verified).

Usage:
  saidvsdid check --base <ref> [--head <ref>] [--exact-base] [options]
  saidvsdid explain <RULE>
  saidvsdid evidence validate <evidence.json>
  saidvsdid evidence from-transcript <file> [--agent auto|claude|codex] [--repo <dir>]
                     [--base <ref> --head <ref> [--exact-base]] [--cwd <dir>] [--strict] [--output <file>]
  saidvsdid run [--output <evidence.json>] -- <command...>
  saidvsdid baseline --base <ref> [--head <ref>] [--exact-base] [--format ...] [--output ...]

check options:
  --base <ref>         Base (required): compared from its merge base with the head, as a
                       pull request's "Files changed" (and the GitHub Action) compare it
  --head <ref>         Head commit (default: HEAD)
  --exact-base         Compare the base commit itself, not its merge base with the head
  --repo <dir>         Repository path (default: current directory)
  --format <fmt>       text | json | md (default: text)
  --output <file>      Write the report to a file instead of stdout
  --rules <ids>        Comma-separated rules to run (default: all implemented)
  --exclude <glob>     Ignore matching paths (repeatable)
  --transcript <file>  Claude Code JSONL / stream-json or Codex exec --json transcript
                       (claims, test runs and edits for TG006/TG007)
  --agent <name>       auto | claude | codex (default: auto)
  --cwd <dir>          The agent's working directory, for a transcript that does not
                       record one (Codex exec --json): places its patches' relative
                       paths. Its test runs stay unplaced (WARN): the stream does not
                       record where each command ran. Check the session's rollout
                       (~/.codex/sessions/.../rollout-*-<session id>.jsonl) instead.
  --evidence <file>    evidence/v2 JSON instead of --transcript
  --f2p                TG007: run the claimed regression tests on base and head.
                       RUNS CODE FROM THE REPOSITORY (its tests and what they import).
  --f2p-timeout <s>    Per runner invocation (default: 120)

run: executes the command, streams its output, and writes evidence/v2 with its
exit code and the tree of the working copy; exits with the command's status.
Its runs are visible evidence, like a transcript's: they verify no claim.

baseline: the same diff analysed with plain regular expressions (no syntax tree),
the deliberately simple rival the rules are benchmarked against.

Exit codes: 0 OK (no issues found; claims are never certified) · 1 WARN · 2 FAIL · 3 ERROR/UNVERIFIABLE (never a pass)
`;

class UsageError extends Error {
  override name = 'UsageError';
}

function readEvidence(path: string): Evidence {
  const result = parseEvidence(readFileSync(path, 'utf8'));
  if (!result.ok) throw new UsageError(`invalid evidence file ${path}:\n  ${result.errors.join('\n  ')}`);
  return result.value;
}

async function cmdCheck(args: string[], io: Io): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      base: { type: 'string' },
      head: { type: 'string', default: 'HEAD' },
      'exact-base': { type: 'boolean', default: false },
      repo: { type: 'string' },
      format: { type: 'string', default: 'text' },
      output: { type: 'string' },
      rules: { type: 'string' },
      exclude: { type: 'string', multiple: true },
      evidence: { type: 'string' },
      transcript: { type: 'string' },
      agent: { type: 'string', default: 'auto' },
      cwd: { type: 'string' },
      f2p: { type: 'boolean', default: false },
      'f2p-timeout': { type: 'string', default: '120' },
    },
    strict: true,
    allowPositionals: false,
  });
  if (!values.base) throw new UsageError('check: --base <ref> is required');
  if (values.evidence && values.transcript) throw new UsageError('check: use --evidence or --transcript, not both');
  const agent = checkAgent('check', values.agent);
  const timeout = Number(values['f2p-timeout']);
  if (!(timeout > 0)) throw new UsageError('check: --f2p-timeout must be a positive number of seconds');
  const format = checkFormat('check', values.format);
  let rules: RuleId[] | undefined;
  if (values.rules) {
    rules = values.rules.split(',').map((r) => r.trim().toUpperCase()).filter(Boolean) as RuleId[];
    const implemented = new Set(RULES.map((r) => r.id));
    for (const r of rules) {
      if (!isRuleId(r)) throw new UsageError(`check: unknown rule ${JSON.stringify(r)}`);
      if (!implemented.has(r)) throw new UsageError(`check: rule ${r} is not implemented in ${VERSION} yet`);
    }
  }
  const evidence = values.evidence ? readEvidence(resolve(io.cwd, values.evidence)) : null;
  const report = await runCheck({
    repo: values.repo ?? io.cwd,
    base: values.base,
    head: values.head,
    exactBase: values['exact-base'],
    ...(rules ? { rules } : {}),
    exclude: values.exclude ?? [],
    evidence,
    ...(values.evidence ? { evidenceLabel: basename(values.evidence) } : {}),
    transcript: values.transcript
      ? { text: readFileSync(resolve(io.cwd, values.transcript), 'utf8'), agent, label: basename(values.transcript) }
      : null,
    cwd: values.cwd ? resolve(io.cwd, values.cwd) : null,
    f2p: values.f2p ? { timeoutMs: timeout * 1000 } : null,
  });
  return emit(report, format, values.output, io);
}

function checkAgent(command: string, agent: string | undefined): AgentOption {
  if (agent !== 'auto' && agent !== 'claude' && agent !== 'codex') {
    throw new UsageError(`${command}: --agent must be auto, claude or codex (got ${JSON.stringify(agent)})`);
  }
  return agent;
}

type Format = 'text' | 'json' | 'md';

function checkFormat(command: string, format: string | undefined): Format {
  if (format !== 'text' && format !== 'json' && format !== 'md') {
    throw new UsageError(`${command}: --format must be text, json or md (got ${JSON.stringify(format)})`);
  }
  return format;
}

function emit(report: Report, format: Format, output: string | undefined, io: Io): number {
  const rendered = format === 'json' ? renderJson(report) : format === 'md' ? renderMarkdown(report) : renderText(report);
  if (output) {
    writeFileSync(output, rendered);
    io.stderr(`saidvsdid: ${verdictLabel(report)} — report written to ${output}\n`);
  } else {
    io.stdout(rendered);
  }
  return report.exit_code;
}

function cmdBaseline(args: string[], io: Io): number {
  const { values } = parseArgs({
    args,
    options: {
      base: { type: 'string' },
      head: { type: 'string', default: 'HEAD' },
      'exact-base': { type: 'boolean', default: false },
      repo: { type: 'string' },
      format: { type: 'string', default: 'text' },
      output: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  if (!values.base) throw new UsageError('baseline: --base <ref> is required');
  const format = checkFormat('baseline', values.format);
  const report = runBaseline({ repo: values.repo ?? io.cwd, base: values.base, head: values.head, exactBase: values['exact-base'] });
  return emit(report, format, values.output, io);
}

function cmdExplain(args: string[], io: Io): number {
  const id = args[0]?.toUpperCase();
  if (!id) {
    io.stdout(explainRule('Rules') ?? '');
    return EXIT_CODES.OK;
  }
  const text = isRuleId(id) ? explainRule(id) : null;
  if (!text) throw new UsageError(`explain: unknown rule ${JSON.stringify(args[0])}`);
  io.stdout(text);
  return EXIT_CODES.OK;
}

function cmdEvidence(args: string[], io: Io): number {
  const [sub, ...rest] = args;
  if (sub === 'validate') {
    const path = rest[0];
    if (!path) throw new UsageError('evidence validate: missing <evidence.json>');
    readEvidence(resolve(io.cwd, path));
    io.stdout(`${path}: valid ${EVIDENCE_SCHEMA_ID}\n`);
    return EXIT_CODES.OK;
  }
  if (sub === 'from-transcript') return cmdFromTranscript(rest, io);
  throw new UsageError(`evidence: unknown subcommand ${JSON.stringify(sub ?? '')} (expected validate | from-transcript)`);
}

function cmdFromTranscript(args: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args,
    options: {
      agent: { type: 'string', default: 'auto' },
      repo: { type: 'string' },
      base: { type: 'string' },
      head: { type: 'string' },
      'exact-base': { type: 'boolean', default: false },
      cwd: { type: 'string' },
      strict: { type: 'boolean', default: false },
      output: { type: 'string' },
    },
    strict: true,
    allowPositionals: true,
  });
  const path = positionals[0];
  if (!path || positionals.length > 1) throw new UsageError('evidence from-transcript: expected exactly one <transcript> file');
  if (Boolean(values.base) !== Boolean(values.head)) throw new UsageError('evidence from-transcript: --base and --head go together');
  const session = parseTranscript(readFileSync(resolve(io.cwd, path), 'utf8'), checkAgent('evidence from-transcript', values.agent));
  if (values.strict) assertKnown(session);
  const dir = resolve(io.cwd, values.repo ?? '.');
  let options: FromTranscriptOptions;
  if (values.base && values.head) {
    const repo = repoRoot(dir);
    // The commits `check` would compare (its merge base, unless --exact-base), so that the evidence binds to them.
    const selected = selectBase(repo, values.base, values.head, values['exact-base']);
    options = transcriptContext(repo, selected.base, selected.head);
  } else {
    // No commits: the working copy's package.json, if any, for `npm run x`.
    let text: string | null = null;
    try {
      text = readFileSync(join(dir, 'package.json'), 'utf8');
    } catch {
      text = null;
    }
    const scripts = packageScripts(text);
    options = { roots: [dir], scripts: (d) => (d === '' ? scripts : null) };
  }
  const evidence = evidenceFromSession(session, { ...options, cwd: values.cwd ? resolve(io.cwd, values.cwd) : null });
  const checked = validateEvidence(evidence);
  if (!checked.ok) throw new Error(`internal error: the adapter produced invalid evidence:\n  ${checked.errors.join('\n  ')}`);
  const json = JSON.stringify(evidence, null, 2) + '\n';
  if (values.output) writeFileSync(resolve(io.cwd, values.output), json);
  else io.stdout(json);
  for (const issue of session.issues) io.stderr(`saidvsdid: transcript: ${issue.text}${issue.hides ? ' (may hide a test run or an edit)' : ''}\n`);
  return EXIT_CODES.OK;
}

async function cmdRun(args: string[], io: Io): Promise<number> {
  const dd = args.indexOf('--');
  if (dd === -1 || dd === args.length - 1) throw new UsageError('run: expected `saidvsdid run [--output <file>] -- <command...>`');
  const { values } = parseArgs({ args: args.slice(0, dd), options: { output: { type: 'string', short: 'o', default: 'evidence.json' } }, strict: true, allowPositionals: false });
  const result = await runWrapped(args.slice(dd + 1), io);
  writeFileSync(resolve(io.cwd, values.output), JSON.stringify(result.evidence, null, 2) + '\n');
  io.stderr(`saidvsdid: evidence written to ${values.output}\n`);
  return result.exitCode;
}

export async function main(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case undefined:
      case '-h':
      case '--help':
      case 'help':
        io.stdout(HELP);
        return command === undefined ? EXIT_CODES.ERROR : EXIT_CODES.OK;
      case '-v':
      case '--version':
        io.stdout(`${VERSION}\n`);
        return EXIT_CODES.OK;
      case 'check':
        return await cmdCheck(rest, io);
      case 'explain':
        return cmdExplain(rest, io);
      case 'evidence':
        return cmdEvidence(rest, io);
      case 'baseline':
        return cmdBaseline(rest, io);
      case 'run':
        return await cmdRun(rest, io);
      default:
        throw new UsageError(`unknown command ${JSON.stringify(command)}; see \`saidvsdid --help\``);
    }
  } catch (err) {
    const e = err as Error;
    const prefix = e.name === 'UsageError' || e.name === 'GitError' || e.name === 'TranscriptError' ? '' : `${e.name}: `;
    io.stderr(`saidvsdid: error: ${prefix}${e.message}\n`);
    return EXIT_CODES.ERROR;
  }
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const code = await main(process.argv.slice(2), {
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
    cwd: process.cwd(),
  });
  process.exitCode = code;
}

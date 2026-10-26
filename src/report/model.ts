import type { Finding, RuleId, Severity } from '../rules/index.js';

export const REPORT_SCHEMA_ID = 'saidvsdid/report/v1';

/**
 * UNVERIFIABLE: the analysis ran but could not see everything it needed (e.g.
 * a test file that does not parse). ERROR: the check itself could not run.
 * Both exit 3 and neither is ever a pass. Nothing above INFO is OK — "no
 * issues found" within what was analysed — exit 0. There is no PASS: an
 * agent's claims are never certified from outside the runner (backlog: a
 * recorder inside the runner).
 */
export type Verdict = 'OK' | 'WARN' | 'FAIL' | 'UNVERIFIABLE' | 'ERROR';

export const EXIT_CODES: Record<Verdict, number> = { OK: 0, WARN: 1, FAIL: 2, UNVERIFIABLE: 3, ERROR: 3 };

/** Where the agent's side came from: none (the diff alone), a transcript, or an evidence file. */
export type Mode = 'diff' | 'transcript' | 'evidence';

/** A selected rule that was not evaluated, and why (no transcript or evidence; evidence about other code). */
export interface NotEvaluated {
  rule: RuleId;
  reason: string;
}

/** How a verdict reads: OK says what it means and what it does not. */
export function verdictLabel(report: Pick<Report, 'verdict' | 'mode' | 'not_evaluated'>): string {
  if (report.verdict !== 'OK') return report.verdict;
  const notEvaluated = report.not_evaluated.map((n) => n.rule);
  if (notEvaluated.length) return `OK — no issues found (${notEvaluated.join(', ')} not evaluated)`;
  return report.mode === 'diff' ? 'OK — no issues found' : 'OK — no issues found (claims not verified)';
}

export interface FileSummary {
  /** Head path, or base path for deleted files. */
  path: string;
  base_path: string | null;
  base_tests: number;
  head_tests: number;
  parse_errors: boolean;
}

/** Something the analysis could not verify; forces the UNVERIFIABLE verdict. */
export interface Unverifiable {
  file: string;
  side: 'base' | 'head';
  reason: string;
}

export interface Report {
  schema: typeof REPORT_SCHEMA_ID;
  tool: {
    name: 'saidvsdid';
    version: string;
    /** What read the files' names (docs/rules.md, *Attribution*): the TypeScript compiler's version, and the Python interpreter's when one read Python files (null: none did). */
    scopes?: { typescript: string; python: string | null; python_unavailable?: string; python_untested?: string };
  };
  repo: { base: string; head: string };
  mode: Mode;
  /** The rules evaluated (selected and with what they need). */
  rules: RuleId[];
  /** Selected rules not evaluated: never among the rules that found nothing. */
  not_evaluated: NotEvaluated[];
  verdict: Verdict;
  exit_code: number;
  counts: Record<Severity, number>;
  unverifiable: Unverifiable[];
  files: FileSummary[];
  findings: Finding[];
}

export function verdictFor(findings: Finding[], unverifiable: Unverifiable[]): Verdict {
  // Incomplete input trumps everything: a FAIL could be an artefact of it and
  // an OK would be unfounded.
  if (unverifiable.length > 0) return 'UNVERIFIABLE';
  if (findings.some((f) => f.severity === 'fail')) return 'FAIL';
  if (findings.some((f) => f.severity === 'warn')) return 'WARN';
  return 'OK';
}

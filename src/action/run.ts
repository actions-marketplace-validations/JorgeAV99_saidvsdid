// The GitHub Action (action.yml): `saidvsdid check` on a pull request, one PR comment that a later run updates, the same
// text in the job summary, and a check that stays green whatever the verdict unless `fail-on` asks otherwise.
//
// Everything it needs from the outside comes in as values (the environment, the event, a fetch), so that
// test/action.test.ts runs it on fixture repositories with a fake GitHub API.
import { appendFileSync, readFileSync } from 'node:fs';
import { runCheck } from '../check.js';
import { MissingHistoryError } from '../git/diff.js';
import { COMMENT_MARKER, commentFits, gateText, literal, renderComment, type CommentOptions, type FailOn, type LineLink, type RestOfReport } from '../report/comment.js';
import { renderJson } from '../report/json.js';
import { uploadArtifact } from './artifact.js';
import { EXIT_CODES, type Verdict } from '../report/model.js';
import { coverageCounts, incomplete } from '../coverage.js';
import { ownRecord } from '../util/names.js';
import { VERSION } from '../version.js';

/** The identity of `GITHUB_TOKEN`: only its own comments are updated, never one someone else wrote with the marker. */
export const ACTIONS_BOT = 'github-actions[bot]';

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * The environment as runAction reads it, from the one GitHub gives the Action (action.yml, `runs: using: node24`): a
 * JavaScript action gets its inputs as `INPUT_<NAME>` with the name's hyphens kept (`INPUT_FAIL-ON`), and no token but
 * the one an input passes (`github-token`, whose default is the job's GITHUB_TOKEN).
 */
export function actionEnv(env: Env): Env {
  // Own properties only, no prototype (src/util/names.ts): runAction looks names up in it.
  return ownRecord<string | undefined>(Object.assign({}, env, { INPUT_FAIL_ON: env['INPUT_FAIL-ON'], GITHUB_TOKEN: env['INPUT_GITHUB-TOKEN'] }));
}

export interface ActionDeps {
  env: Env;
  fetch: typeof fetch;
  /** `::warning::` and friends, and plain log lines. */
  log: (line: string) => void;
}

/**
 * The events the Action analyses: a pull request's own (`pull_request_target` runs in the base's context with the same
 * payload). Any other event is SKIPPED: decided by the event's name, never by the payload's shape (a review event
 * carries a `pull_request` too, and an unreadable payload of a pull request event is an ERROR, not a skip).
 */
export const ANALYSED_EVENTS: ReadonlySet<string> = new Set(['pull_request', 'pull_request_target']);

export interface ActionResult {
  /** SKIPPED: an event that is not a pull request's; an output of the Action only, never a report's verdict (no exit code). */
  verdict: Verdict | 'SKIPPED';
  /** The check's own exit status: 1 when `fail-on` asks for it, else 0. */
  exitCode: number;
  body: string;
  commentUrl: string | null;
}

class InputError extends Error {}

/** `fail-on`: empty or `none` blocks nothing; `fail` and `warn` fail on that verdict or a worse one. */
export function parseFailOn(value: string | undefined): FailOn {
  const v = (value ?? '').trim().toLowerCase();
  if (v === '' || v === 'none') return 'none';
  if (v === 'fail' || v === 'warn') return v;
  throw new InputError(`fail-on must be none, fail or warn (got ${JSON.stringify(value)})`);
}

/** Whether the check fails: UNVERIFIABLE and ERROR (exit 3) are worse than FAIL (2), which is worse than WARN (1). */
export function blocks(verdict: Verdict, failOn: FailOn): boolean {
  const exit = EXIT_CODES[verdict];
  if (failOn === 'warn') return exit >= 1;
  if (failOn === 'fail') return exit >= 2;
  return false;
}

/** `exclude`: one glob per line (blank lines and surrounding spaces ignored). */
export function parseExclude(value: string | undefined): string[] {
  return (value ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

function parseComment(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  if (v === '' || v === 'true') return true;
  if (v === 'false') return false;
  throw new InputError(`comment must be true or false (got ${JSON.stringify(value)})`);
}

interface PullRequest {
  owner: string;
  repo: string;
  number: number;
  baseSha: string;
  headSha: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The pull request of the event, or why there is none. */
export function pullRequestOf(event: unknown, repository: string | undefined): PullRequest | string {
  const pr = isRecord(event) ? event['pull_request'] : undefined;
  if (!isRecord(pr)) return 'this event has no pull request: run saidvsdid on `pull_request`';
  const base = pr['base'];
  const head = pr['head'];
  const number = pr['number'];
  const baseSha = isRecord(base) ? base['sha'] : undefined;
  const headSha = isRecord(head) ? head['sha'] : undefined;
  const [owner, repo, ...rest] = (repository ?? '').split('/');
  const sha = (v: unknown): v is string => typeof v === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(v);
  if (!Number.isSafeInteger(number) || typeof number !== 'number' || !sha(baseSha) || !sha(headSha) || !owner || !repo || rest.length > 0) {
    return 'the event does not say which pull request, base and head to check';
  }
  return { owner, repo, number, baseSha, headSha };
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** The body of the comment when the check could not run: the reason, and the verdict ERROR. */
export function renderErrorComment(reason: string, failOn: FailOn): string {
  return [
    COMMENT_MARKER,
    '### saidvsdid: what this pull request does to the tests',
    '',
    `saidvsdid could not check this pull request: ${literal(reason)}`,
    '',
    '---',
    '',
    `**Verdict: ERROR** — nothing was checked — ${gateText(failOn)}.`,
    '',
    `<sub>saidvsdid ${VERSION}</sub>`,
    '',
  ].join('\n');
}

interface Api {
  base: string;
  token: string;
  fetch: typeof fetch;
}

async function call(api: Api, method: string, path: string, body?: unknown): Promise<unknown> {
  const headers = new Headers([
    ['authorization', `Bearer ${api.token}`],
    ['accept', 'application/vnd.github+json'],
    ['x-github-api-version', '2022-11-28'],
    ['user-agent', `saidvsdid/${VERSION}`],
  ]);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const res = await api.fetch(`${api.base}${path}`, body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const hint = res.status === 403 || res.status === 404 ? ' (the job needs `permissions: pull-requests: write`; a pull request from a fork gets a read-only token)' : '';
    throw new Error(`GitHub API ${method} ${path}: ${res.status}${hint}`);
  }
  return res.json();
}

/** Updates saidvsdid's comment on the pull request, or creates it when there is none: one comment per pull request. */
export async function upsertComment(api: Api, pr: PullRequest, body: string): Promise<string | null> {
  const issue = `/repos/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}/issues`;
  let existing: number | null = null;
  // 100 per page, the API's maximum; a pull request with more than 10,000 comments gets a new one.
  for (let page = 1; page <= 100 && existing === null; page++) {
    const list = await call(api, 'GET', `${issue}/${pr.number}/comments?per_page=100&page=${page}`);
    if (!Array.isArray(list)) throw new Error('GitHub API: the list of comments is not a list');
    for (const c of list) {
      if (!isRecord(c) || typeof c['id'] !== 'number' || typeof c['body'] !== 'string') continue;
      const user = c['user'];
      if (isRecord(user) && user['login'] === ACTIONS_BOT && c['body'].startsWith(COMMENT_MARKER)) {
        existing = c['id'];
        break;
      }
    }
    if (list.length < 100) break;
  }
  const res = existing === null ? await call(api, 'POST', `${issue}/${pr.number}/comments`, { body }) : await call(api, 'PATCH', `${issue}/comments/${existing}`, { body });
  return isRecord(res) && typeof res['html_url'] === 'string' ? res['html_url'] : null;
}

/** What a run found: the verdict, the comment's body, a line for the log (coverage counts, or the ERROR's reason), and whether an OK is qualified. */
interface Analysis {
  verdict: Verdict;
  body: string;
  detail: string;
  /** An OK that does not cover everything the pull request changes (src/coverage.ts): a warning, not a notice. */
  qualified: boolean;
  /** The job summary: the comment when it holds everything; else the full report when it fits GitHub's limit for a step summary; else the comment. */
  summary: string;
}

/** GitHub's limit for one step's summary is 1 MiB; the full report goes there when its UTF-8 bytes are at most this. */
const SUMMARY_LIMIT = 1_000_000;

function failure(reason: string, failOn: FailOn): Analysis {
  const body = renderErrorComment(reason, failOn);
  return { verdict: 'ERROR', body, detail: reason, qualified: false, summary: body };
}

async function analyse(env: Env, fetchImpl: typeof fetch, pr: PullRequest, failOn: FailOn, exclude: string[]): Promise<Analysis> {
  const workspace = env['GITHUB_WORKSPACE'] || process.cwd();
  try {
    // The pull request's own changes: from where it left its base branch, as GitHub's "Files changed" shows them — the
    // same selection as the CLI's `check --base` (src/git/diff.ts, selectBase), inside runCheck.
    const report = await runCheck({ repo: workspace, base: pr.baseSha, head: pr.headSha, baseLabel: 'pull_request.base.sha', exclude });
    const server = (env['GITHUB_SERVER_URL'] || 'https://github.com').replace(/\/+$/, '');
    const repoUrl = `${server}/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}`;
    const link: LineLink = (side, file, line) => `${repoUrl}/blob/${side === 'base' ? report.repo.base : report.repo.head}/${encodePath(file)}${line === null ? '' : `#L${line}`}`;
    const c = report.coverage;
    const qualified = report.verdict === 'OK' && c !== undefined && (incomplete(c) || c.analysed === 0);
    const options: CommentOptions = { link, failOn };
    const full = renderComment(report, { ...options, full: true });
    let body = renderComment(report, options);
    if (!commentFits(report, options)) {
      // The comment cannot hold everything: the full report, Markdown and JSON from this same report, as the job's
      // artifact; when it cannot be attached, what reproduces it. Neither changes the verdict or the gate.
      const encode = (s: string): Uint8Array => new TextEncoder().encode(s);
      const upload = await uploadArtifact(
        [
          { name: 'saidvsdid-report.md', bytes: encode(full.slice(COMMENT_MARKER.length + 1)) },
          { name: 'saidvsdid-report.json', bytes: encode(renderJson(report)) },
        ],
        { env, fetch: fetchImpl },
      );
      const rest: RestOfReport = upload.ok
        ? { kind: 'artifact', url: upload.url }
        : { kind: 'reproduce', why: upload.why, pr: pr.number, baseSha: pr.baseSha, mergeBase: report.repo.base, head: report.repo.head, exclude, version: VERSION };
      body = renderComment(report, { ...options, rest });
    }
    // The summary is the comment when it holds everything; else the full report, when GitHub's limit allows it.
    const summary = commentFits(report, options) || new TextEncoder().encode(full).length > SUMMARY_LIMIT ? body : full;
    return { verdict: report.verdict, body, detail: c ? coverageCounts(c) : '', qualified, summary };
  } catch (e) {
    // A commit missing or the history cut: the checkout; any other reason (two histories with no common ancestor) as it is.
    if (e instanceof MissingHistoryError) {
      return failure(`the base and head commits are not both in the clone, with the history between them (${pr.baseSha.slice(0, 12)}, ${pr.headSha.slice(0, 12)}): check out with \`fetch-depth: 0\``, failOn);
    }
    return failure(e instanceof Error ? e.message : String(e), failOn);
  }
}

/** A workflow command's data on one line, escaped as the runner reads it (`%`, CR, LF), so a message cannot start another command. */
export function commandData(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export async function runAction(deps: ActionDeps): Promise<ActionResult> {
  const { env } = deps;
  const log = (line: string): void => {
    const m = /^(::[a-z]+::)([\s\S]*)$/.exec(line);
    deps.log(m ? `${m[1]}${commandData(m[2]!)}` : line);
  };
  let failOn: FailOn;
  let exclude: string[];
  let comment: boolean;
  try {
    failOn = parseFailOn(env['INPUT_FAIL_ON']);
    exclude = parseExclude(env['INPUT_EXCLUDE']);
    comment = parseComment(env['INPUT_COMMENT']);
  } catch (e) {
    // A misconfigured workflow is not a verdict: it fails, so that it gets fixed.
    const message = e instanceof Error ? e.message : String(e);
    log(`::error::saidvsdid: ${message}`);
    return { verdict: 'ERROR', exitCode: 1, body: '', commentUrl: null };
  }

  // Which event, before anything is read: an event that is not a pull request's has nothing to check, and the check
  // stays green whatever `fail-on` says (it gates verdicts, and there is none).
  const eventName = env['GITHUB_EVENT_NAME'];
  if (eventName && !ANALYSED_EVENTS.has(eventName)) {
    const summary = env['GITHUB_STEP_SUMMARY'];
    if (summary) appendFileSync(summary, `saidvsdid runs on pull_request events; nothing to check here (event: ${literal(eventName)}).\n`);
    const output = env['GITHUB_OUTPUT'];
    if (output) appendFileSync(output, 'verdict=SKIPPED\nexit-code=\ncomment-url=\n');
    log(`::notice::saidvsdid runs on pull_request events; nothing to check here (event: ${eventName})`);
    return { verdict: 'SKIPPED', exitCode: 0, body: '', commentUrl: null };
  }

  let event: unknown = null;
  try {
    event = JSON.parse(readFileSync(env['GITHUB_EVENT_PATH'] ?? '', 'utf8'));
  } catch {
    event = null;
  }
  const pr = eventName ? pullRequestOf(event, env['GITHUB_REPOSITORY']) : 'no GITHUB_EVENT_NAME: saidvsdid runs as a step of a GitHub Actions workflow';
  const { verdict, body, detail, qualified, summary: summaryText } = typeof pr === 'string' ? failure(pr, failOn) : await analyse(env, deps.fetch, pr, failOn, exclude);

  const summary = env['GITHUB_STEP_SUMMARY'];
  if (summary) appendFileSync(summary, summaryText.slice(COMMENT_MARKER.length + 1));

  let commentUrl: string | null = null;
  if (comment && typeof pr !== 'string') {
    try {
      commentUrl = await upsertComment({ base: (env['GITHUB_API_URL'] || 'https://api.github.com').replace(/\/+$/, ''), token: env['GITHUB_TOKEN'] ?? '', fetch: deps.fetch }, pr, body);
    } catch (e) {
      // The verdict is in the job summary either way; a comment that could not be posted never changes the check.
      log(`::warning::saidvsdid: the PR comment was not posted: ${e instanceof Error ? e.message : String(e)}. The report is in the job summary.`);
    }
  }

  const output = env['GITHUB_OUTPUT'];
  if (output) appendFileSync(output, `verdict=${verdict}\nexit-code=${EXIT_CODES[verdict]}\ncomment-url=${commentUrl ?? ''}\n`);

  const fails = blocks(verdict, failOn);
  const level = verdict === 'OK' && !qualified ? 'notice' : fails ? 'error' : 'warning';
  // The verdict, then what it covers or why it could not run: the log says as much as the comment's first lines.
  log(`::${level}::saidvsdid: ${verdict}${detail ? ` — ${detail}` : ''}${fails ? ` (fail-on: ${failOn})` : failOn === 'none' ? ' (not blocking: fail-on is not set)' : ` (not blocking: fail-on: ${failOn})`}${commentUrl ? ` — ${commentUrl}` : ''}`);
  return { verdict, exitCode: fails ? 1 : 0, body, commentUrl };
}

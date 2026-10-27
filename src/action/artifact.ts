// The job's full report as an artifact, when the PR comment cannot hold all of it (docs/rules.md, *The GitHub Action*).
//
// A client of GitHub's artifact service (protocol v4, the one `actions/upload-artifact@v4+` and `@actions/artifact` use)
// with no dependency: CreateArtifact → PUT the zip to the signed URL → FinalizeArtifact. It uses the runtime credentials
// GitHub gives every JavaScript action (`ACTIONS_RUNTIME_TOKEN`, `ACTIONS_RESULTS_URL`), so it works on a pull request
// from a fork too, where the job's token cannot comment. Bundling `@actions/artifact` instead was rejected for the
// Action's supply chain (255 packages for one upload).
//
// Credentials: the bearer token goes only to the Results service's origin; the signed upload URL gets no Authorization
// header; no request follows a redirect; no token, signed URL or response body reaches an error, a log or the comment
// (errors name the step and the HTTP status). An upload that fails never changes the verdict or the gate: the comment
// says so and gives the reproduction instead. Not attempted on GitHub Enterprise Server (no v4 artifacts there).
import { createHash, randomBytes } from 'node:crypto';

export interface ArtifactFile {
  name: string;
  bytes: Uint8Array;
}

export type UploadResult = { ok: true; id: string; name: string; url: string } | { ok: false; why: string };

export interface ArtifactDeps {
  env: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
  /** Waits between attempts (tests pass one that does not wait). */
  sleep?: (ms: number) => Promise<void>;
  /** Eight hex digits for the artifact's name (tests pass a fixed one). */
  suffix?: () => string;
}

/** One attempt's deadline, the attempts per request and the waits between them. */
const TIMEOUT_MS = 30_000;
const ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 2_000];

const SERVICE = 'twirp/github.actions.results.api.v1.ArtifactService';

class UploadError extends Error {}

/** Whether the server is GitHub.com or GitHub Enterprise Cloud with data residency (the toolkit's own test): v4 artifacts. */
export function artifactsSupported(serverUrl: string | undefined): boolean {
  let host: string;
  try {
    host = new URL(serverUrl || 'https://github.com').hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === 'github.com' || host.endsWith('.ghe.com') || host.endsWith('.ghe.localhost');
}

/** The workflow run's and job's backend ids, from the runtime token's `scp` claim (`Actions.Results:<run>:<job>`). */
export function backendIds(token: string): { run: string; job: string } | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const scp = typeof claims === 'object' && claims !== null ? (claims as Record<string, unknown>)['scp'] : undefined;
  if (typeof scp !== 'string') return null;
  for (const scope of scp.split(' ')) {
    const parts = scope.split(':');
    if (parts[0] === 'Actions.Results' && parts.length === 3 && parts[1] && parts[2]) return { run: parts[1], job: parts[2] };
  }
  return null;
}

// CRC-32 (IEEE 802.3), for the zip's entries.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A zip of the files, stored (no compression), names in UTF-8 (flag bit 11), dated 1980-01-01 00:00 so that the same
 * files give the same bytes. Each file must be under 4 GiB and the names unique: a report is a few megabytes at most.
 */
export function zip(files: readonly ArtifactFile[]): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.from(f.bytes);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed: 2.0
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(0, 8); // stored
    header.writeUInt16LE(0, 10); // 00:00
    header.writeUInt16LE(0x21, 12); // 1980-01-01
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // made by: 2.0
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, directory, end]));
}

/** A request with a deadline and no redirect; retried on a network error, 429 and 5xx. The step names it in errors. */
async function request(deps: ArtifactDeps, step: string, url: string, init: RequestInit): Promise<Response> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last = '';
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!);
    let res: Response;
    try {
      res = await deps.fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      last = `${step}: the request failed`;
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      last = `${step}: HTTP ${res.status}`;
      continue;
    }
    return res;
  }
  throw new UploadError(last);
}

async function twirp(deps: ArtifactDeps, origin: string, token: string, method: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const res = await request(deps, method, `${origin}/${SERVICE}/${method}`, {
    method: 'POST',
    headers: new Headers([
      ['authorization', `Bearer ${token}`],
      ['content-type', 'application/json'],
      ['accept', 'application/json'],
    ]),
    body: JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json: typeof json === 'object' && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null };
}

/**
 * Uploads the files as one zipped artifact of the job, named `saidvsdid-report-<job>-<8 hex>` (unique across matrix jobs and
 * reruns; one more try with a new suffix when the name is taken), and returns its page on GitHub, or why it could not.
 */
export async function uploadArtifact(files: readonly ArtifactFile[], deps: ArtifactDeps): Promise<UploadResult> {
  const env = deps.env;
  if (!artifactsSupported(env['GITHUB_SERVER_URL'])) return { ok: false, why: 'this GitHub server has no v4 artifacts (GitHub Enterprise Server)' };
  const token = env['ACTIONS_RUNTIME_TOKEN'];
  const results = env['ACTIONS_RESULTS_URL'];
  const [owner, repo, ...rest] = (env['GITHUB_REPOSITORY'] ?? '').split('/');
  const runId = env['GITHUB_RUN_ID'];
  if (!token || !results || !owner || !repo || rest.length > 0 || !runId || !/^\d+$/.test(runId)) return { ok: false, why: 'the job has no artifact credentials (ACTIONS_RUNTIME_TOKEN, ACTIONS_RESULTS_URL)' };
  let origin: string;
  try {
    const u = new URL(results);
    if (u.protocol !== 'https:') return { ok: false, why: 'ACTIONS_RESULTS_URL is not https' };
    origin = u.origin;
  } catch {
    return { ok: false, why: 'ACTIONS_RESULTS_URL is not a URL' };
  }
  const ids = backendIds(token);
  if (!ids) return { ok: false, why: 'the runtime token names no workflow run and job' };
  const body = zip(files);
  const sha256 = createHash('sha256').update(body).digest('hex');
  const job = (env['GITHUB_JOB'] ?? 'job').replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 60);
  const suffix = deps.suffix ?? (() => randomBytes(4).toString('hex'));
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const name = `saidvsdid-report-${job}-${suffix()}`;
      const ref = { workflow_run_backend_id: ids.run, workflow_job_run_backend_id: ids.job, name };
      const created = await twirp(deps, origin, token, 'CreateArtifact', { ...ref, version: 4 });
      if (created.status === 409 && attempt === 0) continue; // the name is taken: one more try with another suffix
      const signed = created.json?.['signed_upload_url'];
      if (created.status !== 200 || created.json?.['ok'] !== true || typeof signed !== 'string') throw new UploadError(`CreateArtifact: HTTP ${created.status}`);
      let blobUrl: URL;
      try {
        blobUrl = new URL(signed);
      } catch {
        throw new UploadError('CreateArtifact: the upload URL is not a URL');
      }
      if (blobUrl.protocol !== 'https:') throw new UploadError('CreateArtifact: the upload URL is not https');
      // The signed URL carries its own authorisation: no Authorization header goes to the storage.
      const put = await request(deps, 'upload', blobUrl.href, { method: 'PUT', headers: new Headers([['x-ms-blob-type', 'BlockBlob'], ['content-type', 'application/zip']]), body });
      if (put.status !== 201 && put.status !== 200) throw new UploadError(`upload: HTTP ${put.status}`);
      const finalized = await twirp(deps, origin, token, 'FinalizeArtifact', { ...ref, size: String(body.length), hash: `sha256:${sha256}` });
      const id = finalized.json?.['artifact_id'];
      const idText = typeof id === 'string' || typeof id === 'number' ? String(id) : '';
      if (finalized.status !== 200 || finalized.json?.['ok'] !== true || !/^\d+$/.test(idText)) throw new UploadError(`FinalizeArtifact: HTTP ${finalized.status}`);
      const server = (env['GITHUB_SERVER_URL'] || 'https://github.com').replace(/\/+$/, '');
      return { ok: true, id: idText, name, url: `${server}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}/artifacts/${idText}` };
    }
    return { ok: false, why: 'CreateArtifact: the name is taken' };
  } catch (e) {
    return { ok: false, why: e instanceof UploadError ? e.message : 'the upload failed' };
  }
}

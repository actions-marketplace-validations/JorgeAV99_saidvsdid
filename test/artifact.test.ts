// The artifact client (src/action/artifact.ts) against a fake artifact service: the protocol's three steps, where the
// credentials go and where they never go, retries, a taken name, failures that say only the step and the status, and a
// zip that an independent reader (Python's zipfile) extracts byte for byte. The hosted round trip is CI's
// (.github/actions/artifact-roundtrip).
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { artifactsSupported, backendIds, crc32, uploadArtifact, zip, type ArtifactDeps } from '../src/action/artifact.js';
import { pythonRuntime } from '../src/parse/py-scopes.js';

const RUN = 'ce7f54c7-61c7-4aae-887f-30da475f5f1a';
const JOB = 'ca395085-040a-526b-2ce8-bdc85f692774';
const jwt = (claims: unknown): string => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const TOKEN = jwt({ scp: `Actions.GenericRead:1 Actions.Results:${RUN}:${JOB}` });
const ENV = {
  ACTIONS_RUNTIME_TOKEN: TOKEN,
  ACTIONS_RESULTS_URL: 'https://results.example.test/',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'octo/demo',
  GITHUB_RUN_ID: '42',
  GITHUB_JOB: 'saidvsdid',
};
const FILES = [
  { name: 'saidvsdid-report.md', bytes: new TextEncoder().encode('# informe — ñ ✓\n') },
  { name: 'saidvsdid-report.json', bytes: new TextEncoder().encode('{"verdict":"FAIL"}\n') },
];

interface Seen {
  method: string;
  url: string;
  headers: Headers;
  redirect: RequestInit['redirect'];
  body: unknown;
}

/** A fake service: answers by step, with a status per step's attempt; records every request. */
function service(statuses: Partial<Record<'create' | 'put' | 'finalize', number[]>> = {}) {
  const seen: Seen[] = [];
  const left = { create: [...(statuses.create ?? [])], put: [...(statuses.put ?? [])], finalize: [...(statuses.finalize ?? [])] };
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    seen.push({ method: init?.method ?? 'GET', url: u, headers, redirect: init?.redirect, body });
    const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status });
    if (u.endsWith('/CreateArtifact')) {
      const s = left.create.shift() ?? 200;
      return s === 200 ? json(200, { ok: true, signed_upload_url: 'https://blob.example.test/c/x?sig=SECRET' }) : json(s, { code: 'x', msg: 'https://leak.example.test' });
    }
    if (u.startsWith('https://blob.example.test/')) return new Response('', { status: left.put.shift() ?? 201 });
    if (u.endsWith('/FinalizeArtifact')) {
      const s = left.finalize.shift() ?? 200;
      return s === 200 ? json(200, { ok: true, artifact_id: '9001' }) : json(s, {});
    }
    return json(404, {});
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

const deps = (fetch: typeof globalThis.fetch, env: Record<string, string> = ENV): ArtifactDeps => {
  let n = 0;
  return { env, fetch, sleep: async () => {}, suffix: () => ['0a1b2c3d', '4e5f6071'][n++] ?? 'ffffffff' };
};

describe('the artifact client', () => {
  it('creates, uploads and finalises; links the artifact only once finalised', async () => {
    const s = service();
    const r = await uploadArtifact(FILES, deps(s.fetch));
    expect(r).toEqual({ ok: true, id: '9001', name: 'saidvsdid-report-saidvsdid-0a1b2c3d', url: 'https://github.com/octo/demo/actions/runs/42/artifacts/9001' });
    expect(s.seen.map((x) => [x.method, x.url.replace(/\?.*$/, '')])).toEqual([
      ['POST', 'https://results.example.test/twirp/github.actions.results.api.v1.ArtifactService/CreateArtifact'],
      ['PUT', 'https://blob.example.test/c/x'],
      ['POST', 'https://results.example.test/twirp/github.actions.results.api.v1.ArtifactService/FinalizeArtifact'],
    ]);
    expect(s.seen[0]!.body).toEqual({ workflow_run_backend_id: RUN, workflow_job_run_backend_id: JOB, name: 'saidvsdid-report-saidvsdid-0a1b2c3d', version: 4 });
    const zipped = s.seen[1]!.body as Uint8Array;
    expect(s.seen[2]!.body).toMatchObject({ size: String(zipped.length), hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) });
  });

  it('the bearer token goes to the Results service only; no request follows a redirect', async () => {
    const s = service();
    await uploadArtifact(FILES, deps(s.fetch));
    for (const x of s.seen) {
      expect(x.redirect).toBe('error');
      if (x.url.startsWith('https://results.example.test/')) expect(x.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
      else expect(x.headers.get('authorization')).toBeNull();
    }
    expect(s.seen[1]!.headers.get('x-ms-blob-type')).toBe('BlockBlob');
  });

  it('retries a 5xx, a 429 and a failed request, then gives up naming the step and the status only', async () => {
    expect(await uploadArtifact(FILES, deps(service({ create: [503, 429] }).fetch))).toMatchObject({ ok: true });
    const failing = await uploadArtifact(FILES, deps(service({ put: [500, 500, 500] }).fetch));
    expect(failing).toEqual({ ok: false, why: 'upload: HTTP 500' });
    const refused = await uploadArtifact(FILES, deps(service({ create: [403] }).fetch));
    expect(refused).toEqual({ ok: false, why: 'CreateArtifact: HTTP 403' });
    for (const r of [failing, refused]) expect(JSON.stringify(r)).not.toMatch(/SECRET|leak|Bearer|e30\./);
  });

  it('a taken name gets one more try with another suffix', async () => {
    const s = service({ create: [409] });
    const r = await uploadArtifact(FILES, deps(s.fetch));
    expect(r).toMatchObject({ ok: true, name: 'saidvsdid-report-saidvsdid-4e5f6071' });
  });

  it('a finalise without ok or a numeric id is a failure, never a link', async () => {
    expect(await uploadArtifact(FILES, deps(service({ finalize: [500, 500, 500] }).fetch))).toEqual({ ok: false, why: 'FinalizeArtifact: HTTP 500' });
  });

  it('not attempted without credentials, over http, or on GitHub Enterprise Server', async () => {
    const s = service();
    const { ACTIONS_RUNTIME_TOKEN: _t, ...noToken } = ENV;
    expect(await uploadArtifact(FILES, deps(s.fetch, noToken as Record<string, string>))).toMatchObject({ ok: false });
    expect(await uploadArtifact(FILES, deps(s.fetch, { ...ENV, ACTIONS_RESULTS_URL: 'http://results.example.test/' }))).toEqual({ ok: false, why: 'ACTIONS_RESULTS_URL is not https' });
    expect(await uploadArtifact(FILES, deps(s.fetch, { ...ENV, GITHUB_SERVER_URL: 'https://ghes.example.com' }))).toMatchObject({ ok: false, why: expect.stringMatching(/Enterprise Server/) });
    expect(s.seen).toEqual([]);
    expect(artifactsSupported('https://acme.ghe.com')).toBe(true);
  });

  it('reads the backend ids from the scp claim, and nothing else', () => {
    expect(backendIds(TOKEN)).toEqual({ run: RUN, job: JOB });
    expect(backendIds(jwt({ scp: 'Actions.GenericRead:1' }))).toBeNull();
    expect(backendIds(jwt({ scp: 'Actions.Results:only-one' }))).toBeNull();
    expect(backendIds('not-a-jwt')).toBeNull();
  });
});

describe('the zip', () => {
  it('crc32 is the IEEE one', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926');
  });

  it('an independent reader extracts every entry, its name and its bytes', () => {
    const rt = pythonRuntime();
    expect(rt.known, 'a Python to read the zip with').toBe(true);
    if (!rt.known) return;
    const script = 'import sys, zipfile, io, json; z = zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps([[i.filename, z.read(i).hex()] for i in z.infolist()]))';
    const out = execFileSync(rt.command, ['-I', '-c', script], { input: Buffer.from(zip(FILES)), encoding: 'utf8' });
    expect(JSON.parse(out)).toEqual(FILES.map((f) => [f.name, Buffer.from(f.bytes).toString('hex')]));
  });

  it('the same files give the same bytes', () => {
    expect(Buffer.from(zip(FILES)).equals(Buffer.from(zip(FILES)))).toBe(true);
  });
});

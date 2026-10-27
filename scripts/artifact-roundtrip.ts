// CI's round trip of the Action's artifact client against GitHub's own artifact service (.github/workflows/ci.yml):
// this harness, bundled as the local JavaScript action .github/actions/artifact-roundtrip, uploads a known pair of
// files with the production client and writes them to $RUNNER_TEMP/saidvsdid-roundtrip; scripts/artifact-roundtrip-check.py
// then downloads the artifact with the REST API and compares it with an independent reader. Missing credentials or a
// failed upload fail the step: unlike the Action, which keeps its verdict, this is the client's compatibility test.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { uploadArtifact } from '../src/action/artifact.js';

const dir = join(process.env['RUNNER_TEMP'] ?? '.', 'saidvsdid-roundtrip');
mkdirSync(dir, { recursive: true });
const encode = (s: string): Uint8Array => new TextEncoder().encode(s);
const files = [
  { name: 'saidvsdid-report.md', bytes: encode(`# saidvsdid round trip — ñ ✓ ˋ\n\n${'- a finding\n'.repeat(20_000)}`) },
  { name: 'saidvsdid-report.json', bytes: encode(`${JSON.stringify({ verdict: 'FAIL', findings: Array.from({ length: 2_000 }, (_, i) => ({ i })) })}\n`) },
];
for (const f of files) writeFileSync(join(dir, f.name), f.bytes);
const result = await uploadArtifact(files, { env: process.env, fetch });
if (!result.ok) {
  process.stdout.write(`::error::artifact round trip: ${result.why}\n`);
  process.exit(1);
}
process.stdout.write(`uploaded ${result.name} (${result.id}): ${result.url}\n`);
appendFileSync(process.env['GITHUB_OUTPUT'] ?? '/dev/null', `artifact-id=${result.id}\n`);

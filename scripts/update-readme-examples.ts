// Rewrites the README's generated examples (`<!-- example:comment -->`, `<!-- example:cli -->`) with what the tool prints
// on fixtures/action/demo — exactly what test/readme-ci.test.ts compares them with.
//
//   npx tsx scripts/update-readme-examples.ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixtureRepo } from '../fixtures/build.js';
import { runCheck } from '../src/check.js';
import { COMMENT_MARKER, renderComment } from '../src/report/comment.js';
import { renderText } from '../src/report/text.js';

const README = fileURLToPath(new URL('../README.md', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'saidvsdid-readme-'));
try {
  const r = buildFixtureRepo(fileURLToPath(new URL('../fixtures/action/demo', import.meta.url)), join(tmp, 'demo'));
  const demo = await runCheck({ repo: r.repo, base: r.base, head: r.head });
  const body = renderComment(demo, { link: null, failOn: 'none' });
  const quoted = body
    .slice(COMMENT_MARKER.length + 1)
    .trimEnd()
    .split('\n')
    .map((l) => (l === '' ? '>' : `> ${l}`))
    .join('\n');
  const replace = (text: string, name: string, content: string): string => {
    const open = `<!-- example:${name} -->\n`;
    const start = text.indexOf(open);
    const end = text.indexOf(`<!-- /example:${name} -->`);
    if (start < 0 || end < start) throw new Error(`README: no example:${name}`);
    return text.slice(0, start + open.length) + content + text.slice(end);
  };
  let readme = readFileSync(README, 'utf8');
  readme = replace(readme, 'comment', `${quoted}\n`);
  readme = replace(readme, 'cli', `\`\`\`text\n${renderText(demo)}\`\`\`\n`);
  writeFileSync(README, readme);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

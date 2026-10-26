import { readFileSync } from 'node:fs';
import { ASSETS } from './assets.js';

// docs/rules.md ships with the package (src/assets.ts). The docs are the single source of truth for
// rule explanations, so `explain` and docs/rules.md cannot drift apart.
const RULES_DOC = new URL('docs/rules.md', ASSETS);

/** The `## <id> ...` section of docs/rules.md, or null if there is none. */
export function explainRule(id: string, doc = readFileSync(RULES_DOC, 'utf8')): string | null {
  const lines = doc.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => new RegExp(`^## ${id}\\b`).test(l));
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end === -1) end = lines.length;
  return lines.slice(start, end).join('\n').trim() + '\n';
}

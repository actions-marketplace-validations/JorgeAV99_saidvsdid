import { readFileSync } from 'node:fs';
import { ASSETS } from './assets.js';

// The package's package.json (src/assets.ts).
const pkg = JSON.parse(readFileSync(new URL('package.json', ASSETS), 'utf8')) as { version: string };

export const VERSION: string = pkg.version;

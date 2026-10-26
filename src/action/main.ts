// Entry point of the GitHub Action (action.yml: `runs: using: node24`, the bundle dist/action/index.js that
// scripts/build-action.mjs builds from it).
import { actionEnv, commandData, parseFailOn, runAction } from './run.js';

const env = actionEnv(process.env);
try {
  const result = await runAction({ env, fetch, log: (line) => process.stdout.write(`${line}\n`) });
  process.exitCode = result.exitCode;
} catch (e) {
  // A defect of the Action itself: reported, and blocking only when the workflow asked to block on an ERROR.
  process.stdout.write(`::error::saidvsdid: ${commandData(e instanceof Error ? (e.stack ?? e.message) : String(e))}\n`);
  let failOn: string = 'fail';
  try {
    failOn = parseFailOn(env['INPUT_FAIL_ON']);
  } catch {
    failOn = 'fail';
  }
  process.exitCode = failOn === 'none' ? 0 : 1;
}

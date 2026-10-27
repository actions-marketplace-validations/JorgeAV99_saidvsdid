import { execFileSync } from 'node:child_process';

export class GitError extends Error {
  override name = 'GitError';
}

/** A commit the check needs is not in the clone, or the history between base and head is cut (a shallow clone). */
export class MissingHistoryError extends GitError {
  override name = 'MissingHistoryError';
}

export type ChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T';

export interface FileChange {
  status: ChangeStatus;
  /** Path at base; null when the file was added. */
  basePath: string | null;
  /** Path at head; null when the file was deleted. */
  headPath: string | null;
}

const MAX_BUFFER = 512 * 1024 * 1024;

export function git(repo: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Keep git output stable regardless of the user's locale/pager settings.
      env: { ...process.env, LC_ALL: 'C', GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' },
    });
  } catch (err) {
    const e = err as { stderr?: string | Buffer; message: string };
    const stderr = e.stderr ? String(e.stderr).trim() : e.message;
    throw new GitError(`git ${args.join(' ')} failed: ${stderr}`);
  }
}

export function resolveCommit(repo: string, ref: string): string {
  if (ref.startsWith('-')) throw new GitError(`invalid ref ${JSON.stringify(ref)}`);
  try {
    return git(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]).trim();
  } catch {
    throw new MissingHistoryError(`${JSON.stringify(ref)} is not a commit in this clone (git fetch it?)`);
  }
}

/** What a check compares: the commit it diffs from, the head, and the ref given for the base when that is not the commit compared. */
export interface SelectedBase {
  base: string;
  head: string;
  /** The base as given and the commit it resolved to, when the compared commit is their merge base and not that commit. */
  baseRef: { ref: string; sha: string } | null;
}

/**
 * The commits a check compares, as GitHub's "Files changed" shows a pull request: from the merge base of `baseRef` and
 * `headRef` to the head, so that a branch behind its base is never charged with what the base did after the branch left
 * it. The Action and every command that takes `--base` use it; `exact` compares the two commits as they are.
 */
export function selectBase(repo: string, baseRef: string, headRef: string, exact = false): SelectedBase {
  const given = resolveCommit(repo, baseRef);
  const head = resolveCommit(repo, headRef);
  if (exact) return { base: given, head, baseRef: null };
  let base: string;
  try {
    base = git(repo, ['merge-base', given, head]).trim();
  } catch {
    const shallow = git(repo, ['rev-parse', '--is-shallow-repository']).trim() === 'true';
    if (shallow) throw new MissingHistoryError(`the history between ${baseRef} and ${headRef} is not all in this shallow clone: fetch it whole (git fetch --unshallow, or fetch-depth: 0 on GitHub Actions)`);
    throw new GitError(`${baseRef} and ${headRef} have no common ancestor (--exact-base compares the two commits as they are)`);
  }
  return { base, head, baseRef: base === given ? null : { ref: baseRef, sha: given } };
}

/** The tree of a commit. */
export function treeOf(repo: string, commit: string): string {
  return git(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${commit}^{tree}`]).trim();
}

export function repoRoot(repo: string): string {
  try {
    return git(repo, ['rev-parse', '--show-toplevel']).trim();
  } catch {
    throw new GitError(`${repo} is not inside a git repository: run saidvsdid in a clone, or pass --repo <dir>`);
  }
}

/** Files changed between two commits, with rename detection. */
export function changedFiles(repo: string, base: string, head: string): FileChange[] {
  const out = git(repo, ['diff', '--no-ext-diff', '--name-status', '-z', '-M', base, head, '--']);
  const tokens = out.split('\0');
  const changes: FileChange[] = [];
  let i = 0;
  while (i < tokens.length) {
    const code = tokens[i++];
    if (!code) continue;
    const status = code[0] as ChangeStatus;
    if (status === 'R' || status === 'C') {
      const from = tokens[i++]!;
      const to = tokens[i++]!;
      changes.push({ status, basePath: status === 'R' ? from : null, headPath: to });
      // A copy leaves the source untouched, so from the diff's point of view
      // it is an addition of `to`.
      if (status === 'C') changes[changes.length - 1]!.status = 'A';
    } else {
      const path = tokens[i++]!;
      changes.push({
        status,
        basePath: status === 'A' ? null : path,
        headPath: status === 'D' ? null : path,
      });
    }
  }
  return changes.sort((a, b) => compareStr(a.headPath ?? a.basePath ?? '', b.headPath ?? b.basePath ?? ''));
}

/** Every file path in the tree of `commit`. */
export function listFiles(repo: string, commit: string): string[] {
  return git(repo, ['ls-tree', '-r', '--name-only', '-z', commit]).split('\0').filter(Boolean).sort(compareStr);
}

/** The tree of `commit` by kind of entry: files, symlinks, submodules (paths under the last two are not where they appear to be). */
export function listTree(repo: string, commit: string): { files: Set<string>; symlinks: Set<string>; submodules: Set<string> } {
  const out = { files: new Set<string>(), symlinks: new Set<string>(), submodules: new Set<string>() };
  for (const entry of git(repo, ['ls-tree', '-r', '-z', commit]).split('\0')) {
    if (!entry) continue;
    const path = entry.slice(entry.indexOf('\t') + 1);
    if (entry.startsWith('120000 ')) out.symlinks.add(path);
    else if (entry.startsWith('160000 ')) out.submodules.add(path);
    else out.files.add(path);
  }
  return out;
}

/** Contents of `path` at `commit`, or null if it does not exist there. */
/** A blob's bytes, as stored (no decoding): what Python reads, its declared encoding included. */
export function readBlobBytes(repo: string, commit: string, path: string): Buffer | null {
  try {
    return execFileSync('git', ['cat-file', 'blob', `${commit}:${path}`], {
      cwd: repo,
      maxBuffer: MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LC_ALL: 'C', GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' },
    });
  } catch {
    return null;
  }
}

export function readBlob(repo: string, commit: string, path: string): string | null {
  try {
    return git(repo, ['cat-file', 'blob', `${commit}:${path}`]);
  } catch {
    return null;
  }
}

export function compareStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

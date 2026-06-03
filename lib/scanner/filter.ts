// Shared file-classification + ignore rules. Single source for the scanner AND the
// repo source fetcher (lib/github/source.ts), so the backend filters a downloaded
// tarball exactly the way the CLI walks a working tree. Pure string logic, no I/O —
// safe to import from any runtime.
//
// Ported verbatim from preflight.mjs (IGNORE_DIRS / CODE_EXT / extension handling).
// Classification is case-sensitive to match the CLI's node:path.extname behaviour.

export const IGNORE_DIRS: ReadonlySet<string> = new Set([
  // '.claude' holds Claude Code's worktrees/settings — sibling checkouts, not deployed
  // app code. Without it the walker descends into .claude/worktrees/** and double-counts.
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.turbo',
  '.vercel',
  '.cache',
  '.claude',
]);

export const CODE_EXT: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

export const SQL_EXT = '.sql';

export type FileKind = 'code' | 'sql' | null;

// POSIX-normalize separators and drop a single leading "./".
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

// node:path.extname semantics: extension of the basename, '' for a dotfile with no
// other dot (".env") or a name with no dot. Case preserved (matches the CLI).
function extname(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot);
}

// True when any path segment is an ignored directory (node_modules/**, .git/** …).
export function isIgnoredPath(path: string): boolean {
  for (const seg of normalizePath(path).split('/')) {
    if (IGNORE_DIRS.has(seg)) return true;
  }
  return false;
}

export function classifyFile(path: string): FileKind {
  const ext = extname(path);
  if (CODE_EXT.has(ext)) return 'code';
  if (ext === SQL_EXT) return 'sql';
  return null;
}

// A file the scanner actually reads (code or SQL) and that isn't under an ignored
// directory. The source fetcher uses this to keep only what scan() will inspect.
export function isScannablePath(path: string): boolean {
  return !isIgnoredPath(path) && classifyFile(path) !== null;
}

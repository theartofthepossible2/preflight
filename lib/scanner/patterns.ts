export const IGNORE_DIRS = new Set([
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
]);

export const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
export const SQL_EXTENSION = '.sql';

export const hasUseClient = (c: string) => /^\s*['"]use client['"]\s*;?/m.test(c);
export const hasUseServer = (c: string) => /^\s*['"]use server['"]\s*;?/m.test(c);

export const AUTH_HINTS: RegExp[] = [
  /\.auth\.getUser\s*\(/,
  /\.auth\.getSession\s*\(/,
  /getServerSession\s*\(/,
  /\bgetSession\s*\(/,
  /\bgetUser\s*\(/,
  /\brequireUser\s*\(/,
  /\brequireAuth\s*\(/,
  /\bcurrentUser\s*\(/,
  /\bgetCurrentUser\s*\(/,
  /\bverify(Jwt|Token|Session)\s*\(/,
  /withApiAuth/,
  /@clerk\//,
];

export const hasAuthHint = (c: string) => AUTH_HINTS.some((r) => r.test(c));

export const DB_HINTS: RegExp[] = [
  /\.from\s*\(\s*['"`]/,
  /\bsupabase\b/,
  /\bprisma\s*\./,
  /\bdrizzle\b/,
  /\bsql`/,
  /\bpool\.query\s*\(/,
  /\bdb\.(select|insert|update|delete|query|execute)\b/,
];

export const hasDbAccess = (c: string) => DB_HINTS.some((r) => r.test(c));

export function lineAt(content: string, idx: number): number {
  return content.slice(0, Math.max(idx, 0)).split('\n').length;
}

export function snippetAround(content: string, line: number, contextLines = 3): string {
  const lines = content.split('\n');
  const start = Math.max(0, line - 1 - contextLines);
  const end = Math.min(lines.length, line + contextLines);
  const width = String(end).length;
  return lines
    .slice(start, end)
    .map((l, i) => {
      const ln = start + i + 1;
      const marker = ln === line ? '>' : ' ';
      return `${marker} ${String(ln).padStart(width, ' ')} | ${l}`;
    })
    .join('\n');
}

export function isCodeFile(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return false;
  return CODE_EXTENSIONS.has(path.slice(dot));
}

export function isSqlFile(path: string): boolean {
  return path.toLowerCase().endsWith(SQL_EXTENSION);
}

export function isIgnoredPath(path: string): boolean {
  return path.split('/').some((seg) => IGNORE_DIRS.has(seg));
}

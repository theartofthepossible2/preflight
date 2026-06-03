import type { Finding } from '@/lib/types';
import { classifyFile, isIgnoredPath, normalizePath } from './filter';
import { findingId } from './id';
import { runRules, type ScanFile } from './rules';

// The deterministic scanner, extracted from preflight.mjs so the backend worker can
// run it in-process (it used to run only inside the customer's CI). Pure: it takes an
// already-loaded { path -> contents } map and returns findings. No file system, no
// network — the worker's source fetcher (lib/github/source.ts) and the CLI/tests each
// build the map their own way.

export interface ScanInput {
  // Repo-relative POSIX path -> file contents (text only). Callers should pre-filter
  // with lib/scanner/filter, but scan() defends itself against ignored paths too.
  files: Record<string, string>;
}

export interface ScanResult {
  findings: Finding[];
  scanned: { files: number; code: number; sql: number };
}

export function scan(input: ScanInput): ScanResult {
  const code: ScanFile[] = [];
  const sql: ScanFile[] = [];
  let files = 0;

  for (const [rawPath, content] of Object.entries(input.files)) {
    const path = normalizePath(rawPath);
    if (isIgnoredPath(path)) continue;
    files++;
    const kind = classifyFile(path);
    if (kind === 'code') code.push({ path, content });
    else if (kind === 'sql') sql.push({ path, content });
  }

  const findings: Finding[] = runRules({ code, sql }).map((r) => ({
    id: findingId({ file: r.file, title: r.title, line: r.line }),
    severity: r.severity,
    confidence: r.confidence,
    asvsCategory: r.asvsCategory,
    title: r.title,
    file: r.file,
    line: r.line,
    detail: r.detail,
    remediation: r.remediation,
  }));

  return { findings, scanned: { files, code: code.length, sql: sql.length } };
}

export {
  CODE_EXT,
  IGNORE_DIRS,
  SQL_EXT,
  classifyFile,
  isIgnoredPath,
  isScannablePath,
  normalizePath,
} from './filter';

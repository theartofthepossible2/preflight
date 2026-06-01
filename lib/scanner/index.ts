import type { Finding, Severity } from '../types';
import { SEV_ORDER } from '../types';
import {
  checkEntryPoints,
  checkHeaders,
  checkRls,
  checkSecretExposure,
} from './checks';
import { isCodeFile, isIgnoredPath, isSqlFile } from './patterns';

export interface ScanInput {
  files: Record<string, string>;
}

export interface ScanResult {
  findings: Finding[];
  scanned: { files: number; code: number; sql: number };
  counts: Record<Severity, number>;
}

export function runScan(input: ScanInput): ScanResult {
  const allPaths = Object.keys(input.files).filter((p) => !isIgnoredPath(p));
  const codeFiles = allPaths.filter(isCodeFile).sort();
  const sqlFiles = allPaths.filter(isSqlFile).sort();

  const read = (file: string) => input.files[file] ?? '';
  const ctx = { codeFiles, sqlFiles, read };

  const findings = [
    ...checkSecretExposure(ctx),
    ...checkRls(ctx),
    ...checkEntryPoints(ctx),
    ...checkHeaders(ctx),
  ].sort((a, b) => {
    const sev = SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity);
    if (sev !== 0) return sev;
    return a.id.localeCompare(b.id);
  });

  const counts: Record<Severity, number> = { HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
  for (const f of findings) counts[f.severity]++;

  return {
    findings,
    scanned: { files: allPaths.length, code: codeFiles.length, sql: sqlFiles.length },
    counts,
  };
}

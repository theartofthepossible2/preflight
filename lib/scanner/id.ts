import { createHash } from 'node:crypto';

// Stable finding identity, ported from action/report.mjs. file|title|line uniquely
// locates a finding, so the same control gap at the same place yields the same id on
// every scan — which is exactly what the regression baseline diffs against. Changing
// this hash reshapes baselines, so keep it byte-compatible with the Action's id.
export function findingId(parts: { file: string; title: string; line: number | null }): string {
  return (
    'pf_' +
    createHash('sha256')
      .update(`${parts.file}|${parts.title}|${parts.line ?? ''}`)
      .digest('hex')
      .slice(0, 12)
  );
}

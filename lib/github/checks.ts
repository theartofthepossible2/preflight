import type { Finding, Severity } from '@/lib/types';
import type { InstallationOctokit } from './app';
import { CHECK_NAME } from './check-name';

// Posts the `preflight` Check Run from the backend using the installation token. The
// gate conclusion is computed ONLY from deterministic findings (decideGate), never from
// model output — a backend/enrichment outage can therefore neither invent a failure nor
// hide a real one. On scan error the caller posts a neutral check (neutralOutput): we
// never emit a false failure or a false success.

export type GateMode = 'enforce' | 'report-only';
export type CheckConclusion = 'success' | 'failure' | 'neutral';

const SEV_RANK: Record<Severity, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };
const SEV_DISPLAY_ORDER: Severity[] = ['HIGH', 'MEDIUM', 'LOW', 'INFO'];

// GitHub accepts at most 50 annotations per Checks-API write.
const ANNOTATIONS_PER_REQUEST = 50;
// Check Run output.text is capped at 65535 bytes; stay clear of the edge.
const MAX_OUTPUT_TEXT = 60_000;

export interface GateDecision {
  // True when a finding at or above the threshold exists (deterministic fact).
  wouldBlock: boolean;
  conclusion: CheckConclusion;
}

// THE gate decision. report-only never fails the check (first-cohort default): it
// downgrades a would-block to 'neutral' so the finding is surfaced without holding the
// deploy. enforce maps would-block to 'failure'. A clean scan is always 'success'.
export function decideGate(
  findings: Finding[],
  mode: GateMode,
  failOn: Severity = 'HIGH',
): GateDecision {
  const threshold = SEV_RANK[failOn];
  const wouldBlock = findings.some((f) => SEV_RANK[f.severity] >= threshold);
  if (!wouldBlock) return { wouldBlock, conclusion: 'success' };
  return { wouldBlock, conclusion: mode === 'enforce' ? 'failure' : 'neutral' };
}

export function severityCounts(findings: Finding[]): Record<Severity, number> {
  const c: Record<Severity, number> = { HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
  for (const f of findings) c[f.severity]++;
  return c;
}

function annotationLevel(sev: Severity): 'failure' | 'warning' | 'notice' {
  if (sev === 'HIGH') return 'failure';
  if (sev === 'MEDIUM') return 'warning';
  return 'notice';
}

export interface CheckAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'failure' | 'warning' | 'notice';
  title: string;
  message: string;
}

// GitHub only renders an annotation whose path is a real file at head_sha and whose
// start_line >= 1. Synthetic finding paths (e.g. "(project)") are dropped — they still
// appear in the output text. Messages carry detail + remediation only, never source.
export function buildAnnotations(findings: Finding[]): CheckAnnotation[] {
  const out: CheckAnnotation[] = [];
  for (const f of findings) {
    if (f.file.startsWith('(')) continue;
    const line = f.line && f.line > 0 ? f.line : 1;
    const message = (f.detail || f.title) + (f.remediation ? `\n\nFix: ${f.remediation}` : '');
    out.push({
      path: f.file,
      start_line: line,
      end_line: line,
      annotation_level: annotationLevel(f.severity),
      title: `[${f.severity}] ${f.title}`.slice(0, 255),
      message: message.slice(0, 4000),
    });
  }
  return out;
}

export interface CheckOutput {
  title: string;
  summary: string;
  text: string;
}

function renderFinding(f: Finding): string {
  const loc = f.line ? `${f.file}:${f.line}` : f.file;
  return [
    `### [${f.severity}] ${f.title}`,
    `\`${loc}\`  ·  ${f.confidence}`,
    '',
    f.detail || '',
    f.remediation ? `\n**Fix:** ${f.remediation}` : '',
  ].join('\n');
}

// Deterministic, AI-free Check Run body. The orchestrator (lib/scan-run) may replace
// `text` with an enriched rendering, but title/summary/gate always derive from the
// deterministic findings so the gate surface can't be moved by the model.
export function renderOutput(
  findings: Finding[],
  decision: GateDecision,
  mode: GateMode,
  failOn: Severity = 'HIGH',
): CheckOutput {
  const c = severityCounts(findings);
  const title = `${c.HIGH} high · ${c.MEDIUM} medium · ${c.LOW} low`;

  let verdict: string;
  if (!decision.wouldBlock) {
    verdict = `Gate **passed** — no findings at or above \`${failOn}\`.`;
  } else if (mode === 'enforce') {
    verdict = `Gate **failed** — findings at or above \`${failOn}\`. Production promotion is held.`;
  } else {
    verdict = `Findings at or above \`${failOn}\` present. Gate is in **report-only** mode, so the deploy is not blocked.`;
  }

  const summary = [`**${c.HIGH} high · ${c.MEDIUM} medium · ${c.LOW} low · ${c.INFO} info**`, '', verdict].join(
    '\n',
  );

  const ordered = [...findings].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);
  const text = ordered.length
    ? ordered.map(renderFinding).join('\n\n---\n\n').slice(0, MAX_OUTPUT_TEXT)
    : 'No findings.';

  return { title, summary, text };
}

// Canonical fail-safe body: the scan did not complete, so the check is neutral and does
// not block. `reason` is a short fixed internal string (never source, never model text).
export function neutralOutput(reason: string): CheckOutput {
  return {
    title: 'Preflight could not complete this scan',
    summary: [
      'Preflight did not finish scanning this commit, so it is **not** gating the deploy.',
      '',
      `_Reason: ${reason}_`,
    ].join('\n'),
    text: 'No findings were produced because the scan did not complete. This check is neutral and does not block.',
  };
}

// Opens the check run in_progress and returns its id. Call this BEFORE scanning so a
// crash mid-scan still leaves a visible, completable check (the caller finishes it
// neutral on error).
export async function openCheck(
  octokit: InstallationOctokit,
  owner: string,
  repo: string,
  headSha: string,
): Promise<number> {
  const res = await octokit.rest.checks.create({
    owner,
    repo,
    name: CHECK_NAME,
    head_sha: headSha,
    status: 'in_progress',
    started_at: new Date().toISOString(),
  });
  return res.data.id;
}

export interface CompleteCheckInput {
  owner: string;
  repo: string;
  checkRunId: number;
  conclusion: CheckConclusion;
  output: CheckOutput;
  annotations?: CheckAnnotation[];
}

// Completes the check with its conclusion and output. Annotations exceeding GitHub's
// 50-per-write limit are appended in follow-up updates (the conclusion is already set;
// these just add more inline markers).
export async function completeCheck(
  octokit: InstallationOctokit,
  input: CompleteCheckInput,
): Promise<void> {
  const { owner, repo, checkRunId, conclusion, output } = input;
  const annotations = input.annotations ?? [];
  const firstBatch = annotations.slice(0, ANNOTATIONS_PER_REQUEST);

  await octokit.rest.checks.update({
    owner,
    repo,
    check_run_id: checkRunId,
    status: 'completed',
    conclusion,
    completed_at: new Date().toISOString(),
    output: {
      title: output.title,
      summary: output.summary,
      text: output.text.slice(0, MAX_OUTPUT_TEXT),
      annotations: firstBatch.length ? firstBatch : undefined,
    },
  });

  for (let i = ANNOTATIONS_PER_REQUEST; i < annotations.length; i += ANNOTATIONS_PER_REQUEST) {
    await octokit.rest.checks.update({
      owner,
      repo,
      check_run_id: checkRunId,
      output: {
        title: output.title,
        summary: output.summary,
        annotations: annotations.slice(i, i + ANNOTATIONS_PER_REQUEST),
      },
    });
  }
}

export { SEV_DISPLAY_ORDER };

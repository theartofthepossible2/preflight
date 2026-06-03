import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { scans } from '@/db/schema';
import { analyzeFindings } from '@/lib/analyze';
import { primaryRequirement } from '@/lib/asvs';
import { getInstallationOctokit } from '@/lib/github/app';
import {
  buildAnnotations,
  completeCheck,
  decideGate,
  type GateMode,
  neutralOutput,
  openCheck,
  renderOutput,
  severityCounts,
} from '@/lib/github/checks';
import { fetchRepoFiles } from '@/lib/github/source';
import { scan } from '@/lib/scanner';
import { getSubscriptionState } from '@/lib/stripe';
import type { AnalyzedFinding, Finding, Severity } from '@/lib/types';

// The v0.4 scan orchestrator: GitHub calls our webhook on a push/PR, a worker hands the
// commit here, and THIS runs the whole job in-process on Preflight's backend — fetch the
// repo tarball, run the deterministic scanner, diff against the baseline, enrich only the
// new findings, and post the `preflight` Check Run customers gate on. Source is held in
// memory for exactly one scan and never persisted; we persist findings, never source.
//
// Two invariants the rest of the system leans on:
//  - The gate conclusion is computed ONLY from deterministic findings (decideGate), never
//    from model output. An enrichment outage can neither invent nor hide a gate result.
//  - On ANY error we complete the already-open check as `neutral` — never a false failure
//    that blocks a clean deploy, never a false success that hides a real one.

export interface ScanJob {
  installationId: number;
  owner: string;
  repo: string;
  headSha: string;
  ref: string;
  isPullRequest: boolean;
  userId: string;
}

export interface RunScanOptions {
  // Reuse an already-open check run instead of opening a new one. The worker passes the
  // id it recorded on a prior attempt so a retry doesn't post a duplicate in_progress
  // check on the same commit.
  checkRunId?: number;
  // Called once with the freshly-opened check run id (only when we open one, i.e. not
  // when checkRunId was supplied). Best-effort — the worker uses it to persist the id for
  // retry reuse; it must not throw.
  onCheckOpened?: (checkRunId: number) => void | Promise<void>;
}

// §11 conservative default: report-only never fails the check — a would-block is surfaced
// as `neutral` so the finding is visible without holding the deploy. Flipping a cohort to
// `enforce` is an operator-only switch (surfaced in Phase 7), never a customer toggle yet.
const DEFAULT_GATE_MODE: GateMode = 'report-only';
const FAIL_ON: Severity = 'HIGH';

export async function runScan(job: ScanJob, opts: RunScanOptions = {}): Promise<void> {
  const { installationId, owner, repo, headSha, ref, userId } = job;
  const repoFullName = `${owner}/${repo}`;

  const octokit = await getInstallationOctokit(installationId);

  // Open the check BEFORE scanning so a crash mid-scan still leaves a visible, completable
  // check (the catch below finishes it neutral). If this throws there's nothing to
  // complete — let it propagate so the queue retries. On a retry the worker hands back the
  // previously-opened id so we complete that check rather than opening a second one.
  let checkRunId = opts.checkRunId;
  if (checkRunId === undefined) {
    checkRunId = await openCheck(octokit, owner, repo, headSha);
    await opts.onCheckOpened?.(checkRunId);
  }

  // The only reference to customer source. Held in this scope, never written anywhere,
  // dropped in `finally` so it can't outlive the job (in-memory twin of "wipe temp").
  let files: Record<string, string> | undefined;
  let checkCompleted = false;

  try {
    const fetched = await fetchRepoFiles(octokit, owner, repo, headSha);
    files = fetched.files;
    if (fetched.truncated) {
      // A pathological repo blew past MAX_SCANNED_FILES; the scan ran on what was admitted.
      // We never claim "secure", so a partial scan only risks a missed finding, never a
      // false failure — log it (no contents) and proceed.
      console.warn(`scan-run: ${repoFullName}@${headSha} truncated at file cap`);
    }

    const { findings: allFindings } = scan({ files });

    // Regression diff. The baseline is the latest default-branch scan of this repo; a
    // finding absent from it is NEW. A push is judged by what it INTRODUCES — only new
    // findings are enriched (the cost gate: most pushes introduce nothing and call the
    // model zero times) and only new findings move the gate. A PR is diffed against the
    // default branch, so a PR sees everything it adds on top of main. Pre-existing posture
    // lives in the dashboard.
    const prior = await loadBaseline(installationId, repoFullName);
    const baselineIds = new Set(prior.map((f) => f.id));
    const currentIds = new Set(allFindings.map((f) => f.id));
    const newFindings = allFindings.filter((f) => !baselineIds.has(f.id));

    // THE gate decision — deterministic, computed on new findings only.
    const decision = decideGate(newFindings, DEFAULT_GATE_MODE, FAIL_ON);

    // Enrich only new findings, and only for an active subscription. Everything else is a
    // deterministic fallback (no spend). Enrichment never changes the gate above.
    const subscription = await getSubscriptionState(userId);
    let enrichedNew: AnalyzedFinding[] = newFindings.map(toUnenriched);
    let aiEnriched = false;
    if (subscription.active && newFindings.length > 0) {
      const analysis = await analyzeFindings(newFindings);
      enrichedNew = analysis.analyzed;
      aiEnriched = analysis.status === 'ok';
      if (analysis.status === 'unavailable' && analysis.error) {
        // Internal reason stays in server logs; it can name internal services.
        console.warn(`scan-run: enrichment unavailable — ${analysis.error}`);
      }
    }

    // Complete this commit's check from the deterministic new-finding set. The body/title
    // and gate are AI-free so the customer-facing surface can't be moved by the model.
    await completeCheck(octokit, {
      owner,
      repo,
      checkRunId,
      conclusion: decision.conclusion,
      output: renderOutput(newFindings, decision, DEFAULT_GATE_MODE, FAIL_ON),
      annotations: buildAnnotations(newFindings),
    });
    checkCompleted = true;

    // Persist the COMPLETE posture (enriched new findings + carried-over prior findings
    // still present at this commit) so the next baseline is whole and the dashboard shows
    // full posture. Carried-over findings keep enrichment paid for in an earlier scan —
    // never re-billed. Findings only; never source.
    const carriedOver = prior.filter((f) => currentIds.has(f.id));
    const persisted = [...enrichedNew, ...carriedOver];
    const counts = severityCounts(persisted);

    await db.insert(scans).values({
      userId,
      // Backend (GitHub App) scan — not driven by a customer API key.
      apiKeyId: null,
      installationId,
      repo: repoFullName,
      ref,
      commitSha: headSha,
      isPullRequest: job.isPullRequest,
      findingsCount: persisted.length,
      highCount: counts.HIGH,
      aiEnriched,
      findings: persisted,
      additionalObservations: null,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`scan-run: ${repoFullName}@${headSha} failed — ${reason}`);
    // Leave no false gate behind: if the check is still open, complete it neutral. If the
    // check already completed (e.g. a later persist failed), don't overwrite the correct
    // gate — just surface the error.
    if (!checkCompleted) {
      await completeCheck(octokit, {
        owner,
        repo,
        checkRunId,
        conclusion: 'neutral',
        output: neutralOutput('scan_error'),
      }).catch((e) => {
        const m = e instanceof Error ? e.message : String(e);
        console.error(`scan-run: failed to post neutral check for ${repoFullName} — ${m}`);
      });
    }
    // Re-throw so the queue (Phase 4) records the failure and applies its retry policy.
    throw err;
  } finally {
    // Drop the only handle to customer source; nothing here persisted it.
    files = undefined;
  }
}

// Baseline = the latest default-branch scan's full finding set for this repo, scoped to the
// installation (which also excludes legacy v0.3 Action scans, whose installationId is null).
// PR scans are excluded so they never become a baseline. Returns [] on the first scan
// (everything is then "new"). Best-effort: a missing/oddly-shaped row yields an empty
// baseline and the scan still runs and gates honestly.
export async function loadBaseline(installationId: number, repoFullName: string): Promise<AnalyzedFinding[]> {
  const rows = await db
    .select({ findings: scans.findings })
    .from(scans)
    .where(
      and(
        eq(scans.installationId, installationId),
        eq(scans.repo, repoFullName),
        eq(scans.isPullRequest, false),
      ),
    )
    .orderBy(desc(scans.createdAt))
    .limit(1);
  const stored = rows[0]?.findings;
  return Array.isArray(stored) ? (stored as AnalyzedFinding[]) : [];
}

// Deterministic, no-spend projection of a raw finding into the analyzed shape — used when
// enrichment is skipped (no subscription) or unavailable. Mirrors lib/analyze's fallback.
export function toUnenriched(f: Finding): AnalyzedFinding {
  const req = primaryRequirement(f.asvsCategory);
  return {
    ...f,
    asvsRequirement: req
      ? { id: req.id, title: req.title }
      : { id: 'unknown', title: f.asvsCategory },
    isLikelyRealIssue: f.confidence === 'definitive' ? 'high' : 'medium',
    explanation: f.detail,
    remediation_steps: [f.remediation],
  };
}

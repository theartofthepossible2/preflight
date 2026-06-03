import { db } from '@/db';
import { scans } from '@/db/schema';
import { analyzeFindings } from '@/lib/analyze';
import { getInstallationOctokit } from '@/lib/github/app';
import { severityCounts } from '@/lib/github/checks';
import { fetchRepoFiles } from '@/lib/github/source';
import { loadBaseline, toUnenriched } from '@/lib/scan-run';
import { scan } from '@/lib/scanner';
import { getSubscriptionState } from '@/lib/stripe';
import type { AnalyzedFinding } from '@/lib/types';

// On-demand "Scan now" orchestrator for the dashboard. It runs the SAME pipeline the gate
// path runs (fetch the repo at the default-branch HEAD -> deterministic scan -> diff against
// the last baseline -> enrich only the new findings -> persist), but with two differences:
//  - it emits progress so the dashboard can stream a live log, and
//  - it posts NO Check Run — there is no deploy in flight here, so the gate stays owned by
//    the push/PR path (lib/scan-run). This is a user-initiated visibility scan.
//
// Source is held in memory for exactly this call and dropped in `finally` (incl. on error);
// progress messages are stage + counts only — never file contents.

export interface ManualScanInput {
  installationId: number;
  owner: string;
  repo: string;
  // Default branch name, e.g. "main" — resolved to its HEAD sha here.
  ref: string;
  userId: string;
}

export type ScanProgress =
  | { type: 'log'; message: string }
  | { type: 'done'; findings: number; high: number; aiEnriched: boolean }
  | { type: 'error'; message: string };

export async function runManualScan(
  input: ManualScanInput,
  onProgress: (p: ScanProgress) => void,
): Promise<void> {
  const { installationId, owner, repo, ref, userId } = input;
  const repoFullName = `${owner}/${repo}`;
  const log = (message: string) => onProgress({ type: 'log', message });

  // The only handle to customer source; dropped in `finally` so it can't outlive the scan.
  let files: Record<string, string> | undefined;

  try {
    log('Authenticating GitHub App installation…');
    const octokit = await getInstallationOctokit(installationId);

    log(`Resolving ${ref}…`);
    const branch = await octokit.rest.repos.getBranch({ owner, repo, branch: ref });
    const headSha = branch.data.commit.sha;
    log(`HEAD is ${headSha.slice(0, 7)}.`);

    log('Downloading repository (in memory — never written to disk)…');
    const fetched = await fetchRepoFiles(octokit, owner, repo, headSha);
    files = fetched.files;
    const fileCount = Object.keys(files).length;
    log(`Downloaded ${fileCount} scannable file${fileCount === 1 ? '' : 's'}${fetched.truncated ? ' (file cap reached)' : ''}.`);

    log('Running deterministic ASVS scanner…');
    const { findings: allFindings, scanned } = scan({ files });
    log(`Scanned ${scanned.code} code + ${scanned.sql} SQL files — ${allFindings.length} finding${allFindings.length === 1 ? '' : 's'} total.`);

    log('Comparing against your last scan…');
    const prior = await loadBaseline(installationId, repoFullName);
    const baselineIds = new Set(prior.map((f) => f.id));
    const currentIds = new Set(allFindings.map((f) => f.id));
    const newFindings = allFindings.filter((f) => !baselineIds.has(f.id));
    log(`${newFindings.length} new since last scan.`);

    // Enrich only new findings, and only with an active subscription — same cost gate as
    // the gate path. Enrichment never changes the deterministic posture.
    const subscription = await getSubscriptionState(userId);
    let enrichedNew: AnalyzedFinding[] = newFindings.map(toUnenriched);
    let aiEnriched = false;
    if (subscription.active && newFindings.length > 0) {
      log('Generating AI assessments for new findings…');
      const analysis = await analyzeFindings(newFindings);
      enrichedNew = analysis.analyzed;
      aiEnriched = analysis.status === 'ok';
      log(aiEnriched ? 'AI assessments ready.' : 'AI enrichment unavailable — using deterministic detail.');
    } else if (newFindings.length === 0) {
      log('No new findings to assess.');
    } else {
      log('AI enrichment skipped (no active subscription).');
    }

    // Persist the complete posture (enriched new + carried-over prior still present) so the
    // dashboard shows full posture and the next baseline is whole. Findings only; never source.
    const carriedOver = prior.filter((f) => currentIds.has(f.id));
    const persisted = [...enrichedNew, ...carriedOver];
    const counts = severityCounts(persisted);

    log('Saving results…');
    await db.insert(scans).values({
      userId,
      apiKeyId: null,
      installationId,
      repo: repoFullName,
      ref: `refs/heads/${ref}`,
      commitSha: headSha,
      isPullRequest: false,
      findingsCount: persisted.length,
      highCount: counts.HIGH,
      aiEnriched,
      findings: persisted,
      additionalObservations: null,
    });

    onProgress({ type: 'done', findings: persisted.length, high: counts.HIGH, aiEnriched });
  } finally {
    files = undefined;
  }
}

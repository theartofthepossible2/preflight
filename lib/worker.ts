import { claimNext, markDone, markFailed, recordCheckRun, type ScanJobRow } from '@/lib/queue';
import { runScan, type ScanJob } from '@/lib/scan-run';

// Drains the scan queue: claims jobs and runs lib/scan-run for each. Shared by the Vercel
// cron route (app/api/cron/drain) and the standalone worker entry (worker/index.ts) so
// both paths apply the same fairness, lease, and retry behavior.

export interface DrainOptions {
  // Stop after claiming this many jobs (bounds a single drain's work).
  maxJobs?: number;
  // Stop once this much wall-clock has elapsed (keep a serverless drain under its
  // function timeout; the long-running worker passes a per-cycle budget).
  budgetMs?: number;
}

export interface DrainResult {
  claimed: number;
  done: number;
  failed: number;
}

const DEFAULT_MAX_JOBS = 50;
const DEFAULT_BUDGET_MS = 50_000;

function toScanJob(job: ScanJobRow): ScanJob {
  const slash = job.repoFullName.indexOf('/');
  const owner = slash > 0 ? job.repoFullName.slice(0, slash) : job.repoFullName;
  const repo = slash > 0 ? job.repoFullName.slice(slash + 1) : '';
  return {
    installationId: job.installationId,
    owner,
    repo,
    headSha: job.headSha,
    ref: job.ref,
    isPullRequest: job.isPullRequest,
    userId: job.userId,
  };
}

// Claim and run jobs until the budget is spent or the queue is empty. Per-installation
// fairness: within a round we claim at most one job per installation (`serviced`), so a
// single noisy install can't monopolize a drain; when no un-serviced install has work, we
// reset the round and let everyone take another. Bounded by maxJobs/budgetMs, so even a
// single busy install can't loop forever.
export async function drainOnce(opts: DrainOptions = {}): Promise<DrainResult> {
  const maxJobs = opts.maxJobs ?? DEFAULT_MAX_JOBS;
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const start = Date.now();
  let claimed = 0;
  let done = 0;
  let failed = 0;
  let serviced: number[] = [];

  while (claimed < maxJobs && Date.now() - start < budgetMs) {
    const job = await claimNext(serviced);
    if (!job) {
      if (serviced.length === 0) break; // nothing claimable at all
      serviced = []; // round complete — start the next so serviced installs get another turn
      continue;
    }
    claimed++;
    serviced.push(job.installationId);

    try {
      await runScan(toScanJob(job), {
        checkRunId: job.checkRunId ?? undefined,
        onCheckOpened: (id) => recordCheckRun(job.id, id),
      });
      await markDone(job.id);
      done++;
    } catch (err) {
      // runScan already posted a neutral check and logged the reason; the queue decides
      // retry vs dead-letter from the attempt count.
      await markFailed(job.id, err);
      failed++;
    }
  }

  return { claimed, done, failed };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface WorkerLoopOptions {
  // How long to sleep after an empty drain before polling again.
  idleSleepMs?: number;
  // Lets a host stop the loop gracefully (SIGTERM -> abort).
  signal?: AbortSignal;
}

// Long-running worker: drain, sleep when idle, repeat. This is the recommended primary
// runner (scans can exceed serverless limits); the cron drain is a belt-and-suspenders
// fallback for low volume. A drain error is logged and retried after the idle sleep — the
// loop never exits on a transient failure.
export async function runWorkerLoop(opts: WorkerLoopOptions = {}): Promise<void> {
  const idleSleepMs = opts.idleSleepMs ?? 5_000;
  while (!opts.signal?.aborted) {
    let result: DrainResult;
    try {
      result = await drainOnce({ budgetMs: 55_000 });
    } catch (err) {
      console.error(`worker: drain failed — ${err instanceof Error ? err.message : String(err)}`);
      await sleep(idleSleepMs);
      continue;
    }
    if (result.claimed === 0) await sleep(idleSleepMs);
  }
}

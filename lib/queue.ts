import { and, asc, eq, lt, ne, notInArray, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { scanJobs } from '@/db/schema';

// Durable claim/retry logic for the backend scan queue (the `scan_job` table). The webhook
// enqueues; a worker claims with FOR UPDATE SKIP LOCKED, runs the scan, then marks the job
// done or failed. Everything here is plain Drizzle so it runs identically from the Vercel
// cron drain and the standalone worker.

export type ScanJobRow = typeof scanJobs.$inferSelect;

// A job is retried up to this many times before it dead-letters. attempts is incremented
// at claim time, so this counts total runs (initial + retries).
export const MAX_ATTEMPTS = 5;
// Exponential backoff base between retries: 30s, 60s, 120s, … measured from the last claim.
const BACKOFF_BASE_SECONDS = 30;
// Lease: a `running` job whose claim is older than this is assumed orphaned (worker
// crashed) and is reclaimable. Must exceed the longest realistic scan by a wide margin.
const LEASE_SECONDS = 600;

export interface EnqueueInput {
  installationId: number;
  repoFullName: string;
  repoId: number;
  headSha: string;
  ref: string;
  isPullRequest: boolean;
  userId: string;
}

// Idempotent enqueue: a redelivered webhook (same repo + commit) is a no-op thanks to the
// unique (repoId, headSha) index. Returns whether a new job was created.
export async function enqueue(input: EnqueueInput): Promise<{ enqueued: boolean; id?: string }> {
  const [row] = await db
    .insert(scanJobs)
    .values({ ...input, status: 'queued' })
    .onConflictDoNothing({ target: [scanJobs.repoId, scanJobs.headSha] })
    .returning({ id: scanJobs.id });
  return row ? { enqueued: true, id: row.id } : { enqueued: false };
}

// Cancel still-queued jobs for the same ref that an arriving newer commit supersedes — a
// rapid series of pushes to a branch should only scan the latest HEAD, not every interim
// commit. Only `queued` jobs are touched: a `running` scan is already in flight, and a
// finished one is immutable. The new commit's own job (exceptHeadSha) is never cancelled.
// Superseded jobs are marked `done` (they need no further processing) with a note; they
// never opened a check and never wrote a scan, so nothing downstream is affected.
export async function supersedeQueued(
  key: { installationId: number; repoFullName: string; ref: string; isPullRequest: boolean },
  exceptHeadSha: string,
): Promise<number> {
  const rows = await db
    .update(scanJobs)
    .set({ status: 'done', finishedAt: new Date(), lastError: `superseded by ${exceptHeadSha}` })
    .where(
      and(
        eq(scanJobs.installationId, key.installationId),
        eq(scanJobs.repoFullName, key.repoFullName),
        eq(scanJobs.ref, key.ref),
        eq(scanJobs.isPullRequest, key.isPullRequest),
        eq(scanJobs.status, 'queued'),
        ne(scanJobs.headSha, exceptHeadSha),
      ),
    )
    .returning({ id: scanJobs.id });
  return rows.length;
}

// A row is claimable when it is queued, OR a failed attempt whose backoff has elapsed, OR a
// `running` job whose lease expired (orphaned by a crashed worker). attempts < MAX_ATTEMPTS
// keeps exhausted jobs out (they're moved to `dead` by markFailed).
function claimableWhere(excludeInstallationIds: number[]) {
  const backoffElapsed = sql`${scanJobs.claimedAt} + (interval '1 second' * ${BACKOFF_BASE_SECONDS} * power(2, least(${scanJobs.attempts}, 6))) < now()`;
  const leaseExpired = sql`${scanJobs.claimedAt} < now() - (interval '1 second' * ${LEASE_SECONDS})`;
  const ready = or(
    eq(scanJobs.status, 'queued'),
    and(eq(scanJobs.status, 'error'), lt(scanJobs.attempts, MAX_ATTEMPTS), backoffElapsed),
    and(eq(scanJobs.status, 'running'), lt(scanJobs.attempts, MAX_ATTEMPTS), leaseExpired),
  );
  return excludeInstallationIds.length
    ? and(ready, notInArray(scanJobs.installationId, excludeInstallationIds))
    : ready;
}

// Claim the single oldest claimable job, skipping installations the caller has already
// serviced this round (per-installation fairness — see lib/worker.ts). FOR UPDATE SKIP
// LOCKED lets many workers/drains claim concurrently without blocking each other.
export async function claimNext(excludeInstallationIds: number[] = []): Promise<ScanJobRow | null> {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: scanJobs.id })
      .from(scanJobs)
      .where(claimableWhere(excludeInstallationIds))
      .orderBy(asc(scanJobs.createdAt))
      .limit(1)
      .for('update', { skipLocked: true });
    if (!candidate) return null;

    const [claimed] = await tx
      .update(scanJobs)
      .set({ status: 'running', claimedAt: new Date(), attempts: sql`${scanJobs.attempts} + 1` })
      .where(eq(scanJobs.id, candidate.id))
      .returning();
    return claimed ?? null;
  });
}

export async function markDone(jobId: string): Promise<void> {
  await db
    .update(scanJobs)
    .set({ status: 'done', finishedAt: new Date(), lastError: null })
    .where(eq(scanJobs.id, jobId));
}

// Record a failed attempt. attempts was already incremented at claim, so a job that has hit
// MAX_ATTEMPTS dead-letters (terminal); otherwise it returns to `error` to be retried after
// backoff. We never silently drop a job — a dead one stays for inspection.
export async function markFailed(jobId: string, err: unknown): Promise<void> {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
  await db
    .update(scanJobs)
    .set({
      status: sql`CASE WHEN ${scanJobs.attempts} >= ${MAX_ATTEMPTS} THEN 'dead' ELSE 'error' END`,
      finishedAt: sql`CASE WHEN ${scanJobs.attempts} >= ${MAX_ATTEMPTS} THEN now() ELSE NULL END`,
      lastError: message,
    })
    .where(eq(scanJobs.id, jobId));
}

// Best-effort: persist the opened check run id so a retry reuses it. A failure here only
// costs a possible duplicate check on retry, so it must never break the scan.
export async function recordCheckRun(jobId: string, checkRunId: number): Promise<void> {
  try {
    await db.update(scanJobs).set({ checkRunId }).where(eq(scanJobs.id, jobId));
  } catch (e) {
    console.warn(`queue: failed to record checkRunId for ${jobId} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

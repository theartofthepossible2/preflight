// Durable per-subject rate limiting, backed by the `rate_limit` table so the
// counter is shared across serverless instances (an in-memory Map throttles only
// one process and is useless when requests fan out across many cold starts).
//
// Fixed-window: time is bucketed into WINDOW_MS slices; each subject gets one row
// per window. A single atomic upsert increments the counter and returns the new
// value, so concurrent requests can't race past the limit.
//
// Fail-OPEN: this is abuse prevention, not correctness. Authentication already
// runs (and fails) first if the DB is unreachable, so on any limiter error we let
// the request through rather than hard-failing a paying customer's deploy gate.

import { lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { rateLimits } from '@/db/schema';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 6;

export async function rateLimit(key: string): Promise<{ ok: boolean; retryAfterSec: number }> {
  const now = Date.now();
  const windowIndex = Math.floor(now / WINDOW_MS);
  const windowEnd = (windowIndex + 1) * WINDOW_MS;
  const bucketKey = `${key}:${windowIndex}`;

  try {
    // Atomic check-and-increment: the upsert returns the post-increment count, so
    // the (count > max) test below is race-free under concurrent requests.
    const [row] = await db
      .insert(rateLimits)
      .values({ bucketKey, count: 1, expiresAt: new Date(windowEnd) })
      .onConflictDoUpdate({
        target: rateLimits.bucketKey,
        set: { count: sql`${rateLimits.count} + 1` },
      })
      .returning({ count: rateLimits.count });

    // Opportunistically sweep expired windows so the table stays small. Best-effort.
    if (Math.random() < 0.02) {
      void db
        .delete(rateLimits)
        .where(lt(rateLimits.expiresAt, new Date(now)))
        .then(
          () => {},
          () => {},
        );
    }

    if (row && row.count > MAX_PER_WINDOW) {
      return { ok: false, retryAfterSec: Math.ceil((windowEnd - now) / 1000) };
    }
    return { ok: true, retryAfterSec: 0 };
  } catch {
    // Fail open — never block a request because the limiter's store is unavailable.
    return { ok: true, retryAfterSec: 0 };
  }
}

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { drainOnce } from '@/lib/worker';

// Vercel Cron entry point: drains a bounded slice of the scan queue on a schedule (see
// vercel.json). This is the belt-and-suspenders runner for low volume; the standalone
// worker (worker/index.ts) is the recommended primary because scans can exceed serverless
// limits. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`, which we verify before
// doing any work so the endpoint can't be driven by anyone else.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Keep the drain comfortably under maxDuration so the function returns cleanly.
  const result = await drainOnce({ budgetMs: 50_000, maxJobs: 25 });
  return NextResponse.json(result);
}

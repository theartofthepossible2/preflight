import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { githubInstallations } from '@/db/schema';
import { runScan } from '@/lib/scan-run';

// TEMPORARY Phase-3 trigger. The real entry points are the webhook (Phase 5) enqueueing a
// job and the worker (Phase 4) draining it; this route exists only to drive runScan()
// end-to-end against one repo by hand before that plumbing lands, and should be removed
// once it does. It is triple-gated: an explicit env flag, a signed-in session, and an
// ownership check that the caller actually holds the installation being scanned.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A single-repo scan plus one enrichment call; comfortably under a minute in practice, but
// give it headroom since there is no queue here. The async worker (Phase 4) removes this
// constraint for the real path.
export const maxDuration = 300;

interface TriggerBody {
  installationId?: unknown;
  owner?: unknown;
  repo?: unknown;
  headSha?: unknown;
  ref?: unknown;
  isPullRequest?: unknown;
}

const SHA_RE = /^[0-9a-f]{7,40}$/i;
const NAME_RE = /^[A-Za-z0-9._-]+$/;

export async function POST(req: Request): Promise<NextResponse> {
  if (process.env.ENABLE_DEV_SCAN !== '1') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: TriggerBody;
  try {
    body = (await req.json()) as TriggerBody;
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const installationId = Number(body.installationId);
  const owner = typeof body.owner === 'string' ? body.owner : '';
  const repo = typeof body.repo === 'string' ? body.repo : '';
  const headSha = typeof body.headSha === 'string' ? body.headSha : '';
  const ref = typeof body.ref === 'string' && body.ref ? body.ref : `refs/heads/manual`;
  const isPullRequest = body.isPullRequest === true;

  if (!Number.isInteger(installationId) || installationId <= 0) {
    return NextResponse.json({ error: 'installationId (positive integer) is required.' }, { status: 400 });
  }
  if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) {
    return NextResponse.json({ error: 'owner and repo must be valid GitHub names.' }, { status: 400 });
  }
  if (!SHA_RE.test(headSha)) {
    return NextResponse.json({ error: 'headSha must be a git commit SHA.' }, { status: 400 });
  }

  // Ownership: the caller may only scan an installation bound to their own account.
  const [owned] = await db
    .select({ id: githubInstallations.id })
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.installationId, installationId),
        eq(githubInstallations.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!owned) {
    return NextResponse.json({ error: 'Installation not found for this account.' }, { status: 403 });
  }

  try {
    await runScan({
      installationId,
      owner,
      repo,
      headSha,
      ref,
      isPullRequest,
      userId: session.user.id,
    });
  } catch (err) {
    // runScan already posted a neutral check and logged the internal reason; keep the
    // response generic (it can name internal services).
    console.error(`dev/scan: runScan threw — ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: 'Scan failed; check posted neutral.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

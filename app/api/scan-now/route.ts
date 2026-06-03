import { auth } from '@/auth';
import { loadConnectState } from '@/lib/github/setup-data';
import { runManualScan, type ScanProgress } from '@/lib/scan-now';

// On-demand dashboard scan, streamed as Server-Sent Events so the client can render a live
// log. Auth + ownership gated: the caller must be signed in, and the target repo must be one
// of THEIR connected installations' repos (loadConnectState is user-scoped, so resolving the
// repo there IS the ownership check). Posts no Check Run — see lib/scan-now.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// One repo scan + at most one enrichment call. No queue here, so give it headroom.
export const maxDuration = 300;

const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: 'Unauthorized' }, 401);

  let repoFullName = '';
  try {
    const body = (await req.json()) as { repoFullName?: unknown };
    repoFullName = typeof body.repoFullName === 'string' ? body.repoFullName : '';
  } catch {
    return json({ error: 'Body must be JSON.' }, 400);
  }
  if (!REPO_RE.test(repoFullName)) {
    return json({ error: 'repoFullName (owner/repo) is required.' }, 400);
  }

  // Ownership: the repo must belong to one of the caller's own installations.
  const connect = await loadConnectState(session.user.id);
  const match = connect.repos.find((r) => r.fullName === repoFullName);
  if (!match) return json({ error: 'Repository not connected to this account.' }, 403);

  const [owner, repo] = repoFullName.split('/');
  const userId = session.user.id;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (p: ScanProgress) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(p)}\n\n`));
      try {
        await runManualScan(
          { installationId: match.installationId, owner, repo, ref: match.defaultBranch, userId },
          send,
        );
      } catch (err) {
        // Keep the client message generic; the detailed reason may name internal services.
        console.error(
          `scan-now: ${repoFullName} failed — ${err instanceof Error ? err.message : String(err)}`,
        );
        send({ type: 'error', message: 'Scan failed. Please try again.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Discourage proxy/CDN buffering so logs stream rather than arrive all at once.
      'X-Accel-Buffering': 'no',
    },
  });
}

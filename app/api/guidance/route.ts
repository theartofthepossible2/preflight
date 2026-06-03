import { desc, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { scans } from '@/db/schema';
import { buildPosture } from '@/lib/asvs/posture';
import { generateAreaGuidance } from '@/lib/guidance';
import { getSubscriptionState } from '@/lib/stripe';
import type { AnalyzedFinding, AsvsCategory } from '@/lib/types';

// On-demand AI guidance for one ASVS area of the caller's latest scan. Auth + subscription
// gated. The area's findings are reconstructed HERE from the user's own most-recent scan —
// the client sends only the area name, never finding text — so the model can't be fed
// arbitrary input and a caller can't generate guidance for data that isn't theirs. Returns
// a ≤3-sentence assessment + a paste-ready remediation prompt; never moves a gate.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Two sequential model calls (Haiku draft -> Sonnet refine). Give it headroom.
export const maxDuration = 120;

const CATEGORIES: AsvsCategory[] = ['ACCESS', 'SECRETS', 'CONFIG', 'INJECTION'];

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: 'Unauthorized' }, 401);

  let category = '';
  try {
    const body = (await req.json()) as { category?: unknown };
    category = typeof body.category === 'string' ? body.category : '';
  } catch {
    return json({ error: 'Body must be JSON.' }, 400);
  }
  if (!CATEGORIES.includes(category as AsvsCategory)) {
    return json({ error: 'Unknown ASVS area.' }, 400);
  }

  // Cost gate — same entitlement as scan enrichment. Defense in depth: the UI also hides
  // the action for non-subscribers.
  const subscription = await getSubscriptionState(session.user.id);
  if (!subscription.active) {
    return json({ error: 'An active subscription is required to generate AI guidance.' }, 402);
  }

  // Rebuild the area from the caller's OWN latest scan, using the same deterministic
  // grouping the dashboard renders — so guidance always matches what the user is looking at.
  const rows = await db
    .select({ findings: scans.findings })
    .from(scans)
    .where(eq(scans.userId, session.user.id))
    .orderBy(desc(scans.createdAt))
    .limit(1);
  const findings = Array.isArray(rows[0]?.findings) ? (rows[0].findings as AnalyzedFinding[]) : [];
  const area = buildPosture(findings).find((a) => a.category === category);
  if (!area || area.findings.length === 0) {
    return json({ error: 'No findings to act on in this area.' }, 404);
  }

  const result = await generateAreaGuidance({
    category: area.category,
    areaLabel: area.label,
    chapter: area.chapter,
    findings: area.findings,
  });

  if (result.status !== 'ok') {
    // Internal reason (may name a model/service) stays in logs; client message is generic.
    console.error(`guidance: ${category} failed — ${result.error}`);
    return json({ error: 'Guidance is temporarily unavailable. Please try again.' }, 503);
  }

  return json(
    { assessment: result.assessment, fixPrompt: result.fixPrompt, refined: result.refined },
    200,
  );
}

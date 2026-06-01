import { NextResponse } from 'next/server';
import { analyzeFindings } from '@/lib/analyze';
import { authenticateBearer } from '@/lib/apiKey';
import { rateLimit } from '@/lib/rateLimit';
import { getSubscriptionState } from '@/lib/stripe';
import { db } from '@/db';
import { scans } from '@/db/schema';
import type { AnalyzedFinding, Finding, ScanResponse } from '@/lib/types';
import { DISCLAIMER } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const VERSION = '0.3.0';

interface EnrichRequest {
  repo?: unknown;
  ref?: unknown;
  commitSha?: unknown;
  findings?: unknown;
}

function isFinding(value: unknown): value is Finding {
  if (typeof value !== 'object' || value === null) return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.id === 'string' &&
    typeof f.title === 'string' &&
    typeof f.severity === 'string' &&
    typeof f.confidence === 'string' &&
    typeof f.asvsCategory === 'string' &&
    typeof f.file === 'string' &&
    typeof f.detail === 'string' &&
    typeof f.remediation === 'string'
  );
}

export async function POST(req: Request) {
  const auth = await authenticateBearer(req.headers.get('authorization'));
  if (!auth) {
    return NextResponse.json({ error: 'Invalid or missing API key.' }, { status: 401 });
  }

  const limit = rateLimit(`apikey:${auth.apiKeyId}`);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
    );
  }

  let body: EnrichRequest;
  try {
    body = (await req.json()) as EnrichRequest;
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  if (!Array.isArray(body.findings)) {
    return NextResponse.json({ error: 'findings[] is required.' }, { status: 400 });
  }
  const findings = body.findings.filter(isFinding) as Finding[];

  const repo = typeof body.repo === 'string' ? body.repo : null;
  const ref = typeof body.ref === 'string' ? body.ref : null;
  const commitSha = typeof body.commitSha === 'string' ? body.commitSha : null;

  const subscription = await getSubscriptionState(auth.userId);

  let analyzed: AnalyzedFinding[] = findings.map((f) => ({
    ...f,
    asvsRequirement: { id: 'unknown', title: String(f.asvsCategory) },
    isLikelyRealIssue: f.confidence === 'definitive' ? 'high' : 'medium',
    explanation: f.detail,
    remediation_steps: [f.remediation],
  }));
  let additionalObservations: ScanResponse['additionalObservations'] = undefined;
  let aiEnrichment: 'ok' | 'unavailable' = 'unavailable';
  let aiError: string | undefined;

  if (!subscription.active) {
    aiError = 'subscription_required';
  } else if (findings.length > 0) {
    const analysis = await analyzeFindings(findings);
    analyzed = analysis.analyzed;
    additionalObservations = analysis.additionalObservations.length
      ? analysis.additionalObservations
      : undefined;
    aiEnrichment = analysis.status;
    aiError = analysis.error;
  } else {
    aiEnrichment = 'ok';
  }

  const counts = analyzed.reduce(
    (acc, f) => {
      acc[f.severity]++;
      return acc;
    },
    { HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 },
  );

  await db.insert(scans).values({
    userId: auth.userId,
    apiKeyId: auth.apiKeyId,
    repo,
    ref,
    commitSha,
    findingsCount: analyzed.length,
    highCount: counts.HIGH,
    aiEnriched: aiEnrichment === 'ok' && findings.length > 0,
    findings: analyzed,
    additionalObservations: additionalObservations ?? null,
  });

  const response: ScanResponse = {
    version: VERSION,
    scanned: { files: 0, code: 0, sql: 0 },
    counts,
    findings: analyzed,
    additionalObservations,
    aiEnrichment,
    aiError,
    disclaimer: DISCLAIMER,
  };

  return NextResponse.json(response, { status: 200 });
}

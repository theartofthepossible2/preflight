// Content-hash cache for finding enrichment. Repeated scans of unchanged flagged
// code (CI re-runs are the common case) reuse a stored explanation instead of
// re-billing for a fresh analysis. Backed by the `analysis_cache` table.
//
// We cache only the *enrichment delta* (asvsRequirement, explanation, remediation,
// ...) -- never the caller's base finding. The base finding stays with each request,
// so one account's scan text is never served to another; only the model-independent
// guidance for an identical finding is shared.
//
// Every function here is best-effort: a cache miss, a DB outage, or a serialization
// problem must never break enrichment. Reads return "no hits"; writes swallow.

import { createHash } from 'node:crypto';
import { inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { analysisCache } from '@/db/schema';
import type { AnalyzedFinding, Finding } from './types';

export interface CachedEnrichment {
  asvsRequirement: { id: string; title: string };
  isLikelyRealIssue: 'high' | 'medium' | 'low';
  explanation: string;
  remediation_steps: string[];
  codeFixExample?: string;
}

// Key = sha256(id, codeSnippet, detail), NUL-separated. The id encodes
// file|title|line; folding in the snippet and detail makes the key
// content-sensitive, so changed code at the same location misses (and is
// re-analyzed) while an unchanged re-run hits. The NUL separators stop field
// boundaries from colliding (e.g. "a"+"bc" vs "ab"+"c").
export function cacheKeyFor(finding: Pick<Finding, 'id' | 'codeSnippet' | 'detail'>): string {
  return createHash('sha256')
    .update(`${finding.id}\u0000${finding.codeSnippet ?? ''}\u0000${finding.detail ?? ''}`)
    .digest('hex');
}

export function enrichmentOf(f: AnalyzedFinding): CachedEnrichment {
  return {
    asvsRequirement: f.asvsRequirement,
    isLikelyRealIssue: f.isLikelyRealIssue,
    explanation: f.explanation,
    remediation_steps: f.remediation_steps,
    codeFixExample: f.codeFixExample,
  };
}

// Returns cacheKey -> enrichment for rows produced by the same model. A row from a
// different model is treated as a miss so the caller regenerates (and overwrites).
export async function getCachedEnrichments(
  keys: string[],
  model: string,
): Promise<Map<string, CachedEnrichment>> {
  const out = new Map<string, CachedEnrichment>();
  if (keys.length === 0) return out;
  try {
    const rows = await db
      .select({
        cacheKey: analysisCache.cacheKey,
        analysis: analysisCache.analysis,
        model: analysisCache.model,
      })
      .from(analysisCache)
      .where(inArray(analysisCache.cacheKey, keys));
    for (const r of rows) {
      if (r.model !== model) continue;
      out.set(r.cacheKey, r.analysis as CachedEnrichment);
    }
    if (out.size > 0) {
      // Fire-and-forget hit accounting; never block enrichment on it.
      const hitKeys = [...out.keys()];
      void db
        .update(analysisCache)
        .set({ hitCount: sql`${analysisCache.hitCount} + 1` })
        .where(inArray(analysisCache.cacheKey, hitKeys))
        .then(
          () => {},
          () => {},
        );
    }
  } catch {
    return new Map();
  }
  return out;
}

// Upserts fresh enrichments (overwriting a stale row from a prior model). Runs the
// writes in parallel and swallows any failure -- caching is an optimization only.
export async function putCachedEnrichments(
  entries: Array<{ key: string; enrichment: CachedEnrichment }>,
  model: string,
): Promise<void> {
  if (entries.length === 0) return;
  try {
    await Promise.all(
      entries.map((e) =>
        db
          .insert(analysisCache)
          .values({ cacheKey: e.key, analysis: e.enrichment, model })
          .onConflictDoUpdate({
            target: analysisCache.cacheKey,
            set: { analysis: e.enrichment, model, createdAt: new Date() },
          }),
      ),
    );
  } catch {
    // swallow
  }
}

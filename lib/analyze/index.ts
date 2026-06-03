import Anthropic from '@anthropic-ai/sdk';
import type {
  AdditionalObservation,
  AnalyzedFinding,
  Finding,
  Severity,
} from '../types';
import { primaryRequirement } from '../asvs';
import {
  cacheKeyFor,
  enrichmentOf,
  getCachedEnrichments,
  putCachedEnrichments,
} from '../cache';
import { SYSTEM_PROMPT, buildUserMessage } from './prompt';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;

const ANALYSIS_TOOL = {
  name: 'submit_analysis',
  description:
    'Submit the analyzed findings. Call this exactly once with one entry per provided finding (matched by id).',
  input_schema: {
    type: 'object' as const,
    properties: {
      findings: {
        type: 'array',
        description: 'One entry per provided finding, matched by id.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The finding id from the input.' },
            isLikelyRealIssue: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description:
                "Your confidence this is a true positive given the snippet. 'low' is appropriate for heuristic findings you cannot verify.",
            },
            explanation: {
              type: 'string',
              description:
                'Plain-language explanation grounded in the cited ASVS requirement. Cite the ASVS id.',
            },
            remediation: {
              type: 'array',
              items: { type: 'string' },
              description: 'Ordered concrete fix steps, specific to Next.js + Supabase/Neon.',
            },
            codeFixExample: {
              type: 'string',
              description: 'Optional short code snippet showing the corrected pattern.',
            },
          },
          required: ['id', 'isLikelyRealIssue', 'explanation', 'remediation'],
        },
      },
      additionalObservations: {
        type: 'array',
        description:
          'Optional. Issues visible in snippets that the scanner missed. Bounded — only include what you can see.',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            severity: {
              type: 'string',
              enum: ['HIGH', 'MEDIUM', 'LOW', 'INFO'],
            },
          },
          required: ['description', 'severity'],
        },
      },
    },
    required: ['findings'],
  },
};

interface ToolOutput {
  findings: Array<{
    id: string;
    isLikelyRealIssue: 'high' | 'medium' | 'low';
    explanation: string;
    remediation: string[];
    codeFixExample?: string;
  }>;
  additionalObservations?: Array<{ description: string; severity: Severity }>;
}

export interface AnalyzeResult {
  analyzed: AnalyzedFinding[];
  additionalObservations: AdditionalObservation[];
  status: 'ok' | 'unavailable';
  error?: string;
}

export async function analyzeFindings(findings: Finding[]): Promise<AnalyzeResult> {
  if (findings.length === 0) {
    return { analyzed: [], additionalObservations: [], status: 'ok' };
  }

  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

  // --- content-hash cache: reuse stored enrichment for unchanged findings ---
  const keys = findings.map((f) => cacheKeyFor(f));
  const cached = await getCachedEnrichments(keys, model);
  const fromCache = (i: number): AnalyzedFinding | null => {
    const hit = cached.get(keys[i]);
    return hit ? { ...findings[i], ...hit } : null;
  };
  const uncached = findings
    .map((f, i) => ({ f, i }))
    .filter(({ i }) => !cached.has(keys[i]));

  // Everything served from cache -> no model call, no spend.
  if (uncached.length === 0) {
    return {
      analyzed: findings.map((_, i) => fromCache(i)!),
      additionalObservations: [],
      status: 'ok',
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      analyzed: findings.map((f, i) => fromCache(i) ?? toUnanalyzed(f)),
      additionalObservations: [],
      status: 'unavailable',
      error: 'ANTHROPIC_API_KEY not configured',
    };
  }

  const enriched = uncached.map(({ f }) => {
    const req = primaryRequirement(f.asvsCategory);
    return {
      id: f.id,
      title: f.title,
      severity: f.severity,
      confidence: f.confidence,
      file: f.file,
      line: f.line,
      detail: f.detail,
      codeSnippet: f.codeSnippet,
      asvsRequirement: req
        ? { id: req.id, title: req.title, text: req.text }
        : { id: 'unknown', title: f.asvsCategory, text: 'No requirement metadata available.' },
    };
  });

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: 'tool', name: ANALYSIS_TOOL.name },
      messages: [{ role: 'user', content: buildUserMessage({ findings: enriched }) }],
    });

    const toolBlock = response.content.find(
      (block): block is Extract<typeof block, { type: 'tool_use' }> =>
        block.type === 'tool_use' && block.name === ANALYSIS_TOOL.name,
    );
    if (!toolBlock) {
      return {
        analyzed: findings.map((f, i) => fromCache(i) ?? toUnanalyzed(f)),
        additionalObservations: [],
        status: 'unavailable',
        error: 'Model did not call submit_analysis',
      };
    }

    const output = toolBlock.input as ToolOutput;
    const byId = new Map(output.findings.map((f) => [f.id, f]));

    // Analyze only the uncached findings (model result where present, deterministic
    // fallback otherwise), keyed by original index for the merge and cache write.
    const freshByIndex = new Map<number, AnalyzedFinding>();
    for (const { f, i } of uncached) {
      const match = byId.get(f.id);
      const req = primaryRequirement(f.asvsCategory);
      const asvsRequirement = req
        ? { id: req.id, title: req.title }
        : { id: 'unknown', title: f.asvsCategory };
      freshByIndex.set(
        i,
        match
          ? {
              ...f,
              asvsRequirement,
              isLikelyRealIssue: match.isLikelyRealIssue,
              explanation: match.explanation,
              remediation_steps: match.remediation,
              codeFixExample: match.codeFixExample,
            }
          : {
              ...f,
              asvsRequirement,
              isLikelyRealIssue: f.confidence === 'definitive' ? 'high' : 'medium',
              explanation: f.detail,
              remediation_steps: [f.remediation],
            },
      );
    }

    // Persist only model-produced enrichments (never the deterministic fallbacks).
    await putCachedEnrichments(
      uncached
        .filter(({ f }) => byId.has(f.id))
        .map(({ i }) => ({ key: keys[i], enrichment: enrichmentOf(freshByIndex.get(i)!) })),
      model,
    );

    const analyzed = findings.map((_, i) => fromCache(i) ?? freshByIndex.get(i)!);

    const additionalObservations: AdditionalObservation[] = (output.additionalObservations ?? []).map(
      (o) => ({ ...o, confidence: 'inferred' as const }),
    );

    return { analyzed, additionalObservations, status: 'ok' };
  } catch (err) {
    return {
      analyzed: findings.map((f, i) => fromCache(i) ?? toUnanalyzed(f)),
      additionalObservations: [],
      status: 'unavailable',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function toUnanalyzed(f: Finding): AnalyzedFinding {
  const req = primaryRequirement(f.asvsCategory);
  return {
    ...f,
    asvsRequirement: req
      ? { id: req.id, title: req.title }
      : { id: 'unknown', title: f.asvsCategory },
    isLikelyRealIssue: f.confidence === 'definitive' ? 'high' : 'medium',
    explanation: f.detail,
    remediation_steps: [f.remediation],
  };
}

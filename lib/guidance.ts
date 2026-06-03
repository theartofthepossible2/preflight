import Anthropic from '@anthropic-ai/sdk';
import type { AnalyzedFinding, AsvsCategory } from './types';

// On-demand, two-model remediation guidance for ONE ASVS area. This is the visible-but-
// compartmentalized AI surface: it produces (a) a ≤3-sentence posture assessment and (b) a
// paste-ready prompt the developer hands to their OWN coding assistant. It can NEVER move
// an area's level — the deterministic verdict (lib/asvs/posture) owns that. This only ever
// runs on the user's own findings, only on explicit click, and only for an active
// subscription (enforced at the route).
//
// The pipeline is genuinely two-stage: Haiku drafts fast, then Sonnet runs a "counter-
// prompt" pass — an adversarial review that tightens the draft and strips unsupported
// claims. If the Sonnet pass fails we fall back to the Haiku draft (marked `refined:false`)
// rather than failing the request, mirroring the rest of the system's "an AI outage
// degrades, never breaks" stance.

// Haiku 4.5 / Sonnet 4.6 — IDs verified against the Anthropic models docs (2026-06-03).
const DRAFT_MODEL = 'claude-haiku-4-5-20251001';
const REFINE_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2048;

export interface AreaGuidanceInput {
  category: AsvsCategory;
  areaLabel: string;
  chapter: string;
  findings: AnalyzedFinding[];
}

export type GuidanceResult =
  | { status: 'ok'; assessment: string; fixPrompt: string; refined: boolean }
  | { status: 'unavailable'; error: string };

interface Guidance {
  assessment: string;
  fixPrompt: string;
}

const GUIDANCE_TOOL = {
  name: 'submit_guidance',
  description: 'Submit the security assessment and the paste-ready remediation prompt.',
  input_schema: {
    type: 'object' as const,
    properties: {
      assessment: {
        type: 'string',
        description:
          "At most 3 sentences on this ASVS area's posture and why it matters before deploy. Never claim the app is secure, compliant, or passing.",
      },
      fixPrompt: {
        type: 'string',
        description:
          "A self-contained prompt the developer can paste into their own coding assistant to remediate exactly these findings in a Next.js + Supabase/Neon app. Reference the exact file paths and ASVS requirement ids; instruct minimal, reviewed edits; never destructive operations.",
      },
    },
    required: ['assessment', 'fixPrompt'],
  },
};

const DRAFT_SYSTEM = `You are the drafting stage of Preflight's remediation-guidance generator for Next.js + Supabase/Neon projects.

You are given deterministic security findings for ONE OWASP ASVS 5.0 area. Produce a short posture assessment and a paste-ready remediation prompt.

GROUND RULES — load-bearing, never violate:
1. NEVER claim the application is "secure", "compliant", or "passes". Describe posture against the cited controls only.
2. Respect each finding's confidence. "definitive" means the scanner read it directly; "heuristic" means it was inferred and may be a false positive — say so, and tell the developer's agent to verify before changing code.
3. The fix prompt must be stack-specific (Next.js App/Pages Router, Supabase client/server split, Neon Postgres, Vercel env vars), reference the exact file paths and ASVS requirement ids, and instruct minimal, reviewed edits — never destructive operations (no data deletion, no force-push, no disabling checks).
4. Do not invent findings beyond those provided.

Respond by calling submit_guidance exactly once. Produce no other text.`;

const REFINE_SYSTEM = `You are the refinement stage of Preflight's remediation-guidance generator. A faster model produced a DRAFT assessment and DRAFT fix prompt for one OWASP ASVS 5.0 area. You are given the original findings and that draft.

Review the draft as an adversarial reviewer: find where it is vague, generic, overlong, unsafe, or asserts more than the findings support. Then emit an improved FINAL version:
- assessment: tighten to at most 3 sentences; remove any "secure / compliant / passes" claim; stay concrete and honest about heuristic uncertainty.
- fixPrompt: make it precise and paste-ready — exact files, exact ASVS ids, stack-specific steps, minimal and reviewed edits, no destructive operations. Cut filler.

The drafting ground rules still apply in full. Respond by calling submit_guidance exactly once. Produce no other text.`;

function describeFindings(input: AreaGuidanceInput): string {
  const lines: string[] = [
    `ASVS area: ${input.areaLabel} (${input.chapter})`,
    `Findings in this area: ${input.findings.length}`,
    '',
  ];
  input.findings.forEach((f, i) => {
    lines.push(`--- Finding ${i + 1} (id: ${f.id}) ---`);
    lines.push(`Title: ${f.title}`);
    lines.push(`Severity: ${f.severity}   Confidence: ${f.confidence}`);
    lines.push(`Location: ${f.file}${f.line ? `:${f.line}` : ''}`);
    lines.push(`ASVS: ${f.asvsRequirement.id} — ${f.asvsRequirement.title}`);
    lines.push(`Scanner detail: ${f.detail}`);
    if (f.codeSnippet) {
      lines.push('Code:');
      lines.push('```');
      lines.push(f.codeSnippet);
      lines.push('```');
    }
    lines.push('');
  });
  return lines.join('\n');
}

async function callGuidanceTool(
  client: Anthropic,
  model: string,
  system: string,
  userText: string,
): Promise<Guidance | null> {
  const response = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system,
    tools: [GUIDANCE_TOOL],
    tool_choice: { type: 'tool', name: GUIDANCE_TOOL.name },
    messages: [{ role: 'user', content: userText }],
  });
  const block = response.content.find(
    (b): b is Extract<typeof b, { type: 'tool_use' }> =>
      b.type === 'tool_use' && b.name === GUIDANCE_TOOL.name,
  );
  if (!block) return null;
  const out = block.input as { assessment?: unknown; fixPrompt?: unknown };
  if (typeof out.assessment !== 'string' || typeof out.fixPrompt !== 'string') return null;
  return { assessment: out.assessment.trim(), fixPrompt: out.fixPrompt.trim() };
}

export async function generateAreaGuidance(input: AreaGuidanceInput): Promise<GuidanceResult> {
  if (input.findings.length === 0) {
    return { status: 'unavailable', error: 'No findings in this area.' };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { status: 'unavailable', error: 'ANTHROPIC_API_KEY not configured' };
  }

  const client = new Anthropic({ apiKey });
  const findingsText = describeFindings(input);

  try {
    // Stage 1 — Haiku draft.
    const draft = await callGuidanceTool(
      client,
      DRAFT_MODEL,
      DRAFT_SYSTEM,
      `${findingsText}\nDraft the assessment and fix prompt now.`,
    );
    if (!draft) {
      return { status: 'unavailable', error: 'Draft stage returned no guidance.' };
    }

    // Stage 2 — Sonnet counter-prompt / refine. A failure here degrades to the draft.
    let final = draft;
    let refined = false;
    try {
      const improved = await callGuidanceTool(
        client,
        REFINE_MODEL,
        REFINE_SYSTEM,
        `${findingsText}\n--- DRAFT TO REVIEW ---\nAssessment: ${draft.assessment}\n\nFix prompt:\n${draft.fixPrompt}\n\nReview the draft and emit the improved final via submit_guidance.`,
      );
      if (improved) {
        final = improved;
        refined = true;
      }
    } catch (err) {
      // Internal reason stays server-side; the draft is still a usable result.
      console.warn(
        `guidance: refine stage failed — ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { status: 'ok', assessment: final.assessment, fixPrompt: final.fixPrompt, refined };
  } catch (err) {
    return {
      status: 'unavailable',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

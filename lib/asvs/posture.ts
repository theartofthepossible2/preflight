import type { AnalyzedFinding, AsvsCategory, AsvsRequirement } from '../types';
import { requirementsForCategory } from './index';

// Deterministic posture model for the dashboard. The three levels below are derived
// ONLY from the scanner's findings and their severities — never from a model. This is
// the trust anchor: the verdict a customer reads is the same logic the deploy gate runs,
// not an AI opinion. (AI text lives in its own compartment in the UI, keyed off these
// findings, and can never move an area's level.)

export type PostureLevel = 'safe' | 'safer' | 'vulnerable';

export interface AreaPosture {
  category: AsvsCategory;
  label: string;
  // ASVS chapter label for the area's controls, e.g. "V8 Authorization".
  chapter: string;
  controls: AsvsRequirement[];
  level: PostureLevel;
  findings: AnalyzedFinding[];
  highCount: number;
}

// Human labels for the four ASVS areas the scanner covers. Stable display order.
const AREA_ORDER: AsvsCategory[] = ['ACCESS', 'SECRETS', 'CONFIG', 'INJECTION'];
const AREA_LABEL: Record<AsvsCategory, string> = {
  ACCESS: 'Access Control & Authorization',
  SECRETS: 'Secrets & Key Management',
  CONFIG: 'Security Configuration',
  INJECTION: 'Injection & Input Validation',
};

// Vulnerable floats to the top so "immediate action" is what the eye lands on first.
const LEVEL_RANK: Record<PostureLevel, number> = { vulnerable: 0, safer: 1, safe: 2 };

function levelFor(findings: AnalyzedFinding[]): PostureLevel {
  if (findings.some((f) => f.severity === 'HIGH')) return 'vulnerable';
  return findings.length > 0 ? 'safer' : 'safe';
}

// Group a scan's findings into all four ASVS areas (areas with zero findings are still
// returned, as `safe`, so the dashboard shows full coverage rather than only problems),
// then order vulnerable -> safer -> safe.
export function buildPosture(findings: AnalyzedFinding[]): AreaPosture[] {
  const areas: AreaPosture[] = AREA_ORDER.map((category) => {
    const inArea = findings.filter((f) => f.asvsCategory === category);
    const controls = requirementsForCategory(category);
    return {
      category,
      label: AREA_LABEL[category],
      chapter: controls[0]?.chapter ?? 'ASVS 5.0',
      controls,
      level: levelFor(inArea),
      findings: inArea,
      highCount: inArea.filter((f) => f.severity === 'HIGH').length,
    };
  });
  return areas.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
}

// One-line headline level for the whole scan (worst area wins). Used for the section
// summary chip.
export function overallLevel(areas: AreaPosture[]): PostureLevel {
  if (areas.some((a) => a.level === 'vulnerable')) return 'vulnerable';
  if (areas.some((a) => a.level === 'safer')) return 'safer';
  return 'safe';
}

// Display metadata for a level: the chip class reuses the existing severity tokens
// (high/medium/low) so the palette matches the rest of the dashboard.
export const LEVEL_META: Record<PostureLevel, { label: string; chip: 'high' | 'medium' | 'low' }> = {
  vulnerable: { label: 'Vulnerable', chip: 'high' },
  safer: { label: 'Safer available', chip: 'medium' },
  safe: { label: 'Safe', chip: 'low' },
};

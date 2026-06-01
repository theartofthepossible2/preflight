export type Severity = 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type Confidence = 'definitive' | 'heuristic';
export type AsvsCategory = 'ACCESS' | 'SECRETS' | 'CONFIG';

export interface Finding {
  id: string;
  severity: Severity;
  confidence: Confidence;
  asvsCategory: AsvsCategory;
  title: string;
  file: string;
  line: number | null;
  detail: string;
  remediation: string;
  codeSnippet?: string;
}

export interface AsvsRequirement {
  id: string;
  chapter: string;
  section: string;
  title: string;
  text: string;
}

export interface AnalyzedFinding extends Finding {
  asvsRequirement: { id: string; title: string };
  isLikelyRealIssue: 'high' | 'medium' | 'low';
  explanation: string;
  remediation_steps: string[];
  codeFixExample?: string;
}

export interface AdditionalObservation {
  description: string;
  severity: Severity;
  confidence: 'model-inferred';
}

export interface ScanResponse {
  version: string;
  scanned: { files: number; code: number; sql: number };
  counts: Record<Severity, number>;
  findings: AnalyzedFinding[];
  additionalObservations?: AdditionalObservation[];
  aiEnrichment: 'ok' | 'unavailable';
  aiError?: string;
  disclaimer: string;
}

export const DISCLAIMER =
  'Posture check against specific controls — not an ASVS compliance certification. Heuristic findings will be made precise once the connectivity-graph engine lands. AI enrichment explains findings; it does not decide whether they exist.';

export const SEV_ORDER: Severity[] = ['HIGH', 'MEDIUM', 'LOW', 'INFO'];

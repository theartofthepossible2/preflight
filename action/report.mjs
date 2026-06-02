#!/usr/bin/env node
// Preflight Action — report + gate.
// Reads the scanner's --json output, sends findings to the Preflight backend
// for enrichment + recording (best-effort), posts a GitHub Check Run, and
// exits non-zero when findings reach the configured severity threshold.
//
// The gate decision is made from the LOCAL scan, not the backend response, so
// a backend outage or an expired subscription can never let HIGH findings pass.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SEV_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };
const env = (k) => process.env[k] || '';

const findingsFile = process.argv[2];
const apiKey = env('PREFLIGHT_API_KEY');
const backend = (env('PREFLIGHT_BACKEND_URL') || 'https://preflight-seven.vercel.app').replace(/\/+$/, '');
const failOn = (env('PREFLIGHT_FAIL_ON') || 'HIGH').toUpperCase();
const failRank = SEV_RANK[failOn] ?? SEV_RANK.HIGH;

// ---- read local scan output ----
let scan;
try {
  scan = JSON.parse(readFileSync(findingsFile, 'utf8'));
} catch (e) {
  console.error(`Preflight: could not read scan output "${findingsFile}": ${e.message}`);
  process.exit(2);
}
const rawFindings = Array.isArray(scan.findings) ? scan.findings : [];

// ---- map scanner shape -> /api/enrich v0.3 shape ----
// scanner emits { severity, asvs, title, file, line, detail, remediation, confidence }
// enrich requires { id, title, severity, confidence, asvsCategory, file, detail, remediation }
const findingId = (f) =>
  'pf_' + createHash('sha256').update(`${f.file}|${f.title}|${f.line ?? ''}`).digest('hex').slice(0, 12);

const findings = rawFindings.map((f) => ({
  id: findingId(f),
  title: String(f.title ?? 'Untitled finding'),
  severity: String(f.severity ?? 'INFO').toUpperCase(),
  confidence: String(f.confidence ?? 'heuristic'),
  asvsCategory: String(f.asvs ?? 'ASVS'),
  file: String(f.file ?? '(unknown)'),
  line: f.line ?? null,
  detail: String(f.detail ?? ''),
  remediation: String(f.remediation ?? ''),
}));

// ---- gate decision (from local findings) ----
const counts = { HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
const fail = findings.some((f) => (SEV_RANK[f.severity] ?? 0) >= failRank);
const conclusion = fail ? 'failure' : 'success';

// ---- GitHub context ----
const repo = env('GITHUB_REPOSITORY'); // owner/repo
const ref = env('GITHUB_REF');
const sha = env('GITHUB_SHA');
const apiBase = env('GITHUB_API_URL') || 'https://api.github.com';
const ghToken = env('GITHUB_TOKEN');

// ---- enrich (best-effort: explanations + dashboard recording) ----
let enriched = null;
let enrichError = null;
if (!apiKey) {
  enrichError = 'no api-key provided; enrichment skipped';
} else {
  try {
    const res = await fetch(`${backend}/api/enrich`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: repo || null, ref: ref || null, commitSha: sha || null, findings }),
    });
    const text = await res.text();
    if (!res.ok) {
      enrichError = `HTTP ${res.status}: ${text.slice(0, 300)}`;
    } else {
      enriched = JSON.parse(text);
    }
  } catch (e) {
    enrichError = `request failed: ${e.message}`;
  }
}

// ---- build Check Run output (prefer enriched explanations) ----
const display =
  enriched && Array.isArray(enriched.findings) && enriched.findings.length ? enriched.findings : findings;

const summary = [
  `**${counts.HIGH} high · ${counts.MEDIUM} medium · ${counts.LOW} low · ${counts.INFO} info**`,
  '',
  fail
    ? `Gate **failed** — findings at or above \`${failOn}\`. Production promotion should be held.`
    : `Gate **passed** — no findings at or above \`${failOn}\`.`,
];
if (enriched?.aiError === 'subscription_required') {
  summary.push('', '_Explanations are unavailable without an active subscription. The gate still runs on the deterministic findings._');
} else if (enrichError) {
  summary.push('', `_Backend enrichment unavailable (${enrichError}). Gate evaluated on local findings._`);
}

const fmt = (f) => {
  const loc = f.line ? `${f.file}:${f.line}` : f.file;
  const explanation = f.explanation || f.detail || '';
  const fix = Array.isArray(f.remediation_steps) ? f.remediation_steps.join(' ') : f.remediation || '';
  const cat = f.asvsRequirement?.title || f.asvsCategory || '';
  return [
    `### [${f.severity}] ${f.title}`,
    `\`${loc}\`  ·  ${cat}  ·  ${f.confidence}`,
    '',
    explanation,
    fix ? `\n**Fix:** ${fix}` : '',
  ].join('\n');
};

const ordered = [...display].sort((a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0));
const text = ordered.length ? ordered.map(fmt).join('\n\n---\n\n') : 'No findings.';

// ---- post the Check Run (best-effort; needs context + checks: write) ----
if (repo && sha && ghToken) {
  const [owner, name] = repo.split('/');
  try {
    const res = await fetch(`${apiBase}/repos/${owner}/${name}/check-runs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'preflight',
        head_sha: sha,
        status: 'completed',
        conclusion,
        output: {
          title: `${counts.HIGH} high · ${counts.MEDIUM} medium · ${counts.LOW} low`,
          summary: summary.join('\n'),
          text: text.slice(0, 60000),
        },
      }),
    });
    if (res.ok) console.log('Preflight: posted "preflight" check run.');
    else console.error(`Preflight: could not post check run (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  } catch (e) {
    console.error(`Preflight: check run request failed: ${e.message}`);
  }
} else {
  console.log('Preflight: no GitHub check context (running locally?) — skipping check run.');
}

// ---- console summary ----
console.log(`\nPreflight: ${counts.HIGH} high · ${counts.MEDIUM} medium · ${counts.LOW} low · ${counts.INFO} info`);
if (enriched) console.log(`Preflight: enrichment "${enriched.aiEnrichment}"${enriched.aiError ? ` (${enriched.aiError})` : ''}.`);
else if (enrichError) console.log(`Preflight: enrichment skipped — ${enrichError}.`);
console.log(fail ? `Preflight: GATE FAILED (>= ${failOn}).` : 'Preflight: gate passed.');

process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * Scanner parity harness — proves the extracted TypeScript scanner (lib/scanner,
 * the engine the v0.4 backend worker runs in-process) detects byte-for-byte what the
 * original CLI (preflight.mjs) does, over the same materialized fixtures.
 *
 * It is intentionally zero-NEW-dependency: it bundles the TS scanner with the esbuild
 * that already ships in node_modules (resolving the @/* path alias), then runs that
 * bundle's scan() against `node preflight.mjs <dir> --json` and asserts they agree.
 *
 * Why fixtures live as JSON, not .ts/.sql: Preflight dogfoods itself, so any committed
 * insecure snippet would be flagged by its own self-scan. Storing them as .json means
 * classifyFile() skips them; vendor-format credentials are committed as __PLACEHOLDER__
 * tokens and only assembled into real-looking values here, in a temp dir outside the
 * repo, at run time. Nothing secret-shaped is ever written to a tracked file.
 *
 *   Usage: node test/run.mjs   (or: npm test)
 */
import * as esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const CLI = join(repoRoot, 'preflight.mjs');

// The CLI emits the full ASVS label; scan() emits the category key. Inverting the
// CLI's label map here folds the category into the parity comparison, so the test
// catches detection drift AND asvs-category-mapping drift in one pass.
const ASVS_TO_KEY = {
  'ASVS: Authorization & Access Control': 'ACCESS',
  'ASVS: Configuration & Secret Management': 'SECRETS',
  'ASVS: Security Configuration': 'CONFIG',
  'ASVS: Validation, Sanitization & Encoding': 'INJECTION',
};

// Fake-but-format-valid tokens, assembled from fragments so THIS file never trips
// Preflight's own Check E when it scans itself. Substituted into the fixture at run
// time; the committed JSON only ever holds the __PLACEHOLDER__ form.
const CRED = {
  __AWS_KEY__: 'AKIA' + 'IOSFODNN7EXAMPLE',
  __GH_TOKEN__: 'ghp' + '_' + 'A'.repeat(36),
  __STRIPE_KEY__: 'sk' + '_live_' + '0'.repeat(24),
  __SLACK_TOKEN__: 'xox' + 'b-' + '0'.repeat(20),
  __PEM_PRIVATE_KEY__: '-----BEGIN RSA ' + 'PRIVATE' + ' KEY-----',
};
const substitute = (text) =>
  Object.entries(CRED).reduce((s, [ph, val]) => s.split(ph).join(val), text);

// Distinctive title substring per check A–H; the vulnerable fixture must fire all eight.
const EXPECTED_CHECKS = {
  'A secret exposure': 'NEXT_PUBLIC_',
  'B rls posture': 'RLS',
  'C entry points': 'no detectable auth check',
  'D security headers': 'No security headers configured',
  'E hardcoded creds': 'committed to source',
  'F sql injection': 'SQL query assembled by string',
  'G dynamic exec': 'Dynamic code execution',
  'H xss': 'Raw HTML rendered from a non-constant value',
};

const failures = [];
const fail = (msg) => failures.push(msg);

// The comparable projection of a finding. Excludes `id` (scan-only) and the raw asvs
// label/key (folded in as `category`), leaving the fields both producers must agree on.
const tupleKey = (f) =>
  JSON.stringify([
    f.severity,
    f.confidence,
    f.category,
    f.title,
    f.file,
    f.line ?? null,
    f.detail,
    f.remediation,
  ]);

function materialize(workDir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(workDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, substitute(content), 'utf8');
  }
}

function runCli(dir) {
  const r = spawnSync(process.execPath, [CLI, dir, '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  let json;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    throw new Error(`CLI did not emit JSON for ${dir}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  }
  return { json, status: r.status };
}

async function loadScanner(buildDir) {
  const bundlePath = join(buildDir, 'harness.mjs');
  await esbuild.build({
    entryPoints: [join(repoRoot, 'test', 'harness-entry.ts')],
    outfile: bundlePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    absWorkingDir: repoRoot,
    alias: { '@': repoRoot },
    logLevel: 'silent',
  });
  return import(pathToFileURL(bundlePath).href);
}

async function main() {
  const buildDir = mkdtempSync(join(tmpdir(), 'pf-parity-'));
  try {
    const { scan, readProjectFiles } = await loadScanner(buildDir);

    const cases = [
      { name: 'vulnerable', expectFindings: true },
      { name: 'secure', expectFindings: false },
    ];

    for (const c of cases) {
      const fixture = JSON.parse(readFileSync(join(here, 'cases', `${c.name}.json`), 'utf8'));
      const files = fixture.files;
      const caseDir = join(buildDir, c.name);
      mkdirSync(caseDir, { recursive: true });
      materialize(caseDir, files);

      const { json: cli, status } = runCli(caseDir);
      const res = scan({ files: readProjectFiles(caseDir) });

      // scanned-count parity + a no-files-dropped sanity tie-down
      for (const k of ['files', 'code', 'sql']) {
        if (cli.scanned[k] !== res.scanned[k]) {
          fail(`[${c.name}] scanned.${k}: CLI=${cli.scanned[k]} scan=${res.scanned[k]}`);
        }
      }
      const materializedCount = Object.keys(files).length;
      if (res.scanned.files !== materializedCount) {
        fail(`[${c.name}] scan.scanned.files=${res.scanned.files}, materialized ${materializedCount}`);
      }

      // finding multiset parity (order-independent; category mapping included)
      const cliKeys = cli.findings
        .map((f) => {
          const category = ASVS_TO_KEY[f.asvs];
          if (!category) fail(`[${c.name}] CLI finding has unmapped asvs: ${JSON.stringify(f.asvs)}`);
          return tupleKey({ ...f, category });
        })
        .sort();
      const scanKeys = res.findings.map((f) => tupleKey({ ...f, category: f.asvsCategory })).sort();

      if (cliKeys.length !== scanKeys.length) {
        fail(`[${c.name}] finding count: CLI=${cliKeys.length} scan=${scanKeys.length}`);
      }
      for (let i = 0; i < Math.max(cliKeys.length, scanKeys.length); i++) {
        if (cliKeys[i] !== scanKeys[i]) {
          fail(
            `[${c.name}] finding mismatch #${i}\n      CLI : ${cliKeys[i] ?? '(none)'}\n      scan: ${scanKeys[i] ?? '(none)'}`,
          );
          break;
        }
      }

      // fixture-shape sanity: vulnerable trips all eight + gates fail; secure is clean + gates pass
      if (c.expectFindings) {
        const titles = res.findings.map((f) => f.title);
        for (const [check, needle] of Object.entries(EXPECTED_CHECKS)) {
          if (!titles.some((t) => t.includes(needle))) {
            fail(`[${c.name}] check "${check}" did not fire (no title contains "${needle}")`);
          }
        }
        if (status !== 1) fail(`[${c.name}] CLI should exit 1 on HIGH findings, got ${status}`);
      } else {
        if (res.findings.length !== 0) fail(`[${c.name}] scan expected 0 findings, got ${res.findings.length}`);
        if (cli.findings.length !== 0) fail(`[${c.name}] CLI expected 0 findings, got ${cli.findings.length}`);
        if (status !== 0) fail(`[${c.name}] CLI should exit 0 when clean, got ${status}`);
      }

      console.log(`  ${c.name.padEnd(11)} CLI ${cli.findings.length} / scan ${res.findings.length} findings`);
    }
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\nFAIL — ${failures.length} parity issue(s):`);
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('\nPASS — CLI and scan() agree on every fixture.');
}

main().catch((err) => {
  console.error('Harness error:', err);
  process.exit(1);
});

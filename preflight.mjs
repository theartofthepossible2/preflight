#!/usr/bin/env node
/**
 * Preflight v0.1
 * Deterministic, zero-dependency ASVS posture check for Next.js + Supabase/Neon projects.
 *
 * Usage:
 *   node preflight.mjs <path-to-project> [--json]
 *
 * Scope & honesty:
 *   This is the deterministic first slice. It verifies the PRESENCE of specific,
 *   high-signal controls characteristic of the Next/Supabase/Vercel stack. It does
 *   NOT certify "ASVS compliant", and it does NOT yet build the full connectivity
 *   graph or do semantic intent inference — those are the next milestones. Findings
 *   are tagged `definitive` (read directly from source/SQL) or `heuristic`
 *   (pattern-based inference that the future graph will make precise).
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const root = args.find((a) => !a.startsWith('--'));

if (!root || !existsSync(root)) {
  console.error('Usage: node preflight.mjs <path-to-project> [--json]');
  process.exit(2);
}

// ---------- enums ----------
const SEV = { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', INFO: 'INFO' };
const CONF = { DEFINITIVE: 'definitive', HEURISTIC: 'heuristic' };
const SEV_ORDER = [SEV.HIGH, SEV.MEDIUM, SEV.LOW, SEV.INFO];

// ASVS mapping is at category level for v0.1.
// TODO: pin to exact OWASP ASVS v5.0.0 requirement IDs by ingesting the ASVS 5.0 CSV (asvs.dev).
const ASVS = {
  ACCESS: 'ASVS: Authorization & Access Control',
  SECRETS: 'ASVS: Configuration & Secret Management',
  CONFIG: 'ASVS: Security Configuration',
};

// ---------- file walking ----------
const IGNORE_DIRS = new Set([
  'node_modules', '.next', '.git', 'dist', 'build', 'out', 'coverage', '.turbo', '.vercel', '.cache',
]);
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (!IGNORE_DIRS.has(name)) walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function loadProject(rootDir) {
  const files = walk(rootDir);
  const code = [], sql = [];
  for (const f of files) {
    const ext = extname(f);
    if (CODE_EXT.has(ext)) code.push(f);
    else if (ext === '.sql') sql.push(f);
  }
  const cache = new Map();
  const read = (f) => {
    if (cache.has(f)) return cache.get(f);
    let c = '';
    try { c = readFileSync(f, 'utf8'); } catch { /* ignore unreadable */ }
    cache.set(f, c);
    return c;
  };
  return {
    root: rootDir,
    allFiles: files,
    code,
    sql,
    read,
    rel: (f) => (relative(rootDir, f) || basename(f)).split(/[\\/]/).join('/'),
  };
}

// ---------- finding registry ----------
const findings = [];
function add(f) { findings.push({ confidence: CONF.DEFINITIVE, line: null, ...f }); }
function lineAt(content, idx) { return content.slice(0, Math.max(idx, 0)).split('\n').length; }

// ---------- pattern helpers ----------
const hasUseClient = (c) => /^\s*['"]use client['"]\s*;?/m.test(c);
const hasUseServer = (c) => /^\s*['"]use server['"]\s*;?/m.test(c);

const AUTH_HINTS = [
  /\.auth\.getUser\s*\(/, /\.auth\.getSession\s*\(/, /getServerSession\s*\(/,
  /\bgetSession\s*\(/, /\bgetUser\s*\(/,
  /\brequireUser\s*\(/, /\brequireAuth\s*\(/, /\bcurrentUser\s*\(/, /\bgetCurrentUser\s*\(/,
  /\bverify(Jwt|Token|Session)\s*\(/, /withApiAuth/, /@clerk\//,
];
const hasAuthHint = (c) => AUTH_HINTS.some((r) => r.test(c));

const DB_HINTS = [
  /\.from\s*\(\s*['"`]/, /\bsupabase\b/, /\bprisma\s*\./, /\bdrizzle\b/,
  /\bsql`/, /\bpool\.query\s*\(/, /\bdb\.(select|insert|update|delete|query|execute)\b/,
];
const hasDbAccess = (c) => DB_HINTS.some((r) => r.test(c));

// ========== Check A: secret exposure ==========
function checkSecretExposure(p) {
  const PUBLIC_OK = /(ANON|PUBLISHABLE)/i; // anon / publishable keys are public by design
  for (const f of p.code) {
    const c = p.read(f);
    const rel = p.rel(f);

    // 1) NEXT_PUBLIC_ env vars carrying secrets (inlined into the browser bundle)
    const re = /process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g;
    let m;
    while ((m = re.exec(c))) {
      const name = m[1];
      if (PUBLIC_OK.test(name)) continue;
      const tier1 = /(SERVICE_ROLE|SECRET|PASSWORD|PRIVATE)/i.test(name);
      const tier2 = /(_KEY|_TOKEN)\b/i.test(name);
      if (tier1) {
        add({
          severity: SEV.HIGH, asvs: ASVS.SECRETS,
          title: 'Secret exposed via NEXT_PUBLIC_ env var (bundled to the browser)',
          file: rel, line: lineAt(c, m.index),
          detail: `${name} is prefixed NEXT_PUBLIC_, so its value is inlined into the client bundle and readable by anyone.`,
          remediation: 'Drop the NEXT_PUBLIC_ prefix and read this only in server code (route handlers, server actions, server components). Rotate the value.',
        });
      } else if (tier2) {
        add({
          severity: SEV.MEDIUM, asvs: ASVS.SECRETS,
          title: 'Possible secret exposed via NEXT_PUBLIC_ env var',
          file: rel, line: lineAt(c, m.index),
          detail: `${name} is bundled to the browser. Confirm it is meant to be public (e.g. a publishable key). If it is a secret, it is leaked.`,
          remediation: 'If secret: remove the NEXT_PUBLIC_ prefix and read it server-side only.',
        });
      }
    }

    // 2) service_role key referenced inside a client component
    if (hasUseClient(c) && /SERVICE_ROLE|service_role/.test(c)) {
      add({
        severity: SEV.HIGH, asvs: ASVS.SECRETS,
        title: 'Supabase service_role key referenced in a client component',
        file: rel, line: lineAt(c, c.search(/SERVICE_ROLE|service_role/)),
        detail: 'This is a client component ("use client") referencing the service_role key, which bypasses RLS. If it reaches the bundle, it is full database access for any visitor.',
        remediation: 'Use the service_role key only in server-only modules. In the browser, use the anon key with RLS enforced.',
      });
    }

    // 3) hardcoded Postgres connection string with credentials
    const conn = /postgres(?:ql)?:\/\/[^\s'"`]+:[^\s'"`]+@/g;
    while ((m = conn.exec(c))) {
      add({
        severity: SEV.HIGH, asvs: ASVS.SECRETS,
        title: 'Hardcoded database connection string with credentials',
        file: rel, line: lineAt(c, m.index),
        detail: 'A Postgres connection string containing a username and password appears directly in source.',
        remediation: 'Move it to a server-side environment variable and rotate the exposed credentials.',
      });
    }
  }
}

// ========== Check B: Supabase RLS posture ==========
function checkRls(p) {
  if (p.sql.length === 0) {
    add({
      severity: SEV.INFO, asvs: ASVS.ACCESS,
      title: 'No SQL migrations found — database authorization not verified here',
      file: '(project)',
      detail: 'If you use Supabase, RLS is verifiable only when policies live in migrations; if managed in the dashboard, Preflight cannot see it. If you use Neon (plain Postgres), authorization is expected in the app layer instead.',
      remediation: 'Keep RLS policies in versioned migrations so they are reviewable and verifiable.',
    });
    return;
  }

  const created = new Map(); // table -> {file,line}
  const rlsEnabled = new Set();

  for (const f of p.sql) {
    const c = p.read(f);
    const rel = p.rel(f);
    let m;

    const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?["`']?(?:\w+\.)?(\w+)["`']?/gi;
    while ((m = createRe.exec(c))) {
      const t = m[1].toLowerCase();
      if (!created.has(t)) created.set(t, { file: rel, line: lineAt(c, m.index) });
    }

    const enableRe = /alter\s+table\s+(?:if\s+exists\s+)?["`']?(?:\w+\.)?(\w+)["`']?\s+enable\s+row\s+level\s+security/gi;
    while ((m = enableRe.exec(c))) rlsEnabled.add(m[1].toLowerCase());

    const permRe = /(using|with\s+check)\s*\(\s*true\s*\)/gi;
    while ((m = permRe.exec(c))) {
      add({
        severity: SEV.HIGH, asvs: ASVS.ACCESS,
        title: 'Permissive RLS policy (USING/WITH CHECK true)',
        file: rel, line: lineAt(c, m.index),
        detail: 'A policy evaluates to TRUE for everyone, which disables the access control it appears to provide.',
        remediation: 'Scope the policy to the requesting user, e.g. using (auth.uid() = user_id).',
      });
    }
  }

  for (const [t, loc] of created) {
    if (!rlsEnabled.has(t)) {
      add({
        severity: SEV.HIGH, asvs: ASVS.ACCESS,
        title: `Table "${t}" has no RLS enabled in migrations`,
        file: loc.file, line: loc.line,
        detail: `No "alter table ${t} enable row level security" was found. Without RLS, any client holding the anon key can read/write this table. (If RLS is enabled in the dashboard, Preflight can't see it — migrations are the verifiable place.)`,
        remediation: `Add: alter table ${t} enable row level security; then define explicit policies.`,
      });
    }
  }
}

// ========== Check C: unprotected server entry points (HEURISTIC) ==========
function checkEntryPoints(p) {
  let middlewareAuth = false;
  for (const f of p.code) {
    const b = basename(f);
    if ((b === 'middleware.ts' || b === 'middleware.js') && hasAuthHint(p.read(f))) middlewareAuth = true;
  }

  for (const f of p.code) {
    const c = p.read(f);
    const rel = p.rel(f);
    const b = basename(f);

    const isRouteHandler = /^route\.(t|j)sx?$/.test(b) && /(^|\/)app\//.test(rel);
    const isPagesApi = /(^|\/)pages\/api\//.test(rel);
    const isServerAction = hasUseServer(c);

    if (!(isRouteHandler || isPagesApi || isServerAction)) continue;
    if (!hasDbAccess(c)) continue;   // only flag entry points that touch data
    if (hasAuthHint(c)) continue;    // an auth check is present in-handler

    const kind = isRouteHandler ? 'Route handler' : isPagesApi ? 'API route' : 'Server action';
    const caveat = middlewareAuth
      ? ' A middleware auth guard exists in the project — verify whether it actually covers this path.'
      : '';
    add({
      severity: SEV.MEDIUM, asvs: ASVS.ACCESS, confidence: CONF.HEURISTIC,
      title: `${kind} performs data access with no detectable auth check`,
      file: rel, line: 1,
      detail: `This server entry point reads or writes data, but no authentication/authorization call was detected on its path.${caveat}`,
      remediation: 'Enforce an auth check server-side before any data access. Client-side route guards do not count.',
    });
  }
}

// ========== Check D: security headers ==========
function checkHeaders(p) {
  const cfg = p.code.find((f) => /(^|\/)next\.config\.(js|ts|mjs|cjs)$/.test(p.rel(f)));
  if (!cfg) return; // no config -> defaults / different setup; stay quiet rather than guess
  const c = p.read(cfg);
  const hasHeadersFn = /headers\s*\(\s*\)|headers\s*:\s*async/.test(c);
  const hasCsp = /Content-Security-Policy/i.test(c);
  const hasHsts = /Strict-Transport-Security/i.test(c);
  if (!hasHeadersFn && !hasCsp && !hasHsts) {
    add({
      severity: SEV.LOW, asvs: ASVS.CONFIG,
      title: 'No security headers configured in next.config',
      file: p.rel(cfg), line: 1,
      detail: 'No headers() function or CSP/HSTS configuration was found.',
      remediation: 'Add a headers() function setting at least Content-Security-Policy, Strict-Transport-Security, and X-Frame-Options.',
    });
  }
}

// ========== run ==========
const project = loadProject(root);
checkSecretExposure(project);
checkRls(project);
checkEntryPoints(project);
checkHeaders(project);

const counts = { HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
for (const f of findings) counts[f.severity]++;

if (jsonOut) {
  console.log(JSON.stringify({
    tool: 'preflight', version: '0.1',
    scanned: { files: project.allFiles.length, code: project.code.length, sql: project.sql.length },
    counts, findings,
    disclaimer: 'Deterministic posture check. Verifies presence of specific controls; not full ASVS certification. "heuristic" findings will be made precise by the connectivity graph (next milestone).',
  }, null, 2));
} else {
  const C = { HIGH: '\x1b[31m', MEDIUM: '\x1b[33m', LOW: '\x1b[36m', INFO: '\x1b[90m', reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m' };
  console.log(`\n${C.bold}Preflight v0.1${C.reset} ${C.dim}— deterministic ASVS posture check${C.reset}`);
  console.log(`${C.dim}Scanned ${project.code.length} code + ${project.sql.length} SQL files in ${root}${C.reset}\n`);

  const ordered = [...findings].sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
  if (ordered.length === 0) {
    console.log('No issues found by the current checks. (First-pass posture check, not full ASVS certification.)\n');
  }
  for (const f of ordered) {
    const col = C[f.severity] || '';
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    console.log(`${col}${C.bold}[${f.severity}]${C.reset} ${f.title}`);
    console.log(`   ${C.dim}${loc}  ·  ${f.asvs}  ·  ${f.confidence}${C.reset}`);
    console.log(`   ${f.detail}`);
    console.log(`   ${C.dim}Fix:${C.reset} ${f.remediation}\n`);
  }

  console.log(`${C.bold}Summary${C.reset}  ${C.HIGH}${counts.HIGH} high${C.reset} · ${C.MEDIUM}${counts.MEDIUM} medium${C.reset} · ${C.LOW}${counts.LOW} low${C.reset} · ${counts.INFO} info`);
  console.log(`${C.dim}Posture check only — verifies specific controls, not full ASVS compliance. "heuristic" findings get precise once the connectivity graph lands.${C.reset}\n`);
}

process.exit(counts.HIGH > 0 ? 1 : 0);

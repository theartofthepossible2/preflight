import type { AsvsCategory, Confidence, Severity } from '@/lib/types';

// The deterministic detection rules, ported verbatim from preflight.mjs. The regexes,
// severity tiers, ignore-lists and heuristics are intentionally byte-for-byte with the
// CLI — they are tuned against fixtures to keep the false-positive rate low. A parity
// test (test/run.mjs) asserts this module and the CLI agree on every fixture.
//
// This is pure: it takes already-loaded file contents and returns findings. No file
// system, no network. The scan() wrapper (./index.ts) assembles the project model and
// stamps each finding with its stable id.

export interface ScanFile {
  path: string; // repo-relative POSIX path
  content: string;
}

export interface Project {
  code: ScanFile[];
  sql: ScanFile[];
}

export interface RawFinding {
  severity: Severity;
  asvsCategory: AsvsCategory;
  confidence: Confidence;
  title: string;
  file: string;
  line: number | null;
  detail: string;
  remediation: string;
}

type AddInput = Omit<RawFinding, 'confidence' | 'line'> & {
  confidence?: Confidence;
  line?: number | null;
};

// ---------- finding accumulator ----------
function makeSink() {
  const findings: RawFinding[] = [];
  const add = (f: AddInput) =>
    findings.push({ confidence: 'definitive', line: null, ...f });
  return { findings, add };
}

function lineAt(content: string, idx: number): number {
  return content.slice(0, Math.max(idx, 0)).split('\n').length;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

// ---------- pattern helpers ----------
const hasUseClient = (c: string) => /^\s*['"]use client['"]\s*;?/m.test(c);
const hasUseServer = (c: string) => /^\s*['"]use server['"]\s*;?/m.test(c);

const AUTH_HINTS = [
  /\.auth\.getUser\s*\(/,
  /\.auth\.getSession\s*\(/,
  /getServerSession\s*\(/,
  /\bgetSession\s*\(/,
  /\bgetUser\s*\(/,
  /\brequireUser\s*\(/,
  /\brequireAuth\s*\(/,
  /\bcurrentUser\s*\(/,
  /\bgetCurrentUser\s*\(/,
  /\bverify(Jwt|Token|Session)\s*\(/,
  /withApiAuth/,
  /@clerk\//,
];
const hasAuthHint = (c: string) => AUTH_HINTS.some((r) => r.test(c));

const DB_HINTS = [
  /\.from\s*\(\s*['"`]/,
  /\bsupabase\b/,
  /\bprisma\s*\./,
  /\bdrizzle\b/,
  /\bsql`/,
  /\bpool\.query\s*\(/,
  /\bdb\.(select|insert|update|delete|query|execute)\b/,
];
const hasDbAccess = (c: string) => DB_HINTS.some((r) => r.test(c));

// A connection string pointing at one of these hosts is local dev / a build-time
// placeholder, not a leaked production credential.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|::1|0\.0\.0\.0)$/i;
// Unambiguous non-secret tokens. Deliberately excludes weak-but-plausible real
// passwords (postgres, admin, root) so those still flag against a remote host.
const isPlaceholderSecret = (pw: string) =>
  /^(placeholder|changeme|your[-_]?password|example|sample|dummy|x{3,})$/i.test(pw) ||
  /^[[<{].*[\]>}]$/.test(pw);

// ========== Check A: secret exposure ==========
function checkSecretExposure(p: Project, add: (f: AddInput) => void) {
  const PUBLIC_OK = /(ANON|PUBLISHABLE)/i; // anon / publishable keys are public by design
  for (const { path: rel, content: c } of p.code) {
    // 1) NEXT_PUBLIC_ env vars carrying secrets (inlined into the browser bundle)
    const re = /process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(c))) {
      const name = m[1];
      if (PUBLIC_OK.test(name)) continue;
      const tier1 = /(SERVICE_ROLE|SECRET|PASSWORD|PRIVATE)/i.test(name);
      const tier2 = /(_KEY|_TOKEN)\b/i.test(name);
      if (tier1) {
        add({
          severity: 'HIGH',
          asvsCategory: 'SECRETS',
          title: 'Secret exposed via NEXT_PUBLIC_ env var (bundled to the browser)',
          file: rel,
          line: lineAt(c, m.index),
          detail: `${name} is prefixed NEXT_PUBLIC_, so its value is inlined into the client bundle and readable by anyone.`,
          remediation:
            'Drop the NEXT_PUBLIC_ prefix and read this only in server code (route handlers, server actions, server components). Rotate the value.',
        });
      } else if (tier2) {
        add({
          severity: 'MEDIUM',
          asvsCategory: 'SECRETS',
          title: 'Possible secret exposed via NEXT_PUBLIC_ env var',
          file: rel,
          line: lineAt(c, m.index),
          detail: `${name} is bundled to the browser. Confirm it is meant to be public (e.g. a publishable key). If it is a secret, it is leaked.`,
          remediation: 'If secret: remove the NEXT_PUBLIC_ prefix and read it server-side only.',
        });
      }
    }

    // 2) service_role key referenced inside a client component
    if (hasUseClient(c) && /SERVICE_ROLE|service_role/.test(c)) {
      add({
        severity: 'HIGH',
        asvsCategory: 'SECRETS',
        title: 'Supabase service_role key referenced in a client component',
        file: rel,
        line: lineAt(c, c.search(/SERVICE_ROLE|service_role/)),
        detail:
          'This is a client component ("use client") referencing the service_role key, which bypasses RLS. If it reaches the bundle, it is full database access for any visitor.',
        remediation:
          'Use the service_role key only in server-only modules. In the browser, use the anon key with RLS enforced.',
      });
    }

    // 3) hardcoded Postgres connection string with credentials
    const conn = /postgres(?:ql)?:\/\/([^\s'"`:/@]+):([^\s'"`@]+)@([^\s'"`:/?]+)/g;
    while ((m = conn.exec(c))) {
      const [, , pass, host] = m;
      // Skip local-only strings and unambiguous placeholders (e.g. fail-soft build
      // defaults like postgresql://placeholder:placeholder@127.0.0.1). These are not
      // leaked production secrets; flagging them erodes trust in the gate.
      if (LOCAL_HOST.test(host) || isPlaceholderSecret(pass)) continue;
      add({
        severity: 'HIGH',
        asvsCategory: 'SECRETS',
        title: 'Hardcoded database connection string with credentials',
        file: rel,
        line: lineAt(c, m.index),
        detail:
          'A Postgres connection string containing a username and password appears directly in source.',
        remediation:
          'Move it to a server-side environment variable and rotate the exposed credentials.',
      });
    }
  }
}

// ========== Check B: Supabase RLS posture ==========
function checkRls(p: Project, add: (f: AddInput) => void) {
  if (p.sql.length === 0) {
    add({
      severity: 'INFO',
      asvsCategory: 'ACCESS',
      title: 'No SQL migrations found — database authorization not verified here',
      file: '(project)',
      detail:
        'If you use Supabase, RLS is verifiable only when policies live in migrations; if managed in the dashboard, Preflight cannot see it. If you use Neon (plain Postgres), authorization is expected in the app layer instead.',
      remediation:
        'Keep RLS policies in versioned migrations so they are reviewable and verifiable.',
    });
    return;
  }

  const created = new Map<string, { file: string; line: number }>();
  const rlsEnabled = new Set<string>();

  for (const { path: rel, content: c } of p.sql) {
    let m: RegExpExecArray | null;

    const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?["`']?(?:\w+\.)?(\w+)["`']?/gi;
    while ((m = createRe.exec(c))) {
      const t = m[1].toLowerCase();
      if (!created.has(t)) created.set(t, { file: rel, line: lineAt(c, m.index) });
    }

    const enableRe =
      /alter\s+table\s+(?:if\s+exists\s+)?["`']?(?:\w+\.)?(\w+)["`']?\s+enable\s+row\s+level\s+security/gi;
    while ((m = enableRe.exec(c))) rlsEnabled.add(m[1].toLowerCase());

    const permRe = /(using|with\s+check)\s*\(\s*true\s*\)/gi;
    while ((m = permRe.exec(c))) {
      add({
        severity: 'HIGH',
        asvsCategory: 'ACCESS',
        title: 'Permissive RLS policy (USING/WITH CHECK true)',
        file: rel,
        line: lineAt(c, m.index),
        detail:
          'A policy evaluates to TRUE for everyone, which disables the access control it appears to provide.',
        remediation: 'Scope the policy to the requesting user, e.g. using (auth.uid() = user_id).',
      });
    }
  }

  for (const [t, loc] of created) {
    if (!rlsEnabled.has(t)) {
      add({
        severity: 'HIGH',
        asvsCategory: 'ACCESS',
        title: `Table "${t}" has no RLS enabled in migrations`,
        file: loc.file,
        line: loc.line,
        detail: `No "alter table ${t} enable row level security" was found. Without RLS, any client holding the anon key can read/write this table. (If RLS is enabled in the dashboard, Preflight can't see it — migrations are the verifiable place.)`,
        remediation: `Add: alter table ${t} enable row level security; then define explicit policies.`,
      });
    }
  }
}

// ========== Check C: unprotected server entry points (HEURISTIC) ==========
function checkEntryPoints(p: Project, add: (f: AddInput) => void) {
  let middlewareAuth = false;
  for (const { path, content } of p.code) {
    const b = basename(path);
    if ((b === 'middleware.ts' || b === 'middleware.js') && hasAuthHint(content)) {
      middlewareAuth = true;
    }
  }

  for (const { path: rel, content: c } of p.code) {
    const b = basename(rel);

    const isRouteHandler = /^route\.(t|j)sx?$/.test(b) && /(^|\/)app\//.test(rel);
    const isPagesApi = /(^|\/)pages\/api\//.test(rel);
    const isServerAction = hasUseServer(c);

    if (!(isRouteHandler || isPagesApi || isServerAction)) continue;
    if (!hasDbAccess(c)) continue; // only flag entry points that touch data
    if (hasAuthHint(c)) continue; // an auth check is present in-handler

    const kind = isRouteHandler ? 'Route handler' : isPagesApi ? 'API route' : 'Server action';
    const caveat = middlewareAuth
      ? ' A middleware auth guard exists in the project — verify whether it actually covers this path.'
      : '';
    add({
      severity: 'MEDIUM',
      asvsCategory: 'ACCESS',
      confidence: 'heuristic',
      title: `${kind} performs data access with no detectable auth check`,
      file: rel,
      line: 1,
      detail: `This server entry point reads or writes data, but no authentication/authorization call was detected on its path.${caveat}`,
      remediation:
        'Enforce an auth check server-side before any data access. Client-side route guards do not count.',
    });
  }
}

// ========== Check D: security headers ==========
function checkHeaders(p: Project, add: (f: AddInput) => void) {
  const cfg = p.code.find((f) => /(^|\/)next\.config\.(js|ts|mjs|cjs)$/.test(f.path));
  if (!cfg) return; // no config -> defaults / different setup; stay quiet rather than guess
  const c = cfg.content;
  const hasHeadersFn = /headers\s*\(\s*\)|headers\s*:\s*async/.test(c);
  const hasCsp = /Content-Security-Policy/i.test(c);
  const hasHsts = /Strict-Transport-Security/i.test(c);
  if (!hasHeadersFn && !hasCsp && !hasHsts) {
    add({
      severity: 'LOW',
      asvsCategory: 'CONFIG',
      title: 'No security headers configured in next.config',
      file: cfg.path,
      line: 1,
      detail: 'No headers() function or CSP/HSTS configuration was found.',
      remediation:
        'Add a headers() function setting at least Content-Security-Policy, Strict-Transport-Security, and X-Frame-Options.',
    });
  }
}

// ========== Check E: hardcoded credentials (known token formats) ==========
// Each pattern matches a vendor-specific, high-entropy credential whose natural
// false-positive rate is near zero. We never echo the matched value into a finding.
const CRED_PATTERNS = [
  { label: 'an AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'a GitHub access token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { label: 'a Stripe secret key', re: /\b[sr]k_live_[0-9a-zA-Z]{16,}\b/ },
  { label: 'a Slack token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
];
// PEM private-key header, assembled from fragments so this scanner never flags its
// own rule definition when it runs over a checkout that vendors this file.
const PEM_PRIVATE_KEY = new RegExp('-----BEGIN[A-Z ]*PRIVATE' + ' KEY' + '-----');
// Files that legitimately carry sample/redacted values — don't cry wolf on those.
const isExampleFile = (rel: string) =>
  /(^|[./])(example|sample|template|fixture|mock)s?([./]|$)/i.test(rel);

function checkHardcodedCreds(p: Project, add: (f: AddInput) => void) {
  for (const { path: rel, content: c } of p.code) {
    if (isExampleFile(rel)) continue;
    for (const { label, re } of CRED_PATTERNS) {
      const m = re.exec(c);
      if (!m) continue;
      add({
        severity: 'HIGH',
        asvsCategory: 'SECRETS',
        title: 'Hardcoded credential committed to source',
        file: rel,
        line: lineAt(c, m.index),
        detail: `A value matching the format of ${label} appears directly in source. Committed credentials are readable by anyone with repository access and persist in git history even after the line is removed.`,
        remediation:
          'Move it to a server-side environment variable and rotate the exposed credential immediately.',
      });
    }
    const pem = PEM_PRIVATE_KEY.exec(c);
    if (pem) {
      add({
        severity: 'HIGH',
        asvsCategory: 'SECRETS',
        title: 'Private key committed to source',
        file: rel,
        line: lineAt(c, pem.index),
        detail:
          'A PEM private-key block appears directly in source. Anyone with repository access holds the key, and it persists in git history even after the line is removed.',
        remediation:
          'Remove the key from the repository, store it in a secret manager, and rotate the key pair.',
      });
    }
  }
}

// ========== Check F: SQL built by concatenation/interpolation (HEURISTIC) ==========
// A query method whose argument starts with a back-tick template that interpolates,
// or a quoted string immediately concatenated. Tagged-template clients (the sql``
// helper, postgres.js) parameterize and never start the arg with a back-tick, so
// they are not matched here.
const RAW_QUERY = /\.(?:query|execute|unsafe|raw)\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+)/;
function checkSqlInjection(p: Project, add: (f: AddInput) => void) {
  for (const { path: rel, content: c } of p.code) {
    const re = new RegExp(RAW_QUERY.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(c))) {
      add({
        severity: 'MEDIUM',
        asvsCategory: 'INJECTION',
        confidence: 'heuristic',
        title: 'SQL query assembled by string concatenation or interpolation',
        file: rel,
        line: lineAt(c, m.index),
        detail:
          'A database query argument is built from a template literal or a concatenated string. If any interpolated part is caller-controlled, this is a SQL injection vector. (Tagged-template clients that parameterize their inputs are not flagged.)',
        remediation:
          'Pass values as parameterized query placeholders instead of building the SQL string yourself.',
      });
    }
  }
}

// ========== Check G: dynamic code execution (HEURISTIC) ==========
const DYN_EXEC = /\beval\s*\(|\bnew\s+Function\s*\(/;
function checkDynamicExec(p: Project, add: (f: AddInput) => void) {
  for (const { path: rel, content: c } of p.code) {
    const re = new RegExp(DYN_EXEC.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(c))) {
      add({
        severity: 'MEDIUM',
        asvsCategory: 'INJECTION',
        confidence: 'heuristic',
        title: 'Dynamic code execution',
        file: rel,
        line: lineAt(c, m.index),
        detail:
          'Code is executed from a string at runtime. If any part of that string is caller-controlled, it is a remote code execution vector.',
        remediation:
          'Remove the dynamic evaluation; use a data structure, lookup table, or explicit parser instead of executing constructed code.',
      });
    }
  }
}

// ========== Check H: unsanitized raw-HTML rendering (HEURISTIC) ==========
const DSI = /dangerouslySetInnerHTML\s*=\s*\{\{[^}]*__html\s*:\s*([^}]+)\}\}/;
function checkXss(p: Project, add: (f: AddInput) => void) {
  for (const { path: rel, content: c } of p.code) {
    const re = new RegExp(DSI.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(c))) {
      const expr = m[1];
      if (/^\s*['"`]/.test(expr)) continue; // static string literal
      if (/sanitiz|dompurify|purify|escapehtml/i.test(expr)) continue; // already sanitized
      add({
        severity: 'MEDIUM',
        asvsCategory: 'INJECTION',
        confidence: 'heuristic',
        title: 'Raw HTML rendered from a non-constant value',
        file: rel,
        line: lineAt(c, m.index),
        detail:
          'A non-constant value is rendered as raw HTML via dangerouslySetInnerHTML. If any part is caller-controlled and unsanitized, this is a cross-site scripting (XSS) vector.',
        remediation:
          'Sanitize the HTML with a vetted sanitizer before rendering, or render the value as text instead of raw HTML.',
      });
    }
  }
}

// Runs every check in the CLI's order and returns the raw findings (no id stamped).
export function runRules(project: Project): RawFinding[] {
  const { findings, add } = makeSink();
  checkSecretExposure(project, add);
  checkRls(project, add);
  checkEntryPoints(project, add);
  checkHeaders(project, add);
  checkHardcodedCreds(project, add);
  checkSqlInjection(project, add);
  checkDynamicExec(project, add);
  checkXss(project, add);
  return findings;
}

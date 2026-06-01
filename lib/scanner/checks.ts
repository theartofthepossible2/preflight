import type { AsvsCategory, Confidence, Finding, Severity } from '../types';
import {
  hasAuthHint,
  hasDbAccess,
  hasUseClient,
  hasUseServer,
  lineAt,
  snippetAround,
} from './patterns';

interface ProjectContext {
  codeFiles: string[];
  sqlFiles: string[];
  read(file: string): string;
}

interface DraftFinding {
  check: string;
  severity: Severity;
  confidence?: Confidence;
  asvsCategory: AsvsCategory;
  title: string;
  file: string;
  line: number | null;
  detail: string;
  remediation: string;
  codeSnippet?: string;
}

function makeId(d: DraftFinding): string {
  return `${d.check}:${d.file}:${d.line ?? 0}`;
}

function finalize(d: DraftFinding): Finding {
  return {
    id: makeId(d),
    severity: d.severity,
    confidence: d.confidence ?? 'definitive',
    asvsCategory: d.asvsCategory,
    title: d.title,
    file: d.file,
    line: d.line,
    detail: d.detail,
    remediation: d.remediation,
    codeSnippet: d.codeSnippet,
  };
}

export function checkSecretExposure(ctx: ProjectContext): Finding[] {
  const out: Finding[] = [];
  const PUBLIC_OK = /(ANON|PUBLISHABLE)/i;

  for (const file of ctx.codeFiles) {
    const c = ctx.read(file);
    if (!c) continue;

    const envRe = /process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g;
    let m: RegExpExecArray | null;
    while ((m = envRe.exec(c))) {
      const name = m[1];
      if (PUBLIC_OK.test(name)) continue;
      const tier1 = /(SERVICE_ROLE|SECRET|PASSWORD|PRIVATE)/i.test(name);
      const tier2 = /(_KEY|_TOKEN)\b/i.test(name);
      const line = lineAt(c, m.index);
      if (tier1) {
        out.push(
          finalize({
            check: 'secret.public_env_tier1',
            severity: 'HIGH',
            asvsCategory: 'SECRETS',
            title: 'Secret exposed via NEXT_PUBLIC_ env var (bundled to the browser)',
            file,
            line,
            detail: `${name} is prefixed NEXT_PUBLIC_, so its value is inlined into the client bundle and readable by anyone.`,
            remediation:
              'Drop the NEXT_PUBLIC_ prefix and read this only in server code (route handlers, server actions, server components). Rotate the value.',
            codeSnippet: snippetAround(c, line),
          }),
        );
      } else if (tier2) {
        out.push(
          finalize({
            check: 'secret.public_env_tier2',
            severity: 'MEDIUM',
            asvsCategory: 'SECRETS',
            title: 'Possible secret exposed via NEXT_PUBLIC_ env var',
            file,
            line,
            detail: `${name} is bundled to the browser. Confirm it is meant to be public (e.g. a publishable key). If it is a secret, it is leaked.`,
            remediation:
              'If secret: remove the NEXT_PUBLIC_ prefix and read it server-side only.',
            codeSnippet: snippetAround(c, line),
          }),
        );
      }
    }

    if (hasUseClient(c) && /SERVICE_ROLE|service_role/.test(c)) {
      const idx = c.search(/SERVICE_ROLE|service_role/);
      const line = lineAt(c, idx);
      out.push(
        finalize({
          check: 'secret.service_role_in_client',
          severity: 'HIGH',
          asvsCategory: 'SECRETS',
          title: 'Supabase service_role key referenced in a client component',
          file,
          line,
          detail:
            'This is a client component ("use client") referencing the service_role key, which bypasses RLS. If it reaches the bundle, it is full database access for any visitor.',
          remediation:
            'Use the service_role key only in server-only modules. In the browser, use the anon key with RLS enforced.',
          codeSnippet: snippetAround(c, line),
        }),
      );
    }

    const connRe = /postgres(?:ql)?:\/\/[^\s'"`]+:[^\s'"`]+@/g;
    while ((m = connRe.exec(c))) {
      const line = lineAt(c, m.index);
      out.push(
        finalize({
          check: 'secret.hardcoded_pg_url',
          severity: 'HIGH',
          asvsCategory: 'SECRETS',
          title: 'Hardcoded database connection string with credentials',
          file,
          line,
          detail:
            'A Postgres connection string containing a username and password appears directly in source.',
          remediation:
            'Move it to a server-side environment variable and rotate the exposed credentials.',
          codeSnippet: snippetAround(c, line),
        }),
      );
    }
  }

  return out;
}

export function checkRls(ctx: ProjectContext): Finding[] {
  const out: Finding[] = [];

  if (ctx.sqlFiles.length === 0) {
    out.push(
      finalize({
        check: 'rls.no_sql',
        severity: 'INFO',
        asvsCategory: 'ACCESS',
        title: 'No SQL migrations found — database authorization not verified here',
        file: '(project)',
        line: null,
        detail:
          'If you use Supabase, RLS is verifiable only when policies live in migrations; if managed in the dashboard, Preflight cannot see it. If you use Neon (plain Postgres), authorization is expected in the app layer instead.',
        remediation:
          'Keep RLS policies in versioned migrations so they are reviewable and verifiable.',
      }),
    );
    return out;
  }

  const created = new Map<string, { file: string; line: number; snippet: string }>();
  const rlsEnabled = new Set<string>();

  for (const file of ctx.sqlFiles) {
    const c = ctx.read(file);
    if (!c) continue;
    let m: RegExpExecArray | null;

    const createRe =
      /create\s+table\s+(?:if\s+not\s+exists\s+)?["`']?(?:\w+\.)?(\w+)["`']?/gi;
    while ((m = createRe.exec(c))) {
      const t = m[1].toLowerCase();
      if (!created.has(t)) {
        const line = lineAt(c, m.index);
        created.set(t, { file, line, snippet: snippetAround(c, line) });
      }
    }

    const enableRe =
      /alter\s+table\s+(?:if\s+exists\s+)?["`']?(?:\w+\.)?(\w+)["`']?\s+enable\s+row\s+level\s+security/gi;
    while ((m = enableRe.exec(c))) rlsEnabled.add(m[1].toLowerCase());

    const permRe = /(using|with\s+check)\s*\(\s*true\s*\)/gi;
    while ((m = permRe.exec(c))) {
      const line = lineAt(c, m.index);
      out.push(
        finalize({
          check: 'rls.permissive_policy',
          severity: 'HIGH',
          asvsCategory: 'ACCESS',
          title: 'Permissive RLS policy (USING/WITH CHECK true)',
          file,
          line,
          detail:
            'A policy evaluates to TRUE for everyone, which disables the access control it appears to provide.',
          remediation: 'Scope the policy to the requesting user, e.g. using (auth.uid() = user_id).',
          codeSnippet: snippetAround(c, line),
        }),
      );
    }
  }

  for (const [table, loc] of created) {
    if (!rlsEnabled.has(table)) {
      out.push(
        finalize({
          check: 'rls.disabled',
          severity: 'HIGH',
          asvsCategory: 'ACCESS',
          title: `Table "${table}" has no RLS enabled in migrations`,
          file: loc.file,
          line: loc.line,
          detail: `No "alter table ${table} enable row level security" was found. Without RLS, any client holding the anon key can read/write this table. (If RLS is enabled in the dashboard, Preflight can't see it — migrations are the verifiable place.)`,
          remediation: `Add: alter table ${table} enable row level security; then define explicit policies.`,
          codeSnippet: loc.snippet,
        }),
      );
    }
  }

  return out;
}

export function checkEntryPoints(ctx: ProjectContext): Finding[] {
  const out: Finding[] = [];

  let middlewareAuth = false;
  for (const file of ctx.codeFiles) {
    const base = file.split('/').pop() ?? file;
    if ((base === 'middleware.ts' || base === 'middleware.js') && hasAuthHint(ctx.read(file))) {
      middlewareAuth = true;
      break;
    }
  }

  for (const file of ctx.codeFiles) {
    const c = ctx.read(file);
    if (!c) continue;
    const base = file.split('/').pop() ?? file;

    const isRouteHandler = /^route\.(t|j)sx?$/.test(base) && /(^|\/)app\//.test(file);
    const isPagesApi = /(^|\/)pages\/api\//.test(file);
    const isServerAction = hasUseServer(c);

    if (!(isRouteHandler || isPagesApi || isServerAction)) continue;
    if (!hasDbAccess(c)) continue;
    if (hasAuthHint(c)) continue;

    const kind = isRouteHandler ? 'Route handler' : isPagesApi ? 'API route' : 'Server action';
    const caveat = middlewareAuth
      ? ' A middleware auth guard exists in the project — verify whether it actually covers this path.'
      : '';
    out.push(
      finalize({
        check: 'entry.no_auth',
        severity: 'MEDIUM',
        confidence: 'heuristic',
        asvsCategory: 'ACCESS',
        title: `${kind} performs data access with no detectable auth check`,
        file,
        line: 1,
        detail: `This server entry point reads or writes data, but no authentication/authorization call was detected on its path.${caveat}`,
        remediation:
          'Enforce an auth check server-side before any data access. Client-side route guards do not count.',
        codeSnippet: snippetAround(c, 1, 8),
      }),
    );
  }

  return out;
}

export function checkHeaders(ctx: ProjectContext): Finding[] {
  const cfg = ctx.codeFiles.find((f) => /(^|\/)next\.config\.(js|ts|mjs|cjs)$/.test(f));
  if (!cfg) return [];
  const c = ctx.read(cfg);
  if (!c) return [];
  const hasHeadersFn = /headers\s*\(\s*\)|headers\s*:\s*async/.test(c);
  const hasCsp = /Content-Security-Policy/i.test(c);
  const hasHsts = /Strict-Transport-Security/i.test(c);
  if (hasHeadersFn || hasCsp || hasHsts) return [];

  return [
    finalize({
      check: 'headers.missing',
      severity: 'LOW',
      asvsCategory: 'CONFIG',
      title: 'No security headers configured in next.config',
      file: cfg,
      line: 1,
      detail: 'No headers() function or CSP/HSTS configuration was found.',
      remediation:
        'Add a headers() function setting at least Content-Security-Policy, Strict-Transport-Security, and X-Frame-Options.',
      codeSnippet: snippetAround(c, 1, 8),
    }),
  ];
}

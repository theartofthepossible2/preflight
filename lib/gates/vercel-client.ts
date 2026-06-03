import type { GateState } from './types';

// Thin Vercel REST client used by the Vercel gate adapter to check whether a stored
// connection (token + project) is live.
//
// Deliberate limitation: Vercel exposes NO public REST endpoint for "is this GitHub
// check required for Production" — it's a UI-only toggle in Settings → Deployment
// Checks. So this client can authoritatively report a *broken* connection ('error')
// but cannot, on the public API alone, positively confirm 'required'. It therefore
// never invents 'required' or 'missing'; the manual attestation flow remains the
// source of truth until a Phase 2 Vercel Integration provides a real signal at the
// marked seam below.

const API = 'https://api.vercel.com';
const TIMEOUT_MS = 8000;

export interface VerifyArgs {
  token: string;
  teamId: string | null;
  projectId: string | null;
  checkName: string;
}

interface VercelProject {
  id: string;
  name: string;
}

function teamQuery(teamId: string | null): string {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
}

async function vercelFetch(path: string, token: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

// Validates the token can read the configured project. Returns:
//   'error'      — token rejected (401/403) or project missing (404): a real,
//                  surfaceable connection problem worth prompting a reconnect.
//   'unverified' — token + project look valid, OR the call was uncertain (network /
//                  timeout / unexpected shape). We make no positive claim.
// Never returns 'required' (no public signal) or 'missing' (would wrongly clobber a
// manual attestation).
export async function verifyProjectGate(args: VerifyArgs): Promise<GateState> {
  const { token, teamId, projectId } = args;
  if (!projectId) return 'unverified';

  let res: Response;
  try {
    res = await vercelFetch(
      `/v9/projects/${encodeURIComponent(projectId)}${teamQuery(teamId)}`,
      token,
    );
  } catch {
    return 'unverified'; // network / timeout / abort — transient, don't alarm
  }

  // Definitive credential/project failures are worth surfacing.
  if (res.status === 401 || res.status === 403 || res.status === 404) return 'error';
  // Other non-2xx (e.g. a 5xx) is transient — stay quiet.
  if (!res.ok) return 'unverified';

  try {
    const project = (await res.json()) as Partial<VercelProject>;
    if (!project || typeof project.id !== 'string') return 'unverified';
  } catch {
    return 'unverified';
  }

  // --- Positive-confirmation seam -----------------------------------------------
  // A live token + project is all the public API can tell us. With a Phase 2 Vercel
  // Integration (or a future stable "required checks" endpoint) we would return
  // 'required' here when args.checkName is required for Production. Until then, no
  // positive claim is made.
  return 'unverified';
}

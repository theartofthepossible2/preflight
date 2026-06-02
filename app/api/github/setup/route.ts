import { NextResponse } from 'next/server';
import { db } from '@/db';
import { githubInstallations } from '@/db/schema';
import { isGithubAppConfigured } from '@/lib/github/app';
import { exchangeUserCode, listUserInstallations } from '@/lib/github/oauth';
import { verifyConnectState } from '@/lib/github/state';

// GitHub App "Setup URL" callback. Lives under /api/* so it bypasses the auth
// middleware by design — GitHub redirects the browser here and it authenticates
// via signed state + OAuth ownership, not a session cookie.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function back(req: Request, params: Record<string, string>): NextResponse {
  const url = new URL('/dashboard', req.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!isGithubAppConfigured()) {
    return back(req, { connect: 'error', reason: 'not_configured' });
  }

  const { searchParams } = new URL(req.url);
  const installationIdRaw = searchParams.get('installation_id');
  const state = searchParams.get('state');
  const code = searchParams.get('code');

  const installationId = installationIdRaw ? Number(installationIdRaw) : NaN;
  if (!Number.isInteger(installationId)) {
    return back(req, { connect: 'error', reason: 'missing_installation' });
  }

  // 1) Recover the initiating user from the signed, expiring state.
  let uid: string | null = null;
  try {
    uid = verifyConnectState(state);
  } catch {
    uid = null;
  }
  if (!uid) {
    return back(req, { connect: 'error', reason: 'bad_state' });
  }

  // 2) Prove the installer owns this installation. The installation_id param is
  //    spoofable on its own, so confirm it appears in the user's own install list.
  if (!code) {
    return back(req, { connect: 'error', reason: 'no_oauth' });
  }
  const userToken = await exchangeUserCode(code);
  if (!userToken) {
    return back(req, { connect: 'error', reason: 'oauth_failed' });
  }
  const installations = await listUserInstallations(userToken);
  const match = installations.find((i) => i.id === installationId);
  if (!match) {
    return back(req, { connect: 'error', reason: 'not_owner' });
  }

  // 3) Bind the installation to the verified user.
  const accountLogin = match.account?.login ?? 'unknown';
  const accountType = match.account?.type ?? 'User';
  try {
    await db
      .insert(githubInstallations)
      .values({ installationId, accountLogin, accountType, userId: uid })
      .onConflictDoUpdate({
        target: githubInstallations.installationId,
        set: { userId: uid, accountLogin, accountType, suspendedAt: null, updatedAt: new Date() },
      });
  } catch {
    return back(req, { connect: 'error', reason: 'db' });
  }

  return back(req, { connect: 'ok' });
}

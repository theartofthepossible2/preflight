// OAuth-on-install ownership check. GitHub appends a `code` to the setup callback
// when "Request user authorization (OAuth) during installation" is enabled. We
// exchange it for a user token and confirm the installation actually appears in
// that user's installation list — the `installation_id` query param alone is
// spoofable (GitHub's own warning), so it must never bind an install to a user.
//
// Plain fetch (not Octokit's OAuth helper) keeps this independent of octokit's
// OAuth API surface. These calls run server-side, so CSP connect-src does not apply.

export interface UserInstallation {
  id: number;
  account: { login: string; type: string } | null;
}

export async function exchangeUserCode(code: string): Promise<string | null> {
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

export async function listUserInstallations(userToken: string): Promise<UserInstallation[]> {
  const res = await fetch('https://api.github.com/user/installations?per_page=100', {
    headers: {
      authorization: `Bearer ${userToken}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { installations?: UserInstallation[] };
  return data.installations ?? [];
}

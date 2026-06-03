import { App } from 'octokit';

// GitHub App client for automated repo setup. This is a SEPARATE app from the
// sign-in OAuth app (auth.ts uses AUTH_GITHUB_ID/SECRET); do not conflate them.
//
// Module load must never throw — Vercel imports this graph during build/prerender
// before runtime env is present (same fail-soft contract as db/index.ts and
// lib/stripe.ts). Construction is therefore lazy and gated by isGithubAppConfigured().

function getPrivateKey(): string | undefined {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!raw) return undefined;
  // Vercel env stores multi-line PEM with literal "\n" — normalize to real newlines.
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

export function isGithubAppConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_APP_ID &&
      getPrivateKey() &&
      process.env.GITHUB_APP_SLUG &&
      process.env.GITHUB_APP_CLIENT_ID &&
      process.env.GITHUB_APP_CLIENT_SECRET,
  );
}

let cachedApp: App | null = null;

function getApp(): App {
  if (cachedApp) return cachedApp;
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = getPrivateKey();
  if (!appId || !privateKey) {
    throw new Error('GitHub App is not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY).');
  }
  cachedApp = new App({ appId, privateKey });
  return cachedApp;
}

// Installation-scoped REST client. Octokit mints + refreshes the installation
// access token from the app JWT; we never handle the token directly.
export async function getInstallationOctokit(installationId: number) {
  return getApp().getInstallationOctokit(installationId);
}

export type InstallationOctokit = Awaited<ReturnType<typeof getInstallationOctokit>>;

// Uninstall the App from a connected account. Uses the app-level JWT client, not an
// installation token — the latter would be revoked by this very call. Authoritative
// teardown: GitHub drops the App's access to the account's repos. Used by account
// deletion (the install-lifecycle webhook then mirrors the change into our rows).
export async function deleteInstallation(installationId: number): Promise<void> {
  await getApp().octokit.rest.apps.deleteInstallation({ installation_id: installationId });
}

// Where the Connect button sends the user to install the App on their repos.
export function installUrl(state: string): string {
  const slug = process.env.GITHUB_APP_SLUG;
  if (!slug) throw new Error('GitHub App is not configured (GITHUB_APP_SLUG).');
  return `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`;
}

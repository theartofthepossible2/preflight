'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { githubInstallations, repoSetups } from '@/db/schema';
import { issueKey, revokeKey } from '@/lib/apiKey';
import { DEFAULT_GATE_PROVIDER } from '@/lib/gates';
import { getInstallationOctokit, installUrl, isGithubAppConfigured } from '@/lib/github/app';
import { ensureWorkflow } from '@/lib/github/contents';
import { setRepoSecret } from '@/lib/github/secrets';
import { signConnectState } from '@/lib/github/state';
import { SECRET_NAME } from '@/lib/github/workflow-template';
import { getSubscriptionState } from '@/lib/stripe';

export interface ConnectResult {
  url?: string;
  error?: string;
}

export interface ConfigureResult {
  ok?: boolean;
  error?: string;
  workflowState?: string;
  secretState?: string;
}

// Returns the GitHub App install URL; the client navigates to it.
export async function connectRepoAction(): Promise<ConnectResult> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'Not signed in.' };
  if (!isGithubAppConfigured()) return { error: 'Automated setup is not enabled yet.' };
  try {
    return { url: installUrl(signConnectState(session.user.id)) };
  } catch {
    return { error: 'Could not start the connect flow.' };
  }
}

// Writes the workflow file and the PREFLIGHT_API_KEY secret for one repo.
// Idempotent; a hand-edited workflow reports "drift" and is only overwritten when
// the caller passes overwrite=true.
export async function configureRepoAction(formData: FormData): Promise<ConfigureResult> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'Not signed in.' };
  const userId = session.user.id;

  if (!isGithubAppConfigured()) return { error: 'Automated setup is not enabled yet.' };

  // Setup is a paid action (the gate itself never fails on payment state — that's
  // the deploy pipeline; this is the dashboard).
  const subscription = await getSubscriptionState(userId);
  if (!subscription.active) {
    return { error: 'An active subscription is required to connect a repository.' };
  }

  const repoFullName = String(formData.get('repoFullName') ?? '').trim();
  const installationId = Number(formData.get('installationId'));
  const overwrite = String(formData.get('overwrite') ?? '') === 'true';
  if (!repoFullName.includes('/') || !Number.isInteger(installationId)) {
    return { error: 'Invalid repository.' };
  }
  const [owner, repo] = repoFullName.split('/');

  // The installation must be one this user connected.
  const inst = await db
    .select()
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.installationId, installationId),
        eq(githubInstallations.userId, userId),
      ),
    )
    .limit(1);
  if (!inst[0]) return { error: 'That installation is not connected to your account.' };

  let workflowState = 'pending';
  let workflowSha: string | null = null;
  let secretState = 'pending';
  let apiKeyId: string | null = null;
  let defaultBranch: string | null = null;
  let repoId: number | null = null;
  let lastError: string | null = null;

  try {
    const octokit = await getInstallationOctokit(installationId);

    const repoInfo = await octokit.rest.repos.get({ owner, repo });
    defaultBranch = repoInfo.data.default_branch;
    repoId = repoInfo.data.id;

    const wf = await ensureWorkflow(octokit, owner, repo, defaultBranch, { overwrite });
    workflowState = wf.state;
    workflowSha = wf.sha;

    // Reuse the existing per-repo key if one is already set; otherwise mint one and
    // inject it. The raw token goes straight to GitHub (sealed box) and is never
    // returned, logged, or cached — only its SHA-256 hash persists (issueKey).
    const existing = await db
      .select({ secretState: repoSetups.secretState, apiKeyId: repoSetups.apiKeyId })
      .from(repoSetups)
      .where(and(eq(repoSetups.userId, userId), eq(repoSetups.repoFullName, repoFullName)))
      .limit(1);

    if (existing[0]?.secretState === 'set' && existing[0]?.apiKeyId) {
      secretState = 'set';
      apiKeyId = existing[0].apiKeyId;
    } else {
      const issued = await issueKey(userId, `repo:${repoFullName}`);
      await setRepoSecret(octokit, owner, repo, SECRET_NAME, issued.token);
      secretState = 'set';
      apiKeyId = issued.id;
    }
  } catch (err) {
    if (workflowState === 'pending') workflowState = 'error';
    if (secretState !== 'set') secretState = 'error';
    lastError = err instanceof Error ? err.message : 'Setup failed.';
  }

  const now = new Date();
  await db
    .insert(repoSetups)
    .values({
      userId,
      installationId,
      repoFullName,
      repoId,
      defaultBranch,
      workflowState,
      workflowSha,
      secretState,
      apiKeyId,
      gateProvider: DEFAULT_GATE_PROVIDER,
      lastError,
    })
    .onConflictDoUpdate({
      target: [repoSetups.userId, repoSetups.repoFullName],
      set: {
        installationId,
        repoId,
        defaultBranch,
        workflowState,
        workflowSha,
        secretState,
        apiKeyId,
        lastError,
        updatedAt: now,
      },
    });

  revalidatePath('/dashboard');

  if (lastError) return { error: lastError, workflowState, secretState };
  return { ok: true, workflowState, secretState };
}

// Rotates the per-repo PREFLIGHT_API_KEY: mints a new key, overwrites the repo
// secret with it, then revokes the old one. Order matters — the repo always holds a
// VALID token (old until the new secret lands, new after), so a failure mid-rotation
// never leaves the customer's CI authenticating with a revoked key.
export async function rotateRepoKeyAction(formData: FormData): Promise<ConfigureResult> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'Not signed in.' };
  const userId = session.user.id;

  if (!isGithubAppConfigured()) return { error: 'Automated setup is not enabled yet.' };

  const subscription = await getSubscriptionState(userId);
  if (!subscription.active) {
    return { error: 'An active subscription is required to rotate a repository key.' };
  }

  const repoFullName = String(formData.get('repoFullName') ?? '').trim();
  if (!repoFullName.includes('/')) return { error: 'Invalid repository.' };
  const [owner, repo] = repoFullName.split('/');

  // Rotation only applies to a repo whose secret is already set; otherwise there's
  // nothing to rotate (run Configure first).
  const [setup] = await db
    .select()
    .from(repoSetups)
    .where(and(eq(repoSetups.userId, userId), eq(repoSetups.repoFullName, repoFullName)))
    .limit(1);
  if (!setup) return { error: 'That repository is not connected to your account.' };
  if (setup.secretState !== 'set') {
    return { error: 'Configure the repository before rotating its key.' };
  }

  // The installation must still be one this user owns.
  const inst = await db
    .select()
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.installationId, setup.installationId),
        eq(githubInstallations.userId, userId),
      ),
    )
    .limit(1);
  if (!inst[0]) return { error: 'That installation is not connected to your account.' };

  const oldApiKeyId = setup.apiKeyId;
  try {
    const octokit = await getInstallationOctokit(setup.installationId);
    const issued = await issueKey(userId, `repo:${repoFullName}`);
    // New secret goes live in the repo first; only then is the old key revoked.
    await setRepoSecret(octokit, owner, repo, SECRET_NAME, issued.token);
    await db
      .update(repoSetups)
      .set({ apiKeyId: issued.id, secretState: 'set', lastError: null, updatedAt: new Date() })
      .where(and(eq(repoSetups.userId, userId), eq(repoSetups.repoFullName, repoFullName)));
    if (oldApiKeyId) await revokeKey(userId, oldApiKeyId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Key rotation failed.';
    return { error: message };
  }

  revalidatePath('/dashboard');
  return { ok: true, secretState: 'set' };
}

// Manual attestation that the customer required the check on their deploy gate.
// Phase 1 has no provider token to verify for real (see lib/gates/vercel.ts).
export async function attestGateAction(formData: FormData): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };
  const repoFullName = String(formData.get('repoFullName') ?? '').trim();
  if (!repoFullName) return { ok: false };
  await db
    .update(repoSetups)
    .set({ gateState: 'required', gateLastCheckedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(repoSetups.userId, session.user.id), eq(repoSetups.repoFullName, repoFullName)));
  revalidatePath('/dashboard');
  return { ok: true };
}

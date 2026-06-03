import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { githubInstallations, repoSetups } from '@/db/schema';
import { getGateProvider } from '@/lib/gates';
import { getVercelConnectionMeta } from '@/lib/gates/vercel-connection';
import { getInstallationOctokit, isGithubAppConfigured } from './app';

// Server-only loader for the dashboard Connect section. Shapes DB rows + (best
// effort) the GitHub-accessible repo list into serializable view models. The view
// types are imported by the client island with `import type` only, so this file's
// server imports (octokit, db) never reach the client bundle.

export interface ConnectInstallation {
  installationId: number;
  accountLogin: string;
  accountType: string;
  suspended: boolean;
}

export interface ConnectRepo {
  installationId: number;
  fullName: string;
  repoId: number;
  defaultBranch: string;
  private: boolean;
}

export interface RepoSetupRow {
  repoFullName: string;
  installationId: number;
  workflowState: string;
  secretState: string;
  gateState: string;
  gateProvider: string;
  defaultBranch: string | null;
  lastError: string | null;
  updatedAt: string; // ISO — Date isn't a stable client prop
}

export interface ConnectState {
  configured: boolean;
  installations: ConnectInstallation[];
  repos: ConnectRepo[];
  setups: RepoSetupRow[];
}

export async function loadConnectState(userId: string): Promise<ConnectState> {
  const configured = isGithubAppConfigured();

  // Fail soft if these tables don't exist yet (migration 0002 not applied) or the
  // DB hiccups — degrade to an empty Connect section instead of 500ing /dashboard.
  let installRows: (typeof githubInstallations.$inferSelect)[] = [];
  let setupRows: (typeof repoSetups.$inferSelect)[] = [];
  try {
    [installRows, setupRows] = await Promise.all([
      db.select().from(githubInstallations).where(eq(githubInstallations.userId, userId)),
      db.select().from(repoSetups).where(eq(repoSetups.userId, userId)),
    ]);
  } catch {
    return { configured, installations: [], repos: [], setups: [] };
  }

  const installations: ConnectInstallation[] = installRows.map((r) => ({
    installationId: r.installationId,
    accountLogin: r.accountLogin,
    accountType: r.accountType,
    suspended: r.suspendedAt !== null,
  }));

  const setups: RepoSetupRow[] = setupRows.map((r) => ({
    repoFullName: r.repoFullName,
    installationId: r.installationId,
    workflowState: r.workflowState,
    secretState: r.secretState,
    gateState: r.gateState,
    gateProvider: r.gateProvider,
    defaultBranch: r.defaultBranch,
    lastError: r.lastError,
    updatedAt: r.updatedAt.toISOString(),
  }));

  // Best-effort: re-verify gates against the provider when the user has a connection.
  // Mutates `setups` in place to reflect any state that was just confirmed.
  await reverifyGates(userId, setupRows, setups);

  // Accessible repos require GitHub API calls — fail soft so a misconfigured App
  // or GitHub outage degrades to "no repos listed" instead of a 500.
  const repos: ConnectRepo[] = [];
  if (configured) {
    for (const inst of installations) {
      if (inst.suspended) continue;
      try {
        const octokit = await getInstallationOctokit(inst.installationId);
        const res = await octokit.rest.apps.listReposAccessibleToInstallation({ per_page: 100 });
        for (const repo of res.data.repositories) {
          repos.push({
            installationId: inst.installationId,
            fullName: repo.full_name,
            repoId: repo.id,
            defaultBranch: repo.default_branch ?? 'main',
            private: repo.private,
          });
        }
      } catch {
        // Show the installation without its repos rather than failing the page.
      }
    }
  }

  return { configured, installations, repos, setups };
}

// How long a gate's verification is trusted before we re-check on load.
const GATE_RECHECK_MS = 5 * 60 * 1000;

// Re-verify deploy gates on dashboard load, but only when the user actually has a
// provider connection — so the common (unconnected) case adds a single cheap lookup
// and no network calls. Verification is non-downgrading: it only ever *upgrades* a
// gate to 'required' on positive confirmation, and always bumps gateLastCheckedAt to
// throttle. It never clobbers a manual attestation or writes a transient error onto
// gateState. Every step is best-effort; failures leave the rendered state as-is.
async function reverifyGates(
  userId: string,
  rows: (typeof repoSetups.$inferSelect)[],
  view: RepoSetupRow[],
): Promise<void> {
  // Today only the Vercel adapter has a stored connection; gate the whole pass on it
  // so users without one pay nothing beyond this lookup. Workstream B generalizes this
  // to "any provider connection exists".
  const meta = await getVercelConnectionMeta(userId);
  if (!meta) return;

  const now = Date.now();
  const due = rows.filter((r) => {
    if (r.gateProvider !== 'vercel') return false; // no connection for other providers yet
    if (r.gateState === 'required') return false; // already satisfied; can't detect removal
    const last = r.gateLastCheckedAt ? r.gateLastCheckedAt.getTime() : 0;
    return now - last >= GATE_RECHECK_MS;
  });
  if (due.length === 0) return;

  await Promise.allSettled(
    due.map(async (r) => {
      const state = await getGateProvider(r.gateProvider).verifyRequired({
        repoFullName: r.repoFullName,
        defaultBranch: r.defaultBranch ?? undefined,
        userId,
      });
      const checkedAt = new Date();
      const confirmed = state === 'required';
      await db
        .update(repoSetups)
        .set(
          confirmed
            ? { gateState: 'required', gateLastCheckedAt: checkedAt, updatedAt: checkedAt }
            : { gateLastCheckedAt: checkedAt },
        )
        .where(and(eq(repoSetups.userId, userId), eq(repoSetups.repoFullName, r.repoFullName)));
      if (confirmed) {
        const v = view.find((s) => s.repoFullName === r.repoFullName);
        if (v) v.gateState = 'required';
      }
    }),
  );
}

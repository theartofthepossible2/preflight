import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { githubInstallations, repoSetups } from '@/db/schema';
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

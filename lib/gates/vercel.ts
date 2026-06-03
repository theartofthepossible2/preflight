import { CHECK_NAME } from '@/lib/github/workflow-template';
import type { DeployGateProvider } from './types';
import { resolveVercelConnection } from './vercel-connection';
import { verifyProjectGate } from './vercel-client';

export const vercelGate: DeployGateProvider = {
  id: 'vercel',
  label: 'Vercel',
  checkName: CHECK_NAME,
  mechanism: 'deployment-dispatch',
  instructions() {
    return [
      { text: 'Open your project in Vercel → Settings → Deployment Checks.' },
      {
        text: `Click "Add Checks" and select the "${CHECK_NAME}" check — Vercel auto-discovers it from the workflow.`,
      },
      { text: 'Require it for Production and save.' },
    ];
  },
  settingsUrl() {
    // The backend doesn't know the user's Vercel team/project slug in Phase 1, so
    // we send them to the dashboard to pick the project. A project-specific deep
    // link becomes possible with the Phase 2 Vercel Integration.
    return 'https://vercel.com/dashboard';
  },
  async verifyRequired(ctx) {
    // Without a connected Vercel token there's nothing to check — the dashboard's
    // guided attestation governs. With one, we validate it against Vercel's API; the
    // client only ever returns 'required' on positive confirmation (none today; see
    // vercel-client.ts) or 'error' for a dead token, never a false 'missing'.
    if (!ctx.userId) return 'unverified';
    const conn = await resolveVercelConnection(ctx.userId);
    if (!conn) return 'unverified';
    return verifyProjectGate({
      token: conn.token,
      teamId: conn.teamId,
      projectId: conn.projectId,
      checkName: CHECK_NAME,
    });
  },
  async provision() {
    // Vercel's check run is auto-discovered from the workflow file we already wrote;
    // requiring it is a user toggle in Deployment Checks, with no API to call. So
    // there's nothing to provision — the dashboard's guided attestation does the rest.
    return 'unverified';
  },
  async teardown() {
    // Nothing was provisioned on Vercel's side, so there's nothing to remove. Removing
    // the workflow file (handled by repo teardown) is what actually stops the check.
  },
};

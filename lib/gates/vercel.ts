import { CHECK_NAME } from '@/lib/github/workflow-template';
import type { DeployGateProvider } from './types';

export const vercelGate: DeployGateProvider = {
  id: 'vercel',
  label: 'Vercel',
  checkName: CHECK_NAME,
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
  async verifyRequired() {
    // No Vercel token in Phase 1 — we cannot confirm the toggle programmatically.
    // The dashboard surfaces this as a guided step the user attests to.
    return 'unverified';
  },
};

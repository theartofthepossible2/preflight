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

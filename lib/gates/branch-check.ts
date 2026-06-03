import { CHECK_NAME } from '@/lib/github/workflow-template';
import type { DeployGateProvider, GateContext } from './types';

// Shared adapter for providers gated through GitHub branch protection rather than a
// native deployment check. Netlify and Cloudflare Pages both deploy on push to a
// production branch and have no Vercel-style dispatch+status integration, so the gate
// is: run the workflow on PRs/pushes, post the `preflight` check, and require it on the
// production branch via GitHub branch protection — the provider then only deploys
// merged, passing code.
//
// Reading branch protection back needs the App's "Administration: read" permission,
// which it doesn't request today, so Phase 1 uses guided manual attestation (same
// conservative stance as Vercel). The verifyRequired body is where a real
// branch-protection read would slot in once that permission exists.

export function createBranchCheckGate(opts: {
  id: string;
  label: string;
  // Subject for where production deploys originate, e.g. 'Netlify production deploys'.
  deployNoun: string;
}): DeployGateProvider {
  return {
    id: opts.id,
    label: opts.label,
    checkName: CHECK_NAME,
    mechanism: 'branch-check',
    instructions(ctx: GateContext) {
      const branch = ctx.defaultBranch || 'your production branch';
      return [
        { text: 'Open your repository on GitHub → Settings → Branches.' },
        { text: `Add or edit a branch protection rule for \`${branch}\`.` },
        {
          text: `Enable "Require status checks to pass before merging" and select the "${CHECK_NAME}" check.`,
        },
        {
          text: `Save. ${opts.deployNoun} build from \`${branch}\`, so protecting it holds the deploy until the check passes.`,
        },
      ];
    },
    settingsUrl(ctx: GateContext) {
      return `https://github.com/${ctx.repoFullName}/settings/branches`;
    },
    async verifyRequired() {
      return 'unverified';
    },
    async provision() {
      // The check is posted by the workflow we already wrote; requiring it is a user
      // action in GitHub branch protection, with nothing to provision server-side.
      return 'unverified';
    },
    async teardown() {
      // Nothing was provisioned on the provider side; removing the workflow file
      // (repo teardown) is what stops the check.
    },
  };
}

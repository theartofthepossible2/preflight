// Single source of truth for the Preflight GitHub Actions workflow customers run.
// This exact YAML is shown on the marketing install page and the dashboard, AND
// written verbatim by the automated setup flow (lib/github/contents.ts). Keeping
// one copy is how the `theartofthepossible2/preflight/action@v1` contract stays
// from silently drifting across those three surfaces.

import { CHECK_NAME } from './check-name';

// Path the workflow is committed to in the customer's repo.
export const WORKFLOW_PATH = '.github/workflows/preflight.yml';

// The repo secret the workflow reads — also the name the automated setup writes.
export const SECRET_NAME = 'PREFLIGHT_API_KEY';

// Published action ref the workflow pins to.
export const ACTION_REF = 'theartofthepossible2/preflight/action@v1';

// The GitHub check the action posts; this is the check customers require in Vercel's
// Deployment Checks settings. The canonical constant now lives in ./check-name so the
// v0.4 backend poster (lib/github/checks.ts) can share it without importing this
// Action-only template; re-exported here so existing importers (lib/gates/*) keep
// resolving `CHECK_NAME` from this module.
export { CHECK_NAME };

// Canonical file contents (with trailing newline — what gets written to the repo).
// For on-page display, render `WORKFLOW_YAML.trimEnd()` to avoid a trailing blank line.
// Naming notes:
//  - The top-level `name:` is the customer-facing workflow label.
//  - The status step's `name:` is set to CHECK_NAME so Vercel's auto-discovered
//    check reads identically to the `preflight` check run the action posts
//    (see app/(marketing)/install/page.tsx).
//  - The job id is deliberately NOT `preflight`: GitHub auto-creates a check run
//    named after the job, and reusing `preflight` there would collide with the
//    check run the action posts via the Checks API (the one Vercel gates on).
export const WORKFLOW_YAML = `name: Preflight
on:
  repository_dispatch:
    types: [vercel.deployment.success]
jobs:
  security-gate:
    runs-on: ubuntu-latest
    permissions:
      actions: read
      contents: read
      statuses: write
      checks: write
    steps:
      - uses: vercel/repository-dispatch/actions/status@v1
        with:
          name: ${CHECK_NAME}
      - uses: actions/checkout@v4
      - uses: ${ACTION_REF}
        with:
          api-key: \${{ secrets.${SECRET_NAME} }}
          commit-sha: \${{ github.event.client_payload.git.sha }}
`;

// How a provider drives the workflow, which selects the variant written to the repo:
//  - 'deployment-dispatch' (Vercel): the provider fires a repository_dispatch on a
//    successful deploy and reads the workflow result back as a deployment check.
//  - 'branch-check' (Netlify, Cloudflare Pages): neither has Vercel's dispatch+status
//    integration, so the workflow runs on PRs and pushes to the production branch and
//    posts the `preflight` check run. The customer requires that check via GitHub
//    branch protection, so the provider only ever deploys merged, passing code.
export type GateMechanism = 'deployment-dispatch' | 'branch-check';

// Provider-appropriate workflow YAML. The 'deployment-dispatch' variant returns
// WORKFLOW_YAML verbatim (Vercel output is byte-for-byte unchanged); 'branch-check'
// gates the production branch. Still single-source: every surface derives from here.
export function workflowYaml(opts: { mechanism: GateMechanism; defaultBranch?: string }): string {
  if (opts.mechanism === 'deployment-dispatch') return WORKFLOW_YAML;
  const branch = opts.defaultBranch || 'main';
  // For pull_request runs GITHUB_SHA is the ephemeral merge commit, which branch
  // protection won't match against the PR head — so pass the PR head sha explicitly
  // and fall back to github.sha on push. (report.mjs honors commit-sha, see action.)
  return `name: Preflight
on:
  pull_request:
  push:
    branches: [${branch}]
jobs:
  security-gate:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      checks: write
    steps:
      - uses: actions/checkout@v4
      - uses: ${ACTION_REF}
        with:
          api-key: \${{ secrets.${SECRET_NAME} }}
          commit-sha: \${{ github.event.pull_request.head.sha || github.sha }}
`;
}

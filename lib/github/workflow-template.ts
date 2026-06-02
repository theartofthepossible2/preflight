// Single source of truth for the Preflight GitHub Actions workflow customers run.
// This exact YAML is shown on the marketing install page and the dashboard, AND
// written verbatim by the automated setup flow (lib/github/contents.ts). Keeping
// one copy is how the `theartofthepossible2/preflight/action@v1` contract stays
// from silently drifting across those three surfaces.

// Path the workflow is committed to in the customer's repo.
export const WORKFLOW_PATH = '.github/workflows/preflight.yml';

// The repo secret the workflow reads — also the name the automated setup writes.
export const SECRET_NAME = 'PREFLIGHT_API_KEY';

// Published action ref the workflow pins to.
export const ACTION_REF = 'theartofthepossible2/preflight/action@v1';

// The GitHub check the action posts; this is the check customers require in
// Vercel's Deployment Checks settings.
export const CHECK_NAME = 'preflight';

// Canonical file contents (with trailing newline — what gets written to the repo).
// For on-page display, render `WORKFLOW_YAML.trimEnd()` to avoid a trailing blank line.
export const WORKFLOW_YAML = `name: Preflight Security Gate
on:
  repository_dispatch:
    types: [vercel.deployment.success]
jobs:
  security-gate:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      statuses: write
      checks: write
    steps:
      - uses: vercel/repository-dispatch/actions/status@v1
        with:
          name: Preflight Security Gate
      - uses: actions/checkout@v4
      - uses: ${ACTION_REF}
        with:
          api-key: \${{ secrets.${SECRET_NAME} }}
`;

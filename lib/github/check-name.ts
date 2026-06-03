// The GitHub Check Run name Preflight posts and customers gate on — the single
// canonical string. It must read identically on every surface: the Checks-API check
// run the v0.4 backend posts (lib/github/checks.ts), the legacy Action's status step
// (lib/github/workflow-template.ts re-exports this), and Vercel's auto-discovered
// Deployment Check. Vercel keys its required check on this exact name and the name is
// not editable after discovery, so changing it silently un-gates every connected repo.
// Treat it as a wire constant.
export const CHECK_NAME = 'preflight';

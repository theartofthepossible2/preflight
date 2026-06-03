// Deploy-gate provider abstraction. Vercel is the first adapter; Netlify /
// Cloudflare Pages slot in later as new files + a registry entry, with no schema
// change (repoSetups already carries gateProvider/gateState).

export type GateState = 'unverified' | 'required' | 'missing' | 'error';

export interface GateContext {
  repoFullName: string; // 'owner/name'
  // Default branch the provider treats as "production" for the gate. Optional —
  // adapters that don't need it ignore it.
  defaultBranch?: string;
  // Owner of the setup, used to resolve a stored provider connection (token) for
  // server-side verification. Server-only — never include it in any descriptor that
  // crosses to the client.
  userId?: string;
  // Provider-side identity, populated as adapters gain real API access. Generic
  // names so one shape serves Vercel (project/team), Netlify (site) and Cloudflare
  // Pages (account/project) without a separate context type per provider.
  projectId?: string; // Vercel project id / Cloudflare Pages project name
  siteId?: string; // Netlify site id
  accountId?: string; // team / account / org id on the provider
  // Opaque reference to where the provider API token lives (an env var name or a
  // secret id) — NEVER the token itself, so GateContext stays safe to log/serialize.
  tokenRef?: string;
}

export interface GateInstruction {
  text: string;
}

export interface DeployGateProvider {
  id: string; // matches repoSetups.gateProvider, e.g. 'vercel'
  label: string; // human label, e.g. 'Vercel'
  // The check name the customer requires on the provider side.
  checkName: string;
  // Step-by-step guidance rendered in the dashboard checklist.
  instructions(ctx: GateContext): GateInstruction[];
  // Deep link to the provider settings page where the check is required.
  settingsUrl(ctx: GateContext): string;
  // Phase 1 returns 'unverified' (no provider token yet); the UI offers manual
  // attestation. A future adapter with an API token can verify for real.
  verifyRequired(ctx: GateContext): Promise<GateState>;
  // Provision any provider-side gate config (e.g. register a required check via the
  // provider API) and report the resulting state. Vercel's check is discovered from
  // the workflow and toggled by the user, so its provision is a no-op returning
  // 'unverified'; an API-backed adapter (Netlify/Cloudflare) does real work here.
  provision(ctx: GateContext): Promise<GateState>;
  // Reverse of provision — remove provider-side gate config during repo/account
  // teardown. A no-op where there's nothing to undo (e.g. Vercel).
  teardown(ctx: GateContext): Promise<void>;
}

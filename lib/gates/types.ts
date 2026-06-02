// Deploy-gate provider abstraction. Vercel is the first adapter; Netlify /
// Cloudflare Pages slot in later as new files + a registry entry, with no schema
// change (repoSetups already carries gateProvider/gateState).

export type GateState = 'unverified' | 'required' | 'missing' | 'error';

export interface GateContext {
  repoFullName: string; // 'owner/name'
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
}

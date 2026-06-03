import type { DeployGateProvider } from './types';
import { vercelGate } from './vercel';
import { netlifyGate } from './netlify';
import { cloudflareGate } from './cloudflare';

const registry: Record<string, DeployGateProvider> = {
  [vercelGate.id]: vercelGate,
  [netlifyGate.id]: netlifyGate,
  [cloudflareGate.id]: cloudflareGate,
};

export const DEFAULT_GATE_PROVIDER = vercelGate.id;

// Falls back to Vercel for unknown ids so a stale repoSetups.gateProvider never
// breaks the dashboard.
export function getGateProvider(id: string): DeployGateProvider {
  return registry[id] ?? vercelGate;
}

// Serializable {id,label} list for the client connect UI (no server-only fields, so
// the client never imports the registry). Insertion order keeps Vercel — the default
// — first.
export function listGateProviders(): { id: string; label: string }[] {
  return Object.values(registry).map((p) => ({ id: p.id, label: p.label }));
}

export type { DeployGateProvider, GateContext, GateState, GateInstruction } from './types';

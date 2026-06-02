import type { DeployGateProvider } from './types';
import { vercelGate } from './vercel';

const registry: Record<string, DeployGateProvider> = {
  [vercelGate.id]: vercelGate,
};

export const DEFAULT_GATE_PROVIDER = vercelGate.id;

// Falls back to Vercel for unknown ids so a stale repoSetups.gateProvider never
// breaks the dashboard.
export function getGateProvider(id: string): DeployGateProvider {
  return registry[id] ?? vercelGate;
}

export type { DeployGateProvider, GateContext, GateState, GateInstruction } from './types';

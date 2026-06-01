import data from './asvs-5.0.json';
import type { AsvsCategory, AsvsRequirement } from '../types';

interface AsvsData {
  version: string;
  source: string;
  note: string;
  categoryMap: Record<AsvsCategory, string[]>;
  requirements: AsvsRequirement[];
}

const asvs = data as AsvsData;

const byId = new Map<string, AsvsRequirement>(asvs.requirements.map((r) => [r.id, r]));

export function requirementsForCategory(category: AsvsCategory): AsvsRequirement[] {
  const ids = asvs.categoryMap[category] ?? [];
  return ids.map((id) => byId.get(id)).filter((r): r is AsvsRequirement => Boolean(r));
}

export function primaryRequirement(category: AsvsCategory): AsvsRequirement | undefined {
  return requirementsForCategory(category)[0];
}

export const ASVS_VERSION = asvs.version;
export const ASVS_SOURCE = asvs.source;

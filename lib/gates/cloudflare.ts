import { createBranchCheckGate } from './branch-check';

export const cloudflareGate = createBranchCheckGate({
  id: 'cloudflare',
  label: 'Cloudflare Pages',
  deployNoun: 'Cloudflare Pages production deploys',
});

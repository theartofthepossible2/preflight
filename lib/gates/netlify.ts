import { createBranchCheckGate } from './branch-check';

export const netlifyGate = createBranchCheckGate({
  id: 'netlify',
  label: 'Netlify',
  deployNoun: 'Netlify production deploys',
});

// Bundle entry for the parity test only (test/run.mjs builds this with esbuild). It
// re-exports the pure scanner plus the on-disk walker so the harness can compare a
// scan() run against the preflight.mjs CLI over the same materialized fixtures.
export { scan } from '@/lib/scanner';
export { readProjectFiles } from '@/lib/scanner/fs';

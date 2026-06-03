// Runner for the standalone scan worker (worker/index.ts). The worker uses the project's
// `@/` path alias, which plain `node` can't resolve, so we bundle the entry with esbuild
// (already present transitively — same approach as test/run.mjs) and run the output.
//
// node_modules packages stay EXTERNAL: only first-party `@/` code is bundled, and the
// output is written under node_modules/.cache so Node resolves the externals from the
// repo's node_modules at runtime. Zero new dependencies.

import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const result = await build({
  entryPoints: [join(repoRoot, 'worker', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  alias: { '@': repoRoot },
  write: false,
});

const outDir = join(repoRoot, 'node_modules', '.cache', 'preflight');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'worker.mjs');
writeFileSync(outFile, result.outputFiles[0].text);

await import(pathToFileURL(outFile).href);

import { runWorkerLoop } from '@/lib/worker';

// Standalone, long-running scan worker — the recommended primary runner (see lib/worker).
// Run it on an always-on Node host (a small VM/container), NOT a serverless function: a
// scan downloads and analyzes a whole repo and can exceed serverless time limits. It needs
// the same server-side env as the app (DATABASE_URL, GITHUB_APP_*, ANTHROPIC_API_KEY,
// STRIPE_SECRET_KEY). Start it with `npm run worker`, which bundles this entry with the
// `@/` path alias resolved.

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to run the scan worker.');
  }

  const controller = new AbortController();
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`worker: received ${signal}; finishing the current cycle, then exiting`);
    controller.abort();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  console.log('worker: started; polling the scan queue');
  await runWorkerLoop({ signal: controller.signal });
  console.log('worker: stopped');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`worker: fatal — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  },
);

import { closeDb, initDb } from '../db/index.js';
import { syncDataDir } from '../services/data-sync.js';

async function main(): Promise<void> {
  initDb();
  try {
    await syncDataDir();
    console.log('[persona-qa/dashboard-sync] sync complete');
  } finally {
    closeDb();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[persona-qa/dashboard-sync] sync failed: ${message}`);
  process.exit(1);
});

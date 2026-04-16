import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '../db/index.js';
import { syncDataDir } from '../services/data-sync.js';
import { setLastSync } from './stats.js';

export interface SyncSummary {
  success: boolean;
  timestamp: string;
  source: string;
  context_files_processed: number;
  new_runs_imported: number;
  existing_runs_updated: number;
  findings_total: number;
  new_findings: number;
  scenarios_count: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Persistence: sync_meta table stores key/value pairs as JSON
// ---------------------------------------------------------------------------

function ensureSyncMetaTable(): void {
  const db = getDb();
  db.run(sql`CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
}

function saveSyncSummary(summary: SyncSummary): void {
  const db = getDb();
  const json = JSON.stringify(summary);
  db.run(sql`INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('last_sync_summary', ${json})`);
}

function loadSyncSummary(): SyncSummary | null {
  const db = getDb();
  try {
    const rows = db
      .select({ value: sql<string>`value` })
      .from(sql`sync_meta`)
      .where(sql`key = 'last_sync_summary'`)
      .all();
    if (rows.length > 0 && rows[0]) {
      return JSON.parse(rows[0].value as string) as SyncSummary;
    }
  } catch {
    // Table might not exist yet on very first call
  }
  return null;
}

export function getLastSyncSummary(): SyncSummary | null {
  return loadSyncSummary();
}

const SyncBodySchema = z.object({
  source: z.string().optional(),
}).optional();

/** Snapshot run session_ids and their fields before sync for accurate diffing */
async function getRunsSnapshot() {
  const db = getDb();

  const runs = await db
    .select({
      id: schema.runs.id,
      session_id: schema.runs.session_id,
      findings_count: schema.runs.findings_count,
      passed: schema.runs.passed,
      failed: schema.runs.failed,
    })
    .from(schema.runs);

  const [findingsRow] = await db
    .select({ count: sql<number>`count(*)`.as('count') })
    .from(schema.findings);

  const [scenariosRow] = await db
    .select({ count: sql<number>`count(*)`.as('count') })
    .from(schema.scenarios);

  return {
    runMap: new Map(runs.map(r => [r.session_id, {
      id: r.id,
      findings_count: r.findings_count,
      passed: r.passed,
      failed: r.failed,
    }])),
    totalFindings: findingsRow?.count ?? 0,
    totalScenarios: scenariosRow?.count ?? 0,
  };
}

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  // Create sync_meta table on registration
  ensureSyncMetaTable();

  // POST /api/sync - trigger manual sync
  app.post('/api/sync', async (request, reply) => {
    const parsed = SyncBodySchema.safeParse(request.body);
    const source = parsed.success ? (parsed.data?.source ?? 'manual') : 'manual';
    const timestamp = new Date().toISOString();

    const before = await getRunsSnapshot();

    try {
      await syncDataDir();

      const after = await getRunsSnapshot();

      // Diff: new sessions that didn't exist before
      let newRuns = 0;
      let updatedRuns = 0;

      for (const [sessionId, afterRun] of after.runMap) {
        const beforeRun = before.runMap.get(sessionId);
        if (!beforeRun) {
          newRuns++;
        } else if (
          beforeRun.findings_count !== afterRun.findings_count ||
          beforeRun.passed !== afterRun.passed ||
          beforeRun.failed !== afterRun.failed
        ) {
          updatedRuns++;
        }
      }

      const contextFilesProcessed = newRuns + updatedRuns;
      const newFindings = Math.max(0, after.totalFindings - before.totalFindings);

      const summary: SyncSummary = {
        success: true,
        timestamp,
        source,
        context_files_processed: contextFilesProcessed,
        new_runs_imported: newRuns,
        existing_runs_updated: updatedRuns,
        findings_total: after.totalFindings,
        new_findings: newFindings,
        scenarios_count: after.totalScenarios,
      };

      saveSyncSummary(summary);
      setLastSync(timestamp, source);

      return reply.send(summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      const summary: SyncSummary = {
        success: false,
        timestamp,
        source,
        context_files_processed: 0,
        new_runs_imported: 0,
        existing_runs_updated: 0,
        findings_total: before.totalFindings,
        new_findings: 0,
        scenarios_count: before.totalScenarios,
        error: message,
      };

      saveSyncSummary(summary);

      return reply.status(500).send(summary);
    }
  });

  // GET /api/sync/summary - get last sync summary (survives restarts)
  app.get('/api/sync/summary', async (_request, reply) => {
    const summary = loadSyncSummary();
    if (!summary) {
      return reply.send({ message: 'Nenhum sync realizado ainda', summary: null });
    }
    return reply.send(summary);
  });
}

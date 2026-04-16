/**
 * Unit tests for /api/status, /api/suite-health, /api/stats endpoints.
 *
 * These are contract tests validating the response shape and business logic.
 * Run with: npx tsx --test src/routes/__tests__/stats.test.ts
 * Requires: npm install (for better-sqlite3 native module)
 *
 * When better-sqlite3 cannot compile (e.g. Node 25 on macOS), run in CI.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { sql } from 'drizzle-orm';
import { initDb, closeDb, getDb } from '../../db/index.js';
import { statsRoutes, setLastSync, getLastSyncInfo } from '../stats.js';

describe('/api/status', () => {
  const app = Fastify();

  before(async () => {
    process.env['DATABASE_URL'] = ':memory:';
    initDb();
    await app.register(statsRoutes);
    await app.ready();
  });

  after(async () => {
    await app.close();
    closeDb();
  });

  it('returns api: up, db: ok when healthy', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.api, 'up');
    assert.equal(body.db, 'ok');
    assert.equal(body.active_run, null);
  });

  it('returns last_sync as null initially, then updated after setLastSync', async () => {
    setLastSync('2026-04-10T12:00:00Z', 'startup');
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    const body = JSON.parse(res.body);
    assert.equal(body.last_sync, '2026-04-10T12:00:00Z');
    assert.equal(body.last_sync_source, 'startup');
  });

  it('prefers active p2 session when it is the most recent active workload', async () => {
    const db = getDb();
    db.run(sql`
      CREATE TABLE IF NOT EXISTS p2_sessions (
        session_id TEXT PRIMARY KEY,
        run_id INTEGER,
        scenario_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      )
    `);
    db.run(sql`
      INSERT INTO p2_sessions (session_id, run_id, scenario_id, status, created_at, started_at, completed_at)
      VALUES ('p2-active-1', NULL, 'first_order_multi_role', 'running', '2026-04-13T14:00:00Z', '2026-04-13T14:00:00Z', NULL)
    `);

    const res = await app.inject({ method: 'GET', url: '/api/status' });
    const body = JSON.parse(res.body);
    assert.equal(body.active_run?.source, 'p2_sessions');
    assert.equal(body.active_run?.id, 'p2-active-1');
    assert.equal(body.active_run?.status, 'running');
  });

  it('does not expose stale active p2 sessions as executing', async () => {
    const db = getDb();
    db.run(sql`DELETE FROM p2_sessions`);
    db.run(sql`
      INSERT INTO p2_sessions (session_id, run_id, scenario_id, status, created_at, started_at, completed_at)
      VALUES ('p2-stale-1', NULL, 'first_order_multi_role', 'running', '2026-04-10T10:00:00Z', '2026-04-10T10:00:00Z', NULL)
    `);

    const res = await app.inject({ method: 'GET', url: '/api/status' });
    const body = JSON.parse(res.body);
    assert.equal(body.active_run, null);
  });
});

describe('/api/suite-health', () => {
  const app = Fastify();

  before(async () => {
    closeDb();
    process.env['DATABASE_URL'] = ':memory:';
    initDb();
    await app.register(statsRoutes);
    await app.ready();
  });

  after(async () => {
    await app.close();
    closeDb();
  });

  it('returns null last_run when no runs exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/suite-health' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.last_run, null);
    assert.equal(body.is_stale, true);
    assert.equal(body.db_clean_required, false);
  });

  it('returns empty scenarios arrays', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/suite-health' });
    const body = JSON.parse(res.body);
    assert.deepEqual(body.scenarios, []);
    assert.deepEqual(body.scenarios_without_runs, []);
    assert.equal(body.passed_scenarios, 0);
    assert.equal(body.failed_scenarios, 0);
  });
});

describe('getLastSyncInfo hydration', () => {
  it('setLastSync then getLastSyncInfo returns correct values', () => {
    setLastSync('2026-01-01T00:00:00Z', 'test');
    const info = getLastSyncInfo();
    assert.equal(info.timestamp, '2026-01-01T00:00:00Z');
    assert.equal(info.source, 'test');
  });
});

describe('/api/stats', () => {
  const app = Fastify();

  before(async () => {
    closeDb();
    process.env['DATABASE_URL'] = ':memory:';
    initDb();
    const db = getDb();
    db.run(sql`
      CREATE TABLE IF NOT EXISTS p2_sessions (
        session_id TEXT PRIMARY KEY,
        run_id INTEGER,
        scenario_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      )
    `);
    db.run(sql`
      CREATE TABLE IF NOT EXISTS p2_session_findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        severity TEXT,
        title TEXT,
        description TEXT,
        evidence TEXT,
        agent_id TEXT,
        step_id TEXT,
        created_at TEXT NOT NULL
      )
    `);
    db.run(sql`
      INSERT INTO p2_sessions (session_id, run_id, scenario_id, status, created_at, started_at, completed_at)
      VALUES
      ('p2-complete', NULL, 'first_order_multi_role', 'complete', '2026-04-13T14:00:00Z', '2026-04-13T14:00:00Z', '2026-04-13T14:10:00Z'),
      ('p2-running', NULL, 'quarterly_reorder', 'running', '2026-04-13T15:00:00Z', '2026-04-13T15:00:00Z', NULL)
    `);
    db.run(sql`
      INSERT INTO p2_session_findings (session_id, severity, title, created_at)
      VALUES ('p2-complete', 'high', 'handoff incomplete', '2026-04-13T14:05:00Z')
    `);
    await app.register(statsRoutes);
    await app.ready();
  });

  after(async () => {
    await app.close();
    closeDb();
  });

  it('returns agentic aggregate stats', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.agentic.total_sessions, 2);
    assert.equal(body.agentic.complete_sessions, 1);
    assert.equal(body.agentic.running_sessions, 1);
    assert.equal(body.agentic.multi_agent_sessions, 1);
    assert.equal(body.agentic.total_findings, 1);
    assert.equal(body.agentic.last_activity_at, '2026-04-13T15:00:00Z');
    assert.deepEqual(body.agentic.contract_adherence, {
      violated: 2,
      drift: 0,
      compliant: 0,
      no_contract: 0,
      hard_violations: 2,
      drift_signals: 0,
    });
  });
});

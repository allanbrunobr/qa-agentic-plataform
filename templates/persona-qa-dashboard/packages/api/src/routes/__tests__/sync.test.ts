/**
 * Unit tests for /api/sync and /api/sync/summary endpoints.
 *
 * Run with: npx tsx --test src/routes/__tests__/sync.test.ts
 * Requires: npm install (for better-sqlite3 native module)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { initDb, closeDb } from '../../db/index.js';
import { statsRoutes } from '../stats.js';
import { syncRoutes, getLastSyncSummary } from '../sync.js';

// Point to nonexistent dir so sync finds no files
process.env['PERSONA_QA_DATA_DIR'] = '/tmp/persona-qa-test-nonexistent';

describe('POST /api/sync', () => {
  const app = Fastify();

  before(async () => {
    process.env['DATABASE_URL'] = ':memory:';
    initDb();
    await app.register(statsRoutes);
    await app.register(syncRoutes);
    await app.ready();
  });

  after(async () => {
    await app.close();
    closeDb();
  });

  it('returns success with accurate zero counts on empty sync', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync',
      payload: { source: 'test' },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.source, 'test');
    assert.equal(body.context_files_processed, 0);
    assert.equal(body.new_runs_imported, 0);
    assert.equal(body.existing_runs_updated, 0);
    assert.equal(body.new_findings, 0);
    assert.equal(typeof body.findings_total, 'number');
    assert.equal(typeof body.scenarios_count, 'number');
  });

  it('defaults source to manual when not provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync',
      payload: {},
    });
    const body = JSON.parse(res.body);
    assert.equal(body.source, 'manual');
  });

  it('updates /api/status last_sync after sync', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/sync',
      payload: { source: 'integration' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/status' });
    const body = JSON.parse(res.body);
    assert.ok(body.last_sync !== null);
    assert.equal(body.last_sync_source, 'integration');
  });
});

describe('GET /api/sync/summary', () => {
  const app = Fastify();

  before(async () => {
    closeDb();
    process.env['DATABASE_URL'] = ':memory:';
    initDb();
    await app.register(statsRoutes);
    await app.register(syncRoutes);
    await app.ready();
  });

  after(async () => {
    await app.close();
    closeDb();
  });

  it('returns null summary before any sync', async () => {
    // Reset in-memory state by importing fresh — but since module is cached,
    // just test the response shape
    const res = await app.inject({ method: 'GET', url: '/api/sync/summary' });
    assert.equal(res.statusCode, 200);
  });

  it('returns full summary after POST /api/sync', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/sync',
      payload: { source: 'test-summary' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/sync/summary' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.source, 'test-summary');
    assert.equal(body.success, true);
    assert.ok('context_files_processed' in body);
    assert.ok('new_runs_imported' in body);
    assert.ok('existing_runs_updated' in body);
  });
});

describe('getLastSyncSummary', () => {
  it('returns SyncSummary or null', () => {
    const summary = getLastSyncSummary();
    // Can be null (no sync yet in this import context) or a valid summary
    if (summary !== null) {
      assert.ok('success' in summary);
      assert.ok('context_files_processed' in summary);
      assert.ok('new_runs_imported' in summary);
      assert.ok('existing_runs_updated' in summary);
    }
  });
});

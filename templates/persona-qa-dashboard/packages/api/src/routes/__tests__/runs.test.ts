/**
 * Contract tests for the enriched /api/runs/:id payload.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { eq } from 'drizzle-orm';
import { initDb, closeDb, getDb, schema } from '../../db/index.js';
import { runsRoutes } from '../runs.js';

describe('GET /api/runs/:id', () => {
  const app = Fastify();

  before(async () => {
    process.env['DATABASE_URL'] = ':memory:';
    initDb();

    const db = getDb();
    db.insert(schema.scenarios).values({
      scenario_id: 'first_order',
      name: 'First Order',
      description: 'Customer registration and order scenario',
      step_count: 4,
      agent_count: 2,
      last_run_at: '2026-04-10T10:00:00Z',
      last_status: 'complete',
    }).run();

    db.insert(schema.runs).values({
      scenario_id: 'first_order',
      scenario_name: 'First Order',
      session_id: 'session-123',
      status: 'complete',
      started_at: '2026-04-10T10:00:00Z',
      completed_at: '2026-04-10T10:03:30Z',
      duration_ms: 210000,
      total_tests: 12,
      passed: 11,
      failed: 1,
      skipped: 0,
      findings_count: 2,
      critical_count: 1,
      high_count: 1,
      run_source: 'cli',
      artifacts: JSON.stringify({
        customer_id: 'customer-1',
        order_id: 'order-1',
        shipment_id: 'shipment-1',
      }),
      suite_type: 'single',
      clean_db_before_run: true,
      started_by: 'ci-runner',
    }).run();

    const run = db
      .select({ id: schema.runs.id })
      .from(schema.runs)
      .where(eq(schema.runs.session_id, 'session-123'))
      .get();

    assert.ok(run?.id);

    db.insert(schema.findings).values([
      {
        run_id: run.id,
        finding_id: 'F-001',
        agent: 'sales_associate',
        step: 'create customer',
        severity: 'high',
        title: 'Customer missing required field',
        expected: 'tax id filled',
        actual: 'tax id empty',
        screenshot_path: 'test-results/runs/session-123/findings/f-001.png',
        timestamp: '2026-04-10T10:01:00Z',
      },
      {
        run_id: run.id,
        finding_id: 'F-002',
        agent: 'fulfillment_agent',
        step: 'close order',
        severity: 'critical',
        title: 'Error closing order',
        expected: 'status completed',
        actual: 'status failed',
        screenshot_path: null,
        timestamp: '2026-04-10T10:02:00Z',
      },
    ]).run();

    db.insert(schema.pr_links).values({
      run_id: run.id,
      pr_number: 42,
      gate_status: 'passed',
      created_at: '2026-04-10T10:03:00Z',
    }).run();

    await app.register(runsRoutes);
    await app.ready();
  });

  after(async () => {
    await app.close();
    closeDb();
  });

  it('returns enriched run summary, evidence, findings summary, timestamps, scenario and timeline', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs/1' });
    assert.equal(res.statusCode, 200);

    const body = JSON.parse(res.body);

    assert.equal(body.id, 1);
    assert.equal(body.scenario_id, 'first_order');
    assert.equal(body.metadata.run_source, 'cli');
    assert.equal(body.metadata.suite_type, 'single');
    assert.equal(body.metadata.clean_db_before_run, true);
    assert.equal(body.metadata.started_by, 'ci-runner');

    assert.equal(body.evidence.findings_count, 2);
    assert.equal(body.evidence.screenshots_count, 1);
    assert.equal(body.evidence.artifacts_count, 3);
    assert.equal(body.evidence.context_available, true);
    assert.equal(body.evidence.has_pr_links, true);
    assert.equal(body.evidence.pr_links_count, 1);

    assert.equal(body.findings_summary.total, 2);
    assert.equal(body.findings_summary.by_severity.critical, 1);
    assert.equal(body.findings_summary.by_severity.high, 1);
    assert.deepEqual(body.findings_summary.agents, ['fulfillment_agent', 'sales_associate']);
    assert.equal(body.findings_summary.first_finding_at, '2026-04-10T10:01:00Z');
    assert.equal(body.findings_summary.last_finding_at, '2026-04-10T10:02:00Z');

    assert.equal(body.timestamps.started_at, '2026-04-10T10:00:00Z');
    assert.equal(body.timestamps.completed_at, '2026-04-10T10:03:30Z');
    assert.equal(body.timestamps.duration_ms, 210000);
    assert.equal(body.timestamps.first_finding_at, '2026-04-10T10:01:00Z');
    assert.equal(body.timestamps.last_finding_at, '2026-04-10T10:02:00Z');

    assert.deepEqual(body.scenario?.scenario_id, 'first_order');
    assert.equal(body.scenario?.step_count, 4);
    assert.equal(body.scenario?.agent_count, 2);

    assert.equal(body.findings.length, 2);
    assert.equal(body.pr_links.length, 1);
    assert.equal(body.artifacts.customer_id, 'customer-1');
    assert.equal(body.artifacts.order_id, 'order-1');

    const timelineTypes = body.timeline.map((event: { type: string }) => event.type);
    assert.ok(timelineTypes.includes('started'));
    assert.ok(timelineTypes.includes('artifact'));
    assert.ok(timelineTypes.includes('finding'));
    assert.ok(timelineTypes.includes('completed'));
    assert.ok(timelineTypes.includes('pr_link'));
  });

  it('returns 400 for invalid run id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs/not-a-number' });
    assert.equal(res.statusCode, 400);
  });
});

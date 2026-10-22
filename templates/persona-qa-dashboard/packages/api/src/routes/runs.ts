import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, lte, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '../db/index.js';
import { triggerRun } from '../services/runner.js';
import { normalizeScenarioId } from '../services/data-sync.js';

const TriggerRunBody = z.object({
  scenario_id: z.string().optional(),
});

// Check if a column exists in the runs table (cached after first check)
let _hasRunSource: boolean | null = null;
function hasRunSourceColumn(): boolean {
  if (_hasRunSource !== null) return _hasRunSource;
  try {
    const db = getDb();
    const cols = db.all(sql`PRAGMA table_info(runs)`) as Array<{ name: string }>;
    _hasRunSource = cols.some(c => c.name === 'run_source');
  } catch {
    _hasRunSource = false;
  }
  return _hasRunSource;
}

function buildRunFilters(query: Record<string, string | undefined>) {
  const conditions = [];
  if (query.scenario) conditions.push(eq(schema.runs.scenario_id, query.scenario));
  if (query.status && ['pending', 'running', 'complete', 'failed'].includes(query.status)) {
    conditions.push(
      eq(schema.runs.status, query.status as 'pending' | 'running' | 'complete' | 'failed')
    );
  }
  if (query.source && hasRunSourceColumn()) {
    conditions.push(sql`run_source = ${query.source}`);
  }
  if (query.from) conditions.push(gte(schema.runs.started_at, query.from));
  if (query.to) conditions.push(lte(schema.runs.started_at, query.to));
  if (query.has_findings === 'true') conditions.push(gt(schema.runs.findings_count, 0));
  return conditions;
}

// Get distinct source values from DB (empty array if column doesn't exist)
function getDistinctSources(): string[] {
  if (!hasRunSourceColumn()) return [];
  try {
    const db = getDb();
    const rows = db.all(sql`SELECT DISTINCT run_source FROM runs WHERE run_source IS NOT NULL ORDER BY run_source`) as Array<{ run_source: string }>;
    return rows.map(r => r.run_source);
  } catch {
    return [];
  }
}

function parseArtifacts(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function countArtifacts(artifacts: Record<string, unknown> | null): number {
  return artifacts ? Object.keys(artifacts).length : 0;
}

function buildFindingsSummary(findings: Array<{ severity: string; timestamp: string; agent: string }>) {
  const bySeverity = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] ?? 0) + 1;
    return acc;
  }, {});

  return {
    total: findings.length,
    by_severity: {
      critical: bySeverity.critical ?? 0,
      high: bySeverity.high ?? 0,
      medium: bySeverity.medium ?? 0,
      low: bySeverity.low ?? 0,
      info: bySeverity.info ?? 0,
    },
    agents: Array.from(new Set(findings.map(finding => finding.agent))).sort(),
    first_finding_at: findings[0]?.timestamp ?? null,
    last_finding_at: findings.length > 0 ? findings[findings.length - 1]?.timestamp ?? null : null,
  };
}

function buildTimeline(params: {
  startedAt: string;
  completedAt: string | null;
  status: string;
  artifacts: Record<string, unknown> | null;
  findings: Array<{
    finding_id: string;
    agent: string;
    step: string;
    severity: string;
    title: string;
    timestamp: string;
  }>;
  prLinks: Array<{
    pr_number: number;
    gate_status: string;
    created_at: string;
  }>;
}) {
  const events = [
    {
      type: 'started' as const,
      timestamp: params.startedAt,
      label: 'Run started',
    },
    ...(params.artifacts
      ? [{
          type: 'artifact' as const,
          timestamp: params.startedAt,
          label: 'Artifacts recorded',
          details: {
            artifact_count: countArtifacts(params.artifacts),
            artifact_keys: Object.keys(params.artifacts),
          },
        }]
      : []),
    ...params.findings.map(finding => ({
      type: 'finding' as const,
      timestamp: finding.timestamp,
      label: finding.title,
      details: {
        finding_id: finding.finding_id,
        agent: finding.agent,
        step: finding.step,
        severity: finding.severity,
      },
    })),
    ...(params.completedAt
      ? [{
          type: 'completed' as const,
          timestamp: params.completedAt,
          label: params.status === 'complete' ? 'Run completed' : 'Run failed',
          details: {
            status: params.status,
          },
        }]
      : []),
    ...params.prLinks.map(prLink => ({
      type: 'pr_link' as const,
      timestamp: prLink.created_at,
      label: `PR #${prLink.pr_number}`,
      details: {
        gate_status: prLink.gate_status,
      },
    })),
  ];

  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export async function runsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/runs - list all runs ordered by started_at desc, limit 50
  // Supports filter query params: scenario, status, source, from, to, has_findings
  app.get('/api/runs', async (request, reply) => {
    const db = getDb();
    const query = request.query as Record<string, string | undefined>;
    const conditions = buildRunFilters(query);

    const rows = await db
      .select()
      .from(schema.runs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.runs.started_at))
      .limit(50);

    // Enrich with evidence counts
    const enriched = rows.map((run) => {
      // Count screenshots from findings for this run
      const screenshotRows = db
        .select({ screenshot_path: schema.findings.screenshot_path })
        .from(schema.findings)
        .where(eq(schema.findings.run_id, run.id))
        .all();
      const screenshotsCount = screenshotRows.filter((r) => r.screenshot_path).length;

      // Count artifacts
      let artifactsCount = 0;
      if (run.artifacts) {
        try {
          const parsed = JSON.parse(run.artifacts as string);
          artifactsCount = Object.keys(parsed).length;
        } catch { /* ignore */ }
      }

      return {
        ...run,
        screenshots_count: screenshotsCount,
        artifacts_count: artifactsCount,
        context_available: run.artifacts !== null || run.findings_count > 0,
      };
    });

    return reply.send(enriched);
  });

  // GET /api/runs/sources - list distinct run_source values (empty if column not yet added by wt2)
  app.get('/api/runs/sources', async (_request, reply) => {
    return reply.send({ sources: getDistinctSources(), available: hasRunSourceColumn() });
  });

  // GET /api/runs/active - get currently running run (if any)
  app.get('/api/runs/active', async (_request, reply) => {
    const db = getDb();
    const [active] = await db
      .select()
      .from(schema.runs)
      .where(sql`${schema.runs.status} IN ('running', 'pending')`)
      .orderBy(desc(schema.runs.started_at))
      .limit(1);

    if (!active) {
      return reply.send({ active: null });
    }
    return reply.send({ active });
  });

  // GET /api/runs/:id - get single run with findings
  app.get<{ Params: { id: string } }>('/api/runs/:id', async (request, reply) => {
    const runId = parseInt(request.params.id, 10);
    if (isNaN(runId)) {
      return reply.status(400).send({ error: 'Invalid run ID' });
    }

    const db = getDb();
    const [run] = await db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.id, runId));

    if (!run) {
      return reply.status(404).send({ error: 'Run not found' });
    }

    const runFindings = await db
      .select()
      .from(schema.findings)
      .where(eq(schema.findings.run_id, runId))
      .orderBy(schema.findings.timestamp);

    const prLinks = await db
      .select()
      .from(schema.pr_links)
      .where(eq(schema.pr_links.run_id, runId))
      .orderBy(schema.pr_links.created_at);

    const [scenario] = await db
      .select()
      .from(schema.scenarios)
      .where(eq(schema.scenarios.scenario_id, run.scenario_id));

    // Parse artifacts JSON string into object for API consumers
    const artifacts = parseArtifacts(run.artifacts);
    if (run.artifacts && !artifacts) {
      console.warn(`[runs] Corrupted artifacts JSON for run ${runId}, returning null`);
    }

    const findingsSummary = buildFindingsSummary(runFindings);
    const artifactsCount = countArtifacts(artifacts);
    const screenshotsCount = runFindings.filter(finding => finding.screenshot_path).length;
    const evidence = {
      findings_count: run.findings_count,
      screenshots_count: screenshotsCount,
      artifacts_count: artifactsCount,
      context_available: artifacts !== null || run.findings_count > 0,
      has_pr_links: prLinks.length > 0,
      pr_links_count: prLinks.length,
    };
    const metadata = {
      scenario_id: run.scenario_id,
      scenario_name: run.scenario_name,
      session_id: run.session_id,
      run_source: run.run_source ?? 'unknown',
      suite_type: run.suite_type ?? null,
      clean_db_before_run: run.clean_db_before_run ?? null,
      started_by: run.started_by ?? null,
    };
    const timestamps = {
      started_at: run.started_at,
      completed_at: run.completed_at,
      duration_ms: run.duration_ms,
      first_finding_at: findingsSummary.first_finding_at,
      last_finding_at: findingsSummary.last_finding_at,
    };

    return reply.send({
      ...run,
      artifacts,
      findings: runFindings,
      pr_links: prLinks,
      scenario: scenario ?? null,
      metadata,
      evidence,
      findings_summary: findingsSummary,
      timestamps,
      timeline: buildTimeline({
        startedAt: run.started_at,
        completedAt: run.completed_at,
        status: run.status,
        artifacts,
        findings: runFindings,
        prLinks,
      }),
    });
  });

  // POST /api/runs - trigger new test execution
  app.post('/api/runs', async (request, reply) => {
    const parseResult = TriggerRunBody.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid request body',
        details: parseResult.error.issues,
      });
    }

    const scenario_id = parseResult.data.scenario_id
      ? normalizeScenarioId(parseResult.data.scenario_id)
      : undefined;

    try {
      const runId = await triggerRun(scenario_id);
      return reply.status(202).send({ run_id: runId, status: 'pending' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(500).send({ error: 'Failed to trigger run', details: message });
    }
  });

  // DELETE /api/runs/:id - delete a run
  app.delete<{ Params: { id: string } }>('/api/runs/:id', async (request, reply) => {
    const runId = parseInt(request.params.id, 10);
    if (isNaN(runId)) {
      return reply.status(400).send({ error: 'Invalid run ID' });
    }

    const db = getDb();
    const [existing] = await db
      .select({ id: schema.runs.id })
      .from(schema.runs)
      .where(eq(schema.runs.id, runId));

    if (!existing) {
      return reply.status(404).send({ error: 'Run not found' });
    }

    // Delete dependent records first (foreign key constraints)
    await db.delete(schema.findings).where(eq(schema.findings.run_id, runId));
    await db.delete(schema.pr_links).where(eq(schema.pr_links.run_id, runId));
    await db.delete(schema.runs).where(eq(schema.runs.id, runId));

    return reply.status(204).send();
  });

  // GET /api/runs/export - export runs as JSON or CSV
  app.get('/api/runs/export', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const format = query.format ?? 'json';
    const db = getDb();
    const conditions = buildRunFilters(query);

    const rows = await db
      .select()
      .from(schema.runs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.runs.started_at));

    if (format === 'csv') {
      const headers = [
        'id', 'scenario_id', 'scenario_name', 'status', 'started_at',
        'completed_at', 'duration_ms', 'total_tests', 'passed', 'failed',
        'skipped', 'findings_count', 'critical_count', 'high_count',
      ];
      const csvRows = [headers.join(',')];
      for (const row of rows) {
        const values = headers.map(h => {
          const val = (row as Record<string, unknown>)[h];
          if (val === null || val === undefined) return '';
          const str = String(val);
          return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
        });
        csvRows.push(values.join(','));
      }
      return reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', 'attachment; filename="runs-export.csv"')
        .send(csvRows.join('\n'));
    }

    // Default: JSON
    return reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', 'attachment; filename="runs-export.json"')
      .send(rows);
  });

  // GET /api/runs/export-summary - export operational summary as markdown
  // Accepts same filter query params as /api/runs
  app.get('/api/runs/export-summary', async (request, reply) => {
    const db = getDb();
    const query = request.query as Record<string, string | undefined>;
    const conditions = buildRunFilters(query);

    const allRuns = await db
      .select()
      .from(schema.runs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.runs.started_at));

    const total = allRuns.length;
    const complete = allRuns.filter(r => r.status === 'complete').length;
    const failed = allRuns.filter(r => r.status === 'failed').length;
    const passRate = total > 0 ? Math.round((complete / total) * 100) : 0;

    // Scenarios summary
    const scenarioMap = new Map<string, { name: string; count: number; passed: number }>();
    for (const run of allRuns) {
      const entry = scenarioMap.get(run.scenario_id) ?? { name: run.scenario_name, count: 0, passed: 0 };
      entry.count++;
      if (run.status === 'complete') entry.passed++;
      scenarioMap.set(run.scenario_id, entry);
    }

    // Recent findings (last 5 runs)
    const recentRunIds = allRuns.slice(0, 5).map(r => r.id);
    let recentFindings: Array<{ severity: string; title: string; agent: string }> = [];
    if (recentRunIds.length > 0) {
      recentFindings = await db
        .select({ severity: schema.findings.severity, title: schema.findings.title, agent: schema.findings.agent })
        .from(schema.findings)
        .where(sql`${schema.findings.run_id} IN (${sql.join(recentRunIds.map(id => sql`${id}`), sql`, `)})`)
        .limit(20);
    }

    const now = new Date().toISOString().split('T')[0];
    let md = `# Operational report — Agentic QA\n\n`;
    md += `**Generated on:** ${now}\n\n`;
    md += `## Overview\n\n`;
    md += `| Metric | Value |\n|---|---|\n`;
    md += `| Total runs | ${total} |\n`;
    md += `| Completed | ${complete} |\n`;
    md += `| Failed | ${failed} |\n`;
    md += `| Pass rate | ${passRate}% |\n\n`;

    md += `## Scenarios\n\n`;
    md += `| Scenario | Runs | Pass rate |\n|---|---|---|\n`;
    for (const [, entry] of scenarioMap) {
      const rate = entry.count > 0 ? Math.round((entry.passed / entry.count) * 100) : 0;
      md += `| ${entry.name} | ${entry.count} | ${rate}% |\n`;
    }

    if (recentFindings.length > 0) {
      md += `\n## Recent findings\n\n`;
      md += `| Severity | Title | Agent |\n|---|---|---|\n`;
      for (const f of recentFindings) {
        md += `| ${f.severity} | ${f.title} | ${f.agent} |\n`;
      }
    }

    return reply
      .header('Content-Type', 'text/markdown')
      .header('Content-Disposition', 'attachment; filename="summary-report.md"')
      .send(md);
  });

  // GET /api/runs/staleness - check data freshness for stale-data banner
  app.get('/api/runs/staleness', async (_request, reply) => {
    const db = getDb();

    // Find the most recent legacy run activity.
    const [latestRun] = await db
      .select({
        completed_at: schema.runs.completed_at,
        started_at: schema.runs.started_at,
      })
      .from(schema.runs)
      .orderBy(desc(schema.runs.started_at))
      .limit(1);

    const p2SessionsTableExists = (() => {
      try {
        const rows = db.all(
          sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'p2_sessions'`
        ) as Array<{ name: string }>;
        return rows.length > 0;
      } catch {
        return false;
      }
    })();

    const latestP2Session = p2SessionsTableExists
      ? ((db.all(sql`
          SELECT completed_at, started_at, created_at
          FROM p2_sessions
          ORDER BY COALESCE(completed_at, started_at, created_at) DESC
          LIMIT 1
        `) as Array<{
          completed_at: string | null;
          started_at: string | null;
          created_at: string | null;
        }>)[0] ?? null)
      : null;

    const latestRunActivity = latestRun
      ? latestRun.completed_at ?? latestRun.started_at
      : null;

    const latestP2Activity = latestP2Session
      ? latestP2Session.completed_at ?? latestP2Session.started_at ?? latestP2Session.created_at
      : null;

    const latestCandidates = [
      latestRunActivity
        ? {
            source: 'runs' as const,
            timestamp: latestRunActivity,
          }
        : null,
      latestP2Activity
        ? {
            source: 'p2_sessions' as const,
            timestamp: latestP2Activity,
          }
        : null,
    ].filter((candidate): candidate is { source: 'runs' | 'p2_sessions'; timestamp: string } => Boolean(candidate));

    if (latestCandidates.length === 0) {
      return reply.send({
        has_data: false,
        is_stale: false,
        last_activity_at: null,
        age_ms: null,
        new_data_available: false,
        last_activity_source: null,
      });
    }

    const freshestActivity = latestCandidates.reduce((latest, current) => {
      return new Date(current.timestamp).getTime() > new Date(latest.timestamp).getTime()
        ? current
        : latest;
    });

    const lastActivity = freshestActivity.timestamp;
    const lastActivityDate = new Date(lastActivity);
    const ageMs = Date.now() - lastActivityDate.getTime();
    const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

    // Check if data files on disk are newer than last DB activity
    // Scans both legacy context/ dir and new runs/<timestamp>/context/ dirs
    let newDataAvailable = false;
    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const projectDir = process.env['PERSONA_QA_PROJECT_DIR'] ?? path.default.resolve(process.cwd(), '../../..');
      const dataDir = process.env['PERSONA_QA_DATA_DIR']
        ?? path.default.join(projectDir, 'integration-test', 'persona-tests');

      // Helper: check if any .json file in a directory is newer than the cutoff
      const hasNewerJson = async (dir: string, cutoff: number): Promise<boolean> => {
        const entries = await fs.default.readdir(dir).catch(() => [] as string[]);
        for (const f of entries.filter(e => e.endsWith('.json'))) {
          const stat = await fs.default.stat(path.default.join(dir, f));
          if (stat.mtimeMs > cutoff) return true;
        }
        return false;
      };

      const cutoff = lastActivityDate.getTime();

      // 1. Legacy flat context directory
      if (await hasNewerJson(path.default.join(dataDir, 'context'), cutoff)) {
        newDataAvailable = true;
      }

      // 2. New timestamped runs/<timestamp>/context/ directories
      if (!newDataAvailable) {
        const runsDir = path.default.join(dataDir, 'runs');
        const runEntries = await fs.default.readdir(runsDir).catch(() => [] as string[]);
        for (const runDir of runEntries) {
          const runContextDir = path.default.join(runsDir, runDir, 'context');
          if (await hasNewerJson(runContextDir, cutoff)) {
            newDataAvailable = true;
            break;
          }
          // Also check results.json at run level
          const resultsPath = path.default.join(runsDir, runDir, 'results.json');
          try {
            const stat = await fs.default.stat(resultsPath);
            if (stat.mtimeMs > cutoff) {
              newDataAvailable = true;
              break;
            }
          } catch {
            // results.json doesn't exist in this run dir
          }
        }
      }

      // 3. Sessions directory (conversation logs)
      if (!newDataAvailable) {
        const sessionsDir = path.default.join(dataDir, 'sessions');
        const sessionEntries = await fs.default.readdir(sessionsDir).catch(() => [] as string[]);
        for (const sessionDir of sessionEntries) {
          const convPath = path.default.join(sessionsDir, sessionDir, 'conversation.jsonl');
          try {
            const stat = await fs.default.stat(convPath);
            if (stat.mtimeMs > cutoff) {
              newDataAvailable = true;
              break;
            }
          } catch {
            // no conversation.jsonl
          }
        }
      }
    } catch {
      // Data dir doesn't exist or is inaccessible — no new data detection
    }

    return reply.send({
      has_data: true,
      is_stale: ageMs > STALE_THRESHOLD_MS,
      last_activity_at: lastActivity,
      age_ms: ageMs,
      new_data_available: newDataAvailable,
      last_activity_source: freshestActivity.source,
    });
  });
}

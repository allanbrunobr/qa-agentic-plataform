import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const runs = sqliteTable('runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scenario_id: text('scenario_id').notNull(),
  scenario_name: text('scenario_name').notNull(),
  session_id: text('session_id').notNull(),
  status: text('status', { enum: ['pending', 'running', 'complete', 'failed'] })
    .notNull()
    .default('pending'),
  started_at: text('started_at').notNull(),
  completed_at: text('completed_at'),
  duration_ms: integer('duration_ms'),
  total_tests: integer('total_tests').notNull().default(0),
  passed: integer('passed').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  findings_count: integer('findings_count').notNull().default(0),
  critical_count: integer('critical_count').notNull().default(0),
  high_count: integer('high_count').notNull().default(0),
  error_message: text('error_message'),
  run_source: text('run_source', { enum: ['dashboard', 'cli', 'clean-run', 'unknown'] }).default('unknown'),
  artifacts: text('artifacts'), // JSON string of domain artifacts
  suite_type: text('suite_type'),
  clean_db_before_run: integer('clean_db_before_run', { mode: 'boolean' }),
  started_by: text('started_by'),
});

export const findings = sqliteTable('findings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  run_id: integer('run_id')
    .notNull()
    .references(() => runs.id),
  finding_id: text('finding_id').notNull(),
  agent: text('agent').notNull(),
  step: text('step').notNull(),
  severity: text('severity', {
    enum: ['critical', 'high', 'medium', 'low', 'info'],
  }).notNull(),
  title: text('title').notNull(),
  expected: text('expected').notNull(),
  actual: text('actual').notNull(),
  screenshot_path: text('screenshot_path'),
  timestamp: text('timestamp').notNull(),
});

export const scenarios = sqliteTable('scenarios', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scenario_id: text('scenario_id').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  step_count: integer('step_count').notNull().default(0),
  agent_count: integer('agent_count').notNull().default(0),
  last_run_at: text('last_run_at'),
  last_status: text('last_status'),
});

export const pr_links = sqliteTable('pr_links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  run_id: integer('run_id')
    .notNull()
    .references(() => runs.id),
  pr_number: integer('pr_number').notNull(),
  gate_status: text('gate_status', { enum: ['passed', 'blocked'] }).notNull(),
  created_at: text('created_at').notNull(),
});

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type Finding = typeof findings.$inferSelect;
export type NewFinding = typeof findings.$inferInsert;
export type Scenario = typeof scenarios.$inferSelect;
export type NewScenario = typeof scenarios.$inferInsert;
export type PrLink = typeof pr_links.$inferSelect;
export type NewPrLink = typeof pr_links.$inferInsert;

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

// Resolved on every initDb() call, not at import time: tests set DATABASE_URL
// after imports are hoisted and must never touch the on-disk database.
function resolveDbPath(): string {
  return process.env['DATABASE_URL'] ?? './persona-qa.db';
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

export function getDb() {
  if (!_db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return _db;
}

export function initDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (_db) return _db;

  const dbPath = resolveDbPath();
  _sqlite = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  _sqlite.pragma('journal_mode = WAL');
  _sqlite.pragma('foreign_keys = ON');

  _db = drizzle(_sqlite, { schema });

  // Auto-create tables using raw SQL (avoids needing drizzle-kit push at runtime)
  _sqlite.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scenario_id TEXT NOT NULL,
      scenario_name TEXT NOT NULL,
      session_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,
      total_tests INTEGER NOT NULL DEFAULT 0,
      passed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      findings_count INTEGER NOT NULL DEFAULT 0,
      critical_count INTEGER NOT NULL DEFAULT 0,
      high_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      run_source TEXT DEFAULT 'unknown',
      artifacts TEXT,
      suite_type TEXT,
      clean_db_before_run INTEGER,
      started_by TEXT
    );

    CREATE TABLE IF NOT EXISTS findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES runs(id),
      finding_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      step TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      expected TEXT NOT NULL,
      actual TEXT NOT NULL,
      screenshot_path TEXT,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scenarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scenario_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      step_count INTEGER NOT NULL DEFAULT 0,
      agent_count INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT,
      last_status TEXT
    );

    CREATE TABLE IF NOT EXISTS pr_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES runs(id),
      pr_number INTEGER NOT NULL,
      gate_status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_scenario_id ON runs(scenario_id);
    CREATE INDEX IF NOT EXISTS idx_findings_run_id ON findings(run_id);
    CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
    CREATE INDEX IF NOT EXISTS idx_findings_agent ON findings(agent);
    CREATE INDEX IF NOT EXISTS idx_pr_links_run_id ON pr_links(run_id);
  `);

  // Idempotent migrations: add columns to runs
  const runMigrations = [
    'ALTER TABLE runs ADD COLUMN error_message TEXT',
    "ALTER TABLE runs ADD COLUMN run_source TEXT DEFAULT 'unknown'",
    'ALTER TABLE runs ADD COLUMN artifacts TEXT',
    'ALTER TABLE runs ADD COLUMN suite_type TEXT',
    'ALTER TABLE runs ADD COLUMN clean_db_before_run INTEGER',
    'ALTER TABLE runs ADD COLUMN started_by TEXT',
  ];
  for (const sql of runMigrations) {
    try { _sqlite.exec(sql); } catch { /* column already exists */ }
  }

  console.log(`[db] Initialized SQLite database at ${dbPath}`);
  return _db;
}

export function closeDb(): void {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
    _db = null;
  }
}

export { schema };

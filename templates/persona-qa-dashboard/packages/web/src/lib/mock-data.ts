export type RunStatus = 'passed' | 'failed' | 'running' | 'skipped'
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface Persona {
  id: string
  name: string
  role: string
  description: string
  initials: string
  color: string
  colorBg: string
  modules: string[]
  stats: {
    testsRun: number
    passRate: number
    findingsGenerated: number
  }
}

export interface Scenario {
  id: string
  name: string
  description: string
  steps: ScenarioStep[]
  agentCount: number
  lastRun: {
    status: RunStatus
    date: string
  }
}

export interface ScenarioStep {
  id: string
  name: string
  agent: string
}

export interface Run {
  id: number
  scenarioId: string
  scenarioName: string
  status: RunStatus
  startedAt: string
  duration: number
  findings: {
    critical: number
    high: number
    medium: number
    low: number
    info: number
  }
  steps: RunStep[]
  logExcerpt: string
}

export interface RunStep {
  id: string
  name: string
  agent: string
  status: RunStatus
  duration: number
  output?: string
}

export interface Finding {
  id: string
  severity: Severity
  title: string
  description: string
  agent: string
  scenario: string
  timestamp: string
  expected: string
  actual: string
  screenshot?: string
}

export interface TrendPoint {
  run: string
  passed: number
  failed: number
  total: number
}

export interface Insight {
  id: string
  specialist: 'frontend' | 'test' | 'backend'
  title: string
  description: string
  severity: 'info' | 'warning' | 'critical'
  category: string
  recommendation: string
}

// --- Persona colors lookup ---

export const PERSONA_COLORS: Record<string, string> = {
  'Carlos': '#3b82f6',
  'Carlos Mendes': '#3b82f6',
  'Ana Silva': '#a855f7',
  'Roberto Costa': '#22c55e',
  'Fernanda Lima': '#f97316',
  'Juliana Santos': '#ef4444',
}

// --- API response types (from DB schema) ---

export interface ApiRun {
  id: number
  scenario_id: string
  scenario_name: string
  session_id: string
  status: 'pending' | 'running' | 'complete' | 'failed'
  started_at: string
  completed_at: string | null
  duration_ms: number | null
  total_tests: number
  passed: number
  failed: number
  skipped: number
  findings_count: number
  critical_count: number
  high_count: number
}

export interface ApiFinding {
  id: number
  run_id: number
  finding_id: string
  agent: string
  step: string
  severity: Severity
  title: string
  expected: string
  actual: string
  screenshot_path: string | null
  timestamp: string
}

export interface ApiScenario {
  id: number
  scenario_id: string
  name: string
  description: string | null
  step_count: number
  agent_count: number
  last_run_at: string | null
  last_status: string | null
}

export interface ApiStats {
  total_runs: number
  complete_runs: number
  failed_runs: number
  pass_rate: number
  avg_duration_ms: number | null
  total_findings: number
  critical_high_findings: number
  total_scenarios: number
  findings_trend: ApiRun[]
  agentic?: {
    total_sessions: number
    complete_sessions: number
    failed_sessions: number
    running_sessions: number
    multi_agent_sessions: number
    total_findings: number
    last_activity_at: string | null
  }
}

export interface ApiPersona {
  slug: string
  name: string
  role: string
  description: string
  modules: string[]
  color: string | null
  filePath: string
}

export interface ApiInsight {
  id: string
  specialist: 'frontend' | 'test' | 'backend'
  title: string
  description: string
  severity: 'info' | 'warning' | 'critical'
  category: string
  recommendation: string
}

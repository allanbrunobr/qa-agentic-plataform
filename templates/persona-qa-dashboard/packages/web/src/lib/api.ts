const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const WS_BASE = API_BASE.replace(/^http/, 'ws')

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    ...init,
  })
  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${response.statusText}`)
  }
  return response.json() as Promise<T>
}

export interface CreatePersonaPayload {
  name: string
  role: string
  description: string
  modules: string[]
  color: string
  context: string
}

export interface Phase2SessionSummary {
  id: string
  runId: number | null
  scenarioId: string
  status: 'pending' | 'running' | 'complete' | 'failed'
  startedAt: string
  completedAt: string | null
  eventCount: number
  artifactCount: number
  findingCount: number
  lastError?: string | null
  contractVerdict?: 'contract_compliant' | 'contract_drift' | 'contract_violated' | 'contract_evaluating' | null
  contractHardViolations?: number
  contractDriftSignals?: number
}

export interface Phase2ScenarioSummary {
  id: string
  name: string
  description: string | null
  roles: string[]
  step_count: number
  quality_gate: {
    scenarioId: string
    status: 'open' | 'review_required' | 'restricted'
    reason: string
    recentFinalSessions: number
    recentViolated: number
    recentDrift: number
    consecutiveViolated: number
    consecutiveFailures: number
  }
}

export interface Phase2WorkflowContractResponse {
  scenario_id: string
  scenario_name: string
  workflow_contract: Record<string, unknown>
  workflow_contract_yaml: string
}

export interface Phase2SessionEvent {
  id: string
  sessionId: string
  type: string
  agentRole?: string
  timestamp: string
  payload?: Record<string, unknown>
  data?: Record<string, unknown>
}

export interface Phase2SessionFinding {
  id: string
  timestamp: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  title: string
  evidence?: unknown
  agentId?: string | null
  stepId?: string | null
}

export interface Phase2SessionArtifact {
  id: string
  sessionId: string
  type: 'screenshot' | 'dom_snippet' | 'domain_artifact'
  agentRole: string
  description: string
  filePath?: string
  content?: string
  metadata?: Record<string, unknown>
  timestamp: string
}

export interface Phase2SessionDetail {
  id: string
  runId?: number
  scenarioId: string
  status: 'pending' | 'running' | 'complete' | 'failed'
  startedAt: string
  completedAt?: string
  events: Phase2SessionEvent[]
  artifacts: Record<string, unknown>
  findings: Array<{
    id: string
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
    title: string
    description?: string
    evidence?: unknown
    agentId?: string
    stepId?: string
    createdAt?: string
  }>
  checkpoint: {
    lastCompletedStep: number
    cursor: number
  }
  workflowContract?: Record<string, unknown> | null
  workflowContractYaml?: string | null
  contractEvaluation?: {
    verdict: 'contract_compliant' | 'contract_drift' | 'contract_violated' | 'contract_evaluating'
    hardViolations: number
    driftSignals: number
    final: boolean
    expectedStepOrder: string[]
    observedStepOrder: string[]
    expectedArtifacts: string[]
    producedArtifacts: string[]
    missingArtifacts: string[]
    unexpectedArtifacts: string[]
    observedUnexpectedSteps: string[]
    stepChecks: Array<{
      stepId: string
      agentId: string
      expectedCapability: string
      observedTools: string[]
      expectedOrder: number
      observedOrder: number
      status: 'pending' | 'running' | 'complete' | 'failed'
      neverStarted: boolean
      incomplete: boolean
      outOfOrder: boolean
      capabilityMismatch: boolean
      expectedArtifacts: string[]
    }>
  } | null
}

export interface DashboardStats {
  total_runs: number
  complete_runs: number
  failed_runs: number
  pass_rate: number
  avg_duration_ms: number | null
  total_findings: number
  critical_high_findings: number
  total_scenarios: number
  findings_trend: Array<Record<string, unknown>>
  agentic: {
    total_sessions: number
    complete_sessions: number
    failed_sessions: number
    running_sessions: number
    multi_agent_sessions: number
    total_findings: number
    last_activity_at: string | null
    contract_adherence: {
      violated: number
      drift: number
      compliant: number
      no_contract: number
      hard_violations: number
      drift_signals: number
    }
    scenario_quality_gates: {
      open: number
      review_required: number
      restricted: number
    }
  }
}

export const api = {
  getRuns: () => fetchJSON(`${API_BASE}/api/runs`),
  getRun: (id: number) => fetchJSON(`${API_BASE}/api/runs/${id}`),
  triggerRun: (scenarioId?: string) =>
    fetchJSON(`${API_BASE}/api/runs`, {
      method: 'POST',
      body: JSON.stringify({ scenario_id: scenarioId }),
    }),
  getScenarios: () => fetchJSON(`${API_BASE}/api/scenarios`),
  getScenario: (id: string) => fetchJSON(`${API_BASE}/api/scenarios/${id}`),
  getFindings: (params?: Record<string, string>) =>
    fetchJSON(`${API_BASE}/api/findings?${new URLSearchParams(params)}`),
  getStats: () => fetchJSON<DashboardStats>(`${API_BASE}/api/stats`),
  getPersonas: () => fetchJSON(`${API_BASE}/api/personas`),
  createPersona: (data: CreatePersonaPayload) =>
    fetchJSON(`${API_BASE}/api/personas`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getInsights: () => fetchJSON(`${API_BASE}/api/insights`),
  getFindingScreenshotUrl: (id: number) => `${API_BASE}/api/findings/${id}/screenshot`,
  getPhase2Sessions: () => fetchJSON<Phase2SessionSummary[]>(`${API_BASE}/api/p2/sessions`),
  getPhase2Scenarios: () => fetchJSON<Phase2ScenarioSummary[]>(`${API_BASE}/api/p2/scenarios`),
  getPhase2ScenarioWorkflowContract: (id: string) =>
    fetchJSON<Phase2WorkflowContractResponse>(`${API_BASE}/api/p2/scenarios/${id}/workflow-contract`),
  getPhase2Session: (id: string) => fetchJSON<Phase2SessionDetail>(`${API_BASE}/api/p2/sessions/${id}`),
  getPhase2SessionEvents: (id: string) => fetchJSON<Phase2SessionEvent[]>(`${API_BASE}/api/p2/sessions/${id}/events`),
  getPhase2SessionFindings: (id: string) => fetchJSON<Phase2SessionFinding[]>(`${API_BASE}/api/p2/sessions/${id}/findings`),
  getPhase2SessionArtifacts: (id: string) => fetchJSON<Phase2SessionArtifact[]>(`${API_BASE}/api/p2/sessions/${id}/artifacts`),
  getPhase2ArtifactContentUrl: (artifactId: string) => `${API_BASE}/api/p2/artifacts/${artifactId}/content`,
  getPhase2SessionWsUrl: (sessionId: string) => `${WS_BASE}/ws/p2/sessions/${sessionId}`,
  startPhase2Run: (payload: {
    scenario_id: string
    customer_name?: string
    customer_phone?: string
    order_type?: string
  }) =>
    fetchJSON<{
      session_id: string
      scenario_id: string
      status: string
      started_at: string
    }>(`${API_BASE}/api/p2/runs`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
}

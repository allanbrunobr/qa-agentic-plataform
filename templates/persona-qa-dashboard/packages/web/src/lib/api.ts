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

export type Phase2LearningProposalStatus = 'proposed' | 'approved' | 'applied' | 'rejected'
export type Phase2LearningProposalPatchKind = 'none' | 'prompt_overlay' | 'capability_patch' | 'environment_check'
export type Phase2HealingActionStatus = 'proposed' | 'applied' | 'blocked'
export type Phase2GovernanceSubjectType = 'learning_proposal' | 'scenario_draft' | 'healing_action'
export type Phase2GovernanceAction = 'generate' | 'approve' | 'apply' | 'reject' | 'evaluate'
export type Phase2GovernanceVerdict = 'allowed' | 'blocked'
export type Phase2ScenarioDraftStatus = 'pending' | 'approved' | 'rejected' | 'revised'

export interface Phase2LearningProposal {
  id: string
  recommendationId: string
  scenarioId: string
  stepId: string
  agentId?: string
  type: string
  severity: string
  status: Phase2LearningProposalStatus
  recommendation: Record<string, unknown>
  patchKind: Phase2LearningProposalPatchKind
  target?: string
  patchContent?: string
  metadata?: Record<string, unknown>
  createdAt: string
  approvedAt?: string
  appliedAt?: string
  rejectedAt?: string
}

export interface Phase2HealingAction {
  id: string
  type: string
  target: string
  reason: string
  automatic: boolean
  status: Phase2HealingActionStatus
  metadata?: Record<string, unknown>
  createdAt: string
}

export interface Phase2GovernanceDecision {
  id: string
  subjectType: Phase2GovernanceSubjectType
  subjectId: string
  action: Phase2GovernanceAction
  verdict: Phase2GovernanceVerdict
  reason: string
  actor?: string
  requirements?: string[]
  metadata?: Record<string, unknown>
  createdAt: string
}

export interface Phase2ScenarioDraft {
  id: string
  scenarioId: string
  name: string
  description?: string
  contract: Record<string, unknown>
  gapType: string
  gapEvidence?: unknown[]
  status: Phase2ScenarioDraftStatus
  reviewedBy?: string
  reviewedAt?: string
  createdAt: string
  updatedAt: string
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
  getPhase2HealingLog: (limit = 100) =>
    fetchJSON<Phase2HealingAction[]>(`${API_BASE}/api/p2/healing/log?${new URLSearchParams({ limit: String(limit) })}`),
  evaluatePhase2Healing: () =>
    fetchJSON<Phase2HealingAction[]>(`${API_BASE}/api/p2/healing/evaluate`, { method: 'POST' }),
  getPhase2LearningProposals: (params?: {
    scenarioId?: string
    status?: Phase2LearningProposalStatus
    limit?: number
  }) =>
    fetchJSON<Phase2LearningProposal[]>(`${API_BASE}/api/p2/learning/proposals?${new URLSearchParams(compactParams({
      scenarioId: params?.scenarioId,
      status: params?.status,
      limit: params?.limit ? String(params.limit) : undefined,
    }))}`),
  getPhase2GovernanceDecisions: (params?: {
    subjectType?: Phase2GovernanceSubjectType
    subjectId?: string
    limit?: number
  }) =>
    fetchJSON<Phase2GovernanceDecision[]>(`${API_BASE}/api/p2/governance/decisions?${new URLSearchParams(compactParams({
      subjectType: params?.subjectType,
      subjectId: params?.subjectId,
      limit: params?.limit ? String(params.limit) : undefined,
    }))}`),
  getPhase2ScenarioDrafts: (params?: {
    status?: Phase2ScenarioDraftStatus
    limit?: number
  }) =>
    fetchJSON<Phase2ScenarioDraft[]>(`${API_BASE}/api/p2/scenarios/drafts?${new URLSearchParams(compactParams({
      status: params?.status,
      limit: params?.limit ? String(params.limit) : undefined,
    }))}`),
  approvePhase2LearningProposal: (id: string) =>
    fetchJSON<Phase2LearningProposal>(`${API_BASE}/api/p2/learning/proposals/${id}/approve`, { method: 'POST' }),
  applyPhase2LearningProposal: (id: string) =>
    fetchJSON<Phase2LearningProposal>(`${API_BASE}/api/p2/learning/proposals/${id}/apply`, { method: 'POST' }),
  rejectPhase2LearningProposal: (id: string) =>
    fetchJSON<Phase2LearningProposal>(`${API_BASE}/api/p2/learning/proposals/${id}/reject`, { method: 'POST' }),
  updatePhase2ScenarioDraft: (id: string, payload: {
    status: Phase2ScenarioDraftStatus
    reviewedBy?: string
  }) =>
    fetchJSON<Phase2ScenarioDraft>(`${API_BASE}/api/p2/scenarios/drafts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
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

function compactParams(params: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}

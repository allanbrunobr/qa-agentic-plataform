import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type {
  Session,
  SessionArtifact,
  SessionEvent,
  SessionEventType,
  SessionFinding,
  SessionStatus,
} from '../types/session-types.js'
import type {
  AdaptationType,
  FailureCategory,
  StepExecutionStatus,
} from '../types/scenario-types.js'
import { diagnoseFailureMessage } from './failure-diagnosis-service.js'

const DEFAULT_PHASE2_ARTIFACT_DIR = process.env['PHASE2_ARTIFACT_DIR'] ?? path.resolve(process.cwd(), 'artifacts')

export function resolvePhase2ArtifactPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(DEFAULT_PHASE2_ARTIFACT_DIR, filePath)
}

type SessionRow = {
  session_id: string
  run_id: number | null
  scenario_id: string
  status: SessionStatus
  created_at: string
  started_at: string | null
  completed_at: string | null
}

type EventRow = {
  id: number
  session_id: string
  sequence: number
  type: SessionEventType
  timestamp: string
  agent_role: string | null
  data: string | null
}

type ArtifactRow = {
  id: number
  session_id: string
  artifact_key: string
  artifact_type: string | null
  agent_role: string | null
  description: string | null
  file_path: string | null
  content: string | null
  metadata: string | null
  payload: string | null
  created_at: string
}

type FindingRow = {
  id: number
  session_id: string
  severity: string | null
  title: string | null
  description: string | null
  evidence: string | null
  agent_id: string | null
  step_id: string | null
  created_at: string
}

type CheckpointRow = {
  last_completed_step: number
  cursor: number
}

export interface StepPerformanceInput {
  sessionId: string
  scenarioId: string
  stepId: string
  agentId: string
  status: StepExecutionStatus
  success: boolean
  attempt: number
  durationMs: number
  errorCategory?: FailureCategory
  errorMessage?: string
  startedAt?: string
  completedAt?: string
  metadata?: Record<string, unknown>
}

export interface StepPerformanceRecord extends StepPerformanceInput {
  id: number
  createdAt: string
}

export interface StepHistoryStats {
  scenarioId: string
  stepId: string
  totalExecutions: number
  successRate: number
  averageDurationMs: number
  p95DurationMs: number
  retryRecoveryRate: number
  failureBreakdown: Record<string, number>
  recentExecutions: StepPerformanceRecord[]
}

export interface AdaptationEventInput {
  sessionId?: string
  scenarioId: string
  stepId?: string
  type: AdaptationType
  previousValue?: unknown
  newValue?: unknown
  reason: string
  confidence: number
  outcome?: string
  metadata?: Record<string, unknown>
}

export interface AdaptationEvent extends AdaptationEventInput {
  id: number
  timestamp: string
}

export type LearningProposalStatus = 'proposed' | 'approved' | 'applied' | 'rejected'
export type LearningProposalPatchKind = 'none' | 'prompt_overlay' | 'capability_patch' | 'environment_check'
export type ScenarioDraftStatus = 'pending' | 'approved' | 'rejected' | 'revised' | 'promoted'
export type HealingActionStatus = 'proposed' | 'applied' | 'blocked' | 'rolled_back'
export type GovernanceSubjectType = 'learning_proposal' | 'scenario_draft' | 'healing_action'
export type GovernanceAction = 'generate' | 'approve' | 'apply' | 'reject' | 'evaluate' | 'rollback' | 'promote'
export type GovernanceVerdict = 'allowed' | 'blocked'
export type SyntheticToolClosureReason = 'timeout' | 'interruption'
export type L5MaterializationSubjectType = 'learning_proposal' | 'scenario_draft' | 'healing_action'
export type L5MaterializationStatus = 'active' | 'rolled_back'
export type L5ClosedLoopStatus = 'completed' | 'needs_review' | 'blocked' | 'failed'
export type L5ClosedLoopMode = 'observe' | 'apply_approved'
export type KnowledgePromotionEventAction = 'approve' | 'apply' | 'promote'
export type KnowledgePromotionEventStatus = 'completed' | 'blocked' | 'failed'

export interface LearningProposalInput {
  recommendationId: string
  scenarioId: string
  stepId: string
  agentId?: string
  type: string
  severity: string
  recommendation: Record<string, unknown>
  patchKind: LearningProposalPatchKind
  target?: string
  patchContent?: string
  metadata?: Record<string, unknown>
}

export interface LearningProposal extends LearningProposalInput {
  id: string
  status: LearningProposalStatus
  createdAt: string
  approvedAt?: string
  appliedAt?: string
  rejectedAt?: string
}

export interface ScenarioDraftInput {
  scenarioId: string
  name: string
  description?: string
  contract: Record<string, unknown>
  gapType: string
  gapEvidence?: unknown[]
}

export interface ScenarioDraft extends ScenarioDraftInput {
  id: string
  status: ScenarioDraftStatus
  reviewedBy?: string
  reviewedAt?: string
  createdAt: string
  updatedAt: string
}

export interface HealingActionInput {
  type: string
  target: string
  reason: string
  automatic: boolean
  status: HealingActionStatus
  metadata?: Record<string, unknown>
}

export interface HealingAction extends HealingActionInput {
  id: string
  createdAt: string
}

export interface GovernanceDecisionInput {
  subjectType: GovernanceSubjectType
  subjectId: string
  action: GovernanceAction
  verdict: GovernanceVerdict
  reason: string
  actor?: string
  requirements?: string[]
  metadata?: Record<string, unknown>
}

export interface GovernanceDecision extends GovernanceDecisionInput {
  id: string
  createdAt: string
}

export interface L5MaterializationInput {
  subjectType: L5MaterializationSubjectType
  subjectId: string
  kind: string
  filePath: string
  checksum: string
  metadata?: Record<string, unknown>
}

export interface L5Materialization extends L5MaterializationInput {
  id: string
  status: L5MaterializationStatus
  createdAt: string
  rolledBackAt?: string
}

export interface RuntimeLearningOverlay {
  proposalId: string
  materializationId: string
  scenarioId: string
  stepId: string
  agentId?: string
  target?: string
  patchContent: string
  checksum: string
  filePath: string
  createdAt: string
}

export interface L5ClosedLoopRunInput {
  status: L5ClosedLoopStatus
  mode: L5ClosedLoopMode
  scenarioId?: string
  queuedScenarios: string[]
  actions: Record<string, unknown>[]
  verification: Record<string, unknown>
  summary: Record<string, unknown>
  metadata?: Record<string, unknown>
  startedAt?: string
  completedAt?: string
}

export interface L5ClosedLoopRun extends L5ClosedLoopRunInput {
  id: string
  startedAt: string
  completedAt: string
}

export type L5IndependentAuditReviewStatus = 'reviewed'

export interface L5IndependentAuditReviewInput {
  runId: string
  status: L5IndependentAuditReviewStatus
  actor?: string
  reason?: string
  metadata?: Record<string, unknown>
}

export interface L5IndependentAuditReview extends L5IndependentAuditReviewInput {
  id: string
  createdAt: string
}

export interface KnowledgePromotionEventInput {
  sourceRunId: string
  candidateId: string
  candidateVersion: string
  subjectType: GovernanceSubjectType
  subjectId: string
  promotionType: string
  action: KnowledgePromotionEventAction
  status: KnowledgePromotionEventStatus
  actor?: string
  reason?: string
  target?: string
  result?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface KnowledgePromotionEvent extends KnowledgePromotionEventInput {
  id: string
  createdAt: string
}

type StepPerformanceRow = {
  id: number
  session_id: string
  scenario_id: string
  step_id: string
  agent_id: string
  status: StepExecutionStatus
  success: number
  attempt: number
  duration_ms: number
  error_category: FailureCategory | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  metadata: string | null
  created_at: string
}

type AdaptationEventRow = {
  id: number
  session_id: string | null
  scenario_id: string
  step_id: string | null
  adaptation_type: AdaptationType
  previous_value: string | null
  new_value: string | null
  reason: string
  confidence: number
  outcome: string | null
  metadata: string | null
  timestamp: string
}

type LearningProposalRow = {
  proposal_id: string
  recommendation_id: string
  scenario_id: string
  step_id: string
  agent_id: string | null
  proposal_type: string
  severity: string
  status: LearningProposalStatus
  recommendation: string
  patch_kind: LearningProposalPatchKind
  target: string | null
  patch_content: string | null
  metadata: string | null
  created_at: string
  approved_at: string | null
  applied_at: string | null
  rejected_at: string | null
}

type ScenarioDraftRow = {
  draft_id: string
  scenario_id: string
  name: string
  description: string | null
  contract_json: string
  gap_type: string
  gap_evidence: string | null
  status: ScenarioDraftStatus
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

type HealingActionRow = {
  action_id: string
  action_type: string
  target: string
  reason: string
  automatic: number
  status: HealingActionStatus
  metadata: string | null
  created_at: string
}

type GovernanceDecisionRow = {
  decision_id: string
  subject_type: GovernanceSubjectType
  subject_id: string
  action: GovernanceAction
  verdict: GovernanceVerdict
  reason: string
  actor: string | null
  requirements: string | null
  metadata: string | null
  created_at: string
}

type L5MaterializationRow = {
  materialization_id: string
  subject_type: L5MaterializationSubjectType
  subject_id: string
  kind: string
  status: L5MaterializationStatus
  file_path: string
  checksum: string
  metadata: string | null
  created_at: string
  rolled_back_at: string | null
}

type RuntimeLearningOverlayRow = {
  proposal_id: string
  scenario_id: string
  step_id: string
  agent_id: string | null
  target: string | null
  patch_content: string
  materialization_id: string
  file_path: string
  checksum: string
  metadata: string | null
  created_at: string
}

type L5ClosedLoopRunRow = {
  loop_id: string
  status: L5ClosedLoopStatus
  mode: L5ClosedLoopMode
  scenario_id: string | null
  queued_scenarios: string
  actions_json: string
  verification_json: string
  summary_json: string
  metadata: string | null
  started_at: string
  completed_at: string
}

type L5IndependentAuditReviewRow = {
  review_id: string
  run_id: string
  status: L5IndependentAuditReviewStatus
  actor: string | null
  reason: string | null
  metadata: string | null
  created_at: string
}

type KnowledgePromotionEventRow = {
  event_id: string
  source_run_id: string
  candidate_id: string
  candidate_version: string
  subject_type: GovernanceSubjectType
  subject_id: string
  promotion_type: string
  action: KnowledgePromotionEventAction
  status: KnowledgePromotionEventStatus
  actor: string | null
  reason: string | null
  target: string | null
  result_json: string | null
  metadata: string | null
  created_at: string
}

type ToolClosureRow = {
  session_id: string
  tool_call_id: string
  tool_name: string
  reason: SyntheticToolClosureReason
  closed_at: string
  original_started_at: string
}

function getDefaultDbPath(): string {
  if (process.env['VITEST'] || process.env['NODE_ENV'] === 'test') {
    return ':memory:'
  }
  return process.env['DATABASE_URL'] ?? './persona-qa.db'
}

export class SessionService {
  private readonly sqlite: Database.Database

  constructor(databasePath = getDefaultDbPath()) {
    this.sqlite = new Database(databasePath)
    this.sqlite.pragma('journal_mode = WAL')
    this.sqlite.pragma('foreign_keys = ON')
    this.ensureTables()
  }

  createSession(scenarioId: string, runId?: number): Session {
    const id = randomUUID()
    const now = new Date().toISOString()

    this.sqlite
      .prepare(
        `INSERT INTO p2_sessions (session_id, run_id, scenario_id, status, created_at, started_at, completed_at)
         VALUES (?, ?, ?, 'pending', ?, ?, NULL)`,
      )
      .run(id, runId ?? null, scenarioId, now, now)

    return this.getSession(id)!
  }

  private ensureSession(sessionId: string): void {
    const existing = this.sqlite
      .prepare(`SELECT session_id FROM p2_sessions WHERE session_id = ?`)
      .get(sessionId) as { session_id: string } | undefined

    if (existing) return

    const now = new Date().toISOString()
    this.sqlite
      .prepare(
        `INSERT INTO p2_sessions (session_id, run_id, scenario_id, status, created_at, started_at, completed_at)
         VALUES (?, NULL, 'stub', 'pending', ?, ?, NULL)`,
      )
      .run(sessionId, now, now)
  }

  getSession(sessionId: string): Session | undefined {
    const row = this.sqlite
      .prepare(
        `SELECT session_id, run_id, scenario_id, status, created_at, started_at, completed_at
         FROM p2_sessions
         WHERE session_id = ?`,
      )
      .get(sessionId) as SessionRow | undefined

    if (!row) return undefined

    const events = this.sqlite
      .prepare(
        `SELECT id, session_id, sequence, type, timestamp, agent_role, data
         FROM p2_session_events
         WHERE session_id = ?
         ORDER BY sequence ASC`,
      )
      .all(sessionId) as EventRow[]

    const artifactRows = this.sqlite
      .prepare(
        `SELECT id, session_id, artifact_key, artifact_type, agent_role, description, file_path, content, metadata, payload, created_at
         FROM p2_session_artifacts
         WHERE session_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(sessionId) as ArtifactRow[]

    const findingRows = this.sqlite
      .prepare(
        `SELECT id, session_id, severity, title, description, evidence, agent_id, step_id, created_at
         FROM p2_session_findings
         WHERE session_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(sessionId) as FindingRow[]

    const checkpoint = this.sqlite
      .prepare(
        `SELECT last_completed_step, cursor
         FROM p2_session_checkpoints
         WHERE session_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(sessionId) as CheckpointRow | undefined

    const artifacts = Object.fromEntries(
      artifactRows.map((artifact) => {
        const payload = artifact.payload ? JSON.parse(artifact.payload) : {
          artifactId: String(artifact.id),
          type: artifact.artifact_type,
          description: artifact.description,
          filePath: artifact.file_path,
          content: artifact.content,
          metadata: artifact.metadata ? JSON.parse(artifact.metadata) : undefined,
        }
        return [artifact.artifact_key, payload]
      }),
    )

    return {
      id: row.session_id,
      runId: row.run_id ?? undefined,
      scenarioId: row.scenario_id,
      status: row.status,
      startedAt: row.started_at ?? row.created_at,
      completedAt: row.completed_at ?? undefined,
      events: events.map((event) => {
        const data = event.data ? JSON.parse(event.data) as Record<string, unknown> : undefined
        return {
          id: String(event.id),
          sessionId: event.session_id,
          type: event.type,
          agentRole: event.agent_role ?? undefined,
          timestamp: event.timestamp,
          payload: data,
          data,
        }
      }),
      artifacts,
      findings: findingRows.map((finding) => ({
        id: String(finding.id),
        sessionId: finding.session_id,
        agentId: finding.agent_id ?? undefined,
        agentRole: finding.agent_id ?? undefined,
        stepId: finding.step_id ?? undefined,
        severity: (finding.severity ?? 'info') as SessionFinding['severity'],
        title: finding.title ?? 'Untitled',
        description: finding.description ?? undefined,
        evidence: finding.evidence ? JSON.parse(finding.evidence) : null,
        createdAt: finding.created_at,
        timestamp: finding.created_at,
      })),
      checkpoint: {
        lastCompletedStep: checkpoint?.last_completed_step ?? -1,
        cursor: checkpoint?.cursor ?? 0,
      },
    }
  }

  getAllSessions(): Session[] {
    const rows = this.sqlite
      .prepare(`SELECT session_id FROM p2_sessions ORDER BY rowid ASC`)
      .all() as Array<{ session_id: string }>

    return rows
      .map((row) => this.getSession(row.session_id))
      .filter((session): session is Session => session !== undefined)
  }

  updateStatus(sessionId: string, status: SessionStatus): void {
    const session = this.getSession(sessionId)
    if (!session) return

    const now = new Date().toISOString()
    const startedAt = status === 'running' ? session.startedAt ?? now : session.startedAt ?? null
    const completedAt = status === 'complete' || status === 'failed'
      ? (session.completedAt ?? now)
      : null

    this.sqlite
      .prepare(
        `UPDATE p2_sessions
         SET status = ?, started_at = ?, completed_at = ?
         WHERE session_id = ?`,
      )
      .run(status, startedAt, completedAt, sessionId)
  }

  addEvent(sessionId: string, type: SessionEventType, data?: Record<string, unknown>): SessionEvent {
    this.ensureSession(sessionId)
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)

    const nextSequenceRow = this.sqlite
      .prepare(`SELECT COALESCE(MAX(sequence), -1) + 1 AS next_sequence FROM p2_session_events WHERE session_id = ?`)
      .get(sessionId) as { next_sequence: number }

    const timestamp = new Date().toISOString()
    const agentRole = typeof data?.['agentRole'] === 'string' ? String(data['agentRole']) : null
    const result = this.sqlite
      .prepare(
        `INSERT INTO p2_session_events (session_id, sequence, type, timestamp, agent_role, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(sessionId, nextSequenceRow.next_sequence, type, timestamp, agentRole, data ? JSON.stringify(data) : null)

    if (type === 'finding_recorded') {
      this.insertFindingRow(sessionId, {
        severity: typeof data?.['severity'] === 'string' ? String(data['severity']) : 'info',
        title: typeof data?.['title'] === 'string' ? String(data['title']) : 'Untitled',
        description: typeof data?.['description'] === 'string' ? String(data['description']) : null,
        evidence: data?.['evidence'] ?? null,
        agentId: typeof data?.['agentId'] === 'string' ? String(data['agentId']) : agentRole,
        stepId: typeof data?.['stepId'] === 'string' ? String(data['stepId']) : null,
        createdAt: timestamp,
      })
    }

    return {
      id: String(result.lastInsertRowid),
      sessionId,
      type,
      agentRole: agentRole ?? undefined,
      timestamp,
      payload: data,
      data,
    }
  }

  appendEvent(
    sessionId: string,
    event: Omit<SessionEvent, 'id' | 'sessionId' | 'timestamp'>,
  ): SessionEvent {
    const payload = event.payload ?? event.data ?? {}
    let eventType: SessionEventType = event.type

    if (event.type === 'finding') {
      eventType = 'finding_recorded'
    }

    const mergedPayload = {
      ...(payload as Record<string, unknown>),
      ...(event.agentRole ? { agentRole: event.agentRole } : {}),
    }

    return this.addEvent(sessionId, eventType, mergedPayload)
  }

  recordToolClosure(
    sessionId: string,
    toolCallId: string,
    toolName: string,
    reason: SyntheticToolClosureReason,
    originalStartedAt?: string,
  ): boolean {
    this.ensureSession(sessionId)
    const closedAt = new Date().toISOString()
    const startedAt = originalStartedAt ?? closedAt
    const result = this.sqlite
      .prepare(
        `INSERT OR IGNORE INTO p2_tool_ledger_closures (
           session_id, tool_call_id, tool_name, reason, closed_at, original_started_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(sessionId, toolCallId, toolName, reason, closedAt, startedAt)

    if (result.changes === 0) return false

    this.addEvent(sessionId, 'info', {
      event: 'tool_synthetic_closure',
      toolCallId,
      toolName,
      reason,
      closedAt,
      originalStartedAt: startedAt,
    })

    return true
  }

  isToolCallClosed(sessionId: string, toolCallId: string): boolean {
    const row = this.sqlite
      .prepare(
        `SELECT tool_call_id
         FROM p2_tool_ledger_closures
         WHERE session_id = ? AND tool_call_id = ?
         LIMIT 1`,
      )
      .get(sessionId, toolCallId) as Pick<ToolClosureRow, 'tool_call_id'> | undefined

    return Boolean(row)
  }

  setArtifact(sessionId: string, key: string, value: unknown): void {
    this.ensureSession(sessionId)
    const now = new Date().toISOString()
    this.sqlite
      .prepare(
        `INSERT INTO p2_session_artifacts (session_id, artifact_key, artifact_type, payload, created_at)
         VALUES (?, ?, 'domain_artifact', ?, ?)
         ON CONFLICT(session_id, artifact_key)
         DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`,
      )
      .run(sessionId, key, JSON.stringify(value), now)
  }

  storeArtifact(
    sessionId: string,
    artifact: Omit<SessionArtifact, 'id' | 'sessionId' | 'timestamp'>,
  ): SessionArtifact {
    this.ensureSession(sessionId)
    const artifactKey = randomUUID()
    const timestamp = new Date().toISOString()
    const payload = JSON.stringify({
      filePath: artifact.filePath,
      content: artifact.content,
      metadata: artifact.metadata,
      description: artifact.description,
    })

    const result = this.sqlite
      .prepare(
        `INSERT INTO p2_session_artifacts (
           session_id, artifact_key, artifact_type, agent_role, description, file_path, content, metadata, payload, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        artifactKey,
        artifact.type,
        artifact.agentRole,
        artifact.description,
        artifact.filePath ?? null,
        artifact.content ?? null,
        artifact.metadata ? JSON.stringify(artifact.metadata) : null,
        payload,
        timestamp,
      )

    return {
      id: String(result.lastInsertRowid),
      sessionId,
      ...artifact,
      timestamp,
    }
  }

  listArtifacts(sessionId: string): SessionArtifact[] {
    const artifactRows = this.sqlite
      .prepare(
        `SELECT id, session_id, artifact_key, artifact_type, agent_role, description, file_path, content, metadata, payload, created_at
         FROM p2_session_artifacts
         WHERE session_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(sessionId) as ArtifactRow[]

    return artifactRows.map((artifact) => ({
      id: String(artifact.id),
      sessionId: artifact.session_id,
      type: (artifact.artifact_type ?? 'domain_artifact') as SessionArtifact['type'],
      agentRole: artifact.agent_role ?? 'unknown',
      description: artifact.description ?? '',
      filePath: artifact.file_path ?? undefined,
      content: artifact.content ?? undefined,
      metadata: artifact.metadata ? JSON.parse(artifact.metadata) : undefined,
      timestamp: artifact.created_at,
    }))
  }

  getArtifactById(artifactId: string): SessionArtifact | undefined {
    const artifact = this.sqlite
      .prepare(
        `SELECT id, session_id, artifact_key, artifact_type, agent_role, description, file_path, content, metadata, payload, created_at
         FROM p2_session_artifacts
         WHERE id = ?`,
      )
      .get(Number(artifactId)) as ArtifactRow | undefined

    if (!artifact) return undefined

    return {
      id: String(artifact.id),
      sessionId: artifact.session_id,
      type: (artifact.artifact_type ?? 'domain_artifact') as SessionArtifact['type'],
      agentRole: artifact.agent_role ?? 'unknown',
      description: artifact.description ?? '',
      filePath: artifact.file_path ?? undefined,
      content: artifact.content ?? undefined,
      metadata: artifact.metadata ? JSON.parse(artifact.metadata) : undefined,
      timestamp: artifact.created_at,
    }
  }

  classifyFailure(error?: string, status?: StepExecutionStatus): FailureCategory {
    return diagnoseFailureMessage(error, status).failureCategory
  }

  recordStepPerformance(input: StepPerformanceInput): StepPerformanceRecord {
    this.ensureSession(input.sessionId)
    const createdAt = new Date().toISOString()
    const errorCategory = input.errorCategory ?? this.classifyFailure(input.errorMessage, input.status)
    const result = this.sqlite
      .prepare(
        `INSERT INTO p2_step_performance (
           session_id, scenario_id, step_id, agent_id, status, success, attempt,
           duration_ms, error_category, error_message, started_at, completed_at, metadata, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.sessionId,
        input.scenarioId,
        input.stepId,
        input.agentId,
        input.status,
        input.success ? 1 : 0,
        input.attempt,
        input.durationMs,
        errorCategory,
        input.errorMessage ?? null,
        input.startedAt ?? null,
        input.completedAt ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        createdAt,
      )

    return {
      ...input,
      id: Number(result.lastInsertRowid),
      errorCategory,
      createdAt,
    }
  }

  listStepPerformance(filter: {
    scenarioId?: string
    stepId?: string
    agentId?: string
    limit?: number
  } = {}): StepPerformanceRecord[] {
    const where: string[] = []
    const params: unknown[] = []
    if (filter.scenarioId) {
      where.push('scenario_id = ?')
      params.push(filter.scenarioId)
    }
    if (filter.stepId) {
      where.push('step_id = ?')
      params.push(filter.stepId)
    }
    if (filter.agentId) {
      where.push('agent_id = ?')
      params.push(filter.agentId)
    }

    const limit = Math.max(1, Math.min(filter.limit ?? 50, 500))
    const rows = this.sqlite
      .prepare(
        `SELECT id, session_id, scenario_id, step_id, agent_id, status, success, attempt,
                duration_ms, error_category, error_message, started_at, completed_at, metadata, created_at
         FROM p2_step_performance
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(...params, limit) as StepPerformanceRow[]

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      scenarioId: row.scenario_id,
      stepId: row.step_id,
      agentId: row.agent_id,
      status: row.status,
      success: row.success === 1,
      attempt: row.attempt,
      durationMs: row.duration_ms,
      errorCategory: row.error_category ?? undefined,
      errorMessage: row.error_message ?? undefined,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
    }))
  }

  getStepHistoryStats(scenarioId: string, stepId: string, limit = 50): StepHistoryStats {
    const recentExecutions = this.listStepPerformance({ scenarioId, stepId, limit })
    const totalExecutions = recentExecutions.length
    const successes = recentExecutions.filter((record) => record.success).length
    const durations = recentExecutions.map((record) => record.durationMs).sort((a, b) => a - b)
    const p95Index = durations.length ? Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1) : 0
    const retryAttempts = recentExecutions.filter((record) => record.attempt > 1)
    const retrySuccesses = retryAttempts.filter((record) => record.success)
    const failureBreakdown: Record<string, number> = {}

    for (const record of recentExecutions) {
      if (!record.success) {
        const category = record.errorCategory ?? 'unknown'
        failureBreakdown[category] = (failureBreakdown[category] ?? 0) + 1
      }
    }

    return {
      scenarioId,
      stepId,
      totalExecutions,
      successRate: totalExecutions ? successes / totalExecutions : 0,
      averageDurationMs: totalExecutions
        ? Math.round(recentExecutions.reduce((sum, record) => sum + record.durationMs, 0) / totalExecutions)
        : 0,
      p95DurationMs: durations[p95Index] ?? 0,
      retryRecoveryRate: retryAttempts.length ? retrySuccesses.length / retryAttempts.length : 0,
      failureBreakdown,
      recentExecutions,
    }
  }

  recordAdaptationEvent(input: AdaptationEventInput): AdaptationEvent {
    const timestamp = new Date().toISOString()
    const result = this.sqlite
      .prepare(
        `INSERT INTO p2_adaptation_events (
           session_id, scenario_id, step_id, adaptation_type, previous_value,
           new_value, reason, confidence, outcome, metadata, timestamp
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.sessionId ?? null,
        input.scenarioId,
        input.stepId ?? null,
        input.type,
        input.previousValue === undefined ? null : JSON.stringify(input.previousValue),
        input.newValue === undefined ? null : JSON.stringify(input.newValue),
        input.reason,
        input.confidence,
        input.outcome ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        timestamp,
      )

    if (input.sessionId) {
      this.addEvent(input.sessionId, 'adaptation_decision', {
        type: input.type,
        stepId: input.stepId,
        previousValue: input.previousValue,
        newValue: input.newValue,
        reason: input.reason,
        confidence: input.confidence,
        outcome: input.outcome,
      })
    }

    return { ...input, id: Number(result.lastInsertRowid), timestamp }
  }

  listAdaptationEvents(filter: { scenarioId?: string; stepId?: string; limit?: number } = {}): AdaptationEvent[] {
    const where: string[] = []
    const params: unknown[] = []
    if (filter.scenarioId) {
      where.push('scenario_id = ?')
      params.push(filter.scenarioId)
    }
    if (filter.stepId) {
      where.push('step_id = ?')
      params.push(filter.stepId)
    }

    const limit = Math.max(1, Math.min(filter.limit ?? 50, 500))
    const rows = this.sqlite
      .prepare(
        `SELECT id, session_id, scenario_id, step_id, adaptation_type, previous_value,
                new_value, reason, confidence, outcome, metadata, timestamp
         FROM p2_adaptation_events
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY timestamp DESC, id DESC
         LIMIT ?`,
      )
      .all(...params, limit) as AdaptationEventRow[]

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id ?? undefined,
      scenarioId: row.scenario_id,
      stepId: row.step_id ?? undefined,
      type: row.adaptation_type,
      previousValue: row.previous_value ? JSON.parse(row.previous_value) : undefined,
      newValue: row.new_value ? JSON.parse(row.new_value) : undefined,
      reason: row.reason,
      confidence: row.confidence,
      outcome: row.outcome ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      timestamp: row.timestamp,
    }))
  }

  createLearningProposal(input: LearningProposalInput): LearningProposal {
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    this.sqlite
      .prepare(
        `INSERT INTO p2_learning_proposals (
           proposal_id, recommendation_id, scenario_id, step_id, agent_id, proposal_type,
           severity, status, recommendation, patch_kind, target, patch_content, metadata, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(recommendation_id)
         DO UPDATE SET
           recommendation = excluded.recommendation,
           metadata = excluded.metadata`,
      )
      .run(
        id,
        input.recommendationId,
        input.scenarioId,
        input.stepId,
        input.agentId ?? null,
        input.type,
        input.severity,
        JSON.stringify(input.recommendation),
        input.patchKind,
        input.target ?? null,
        input.patchContent ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        createdAt,
      )

    return this.getLearningProposalByRecommendationId(input.recommendationId)!
  }

  getLearningProposal(id: string): LearningProposal | undefined {
    const row = this.sqlite
      .prepare(
        `SELECT proposal_id, recommendation_id, scenario_id, step_id, agent_id, proposal_type,
                severity, status, recommendation, patch_kind, target, patch_content, metadata,
                created_at, approved_at, applied_at, rejected_at
         FROM p2_learning_proposals
         WHERE proposal_id = ?`,
      )
      .get(id) as LearningProposalRow | undefined

    return row ? this.mapLearningProposal(row) : undefined
  }

  getLearningProposalByRecommendationId(recommendationId: string): LearningProposal | undefined {
    const row = this.sqlite
      .prepare(
        `SELECT proposal_id, recommendation_id, scenario_id, step_id, agent_id, proposal_type,
                severity, status, recommendation, patch_kind, target, patch_content, metadata,
                created_at, approved_at, applied_at, rejected_at
         FROM p2_learning_proposals
         WHERE recommendation_id = ?`,
      )
      .get(recommendationId) as LearningProposalRow | undefined

    return row ? this.mapLearningProposal(row) : undefined
  }

  listLearningProposals(filter: {
    scenarioId?: string
    status?: LearningProposalStatus
    limit?: number
  } = {}): LearningProposal[] {
    const where: string[] = []
    const params: unknown[] = []
    if (filter.scenarioId) {
      where.push('scenario_id = ?')
      params.push(filter.scenarioId)
    }
    if (filter.status) {
      where.push('status = ?')
      params.push(filter.status)
    }

    const limit = Math.max(1, Math.min(filter.limit ?? 100, 500))
    const rows = this.sqlite
      .prepare(
        `SELECT proposal_id, recommendation_id, scenario_id, step_id, agent_id, proposal_type,
                severity, status, recommendation, patch_kind, target, patch_content, metadata,
                created_at, approved_at, applied_at, rejected_at
         FROM p2_learning_proposals
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(...params, limit) as LearningProposalRow[]

    return rows.map((row) => this.mapLearningProposal(row))
  }

  updateLearningProposalStatus(id: string, status: LearningProposalStatus): LearningProposal | undefined {
    const timestampColumn = status === 'approved'
      ? 'approved_at'
      : status === 'applied'
        ? 'applied_at'
        : status === 'rejected'
          ? 'rejected_at'
          : null
    const timestamp = new Date().toISOString()

    if (timestampColumn) {
      this.sqlite
        .prepare(`UPDATE p2_learning_proposals SET status = ?, ${timestampColumn} = ? WHERE proposal_id = ?`)
        .run(status, timestamp, id)
    } else {
      this.sqlite
        .prepare(`UPDATE p2_learning_proposals SET status = ? WHERE proposal_id = ?`)
        .run(status, id)
    }

    return this.getLearningProposal(id)
  }

  listAppliedPromptOverlays(agentId: string): LearningProposal[] {
    const rows = this.sqlite
      .prepare(
        `SELECT proposal_id, recommendation_id, scenario_id, step_id, agent_id, proposal_type,
                severity, status, recommendation, patch_kind, target, patch_content, metadata,
                created_at, approved_at, applied_at, rejected_at
         FROM p2_learning_proposals
         WHERE status = 'applied'
           AND patch_kind = 'prompt_overlay'
           AND (agent_id = ? OR target = 'agent:*')
         ORDER BY applied_at ASC, created_at ASC`,
      )
      .all(agentId) as LearningProposalRow[]

    return rows.map((row) => this.mapLearningProposal(row))
  }

  listRuntimeLearningOverlays(filter: {
    scenarioId?: string
    stepId?: string
    agentId: string
    limit?: number
  }): RuntimeLearningOverlay[] {
    const where = [
      `m.subject_type = 'learning_proposal'`,
      `m.kind = 'learning_prompt_overlay'`,
      `m.status = 'active'`,
      `p.status = 'applied'`,
      `p.patch_kind = 'prompt_overlay'`,
      `p.patch_content IS NOT NULL`,
      `(p.agent_id = ? OR p.target = ? OR p.target = 'agent:*')`,
    ]
    const params: unknown[] = [filter.agentId, `agent:${filter.agentId}`]

    if (filter.scenarioId) {
      where.push('p.scenario_id = ?')
      params.push(filter.scenarioId)
    }
    if (filter.stepId) {
      where.push('p.step_id = ?')
      params.push(filter.stepId)
    }

    const limit = Math.max(1, Math.min(filter.limit ?? 5, 25))
    const rows = this.sqlite
      .prepare(
        `SELECT p.proposal_id, p.scenario_id, p.step_id, p.agent_id, p.target,
                p.patch_content, m.materialization_id, m.file_path, m.checksum,
                m.metadata, m.created_at
         FROM p2_l5_materializations m
         INNER JOIN p2_learning_proposals p ON p.proposal_id = m.subject_id
         WHERE ${where.join(' AND ')}
         ORDER BY m.created_at DESC
         LIMIT ?`,
      )
      .all(...params, limit) as RuntimeLearningOverlayRow[]

    return rows
      .filter((row) => this.hasVerifiedRuntimeLearningMetadata(row.metadata))
      .reverse()
      .map((row) => ({
        proposalId: row.proposal_id,
        materializationId: row.materialization_id,
        scenarioId: row.scenario_id,
        stepId: row.step_id,
        agentId: row.agent_id ?? undefined,
        target: row.target ?? undefined,
        patchContent: row.patch_content,
        checksum: row.checksum,
        filePath: row.file_path,
        createdAt: row.created_at,
      }))
  }

  createScenarioDraft(input: ScenarioDraftInput): ScenarioDraft {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.sqlite
      .prepare(
        `INSERT INTO p2_scenario_drafts (
           draft_id, scenario_id, name, description, contract_json, gap_type,
           gap_evidence, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
         ON CONFLICT(scenario_id)
         DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           contract_json = excluded.contract_json,
           gap_type = excluded.gap_type,
           gap_evidence = excluded.gap_evidence,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        input.scenarioId,
        input.name,
        input.description ?? null,
        JSON.stringify(input.contract),
        input.gapType,
        input.gapEvidence ? JSON.stringify(input.gapEvidence) : null,
        now,
        now,
      )

    return this.getScenarioDraftByScenarioId(input.scenarioId)!
  }

  listScenarioDrafts(filter: { status?: ScenarioDraftStatus; limit?: number } = {}): ScenarioDraft[] {
    const where: string[] = []
    const params: unknown[] = []
    if (filter.status) {
      where.push('status = ?')
      params.push(filter.status)
    }

    const limit = Math.max(1, Math.min(filter.limit ?? 100, 500))
    const rows = this.sqlite
      .prepare(
        `SELECT draft_id, scenario_id, name, description, contract_json, gap_type,
                gap_evidence, status, reviewed_by, reviewed_at, created_at, updated_at
         FROM p2_scenario_drafts
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(...params, limit) as ScenarioDraftRow[]

    return rows.map((row) => this.mapScenarioDraft(row))
  }

  updateScenarioDraftStatus(id: string, status: ScenarioDraftStatus, reviewedBy?: string): ScenarioDraft | undefined {
    const now = new Date().toISOString()
    this.sqlite
      .prepare(
        `UPDATE p2_scenario_drafts
         SET status = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
         WHERE draft_id = ?`,
      )
      .run(status, reviewedBy ?? null, now, now, id)

    return this.getScenarioDraft(id)
  }

  getScenarioDraft(id: string): ScenarioDraft | undefined {
    const row = this.sqlite
      .prepare(
        `SELECT draft_id, scenario_id, name, description, contract_json, gap_type,
                gap_evidence, status, reviewed_by, reviewed_at, created_at, updated_at
         FROM p2_scenario_drafts
         WHERE draft_id = ?`,
      )
      .get(id) as ScenarioDraftRow | undefined

    return row ? this.mapScenarioDraft(row) : undefined
  }

  private getScenarioDraftByScenarioId(scenarioId: string): ScenarioDraft | undefined {
    const row = this.sqlite
      .prepare(
        `SELECT draft_id, scenario_id, name, description, contract_json, gap_type,
                gap_evidence, status, reviewed_by, reviewed_at, created_at, updated_at
         FROM p2_scenario_drafts
         WHERE scenario_id = ?`,
      )
      .get(scenarioId) as ScenarioDraftRow | undefined

    return row ? this.mapScenarioDraft(row) : undefined
  }

  recordHealingAction(input: HealingActionInput): HealingAction {
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    this.sqlite
      .prepare(
        `INSERT INTO p2_healing_actions (
           action_id, action_type, target, reason, automatic, status, metadata, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.type,
        input.target,
        input.reason,
        input.automatic ? 1 : 0,
        input.status,
        input.metadata ? JSON.stringify(input.metadata) : null,
        createdAt,
      )

    return { ...input, id, createdAt }
  }

  updateHealingActionStatus(
    id: string,
    status: HealingActionStatus,
    metadata?: Record<string, unknown>,
  ): HealingAction | undefined {
    if (metadata) {
      this.sqlite
        .prepare(
          `UPDATE p2_healing_actions
           SET status = ?, metadata = ?
           WHERE action_id = ?`,
        )
        .run(status, JSON.stringify(metadata), id)
    } else {
      this.sqlite
        .prepare(
          `UPDATE p2_healing_actions
           SET status = ?
           WHERE action_id = ?`,
        )
        .run(status, id)
    }

    return this.getHealingAction(id)
  }

  getHealingAction(id: string): HealingAction | undefined {
    const row = this.sqlite
      .prepare(
        `SELECT action_id, action_type, target, reason, automatic, status, metadata, created_at
         FROM p2_healing_actions
         WHERE action_id = ?`,
      )
      .get(id) as HealingActionRow | undefined

    return row ? this.mapHealingAction(row) : undefined
  }

  listHealingActions(filter: { limit?: number } = {}): HealingAction[] {
    const limit = Math.max(1, Math.min(filter.limit ?? 100, 500))
    const rows = this.sqlite
      .prepare(
        `SELECT action_id, action_type, target, reason, automatic, status, metadata, created_at
         FROM p2_healing_actions
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit) as HealingActionRow[]

    return rows.map((row) => this.mapHealingAction(row))
  }

  countAutomaticHealingActionsSince(isoTimestamp: string): number {
    const row = this.sqlite
      .prepare(
        `SELECT COUNT(*) AS total
         FROM p2_healing_actions
         WHERE automatic = 1
           AND status = 'applied'
           AND created_at >= ?`,
      )
      .get(isoTimestamp) as { total: number }

    return row.total
  }

  recordGovernanceDecision(input: GovernanceDecisionInput): GovernanceDecision {
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    this.sqlite
      .prepare(
        `INSERT INTO p2_governance_decisions (
           decision_id, subject_type, subject_id, action, verdict, reason,
           actor, requirements, metadata, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.subjectType,
        input.subjectId,
        input.action,
        input.verdict,
        input.reason,
        input.actor ?? null,
        input.requirements ? JSON.stringify(input.requirements) : null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        createdAt,
      )

    return { ...input, id, createdAt }
  }

  listGovernanceDecisions(filter: {
    subjectType?: GovernanceSubjectType
    subjectId?: string
    limit?: number
  } = {}): GovernanceDecision[] {
    const where: string[] = []
    const params: unknown[] = []
    if (filter.subjectType) {
      where.push('subject_type = ?')
      params.push(filter.subjectType)
    }
    if (filter.subjectId) {
      where.push('subject_id = ?')
      params.push(filter.subjectId)
    }

    const limit = Math.max(1, Math.min(filter.limit ?? 100, 500))
    const rows = this.sqlite
      .prepare(
        `SELECT decision_id, subject_type, subject_id, action, verdict, reason,
                actor, requirements, metadata, created_at
         FROM p2_governance_decisions
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(...params, limit) as GovernanceDecisionRow[]

    return rows.map((row) => this.mapGovernanceDecision(row))
  }

  recordKnowledgePromotionEvent(input: KnowledgePromotionEventInput): KnowledgePromotionEvent {
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    this.sqlite
      .prepare(
        `INSERT INTO p2_knowledge_promotion_events (
           event_id, source_run_id, candidate_id, candidate_version, subject_type,
           subject_id, promotion_type, action, status, actor, reason, target,
           result_json, metadata, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sourceRunId,
        input.candidateId,
        input.candidateVersion,
        input.subjectType,
        input.subjectId,
        input.promotionType,
        input.action,
        input.status,
        input.actor ?? null,
        input.reason ?? null,
        input.target ?? null,
        input.result ? JSON.stringify(input.result) : null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        createdAt,
      )

    return { ...input, id, createdAt }
  }

  listKnowledgePromotionEvents(filter: {
    sourceRunId?: string
    subjectType?: GovernanceSubjectType
    subjectId?: string
    limit?: number
  } = {}): KnowledgePromotionEvent[] {
    const where: string[] = []
    const params: unknown[] = []
    if (filter.sourceRunId) {
      where.push('source_run_id = ?')
      params.push(filter.sourceRunId)
    }
    if (filter.subjectType) {
      where.push('subject_type = ?')
      params.push(filter.subjectType)
    }
    if (filter.subjectId) {
      where.push('subject_id = ?')
      params.push(filter.subjectId)
    }

    const limit = Math.max(1, Math.min(filter.limit ?? 100, 500))
    const rows = this.sqlite
      .prepare(
        `SELECT event_id, source_run_id, candidate_id, candidate_version,
                subject_type, subject_id, promotion_type, action, status, actor,
                reason, target, result_json, metadata, created_at
         FROM p2_knowledge_promotion_events
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(...params, limit) as KnowledgePromotionEventRow[]

    return rows.map((row) => this.mapKnowledgePromotionEvent(row))
  }

  recordL5Materialization(input: L5MaterializationInput): L5Materialization {
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    this.sqlite
      .prepare(
        `INSERT INTO p2_l5_materializations (
           materialization_id, subject_type, subject_id, kind, status,
           file_path, checksum, metadata, created_at, rolled_back_at
         ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, NULL)`,
      )
      .run(
        id,
        input.subjectType,
        input.subjectId,
        input.kind,
        input.filePath,
        input.checksum,
        input.metadata ? JSON.stringify(input.metadata) : null,
        createdAt,
      )

    return {
      ...input,
      id,
      status: 'active',
      createdAt,
    }
  }

  listL5Materializations(filter: {
    subjectType?: L5MaterializationSubjectType
    subjectId?: string
    status?: L5MaterializationStatus
    limit?: number
  } = {}): L5Materialization[] {
    const where: string[] = []
    const params: unknown[] = []
    if (filter.subjectType) {
      where.push('subject_type = ?')
      params.push(filter.subjectType)
    }
    if (filter.subjectId) {
      where.push('subject_id = ?')
      params.push(filter.subjectId)
    }
    if (filter.status) {
      where.push('status = ?')
      params.push(filter.status)
    }

    const limit = Math.max(1, Math.min(filter.limit ?? 100, 500))
    const rows = this.sqlite
      .prepare(
        `SELECT materialization_id, subject_type, subject_id, kind, status,
                file_path, checksum, metadata, created_at, rolled_back_at
         FROM p2_l5_materializations
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(...params, limit) as L5MaterializationRow[]

    return rows.map((row) => this.mapL5Materialization(row))
  }

  markL5MaterializationRolledBack(id: string): L5Materialization | undefined {
    const timestamp = new Date().toISOString()
    this.sqlite
      .prepare(
        `UPDATE p2_l5_materializations
         SET status = 'rolled_back', rolled_back_at = ?
         WHERE materialization_id = ?`,
      )
      .run(timestamp, id)

    const row = this.sqlite
      .prepare(
        `SELECT materialization_id, subject_type, subject_id, kind, status,
                file_path, checksum, metadata, created_at, rolled_back_at
         FROM p2_l5_materializations
         WHERE materialization_id = ?`,
      )
      .get(id) as L5MaterializationRow | undefined

    return row ? this.mapL5Materialization(row) : undefined
  }

  recordL5ClosedLoopRun(input: L5ClosedLoopRunInput): L5ClosedLoopRun {
    const id = randomUUID()
    const startedAt = input.startedAt ?? new Date().toISOString()
    const completedAt = input.completedAt ?? new Date().toISOString()

    this.sqlite
      .prepare(
        `INSERT INTO p2_l5_closed_loop_runs (
           loop_id, status, mode, scenario_id, queued_scenarios, actions_json,
           verification_json, summary_json, metadata, started_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.status,
        input.mode,
        input.scenarioId ?? null,
        JSON.stringify(input.queuedScenarios),
        JSON.stringify(input.actions),
        JSON.stringify(input.verification),
        JSON.stringify(input.summary),
        input.metadata ? JSON.stringify(input.metadata) : null,
        startedAt,
        completedAt,
      )

    return {
      ...input,
      id,
      startedAt,
      completedAt,
    }
  }

  getL5ClosedLoopRun(id: string): L5ClosedLoopRun | undefined {
    const row = this.sqlite
      .prepare(
        `SELECT loop_id, status, mode, scenario_id, queued_scenarios, actions_json,
                verification_json, summary_json, metadata, started_at, completed_at
         FROM p2_l5_closed_loop_runs
         WHERE loop_id = ?`,
      )
      .get(id) as L5ClosedLoopRunRow | undefined

    return row ? this.mapL5ClosedLoopRun(row) : undefined
  }

  listL5ClosedLoopRuns(filter: {
    scenarioId?: string
    status?: L5ClosedLoopStatus
    limit?: number
  } = {}): L5ClosedLoopRun[] {
    const where: string[] = []
    const params: unknown[] = []
    if (filter.scenarioId) {
      where.push('scenario_id = ?')
      params.push(filter.scenarioId)
    }
    if (filter.status) {
      where.push('status = ?')
      params.push(filter.status)
    }

    const limit = Math.max(1, Math.min(filter.limit ?? 25, 100))
    const rows = this.sqlite
      .prepare(
        `SELECT loop_id, status, mode, scenario_id, queued_scenarios, actions_json,
                verification_json, summary_json, metadata, started_at, completed_at
         FROM p2_l5_closed_loop_runs
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY completed_at DESC
         LIMIT ?`,
      )
      .all(...params, limit) as L5ClosedLoopRunRow[]

    return rows.map((row) => this.mapL5ClosedLoopRun(row))
  }

  recordL5IndependentAuditReview(input: L5IndependentAuditReviewInput): L5IndependentAuditReview {
    const id = randomUUID()
    const createdAt = new Date().toISOString()

    this.sqlite
      .prepare(
        `INSERT INTO p2_l5_independent_audit_reviews (
           review_id, run_id, status, actor, reason, metadata, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.runId,
        input.status,
        input.actor ?? null,
        input.reason ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        createdAt,
      )

    return { ...input, id, createdAt }
  }

  listL5IndependentAuditReviews(filter: {
    runId?: string
    limit?: number
  } = {}): L5IndependentAuditReview[] {
    const where: string[] = []
    const params: unknown[] = []
    if (filter.runId) {
      where.push('run_id = ?')
      params.push(filter.runId)
    }

    const limit = Math.max(1, Math.min(filter.limit ?? 100, 500))
    const rows = this.sqlite
      .prepare(
        `SELECT review_id, run_id, status, actor, reason, metadata, created_at
         FROM p2_l5_independent_audit_reviews
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(...params, limit) as L5IndependentAuditReviewRow[]

    return rows.map((row) => this.mapL5IndependentAuditReview(row))
  }

  private mapLearningProposal(row: LearningProposalRow): LearningProposal {
    return {
      id: row.proposal_id,
      recommendationId: row.recommendation_id,
      scenarioId: row.scenario_id,
      stepId: row.step_id,
      agentId: row.agent_id ?? undefined,
      type: row.proposal_type,
      severity: row.severity,
      status: row.status,
      recommendation: JSON.parse(row.recommendation),
      patchKind: row.patch_kind,
      target: row.target ?? undefined,
      patchContent: row.patch_content ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
      approvedAt: row.approved_at ?? undefined,
      appliedAt: row.applied_at ?? undefined,
      rejectedAt: row.rejected_at ?? undefined,
    }
  }

  private mapScenarioDraft(row: ScenarioDraftRow): ScenarioDraft {
    return {
      id: row.draft_id,
      scenarioId: row.scenario_id,
      name: row.name,
      description: row.description ?? undefined,
      contract: JSON.parse(row.contract_json),
      gapType: row.gap_type,
      gapEvidence: row.gap_evidence ? JSON.parse(row.gap_evidence) : undefined,
      status: row.status,
      reviewedBy: row.reviewed_by ?? undefined,
      reviewedAt: row.reviewed_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private mapHealingAction(row: HealingActionRow): HealingAction {
    return {
      id: row.action_id,
      type: row.action_type,
      target: row.target,
      reason: row.reason,
      automatic: row.automatic === 1,
      status: row.status,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
    }
  }

  private mapGovernanceDecision(row: GovernanceDecisionRow): GovernanceDecision {
    return {
      id: row.decision_id,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      action: row.action,
      verdict: row.verdict,
      reason: row.reason,
      actor: row.actor ?? undefined,
      requirements: row.requirements ? JSON.parse(row.requirements) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
    }
  }

  private mapL5Materialization(row: L5MaterializationRow): L5Materialization {
    return {
      id: row.materialization_id,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      kind: row.kind,
      status: row.status,
      filePath: row.file_path,
      checksum: row.checksum,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
      rolledBackAt: row.rolled_back_at ?? undefined,
    }
  }

  private hasVerifiedRuntimeLearningMetadata(metadataJson: string | null): boolean {
    if (!metadataJson) return false

    try {
      const metadata = JSON.parse(metadataJson) as {
        independentAudit?: { verdict?: unknown }
        postWriteVerification?: { checksumMatches?: unknown }
      }
      return metadata.independentAudit?.verdict === 'passed'
        && metadata.postWriteVerification?.checksumMatches === true
    } catch {
      return false
    }
  }

  private mapL5ClosedLoopRun(row: L5ClosedLoopRunRow): L5ClosedLoopRun {
    return {
      id: row.loop_id,
      status: row.status,
      mode: row.mode,
      scenarioId: row.scenario_id ?? undefined,
      queuedScenarios: JSON.parse(row.queued_scenarios),
      actions: JSON.parse(row.actions_json),
      verification: JSON.parse(row.verification_json),
      summary: JSON.parse(row.summary_json),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    }
  }

  private mapL5IndependentAuditReview(row: L5IndependentAuditReviewRow): L5IndependentAuditReview {
    return {
      id: row.review_id,
      runId: row.run_id,
      status: row.status,
      actor: row.actor ?? undefined,
      reason: row.reason ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
    }
  }

  private mapKnowledgePromotionEvent(row: KnowledgePromotionEventRow): KnowledgePromotionEvent {
    return {
      id: row.event_id,
      sourceRunId: row.source_run_id,
      candidateId: row.candidate_id,
      candidateVersion: row.candidate_version,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      promotionType: row.promotion_type,
      action: row.action,
      status: row.status,
      actor: row.actor ?? undefined,
      reason: row.reason ?? undefined,
      target: row.target ?? undefined,
      result: row.result_json ? JSON.parse(row.result_json) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
    }
  }

  storeFinding(
    sessionId: string,
    finding: Omit<SessionFinding, 'id' | 'sessionId' | 'timestamp' | 'createdAt'>,
  ): SessionFinding {
    this.ensureSession(sessionId)
    const timestamp = new Date().toISOString()
    const id = this.insertFindingRow(sessionId, {
      severity: finding.severity,
      title: finding.title,
      description: finding.description ?? null,
      evidence: finding.evidence ?? null,
      agentId: finding.agentId ?? finding.agentRole ?? null,
      stepId: finding.stepId ?? null,
      createdAt: timestamp,
    })

    return {
      id: String(id),
      sessionId,
      ...finding,
      timestamp,
      createdAt: timestamp,
    }
  }

  saveCheckpoint(sessionId: string, lastCompletedStep: number): void {
    const session = this.getSession(sessionId)
    if (!session) return

    const checkpointId = randomUUID()
    const now = new Date().toISOString()
    const cursor = session.events.length

    this.sqlite
      .prepare(
        `INSERT INTO p2_session_checkpoints (checkpoint_id, session_id, created_at, last_completed_step, cursor)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(checkpointId, sessionId, now, lastCompletedStep, cursor)

    this.addEvent(sessionId, 'checkpoint_saved', { lastCompletedStep, cursor })
  }

  private insertFindingRow(
    sessionId: string,
    finding: {
      severity: unknown
      title: unknown
      description: unknown
      evidence: unknown
      agentId: unknown
      stepId: unknown
      createdAt: string
    },
  ): number {
    const result = this.sqlite
      .prepare(
        `INSERT INTO p2_session_findings (
           session_id, severity, title, description, evidence, agent_id, step_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        typeof finding.severity === 'string' ? finding.severity : 'info',
        typeof finding.title === 'string' ? finding.title : 'Untitled',
        typeof finding.description === 'string' ? finding.description : null,
        finding.evidence ? JSON.stringify(finding.evidence) : null,
        typeof finding.agentId === 'string' ? finding.agentId : null,
        typeof finding.stepId === 'string' ? finding.stepId : null,
        finding.createdAt,
      )

    return Number(result.lastInsertRowid)
  }

  private ensureTables(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS p2_sessions (
        session_id TEXT PRIMARY KEY,
        run_id INTEGER,
        scenario_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS p2_session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES p2_sessions(session_id),
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        agent_role TEXT,
        data TEXT,
        UNIQUE(session_id, sequence)
      );

      CREATE TABLE IF NOT EXISTS p2_session_checkpoints (
        checkpoint_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES p2_sessions(session_id),
        created_at TEXT NOT NULL,
        last_completed_step INTEGER NOT NULL,
        cursor INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS p2_session_artifacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES p2_sessions(session_id),
        artifact_key TEXT NOT NULL,
        artifact_type TEXT,
        agent_role TEXT,
        description TEXT,
        file_path TEXT,
        content TEXT,
        metadata TEXT,
        payload TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(session_id, artifact_key)
      );

      CREATE TABLE IF NOT EXISTS p2_session_findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES p2_sessions(session_id),
        severity TEXT,
        title TEXT,
        description TEXT,
        evidence TEXT,
        agent_id TEXT,
        step_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS p2_step_performance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES p2_sessions(session_id),
        scenario_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        status TEXT NOT NULL,
        success INTEGER NOT NULL,
        attempt INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        error_category TEXT,
        error_message TEXT,
        started_at TEXT,
        completed_at TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS p2_adaptation_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT REFERENCES p2_sessions(session_id),
        scenario_id TEXT NOT NULL,
        step_id TEXT,
        adaptation_type TEXT NOT NULL,
        previous_value TEXT,
        new_value TEXT,
        reason TEXT NOT NULL,
        confidence REAL NOT NULL,
        outcome TEXT,
        metadata TEXT,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS p2_learning_proposals (
        proposal_id TEXT PRIMARY KEY,
        recommendation_id TEXT NOT NULL UNIQUE,
        scenario_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        agent_id TEXT,
        proposal_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT NOT NULL,
        recommendation TEXT NOT NULL,
        patch_kind TEXT NOT NULL,
        target TEXT,
        patch_content TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL,
        approved_at TEXT,
        applied_at TEXT,
        rejected_at TEXT
      );

      CREATE TABLE IF NOT EXISTS p2_scenario_drafts (
        draft_id TEXT PRIMARY KEY,
        scenario_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        contract_json TEXT NOT NULL,
        gap_type TEXT NOT NULL,
        gap_evidence TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by TEXT,
        reviewed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS p2_healing_actions (
        action_id TEXT PRIMARY KEY,
        action_type TEXT NOT NULL,
        target TEXT NOT NULL,
        reason TEXT NOT NULL,
        automatic INTEGER NOT NULL,
        status TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS p2_governance_decisions (
        decision_id TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        action TEXT NOT NULL,
        verdict TEXT NOT NULL,
        reason TEXT NOT NULL,
        actor TEXT,
        requirements TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS p2_l5_materializations (
        materialization_id TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        file_path TEXT NOT NULL,
        checksum TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL,
        rolled_back_at TEXT,
        UNIQUE(subject_type, subject_id, kind, file_path)
      );

      CREATE TABLE IF NOT EXISTS p2_l5_closed_loop_runs (
        loop_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        scenario_id TEXT,
        queued_scenarios TEXT NOT NULL,
        actions_json TEXT NOT NULL,
        verification_json TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        metadata TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS p2_l5_independent_audit_reviews (
        review_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        status TEXT NOT NULL,
        actor TEXT,
        reason TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS p2_knowledge_promotion_events (
        event_id TEXT PRIMARY KEY,
        source_run_id TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        candidate_version TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        promotion_type TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        actor TEXT,
        reason TEXT,
        target TEXT,
        result_json TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS p2_tool_ledger_closures (
        session_id TEXT NOT NULL REFERENCES p2_sessions(session_id),
        tool_call_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        reason TEXT NOT NULL,
        closed_at TEXT NOT NULL,
        original_started_at TEXT NOT NULL,
        PRIMARY KEY(session_id, tool_call_id)
      );

      CREATE INDEX IF NOT EXISTS idx_p2_sessions_scenario ON p2_sessions(scenario_id);
      CREATE INDEX IF NOT EXISTS idx_p2_events_session_sequence ON p2_session_events(session_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_p2_findings_session_created ON p2_session_findings(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_p2_step_perf_step ON p2_step_performance(scenario_id, step_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_p2_adaptations_step ON p2_adaptation_events(scenario_id, step_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_p2_learning_proposals_status ON p2_learning_proposals(status, scenario_id);
      CREATE INDEX IF NOT EXISTS idx_p2_scenario_drafts_status ON p2_scenario_drafts(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_p2_healing_actions_created ON p2_healing_actions(created_at);
      CREATE INDEX IF NOT EXISTS idx_p2_governance_subject ON p2_governance_decisions(subject_type, subject_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_p2_l5_materializations_subject ON p2_l5_materializations(subject_type, subject_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_p2_l5_closed_loop_status ON p2_l5_closed_loop_runs(status, scenario_id, completed_at);
      CREATE INDEX IF NOT EXISTS idx_p2_l5_independent_audit_reviews_run ON p2_l5_independent_audit_reviews(run_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_p2_knowledge_promotion_events_run ON p2_knowledge_promotion_events(source_run_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_p2_knowledge_promotion_events_subject ON p2_knowledge_promotion_events(subject_type, subject_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_p2_tool_ledger_closures_session ON p2_tool_ledger_closures(session_id, closed_at);
    `)
  }
}

export function createSessionServiceStub(): SessionService {
  return new SessionService(':memory:')
}

import { createHash } from 'node:crypto'
import { L5LoopGuardService } from './l5-loop-guard-service.js'
import type {
  GovernanceDecision,
  GovernanceSubjectType,
  HealingAction,
  L5ClosedLoopRun,
  L5Materialization,
  LearningProposal,
  ScenarioDraft,
  SessionService,
} from './session-service.js'

export interface L5AuditBundleReplayPlan {
  endpoint: '/api/p2/closed-loop/run'
  method: 'POST'
  safeReplayPayload: {
    scenarioId?: string
    maxScenarios: number
    applyApprovedChanges: false
    generateScenarioDrafts: false
  }
  originalIntent: {
    mode: L5ClosedLoopRun['mode']
    scenarioId?: string
    maxScenarios: number
    applyApprovedChanges: boolean
    generateScenarioDrafts: boolean
  }
  notes: string[]
}

export type L5KnowledgePromotionType = 'learning_overlay' | 'scenario_contract' | 'healing_policy'
export type L5KnowledgePromotionStatus = 'requires_review' | 'approved' | 'materialized' | 'blocked' | 'rejected'
export type L5KnowledgePromotionNextAction = 'approve' | 'apply' | 'promote' | 'review' | 'none'

export interface L5KnowledgePromotionCandidate {
  id: string
  sourceRunId: string
  subjectType: GovernanceSubjectType
  subjectId: string
  promotionType: L5KnowledgePromotionType
  status: L5KnowledgePromotionStatus
  version: string
  title: string
  target: string
  reason: string
  approvalRequired: boolean
  materializationReady: boolean
  nextAction: L5KnowledgePromotionNextAction
  evidence: Record<string, unknown>
}

export interface L5AuditBundlePromotionPlan {
  candidates: L5KnowledgePromotionCandidate[]
  notes: string[]
}

export interface L5AuditBundle {
  schemaVersion: 'persona-qa.l5.audit-bundle.v1'
  generatedAt: string
  run: L5ClosedLoopRun
  lifecycle: unknown[]
  guards: ReturnType<L5LoopGuardService['summarize']>
  snapshots: {
    before: Record<string, unknown>
    after: Record<string, unknown>
  }
  related: {
    learningProposals: LearningProposal[]
    healingActions: HealingAction[]
    scenarioDrafts: ScenarioDraft[]
    materializations: L5Materialization[]
    governanceDecisions: GovernanceDecision[]
  }
  replay: L5AuditBundleReplayPlan
  promotion: L5AuditBundlePromotionPlan
  integrity: {
    checksum: string
    counts: {
      lifecycleEvents: number
      actions: number
      learningProposals: number
      healingActions: number
      scenarioDrafts: number
      materializations: number
      governanceDecisions: number
      promotionCandidates: number
    }
  }
}

type SubjectRef = {
  subjectType: GovernanceSubjectType
  subjectId: string
}

export class L5AuditBundleService {
  constructor(private readonly sessionService: SessionService) {}

  build(runId: string): L5AuditBundle | undefined {
    const run = this.sessionService.getL5ClosedLoopRun(runId)
    if (!run) return undefined

    const refs = collectSubjectRefs(run.actions)
    const materializationIds = collectStringValues(run.actions, 'materializationId')
    const lifecycle = arrayValue(run.metadata?.['lifecycle'])
    const before = recordValue(run.metadata?.['before'])
    const after = recordValue(run.metadata?.['after'])
    const learningProposals = this.collectLearningProposals(refs)
    const healingActions = this.collectHealingActions(refs)
    const scenarioDrafts = this.collectScenarioDrafts(refs)
    const materializations = this.collectMaterializations(refs, materializationIds)
    const governanceDecisions = this.collectGovernanceDecisions(refs, run)

    const bundleWithoutChecksum = {
      schemaVersion: 'persona-qa.l5.audit-bundle.v1' as const,
      generatedAt: new Date().toISOString(),
      run,
      lifecycle,
      guards: new L5LoopGuardService(this.sessionService).summarize(),
      snapshots: {
        before,
        after,
      },
      related: {
        learningProposals,
        healingActions,
        scenarioDrafts,
        materializations,
        governanceDecisions,
      },
      replay: buildReplayPlan(run),
      promotion: buildPromotionPlan(run, {
        learningProposals,
        healingActions,
        scenarioDrafts,
        materializations,
        governanceDecisions,
      }),
    }

    return {
      ...bundleWithoutChecksum,
      integrity: {
        checksum: checksum(bundleWithoutChecksum),
        counts: {
          lifecycleEvents: lifecycle.length,
          actions: run.actions.length,
          learningProposals: learningProposals.length,
          healingActions: healingActions.length,
          scenarioDrafts: scenarioDrafts.length,
          materializations: materializations.length,
          governanceDecisions: governanceDecisions.length,
          promotionCandidates: bundleWithoutChecksum.promotion.candidates.length,
        },
      },
    }
  }

  private collectLearningProposals(refs: SubjectRef[]): LearningProposal[] {
    return refs
      .filter((ref) => ref.subjectType === 'learning_proposal')
      .map((ref) => this.sessionService.getLearningProposal(ref.subjectId))
      .filter((proposal): proposal is LearningProposal => Boolean(proposal))
  }

  private collectHealingActions(refs: SubjectRef[]): HealingAction[] {
    return refs
      .filter((ref) => ref.subjectType === 'healing_action')
      .map((ref) => this.sessionService.getHealingAction(ref.subjectId))
      .filter((action): action is HealingAction => Boolean(action))
  }

  private collectScenarioDrafts(refs: SubjectRef[]): ScenarioDraft[] {
    return refs
      .filter((ref) => ref.subjectType === 'scenario_draft')
      .map((ref) => this.sessionService.getScenarioDraft(ref.subjectId))
      .filter((draft): draft is ScenarioDraft => Boolean(draft))
  }

  private collectMaterializations(refs: SubjectRef[], materializationIds: Set<string>): L5Materialization[] {
    const materializations = this.sessionService.listL5Materializations({ limit: 500 })
    return materializations.filter((materialization) => {
      if (materializationIds.has(materialization.id)) return true
      return refs.some((ref) => (
        ref.subjectType === materialization.subjectType
        && ref.subjectId === materialization.subjectId
      ))
    })
  }

  private collectGovernanceDecisions(refs: SubjectRef[], run: L5ClosedLoopRun): GovernanceDecision[] {
    const byId = new Map<string, GovernanceDecision>()

    for (const ref of refs) {
      for (const decision of this.sessionService.listGovernanceDecisions({
        subjectType: ref.subjectType,
        subjectId: ref.subjectId,
        limit: 100,
      })) {
        byId.set(decision.id, decision)
      }
    }

    for (const decision of this.sessionService.listGovernanceDecisions({ limit: 500 })) {
      if (isWithinRunWindow(decision.createdAt, run)) {
        byId.set(decision.id, decision)
      }
    }

    return Array.from(byId.values()).sort((left, right) => (
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    ))
  }
}

function collectSubjectRefs(actions: Record<string, unknown>[]): SubjectRef[] {
  const refs = new Map<string, SubjectRef>()

  for (const action of actions) {
    addRef(refs, 'learning_proposal', action['proposalId'])
    addRef(refs, 'healing_action', action['actionId'])
    addRef(refs, 'scenario_draft', action['draftId'])
  }

  return Array.from(refs.values())
}

function addRef(refs: Map<string, SubjectRef>, subjectType: GovernanceSubjectType, value: unknown): void {
  if (typeof value !== 'string' || value.length === 0) return
  refs.set(`${subjectType}:${value}`, { subjectType, subjectId: value })
}

function collectStringValues(actions: Record<string, unknown>[], key: string): Set<string> {
  const values = new Set<string>()
  for (const action of actions) {
    const value = action[key]
    if (typeof value === 'string' && value.length > 0) values.add(value)
  }
  return values
}

function buildReplayPlan(run: L5ClosedLoopRun): L5AuditBundleReplayPlan {
  const maxScenarios = Math.max(1, run.queuedScenarios.length || (run.scenarioId ? 1 : 3))
  const generatedDrafts = run.actions.some((action) => action['type'] === 'scenario_draft_generated')
  const scenario = run.scenarioId ? { scenarioId: run.scenarioId } : {}

  return {
    endpoint: '/api/p2/closed-loop/run',
    method: 'POST',
    safeReplayPayload: {
      ...scenario,
      maxScenarios,
      applyApprovedChanges: false,
      generateScenarioDrafts: false,
    },
    originalIntent: {
      mode: run.mode,
      ...scenario,
      maxScenarios,
      applyApprovedChanges: run.mode === 'apply_approved',
      generateScenarioDrafts: generatedDrafts,
    },
    notes: [
      'safeReplayPayload intentionally runs in observe mode and does not apply approved changes.',
      'originalIntent records the source run mode for a human-controlled replay decision.',
    ],
  }
}

function buildPromotionPlan(
  run: L5ClosedLoopRun,
  related: {
    learningProposals: LearningProposal[]
    healingActions: HealingAction[]
    scenarioDrafts: ScenarioDraft[]
    materializations: L5Materialization[]
    governanceDecisions: GovernanceDecision[]
  },
): L5AuditBundlePromotionPlan {
  const candidates = [
    ...related.learningProposals.map((proposal) => learningPromotionCandidate(run, proposal, related)),
    ...related.scenarioDrafts.map((draft) => scenarioPromotionCandidate(run, draft, related)),
    ...related.healingActions.map((action) => healingPromotionCandidate(run, action, related)),
  ].sort((left, right) => promotionRank(left.status) - promotionRank(right.status))

  return {
    candidates,
    notes: [
      'Promotion candidates are derived from the audit bundle and do not mutate runtime behavior.',
      'Use existing approve/apply/promote governance endpoints before any candidate becomes durable knowledge.',
    ],
  }
}

function learningPromotionCandidate(
  run: L5ClosedLoopRun,
  proposal: LearningProposal,
  related: { materializations: L5Materialization[]; governanceDecisions: GovernanceDecision[] },
): L5KnowledgePromotionCandidate {
  const materialization = findActiveMaterialization(related.materializations, 'learning_proposal', proposal.id)
  const status: L5KnowledgePromotionStatus = proposal.status === 'rejected'
    ? 'rejected'
    : proposal.status === 'applied' && materialization
      ? 'materialized'
      : proposal.status === 'approved' || proposal.status === 'applied'
        ? 'approved'
        : 'requires_review'
  const version = promotionVersion({
    subjectType: 'learning_proposal',
    subjectId: proposal.id,
    patchKind: proposal.patchKind,
    patchContent: proposal.patchContent,
    recommendation: proposal.recommendation,
    materializationChecksum: materialization?.checksum,
  })

  return {
    id: candidateId('learning_proposal', proposal.id, version),
    sourceRunId: run.id,
    subjectType: 'learning_proposal',
    subjectId: proposal.id,
    promotionType: 'learning_overlay',
    status,
    version,
    title: `${proposal.type.replace(/_/g, ' ')} for ${proposal.stepId}`,
    target: proposal.target ?? (proposal.agentId ? `agent:${proposal.agentId}` : 'agent:*'),
    reason: stringValue(proposal.recommendation['reason'], 'Learning proposal is available for governed promotion.'),
    approvalRequired: status !== 'materialized',
    materializationReady: proposal.status === 'approved' || proposal.status === 'applied',
    nextAction: learningNextAction(proposal.status, Boolean(materialization)),
    evidence: {
      scenarioId: proposal.scenarioId,
      stepId: proposal.stepId,
      severity: proposal.severity,
      patchKind: proposal.patchKind,
      governanceEvidence: countGovernanceEvidence(related.governanceDecisions, 'learning_proposal', proposal.id),
      materializationId: materialization?.id,
    },
  }
}

function scenarioPromotionCandidate(
  run: L5ClosedLoopRun,
  draft: ScenarioDraft,
  related: { materializations: L5Materialization[]; governanceDecisions: GovernanceDecision[] },
): L5KnowledgePromotionCandidate {
  const materialization = findActiveMaterialization(related.materializations, 'scenario_draft', draft.id)
  const status: L5KnowledgePromotionStatus = draft.status === 'rejected'
    ? 'rejected'
    : draft.status === 'promoted' && materialization
      ? 'materialized'
      : draft.status === 'approved' || draft.status === 'promoted'
        ? 'approved'
        : 'requires_review'
  const version = promotionVersion({
    subjectType: 'scenario_draft',
    subjectId: draft.id,
    contract: draft.contract,
    gapType: draft.gapType,
    materializationChecksum: materialization?.checksum,
  })

  return {
    id: candidateId('scenario_draft', draft.id, version),
    sourceRunId: run.id,
    subjectType: 'scenario_draft',
    subjectId: draft.id,
    promotionType: 'scenario_contract',
    status,
    version,
    title: draft.name,
    target: `scenario:${draft.scenarioId}`,
    reason: draft.description ?? `Scenario draft generated from ${draft.gapType}.`,
    approvalRequired: status !== 'materialized',
    materializationReady: draft.status === 'approved' || draft.status === 'promoted',
    nextAction: scenarioNextAction(draft.status, Boolean(materialization)),
    evidence: {
      scenarioId: draft.scenarioId,
      gapType: draft.gapType,
      reviewedBy: draft.reviewedBy,
      governanceEvidence: countGovernanceEvidence(related.governanceDecisions, 'scenario_draft', draft.id),
      materializationId: materialization?.id,
    },
  }
}

function healingPromotionCandidate(
  run: L5ClosedLoopRun,
  action: HealingAction,
  related: { governanceDecisions: GovernanceDecision[] },
): L5KnowledgePromotionCandidate {
  const status: L5KnowledgePromotionStatus = action.status === 'blocked'
    ? 'blocked'
    : action.status === 'rolled_back'
      ? 'rejected'
      : action.status === 'applied'
        ? 'materialized'
        : 'requires_review'
  const version = promotionVersion({
    subjectType: 'healing_action',
    subjectId: action.id,
    type: action.type,
    target: action.target,
    reason: action.reason,
    automatic: action.automatic,
    metadata: action.metadata,
  })

  return {
    id: candidateId('healing_action', action.id, version),
    sourceRunId: run.id,
    subjectType: 'healing_action',
    subjectId: action.id,
    promotionType: 'healing_policy',
    status,
    version,
    title: action.type.replace(/_/g, ' '),
    target: action.target,
    reason: action.reason,
    approvalRequired: status !== 'materialized',
    materializationReady: action.status === 'applied',
    nextAction: healingNextAction(action.status),
    evidence: {
      automatic: action.automatic,
      governanceEvidence: countGovernanceEvidence(related.governanceDecisions, 'healing_action', action.id),
      metadata: action.metadata ?? {},
    },
  }
}

function findActiveMaterialization(
  materializations: L5Materialization[],
  subjectType: GovernanceSubjectType,
  subjectId: string,
): L5Materialization | undefined {
  return materializations.find((materialization) => (
    materialization.subjectType === subjectType
    && materialization.subjectId === subjectId
    && materialization.status === 'active'
  ))
}

function countGovernanceEvidence(
  decisions: GovernanceDecision[],
  subjectType: GovernanceSubjectType,
  subjectId: string,
): number {
  return decisions.filter((decision) => (
    decision.subjectType === subjectType
    && decision.subjectId === subjectId
  )).length
}

function learningNextAction(
  status: LearningProposal['status'],
  hasMaterialization: boolean,
): L5KnowledgePromotionNextAction {
  if (status === 'proposed') return 'approve'
  if (status === 'approved') return 'apply'
  if (status === 'applied' && !hasMaterialization) return 'apply'
  return 'none'
}

function scenarioNextAction(
  status: ScenarioDraft['status'],
  hasMaterialization: boolean,
): L5KnowledgePromotionNextAction {
  if (status === 'pending' || status === 'revised') return 'approve'
  if (status === 'approved') return 'promote'
  if (status === 'promoted' && !hasMaterialization) return 'promote'
  return 'none'
}

function healingNextAction(status: HealingAction['status']): L5KnowledgePromotionNextAction {
  if (status === 'proposed') return 'apply'
  if (status === 'blocked') return 'review'
  return 'none'
}

function candidateId(subjectType: GovernanceSubjectType, subjectId: string, version: string): string {
  return `${subjectType}:${subjectId}:${version.slice(0, 12)}`
}

function promotionVersion(value: Record<string, unknown>): string {
  return checksum(value)
}

function promotionRank(status: L5KnowledgePromotionStatus): number {
  if (status === 'requires_review') return 0
  if (status === 'approved') return 1
  if (status === 'blocked') return 2
  if (status === 'rejected') return 3
  return 4
}

function isWithinRunWindow(timestamp: string, run: L5ClosedLoopRun): boolean {
  const value = Date.parse(timestamp)
  const startedAt = Date.parse(run.startedAt)
  const completedAt = Date.parse(run.completedAt)
  if (!Number.isFinite(value) || !Number.isFinite(startedAt) || !Number.isFinite(completedAt)) return false
  return value >= startedAt && value <= completedAt
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function checksum(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

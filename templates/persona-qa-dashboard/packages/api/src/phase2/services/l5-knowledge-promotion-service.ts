import type { L5KnowledgePromotionCandidate } from './l5-audit-bundle-service.js'
import { L5MaterializationService } from './l5-materialization-service.js'
import { LearningControlService } from './learning-control-service.js'
import { SelfHealingService } from './self-healing-service.js'
import { GovernancePolicyService } from './governance-policy-service.js'
import { ScenarioDraftPromotionReadinessService } from './scenario-draft-promotion-readiness-service.js'
import type {
  GovernanceSubjectType,
  HealingAction,
  KnowledgePromotionEvent,
  KnowledgePromotionEventAction,
  KnowledgePromotionEventInput,
  KnowledgePromotionEventStatus,
  L5ClosedLoopRun,
  L5Materialization,
  LearningProposal,
  ScenarioDraft,
  SessionService,
} from './session-service.js'

export type L5PostPromotionVerificationStatus = 'passed' | 'warning' | 'failed'

export interface L5PostPromotionVerificationCheck {
  id: string
  status: L5PostPromotionVerificationStatus
  detail: string
  evidence?: Record<string, unknown>
}

export interface L5PostPromotionVerification {
  status: L5PostPromotionVerificationStatus
  checkedAt: string
  subjectType: GovernanceSubjectType
  subjectId: string
  action: KnowledgePromotionEventAction
  checks: L5PostPromotionVerificationCheck[]
  recommendation: string
}

export interface L5KnowledgePromotionActionResult {
  candidate: L5KnowledgePromotionCandidate
  event: KnowledgePromotionEvent
  result: Record<string, unknown>
}

export class L5KnowledgePromotionService {
  constructor(private readonly sessionService: SessionService) {}

  async runCandidateAction(
    candidate: L5KnowledgePromotionCandidate,
    actor = 'dashboard',
  ): Promise<L5KnowledgePromotionActionResult> {
    const action = candidate.nextAction
    if (!isPromotionAction(action)) {
      const event = this.recordEvent(candidate, {
        action: 'approve',
        status: 'blocked',
        actor,
        result: {
          error: `Promotion candidate ${candidate.id} has no executable next action`,
          nextAction: candidate.nextAction,
        },
      })
      throw withPromotionEvent(
        new Error(`Promotion candidate ${candidate.id} has no executable next action`),
        event,
      )
    }

    const sourceRun = this.sessionService.getL5ClosedLoopRun(candidate.sourceRunId)
    if (!sourceRun) {
      const event = this.recordEvent(candidate, {
        action,
        status: 'failed',
        actor,
        result: { error: `Source run ${candidate.sourceRunId} not found` },
      })
      throw withPromotionEvent(new Error(`Source run ${candidate.sourceRunId} not found`), event)
    }

    const auditGate = this.evaluateSourceRunAuditReviewGate(sourceRun)
    if (!auditGate.allowed) {
      const event = this.recordEvent(candidate, {
        action,
        status: 'blocked',
        actor,
        result: {
          error: auditGate.reason,
          gate: auditGate,
        },
      })
      throw withPromotionEvent(new Error(auditGate.reason), event)
    }

    try {
      const actionResult = await this.executeAction(candidate, action, actor)
      const postPromotionVerification = this.verifyPostPromotion(candidate, action, actionResult)
      const result = {
        ...actionResult,
        postPromotionVerification,
      }
      const event = this.recordEvent(candidate, {
        action,
        status: postPromotionVerification.status === 'failed' ? 'failed' : 'completed',
        actor,
        result,
      })
      if (postPromotionVerification.status === 'failed') {
        throw withPromotionEvent(new Error(`Post-promotion verification failed for ${candidate.id}`), event)
      }
      return { candidate, event, result }
    } catch (error) {
      if (getAttachedPromotionEvent(error)) throw error

      const message = error instanceof Error ? error.message : String(error)
      const event = this.recordEvent(candidate, {
        action,
        status: classifyFailure(message),
        actor,
        result: { error: message },
      })
      throw withPromotionEvent(error instanceof Error ? error : new Error(message), event)
    }
  }

  private async executeAction(
    candidate: L5KnowledgePromotionCandidate,
    action: KnowledgePromotionEventAction,
    actor: string,
  ): Promise<Record<string, unknown>> {
    if (candidate.subjectType === 'learning_proposal') {
      return this.executeLearningProposalAction(candidate.subjectId, action)
    }

    if (candidate.subjectType === 'scenario_draft') {
      return this.executeScenarioDraftAction(candidate.subjectId, action, actor)
    }

    if (candidate.subjectType === 'healing_action') {
      return this.executeHealingAction(candidate.subjectId, action, actor)
    }

    throw new Error(`Unsupported promotion subject type: ${candidate.subjectType}`)
  }

  private async executeLearningProposalAction(
    proposalId: string,
    action: KnowledgePromotionEventAction,
  ): Promise<Record<string, unknown>> {
    const learning = new LearningControlService(this.sessionService)

    if (action === 'approve') {
      const proposal = learning.approveProposal(proposalId)
      return {
        proposalId: proposal.id,
        proposalStatus: proposal.status,
        approvedAt: proposal.approvedAt ?? null,
      }
    }

    if (action === 'apply') {
      const proposal = learning.applyProposal(proposalId)
      const materialization = await new L5MaterializationService(this.sessionService).materializeLearningProposal(proposal)
      return {
        proposalId: proposal.id,
        proposalStatus: proposal.status,
        materialization: serializeMaterialization(materialization),
      }
    }

    throw new Error(`Learning proposal does not support ${action}`)
  }

  private async executeScenarioDraftAction(
    draftId: string,
    action: KnowledgePromotionEventAction,
    actor: string,
  ): Promise<Record<string, unknown>> {
    const currentDraft = this.requireScenarioDraft(draftId)
    const readinessService = new ScenarioDraftPromotionReadinessService(this.sessionService)
    const readinessBefore = readinessService.buildReport(currentDraft, actor)

    if (action === 'approve') {
      const draft = this.transitionScenarioDraft(currentDraft, 'approved', actor)
      return {
        draft,
        readinessBefore,
        readinessAfter: readinessService.buildReport(draft, actor),
      }
    }

    if (action === 'promote') {
      const draft = currentDraft.status === 'promoted'
        ? this.recordScenarioDraftPromotionEvidence(currentDraft, actor)
        : this.transitionScenarioDraft(currentDraft, 'promoted', actor)
      const materialization = await new L5MaterializationService(this.sessionService).promoteScenarioDraftToRunnable(draft)
      return {
        draft,
        readinessBefore,
        readinessAfter: readinessService.buildReport(draft, actor),
        materialization: serializeMaterialization(materialization.manifest),
        runnableScenarioRegistry: serializeMaterialization(materialization.runnableScenarioRegistry),
      }
    }

    throw new Error(`Scenario draft does not support ${action}`)
  }

  private recordScenarioDraftPromotionEvidence(draft: ScenarioDraft, actor: string): ScenarioDraft {
    const governanceDecision = new GovernancePolicyService(this.sessionService).recordScenarioDraftTransitionDecision(
      draft,
      'promoted',
      actor,
    )
    if (governanceDecision.verdict === 'blocked') {
      throw new Error(governanceDecision.reason)
    }
    return draft
  }

  private executeHealingAction(
    actionId: string,
    action: KnowledgePromotionEventAction,
    actor: string,
  ): Record<string, unknown> {
    if (action !== 'apply') {
      throw new Error(`Healing action does not support ${action}`)
    }

    const healingAction = new SelfHealingService(this.sessionService).applyAction(actionId, actor)
    return {
      actionId: healingAction.id,
      actionStatus: healingAction.status,
      metadata: healingAction.metadata ?? {},
    }
  }

  private transitionScenarioDraft(
    draft: ScenarioDraft,
    status: ScenarioDraft['status'],
    actor: string,
  ): ScenarioDraft {
    if (status === 'promoted' && draft.status !== 'approved') {
      throw new Error('Scenario draft must be approved before promotion')
    }

    const governanceDecision = new GovernancePolicyService(this.sessionService).recordScenarioDraftTransitionDecision(
      draft,
      status,
      actor,
    )
    if (governanceDecision.verdict === 'blocked') {
      throw new Error(governanceDecision.reason)
    }

    const updated = this.sessionService.updateScenarioDraftStatus(draft.id, status, actor)
    if (!updated) throw new Error(`Scenario draft ${draft.id} not found after ${status}`)
    return updated
  }

  private verifyPostPromotion(
    candidate: L5KnowledgePromotionCandidate,
    action: KnowledgePromotionEventAction,
    result: Record<string, unknown>,
  ): L5PostPromotionVerification {
    const checks: L5PostPromotionVerificationCheck[] = [
      buildCheck({
        id: 'source_run_available',
        passed: Boolean(this.sessionService.getL5ClosedLoopRun(candidate.sourceRunId)),
        detail: `Source run ${candidate.sourceRunId} is available for audit traceability.`,
      }),
      this.verifySourceRunAuditReview(candidate.sourceRunId),
      this.verifyGovernanceEvidence(candidate, action),
    ]

    if (candidate.subjectType === 'learning_proposal') {
      checks.push(...this.verifyLearningProposalPromotion(candidate.subjectId, action, result))
    } else if (candidate.subjectType === 'scenario_draft') {
      checks.push(...this.verifyScenarioDraftPromotion(candidate.subjectId, action, result))
    } else if (candidate.subjectType === 'healing_action') {
      checks.push(...this.verifyHealingActionPromotion(candidate.subjectId))
    } else {
      checks.push({
        id: 'subject_type_supported',
        status: 'failed',
        detail: `Unsupported promotion subject type: ${candidate.subjectType}`,
      })
    }

    return {
      status: aggregateStatus(checks),
      checkedAt: new Date().toISOString(),
      subjectType: candidate.subjectType,
      subjectId: candidate.subjectId,
      action,
      checks,
      recommendation: buildVerificationRecommendation(checks),
    }
  }

  private evaluateSourceRunAuditReviewGate(run: L5ClosedLoopRun): {
    allowed: boolean
    reason: string
    verdict?: unknown
    reviewId?: string
    reviewedAt?: string
  } {
    const independentAudit = recordValue(run.verification['independentAudit'])
    const verdict = independentAudit['verdict']
    if (verdict !== 'failed' && verdict !== 'warning') {
      return {
        allowed: true,
        reason: 'Source run independent audit does not require review.',
        verdict,
      }
    }

    const review = this.sessionService.getLatestL5IndependentAuditReview(run.id)
    if (review?.status === 'reviewed') {
      return {
        allowed: true,
        reason: 'Source run independent audit was reviewed before promotion.',
        verdict,
        reviewId: review.id,
        reviewedAt: review.createdAt,
      }
    }

    return {
      allowed: false,
      reason: `Source run ${run.id} has independent audit ${String(verdict)} and must be reviewed before promotion.`,
      verdict,
    }
  }

  private verifySourceRunAuditReview(sourceRunId: string): L5PostPromotionVerificationCheck {
    const run = this.sessionService.getL5ClosedLoopRun(sourceRunId)
    if (!run) {
      return buildCheck({
        id: 'source_run_audit_review_gate',
        passed: false,
        detail: 'Source run is missing; audit review gate cannot be evaluated.',
      })
    }

    const gate = this.evaluateSourceRunAuditReviewGate(run)
    return buildCheck({
      id: 'source_run_audit_review_gate',
      passed: gate.allowed,
      detail: gate.reason,
      evidence: {
        sourceRunId,
        verdict: gate.verdict,
        reviewId: gate.reviewId,
        reviewedAt: gate.reviewedAt,
      },
    })
  }

  private verifyGovernanceEvidence(
    candidate: L5KnowledgePromotionCandidate,
    action: KnowledgePromotionEventAction,
  ): L5PostPromotionVerificationCheck {
    const decisions = this.sessionService.listGovernanceDecisions({
      subjectType: candidate.subjectType,
      subjectId: candidate.subjectId,
      limit: 100,
    })
    const allowed = decisions.filter((decision) => (
      decision.action === action && decision.verdict === 'allowed'
    ))

    return buildCheck({
      id: 'allowed_governance_decision',
      passed: allowed.length > 0,
      detail: `Allowed governance decision exists for ${action}.`,
      evidence: {
        allowedDecisions: allowed.length,
        latestDecisionId: allowed[0]?.id,
      },
    })
  }

  private verifyLearningProposalPromotion(
    proposalId: string,
    action: KnowledgePromotionEventAction,
    result: Record<string, unknown>,
  ): L5PostPromotionVerificationCheck[] {
    const checks: L5PostPromotionVerificationCheck[] = []
    const proposal = this.sessionService.getLearningProposal(proposalId)
    checks.push(buildCheck({
      id: 'learning_proposal_exists',
      passed: Boolean(proposal),
      detail: `Learning proposal ${proposalId} is persisted.`,
    }))
    if (!proposal) return checks

    if (action === 'approve') {
      checks.push(buildCheck({
        id: 'learning_proposal_approved',
        passed: proposal.status === 'approved' || proposal.status === 'applied',
        detail: 'Learning proposal status permits future materialization.',
        evidence: { status: proposal.status },
      }))
      return checks
    }

    if (action === 'apply') {
      checks.push(buildCheck({
        id: 'learning_proposal_applied',
        passed: proposal.status === 'applied',
        detail: 'Learning proposal is marked as applied.',
        evidence: { status: proposal.status },
      }))
      checks.push(...this.verifyMaterialization('learning_proposal', proposal.id, result))
      checks.push(this.verifyRuntimeOverlayLoadable(proposal))
      return checks
    }

    checks.push({
      id: 'learning_action_supported',
      status: 'failed',
      detail: `Learning proposal does not support ${action}.`,
    })
    return checks
  }

  private verifyScenarioDraftPromotion(
    draftId: string,
    action: KnowledgePromotionEventAction,
    result: Record<string, unknown>,
  ): L5PostPromotionVerificationCheck[] {
    const checks: L5PostPromotionVerificationCheck[] = []
    const draft = this.sessionService.getScenarioDraft(draftId)
    checks.push(buildCheck({
      id: 'scenario_draft_exists',
      passed: Boolean(draft),
      detail: `Scenario draft ${draftId} is persisted.`,
    }))
    if (!draft) return checks

    if (action === 'approve') {
      checks.push(buildCheck({
        id: 'scenario_draft_approved',
        passed: draft.status === 'approved' || draft.status === 'promoted',
        detail: 'Scenario draft status permits future promotion.',
        evidence: { status: draft.status },
      }))
      return checks
    }

    if (action === 'promote') {
      checks.push(buildCheck({
        id: 'scenario_draft_promoted',
        passed: draft.status === 'promoted',
        detail: 'Scenario draft is marked as promoted.',
        evidence: { status: draft.status },
      }))
      checks.push(...this.verifyMaterialization('scenario_draft', draft.id, result))
      return checks
    }

    checks.push({
      id: 'scenario_action_supported',
      status: 'failed',
      detail: `Scenario draft does not support ${action}.`,
    })
    return checks
  }

  private verifyHealingActionPromotion(actionId: string): L5PostPromotionVerificationCheck[] {
    const action = this.sessionService.getHealingAction(actionId)
    return [
      buildCheck({
        id: 'healing_action_exists',
        passed: Boolean(action),
        detail: `Healing action ${actionId} is persisted.`,
      }),
      buildCheck({
        id: 'healing_action_applied',
        passed: action?.status === 'applied',
        detail: 'Healing action is marked as applied.',
        evidence: action ? healingActionEvidence(action) : undefined,
      }),
    ]
  }

  private verifyMaterialization(
    subjectType: GovernanceSubjectType,
    subjectId: string,
    result: Record<string, unknown>,
  ): L5PostPromotionVerificationCheck[] {
    const materializationId = getMaterializationId(result)
    const materializations = this.sessionService.listL5Materializations({
      subjectType,
      subjectId,
      status: 'active',
      limit: 100,
    })
    const materialization = materializationId
      ? materializations.find((candidate) => candidate.id === materializationId)
      : materializations[0]

    const checks: L5PostPromotionVerificationCheck[] = [
      buildCheck({
        id: 'active_materialization_exists',
        passed: Boolean(materialization),
        detail: 'Active L5 materialization exists for promoted knowledge.',
        evidence: {
          requestedMaterializationId: materializationId,
          activeMaterializations: materializations.length,
        },
      }),
    ]
    if (!materialization) return checks

    const metadata = materialization.metadata ?? {}
    const independentAudit = recordValue(metadata['independentAudit'])
    const postWriteVerification = recordValue(metadata['postWriteVerification'])
    checks.push(buildCheck({
      id: 'materialization_independent_audit_passed',
      passed: independentAudit['verdict'] === 'passed',
      detail: 'Materialization independent audit passed.',
      evidence: {
        materializationId: materialization.id,
        verdict: independentAudit['verdict'],
      },
    }))
    checks.push(buildCheck({
      id: 'materialization_checksum_verified',
      passed: postWriteVerification['checksumMatches'] === true,
      detail: 'Materialization checksum matches persisted content.',
      evidence: {
        materializationId: materialization.id,
        checksumMatches: postWriteVerification['checksumMatches'],
      },
    }))
    return checks
  }

  private verifyRuntimeOverlayLoadable(proposal: LearningProposal): L5PostPromotionVerificationCheck {
    if (proposal.patchKind !== 'prompt_overlay') {
      return {
        id: 'runtime_overlay_loadable',
        status: 'passed',
        detail: `Patch kind ${proposal.patchKind} does not require runtime overlay loading.`,
      }
    }

    const agentId = proposal.agentId ?? agentIdFromTarget(proposal.target)
    if (!agentId) {
      return {
        id: 'runtime_overlay_loadable',
        status: 'warning',
        detail: 'Prompt overlay has no concrete agent target; runtime loading could not be scoped.',
        evidence: {
          target: proposal.target,
        },
      }
    }

    const overlays = this.sessionService.listRuntimeLearningOverlays({
      scenarioId: proposal.scenarioId,
      stepId: proposal.stepId,
      agentId,
      limit: 5,
    })
    const overlay = overlays.find((candidate) => candidate.proposalId === proposal.id)
    return buildCheck({
      id: 'runtime_overlay_loadable',
      passed: Boolean(overlay),
      detail: 'Applied prompt overlay is loadable by the agent runtime.',
      evidence: {
        agentId,
        overlayCount: overlays.length,
        materializationId: overlay?.materializationId,
      },
    })
  }

  private requireScenarioDraft(id: string): ScenarioDraft {
    const draft = this.sessionService.getScenarioDraft(id)
    if (!draft) throw new Error(`Scenario draft ${id} not found`)
    return draft
  }

  private recordEvent(
    candidate: L5KnowledgePromotionCandidate,
    override: Pick<KnowledgePromotionEventInput, 'action' | 'status' | 'actor' | 'result'>,
  ): KnowledgePromotionEvent {
    return this.sessionService.recordKnowledgePromotionEvent({
      sourceRunId: candidate.sourceRunId,
      candidateId: candidate.id,
      candidateVersion: candidate.version,
      subjectType: candidate.subjectType,
      subjectId: candidate.subjectId,
      promotionType: candidate.promotionType,
      action: override.action,
      status: override.status,
      actor: override.actor,
      reason: candidate.reason,
      target: candidate.target,
      result: override.result,
      metadata: {
        candidateStatus: candidate.status,
        approvalRequired: candidate.approvalRequired,
        materializationReady: candidate.materializationReady,
        evidence: candidate.evidence,
      },
    })
  }
}

function isPromotionAction(value: string): value is KnowledgePromotionEventAction {
  return value === 'approve' || value === 'apply' || value === 'promote'
}

function classifyFailure(message: string): KnowledgePromotionEventStatus {
  return /blocked|must be approved|requires|not support|no executable/i.test(message)
    ? 'blocked'
    : 'failed'
}

function serializeMaterialization(materialization: L5Materialization): Record<string, unknown> {
  return {
    id: materialization.id,
    subjectType: materialization.subjectType,
    subjectId: materialization.subjectId,
    kind: materialization.kind,
    status: materialization.status,
    filePath: materialization.filePath,
    checksum: materialization.checksum,
    createdAt: materialization.createdAt,
  }
}

function getMaterializationId(result: Record<string, unknown>): string | undefined {
  const materialization = recordValue(result['materialization'])
  return typeof materialization['id'] === 'string' ? materialization['id'] : undefined
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function healingActionEvidence(action: HealingAction): Record<string, unknown> {
  return {
    status: action.status,
    automatic: action.automatic,
    appliedBy: action.metadata?.['appliedBy'],
    rollbackAvailable: action.metadata?.['rollbackAvailable'],
  }
}

function agentIdFromTarget(target: string | undefined): string | undefined {
  if (!target?.startsWith('agent:')) return undefined
  const agentId = target.slice('agent:'.length)
  return agentId && agentId !== '*' ? agentId : undefined
}

function buildCheck(input: {
  id: string
  passed: boolean
  detail: string
  evidence?: Record<string, unknown>
}): L5PostPromotionVerificationCheck {
  return {
    id: input.id,
    status: input.passed ? 'passed' : 'failed',
    detail: input.detail,
    evidence: input.evidence,
  }
}

function aggregateStatus(checks: L5PostPromotionVerificationCheck[]): L5PostPromotionVerificationStatus {
  if (checks.some((check) => check.status === 'failed')) return 'failed'
  if (checks.some((check) => check.status === 'warning')) return 'warning'
  return 'passed'
}

function buildVerificationRecommendation(checks: L5PostPromotionVerificationCheck[]): string {
  const failed = checks.filter((check) => check.status === 'failed')
  if (failed.length > 0) {
    return `Review failed post-promotion checks before relying on promoted knowledge: ${failed.map((check) => check.id).join(', ')}.`
  }

  const warnings = checks.filter((check) => check.status === 'warning')
  if (warnings.length > 0) {
    return `Promotion completed with non-blocking verification warnings: ${warnings.map((check) => check.id).join(', ')}.`
  }

  return 'Promotion completed and post-promotion verification passed.'
}

function withPromotionEvent(error: Error, event: KnowledgePromotionEvent): Error {
  Object.assign(error, { promotionEvent: event })
  return error
}

function getAttachedPromotionEvent(error: unknown): KnowledgePromotionEvent | undefined {
  return error && typeof error === 'object' && 'promotionEvent' in error
    ? (error as { promotionEvent?: KnowledgePromotionEvent }).promotionEvent
    : undefined
}

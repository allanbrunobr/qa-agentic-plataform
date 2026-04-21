import type { L5KnowledgePromotionCandidate } from './l5-audit-bundle-service.js'
import { L5MaterializationService } from './l5-materialization-service.js'
import { LearningControlService } from './learning-control-service.js'
import { SelfHealingService } from './self-healing-service.js'
import { GovernancePolicyService } from './governance-policy-service.js'
import type {
  KnowledgePromotionEvent,
  KnowledgePromotionEventAction,
  KnowledgePromotionEventInput,
  KnowledgePromotionEventStatus,
  L5Materialization,
  ScenarioDraft,
  SessionService,
} from './session-service.js'

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

    if (!this.sessionService.getL5ClosedLoopRun(candidate.sourceRunId)) {
      const event = this.recordEvent(candidate, {
        action,
        status: 'failed',
        actor,
        result: { error: `Source run ${candidate.sourceRunId} not found` },
      })
      throw withPromotionEvent(new Error(`Source run ${candidate.sourceRunId} not found`), event)
    }

    try {
      const result = await this.executeAction(candidate, action, actor)
      const event = this.recordEvent(candidate, {
        action,
        status: 'completed',
        actor,
        result,
      })
      return { candidate, event, result }
    } catch (error) {
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

    if (action === 'approve') {
      return {
        draft: this.transitionScenarioDraft(currentDraft, 'approved', actor),
      }
    }

    if (action === 'promote') {
      const draft = currentDraft.status === 'promoted'
        ? this.recordScenarioDraftPromotionEvidence(currentDraft, actor)
        : this.transitionScenarioDraft(currentDraft, 'promoted', actor)
      const materialization = await new L5MaterializationService(this.sessionService).materializeScenarioDraft(draft)
      return {
        draft,
        materialization: serializeMaterialization(materialization),
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

function withPromotionEvent(error: Error, event: KnowledgePromotionEvent): Error {
  Object.assign(error, { promotionEvent: event })
  return error
}

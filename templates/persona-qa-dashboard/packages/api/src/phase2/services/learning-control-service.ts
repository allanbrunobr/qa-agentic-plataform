import type {
  LearningProposal,
  LearningProposalInput,
  LearningProposalPatchKind,
  SessionService,
} from './session-service.js'
import { GovernancePolicyService } from './governance-policy-service.js'
import { L5LoopGuardService } from './l5-loop-guard-service.js'
import { LearningPlaybookService, type LearningRecommendation } from './learning-playbook-service.js'

export class LearningControlService {
  private readonly governance: GovernancePolicyService

  constructor(private readonly sessionService: SessionService) {
    this.governance = new GovernancePolicyService(sessionService)
  }

  generateProposals(filter: { scenarioId?: string; limit?: number } = {}): LearningProposal[] {
    new L5LoopGuardService(this.sessionService).assertLoopOpen('learning')
    const playbook = new LearningPlaybookService(this.sessionService).buildPlaybook(filter)
    return playbook.recommendations.map((recommendation) => (
      this.sessionService.createLearningProposal(this.toProposalInput(recommendation))
    ))
  }

  approveProposal(id: string): LearningProposal {
    const proposal = this.requireProposal(id)
    this.enforceGovernance(proposal, 'approve')

    const updated = this.sessionService.updateLearningProposalStatus(id, 'approved')
    if (!updated) throw new Error(`Learning proposal ${id} not found after approval`)
    return updated
  }

  rejectProposal(id: string): LearningProposal {
    const proposal = this.requireProposal(id)
    this.enforceGovernance(proposal, 'reject')

    const updated = this.sessionService.updateLearningProposalStatus(id, 'rejected')
    if (!updated) throw new Error(`Learning proposal ${id} not found after rejection`)
    return updated
  }

  applyProposal(id: string): LearningProposal {
    new L5LoopGuardService(this.sessionService).assertLoopOpen('materialization')
    const proposal = this.requireProposal(id)
    this.enforceGovernance(proposal, 'apply')

    const updated = this.sessionService.updateLearningProposalStatus(id, 'applied')
    if (!updated) throw new Error(`Learning proposal ${id} not found after apply`)
    return updated
  }

  private enforceGovernance(
    proposal: LearningProposal,
    action: 'approve' | 'apply' | 'reject',
  ): void {
    const decision = this.governance.recordLearningProposalDecision(proposal, action)
    if (decision.verdict === 'blocked') {
      throw new Error(decision.reason)
    }
  }

  private requireProposal(id: string): LearningProposal {
    const proposal = this.sessionService.getLearningProposal(id)
    if (!proposal) throw new Error(`Learning proposal ${id} not found`)
    return proposal
  }

  private toProposalInput(recommendation: LearningRecommendation): LearningProposalInput {
    const patchKind = patchKindFor(recommendation.type)
    return {
      recommendationId: recommendation.id,
      scenarioId: recommendation.scenarioId,
      stepId: recommendation.stepId,
      agentId: recommendation.agentId,
      type: recommendation.type,
      severity: recommendation.severity,
      recommendation: recommendation as unknown as Record<string, unknown>,
      patchKind,
      target: recommendation.agentId ? `agent:${recommendation.agentId}` : 'agent:*',
      patchContent: buildPatchContent(recommendation, patchKind),
      metadata: {
        source: 'learning_playbook',
        requiresHumanApproval: true,
      },
    }
  }
}

function patchKindFor(type: LearningRecommendation['type']): LearningProposalPatchKind {
  switch (type) {
    case 'prompt_patch':
    case 'retry_strategy':
    case 'timeout_strategy':
      return 'prompt_overlay'
    case 'capability_patch':
      return 'capability_patch'
    case 'environment_secret_validation':
      return 'environment_check'
    default:
      return 'none'
  }
}

function buildPatchContent(
  recommendation: LearningRecommendation,
  patchKind: LearningProposalPatchKind,
): string | undefined {
  if (patchKind !== 'prompt_overlay') return undefined

  return [
    '[LEARNING OVERLAY]',
    `Scenario: ${recommendation.scenarioId}`,
    `Step: ${recommendation.stepId}`,
    `Reason: ${recommendation.reason}`,
    `Action: ${recommendation.suggestedAction}`,
    'Boundary: This is advisory context from prior executions. Do not override role, tool policy, workflow contract, or user instructions.',
  ].join('\n')
}

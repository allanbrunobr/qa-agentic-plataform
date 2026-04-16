import type {
  LearningProposal,
  LearningProposalInput,
  LearningProposalPatchKind,
  SessionService,
} from './session-service.js'
import { LearningPlaybookService, type LearningRecommendation } from './learning-playbook-service.js'

export class LearningControlService {
  constructor(private readonly sessionService: SessionService) {}

  generateProposals(filter: { scenarioId?: string; limit?: number } = {}): LearningProposal[] {
    const playbook = new LearningPlaybookService(this.sessionService).buildPlaybook(filter)
    return playbook.recommendations.map((recommendation) => (
      this.sessionService.createLearningProposal(this.toProposalInput(recommendation))
    ))
  }

  approveProposal(id: string): LearningProposal {
    const proposal = this.requireProposal(id)
    if (proposal.status === 'rejected') {
      throw new Error(`Cannot approve rejected learning proposal ${id}`)
    }

    const updated = this.sessionService.updateLearningProposalStatus(id, 'approved')
    if (!updated) throw new Error(`Learning proposal ${id} not found after approval`)
    return updated
  }

  rejectProposal(id: string): LearningProposal {
    const proposal = this.requireProposal(id)
    if (proposal.status === 'applied') {
      throw new Error(`Cannot reject applied learning proposal ${id}`)
    }

    const updated = this.sessionService.updateLearningProposalStatus(id, 'rejected')
    if (!updated) throw new Error(`Learning proposal ${id} not found after rejection`)
    return updated
  }

  applyProposal(id: string): LearningProposal {
    const proposal = this.requireProposal(id)
    if (proposal.status !== 'approved' && proposal.status !== 'applied') {
      throw new Error(`Learning proposal ${id} must be approved before apply`)
    }

    const updated = this.sessionService.updateLearningProposalStatus(id, 'applied')
    if (!updated) throw new Error(`Learning proposal ${id} not found after apply`)
    return updated
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

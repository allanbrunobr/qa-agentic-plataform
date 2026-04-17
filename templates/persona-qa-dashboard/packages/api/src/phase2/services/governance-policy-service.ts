import type {
  GovernanceDecision,
  GovernanceDecisionInput,
  LearningProposal,
  LearningProposalPatchKind,
  SessionService,
} from './session-service.js'

type LearningGovernanceAction = 'approve' | 'apply' | 'reject'

const HUMAN_REVIEW_REQUIREMENTS = ['human_review']
const APPLY_REQUIREMENTS = ['human_review', 'approved_learning_proposal']
const APPLY_SAFE_PATCH_KINDS: LearningProposalPatchKind[] = ['none', 'prompt_overlay']

export class GovernancePolicyService {
  constructor(private readonly sessionService: SessionService) {}

  recordLearningProposalDecision(
    proposal: LearningProposal,
    action: LearningGovernanceAction,
    actor = 'system',
  ): GovernanceDecision {
    return this.sessionService.recordGovernanceDecision(
      this.decideLearningProposalAction(proposal, action, actor),
    )
  }

  decideLearningProposalAction(
    proposal: LearningProposal,
    action: LearningGovernanceAction,
    actor = 'system',
  ): GovernanceDecisionInput {
    const metadata = {
      previousStatus: proposal.status,
      patchKind: proposal.patchKind,
      proposalType: proposal.type,
      severity: proposal.severity,
      target: proposal.target,
    }

    if (action === 'approve') {
      if (proposal.status === 'rejected') {
        return blocked(proposal, action, actor, 'Rejected learning proposals cannot be approved', metadata)
      }
      if (proposal.status === 'applied') {
        return blocked(proposal, action, actor, 'Applied learning proposals cannot be re-approved', metadata)
      }
      return allowed(proposal, action, actor, 'Learning proposal approved for human-reviewed application', HUMAN_REVIEW_REQUIREMENTS, metadata)
    }

    if (action === 'reject') {
      if (proposal.status === 'applied') {
        return blocked(proposal, action, actor, 'Applied learning proposals cannot be rejected', metadata)
      }
      return allowed(proposal, action, actor, 'Learning proposal rejected by human review', HUMAN_REVIEW_REQUIREMENTS, metadata)
    }

    if (proposal.status !== 'approved' && proposal.status !== 'applied') {
      return blocked(proposal, action, actor, 'Learning proposal must be approved before apply', metadata)
    }

    if (!APPLY_SAFE_PATCH_KINDS.includes(proposal.patchKind)) {
      return blocked(
        proposal,
        action,
        actor,
        `Patch kind ${proposal.patchKind} requires manual implementation outside automatic apply`,
        metadata,
      )
    }

    return allowed(proposal, action, actor, 'Learning proposal apply permitted by governance policy', APPLY_REQUIREMENTS, metadata)
  }
}

function allowed(
  proposal: LearningProposal,
  action: LearningGovernanceAction,
  actor: string,
  reason: string,
  requirements: string[],
  metadata: Record<string, unknown>,
): GovernanceDecisionInput {
  return {
    subjectType: 'learning_proposal',
    subjectId: proposal.id,
    action,
    verdict: 'allowed',
    reason,
    actor,
    requirements,
    metadata,
  }
}

function blocked(
  proposal: LearningProposal,
  action: LearningGovernanceAction,
  actor: string,
  reason: string,
  metadata: Record<string, unknown>,
): GovernanceDecisionInput {
  return {
    subjectType: 'learning_proposal',
    subjectId: proposal.id,
    action,
    verdict: 'blocked',
    reason,
    actor,
    requirements: HUMAN_REVIEW_REQUIREMENTS,
    metadata,
  }
}

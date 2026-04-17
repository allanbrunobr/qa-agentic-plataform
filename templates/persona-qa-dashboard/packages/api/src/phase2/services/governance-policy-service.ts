import type {
  GovernanceDecision,
  GovernanceDecisionInput,
  HealingAction,
  LearningProposal,
  LearningProposalPatchKind,
  ScenarioDraft,
  SessionService,
} from './session-service.js'

type LearningGovernanceAction = 'approve' | 'apply' | 'reject'
type HealingGovernanceAction = 'apply' | 'evaluate'
type ScenarioDraftGovernanceAction = 'approve' | 'reject' | 'evaluate'

const HUMAN_REVIEW_REQUIREMENTS = ['human_review']
const APPLY_REQUIREMENTS = ['human_review', 'approved_learning_proposal']
const APPLY_SAFE_PATCH_KINDS: LearningProposalPatchKind[] = ['none', 'prompt_overlay']
const BOUNDED_POLICY_REQUIREMENTS = ['bounded_policy']

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

  recordHealingActionDecision(
    action: HealingAction,
    governanceAction: HealingGovernanceAction = inferHealingGovernanceAction(action),
    actor = 'self_healing',
  ): GovernanceDecision {
    return this.sessionService.recordGovernanceDecision(
      this.decideHealingAction(action, governanceAction, actor),
    )
  }

  decideHealingAction(
    action: HealingAction,
    governanceAction: HealingGovernanceAction = inferHealingGovernanceAction(action),
    actor = 'self_healing',
  ): GovernanceDecisionInput {
    const metadata = {
      healingType: action.type,
      target: action.target,
      automatic: action.automatic,
      status: action.status,
      ...action.metadata,
    }

    if (action.status === 'blocked') {
      return {
        subjectType: 'healing_action',
        subjectId: action.id,
        action: governanceAction,
        verdict: 'blocked',
        reason: action.reason,
        actor,
        requirements: BOUNDED_POLICY_REQUIREMENTS,
        metadata,
      }
    }

    if (action.automatic && action.status === 'applied') {
      return {
        subjectType: 'healing_action',
        subjectId: action.id,
        action: governanceAction,
        verdict: 'allowed',
        reason: 'Automatic healing action permitted by bounded policy',
        actor,
        requirements: BOUNDED_POLICY_REQUIREMENTS,
        metadata,
      }
    }

    return {
      subjectType: 'healing_action',
      subjectId: action.id,
      action: governanceAction,
      verdict: 'allowed',
      reason: 'Healing action requires human review before application',
      actor,
      requirements: HUMAN_REVIEW_REQUIREMENTS,
      metadata,
    }
  }

  recordScenarioDraftDecision(
    draft: ScenarioDraft,
    governanceAction: ScenarioDraftGovernanceAction = inferScenarioDraftGovernanceAction(draft),
    actor = draft.reviewedBy ?? 'human_reviewer',
  ): GovernanceDecision {
    return this.sessionService.recordGovernanceDecision(
      this.decideScenarioDraftAction(draft, governanceAction, actor),
    )
  }

  decideScenarioDraftAction(
    draft: ScenarioDraft,
    governanceAction: ScenarioDraftGovernanceAction = inferScenarioDraftGovernanceAction(draft),
    actor = draft.reviewedBy ?? 'human_reviewer',
  ): GovernanceDecisionInput {
    const metadata = {
      scenarioId: draft.scenarioId,
      draftStatus: draft.status,
      gapType: draft.gapType,
      reviewedBy: draft.reviewedBy,
    }

    return {
      subjectType: 'scenario_draft',
      subjectId: draft.id,
      action: governanceAction,
      verdict: 'allowed',
      reason: scenarioDraftReason(draft.status),
      actor,
      requirements: HUMAN_REVIEW_REQUIREMENTS,
      metadata,
    }
  }
}

function inferHealingGovernanceAction(action: HealingAction): HealingGovernanceAction {
  return action.status === 'applied' || action.status === 'blocked' ? 'apply' : 'evaluate'
}

function inferScenarioDraftGovernanceAction(draft: ScenarioDraft): ScenarioDraftGovernanceAction {
  if (draft.status === 'approved') return 'approve'
  if (draft.status === 'rejected') return 'reject'
  return 'evaluate'
}

function scenarioDraftReason(status: ScenarioDraft['status']): string {
  if (status === 'approved') return 'Scenario draft approved by human review'
  if (status === 'rejected') return 'Scenario draft rejected by human review'
  if (status === 'revised') return 'Scenario draft marked for revision by human review'
  return 'Scenario draft returned to review queue'
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

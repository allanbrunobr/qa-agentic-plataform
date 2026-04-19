import type {
  GovernanceDecision,
  GovernanceDecisionInput,
  HealingAction,
  LearningProposal,
  LearningProposalPatchKind,
  ScenarioDraft,
  SessionService,
} from './session-service.js'
import { IndependentAuditorService, type GovernanceAuditEvaluation } from './independent-auditor-service.js'
import { defaultRuntimeHookBus } from './runtime-hooks.js'

type LearningGovernanceAction = 'approve' | 'apply' | 'reject'
type HealingGovernanceAction = 'apply' | 'evaluate' | 'rollback'
type ScenarioDraftGovernanceAction = 'approve' | 'reject' | 'evaluate' | 'promote'

const HUMAN_REVIEW_REQUIREMENTS = ['human_review']
const APPLY_REQUIREMENTS = ['human_review', 'approved_learning_proposal']
const APPLY_SAFE_PATCH_KINDS: LearningProposalPatchKind[] = ['none', 'prompt_overlay']
const BOUNDED_POLICY_REQUIREMENTS = ['bounded_policy']
const INDEPENDENT_AUDIT_REQUIREMENTS = ['independent_audit']

export class GovernancePolicyService {
  private readonly auditor = new IndependentAuditorService()

  constructor(private readonly sessionService: SessionService) {}

  recordLearningProposalDecision(
    proposal: LearningProposal,
    action: LearningGovernanceAction,
    actor = 'system',
  ): GovernanceDecision {
    return this.recordGovernanceDecision(
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
        return this.withIndependentAudit(
          blocked(proposal, action, actor, 'Rejected learning proposals cannot be approved', metadata),
          proposal,
          actor,
        )
      }
      if (proposal.status === 'applied') {
        return this.withIndependentAudit(
          blocked(proposal, action, actor, 'Applied learning proposals cannot be re-approved', metadata),
          proposal,
          actor,
        )
      }
      return this.withIndependentAudit(
        allowed(proposal, action, actor, 'Learning proposal approved for human-reviewed application', HUMAN_REVIEW_REQUIREMENTS, metadata),
        proposal,
        actor,
      )
    }

    if (action === 'reject') {
      if (proposal.status === 'applied') {
        return this.withIndependentAudit(
          blocked(proposal, action, actor, 'Applied learning proposals cannot be rejected', metadata),
          proposal,
          actor,
        )
      }
      return this.withIndependentAudit(
        allowed(proposal, action, actor, 'Learning proposal rejected by human review', HUMAN_REVIEW_REQUIREMENTS, metadata),
        proposal,
        actor,
      )
    }

    if (proposal.status !== 'approved' && proposal.status !== 'applied') {
      return this.withIndependentAudit(
        blocked(proposal, action, actor, 'Learning proposal must be approved before apply', metadata),
        proposal,
        actor,
      )
    }

    if (!APPLY_SAFE_PATCH_KINDS.includes(proposal.patchKind)) {
      return this.withIndependentAudit(
        blocked(
          proposal,
          action,
          actor,
          `Patch kind ${proposal.patchKind} requires manual implementation outside automatic apply`,
          metadata,
        ),
        proposal,
        actor,
      )
    }

    return this.withIndependentAudit(
      allowed(proposal, action, actor, 'Learning proposal apply permitted by governance policy', APPLY_REQUIREMENTS, metadata),
      proposal,
      actor,
    )
  }

  recordHealingActionDecision(
    action: HealingAction,
    governanceAction: HealingGovernanceAction = inferHealingGovernanceAction(action),
    actor = 'self_healing',
  ): GovernanceDecision {
    return this.recordGovernanceDecision(
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

    if (governanceAction === 'rollback') {
      if (action.status !== 'applied') {
        return this.withIndependentAudit({
          subjectType: 'healing_action',
          subjectId: action.id,
          action: governanceAction,
          verdict: 'blocked',
          reason: 'Only applied healing actions can be rolled back',
          actor,
          requirements: BOUNDED_POLICY_REQUIREMENTS,
          metadata,
        }, action, actor)
      }

      return this.withIndependentAudit({
        subjectType: 'healing_action',
        subjectId: action.id,
        action: governanceAction,
        verdict: 'allowed',
        reason: 'Healing action rollback permitted by governance policy',
        actor,
        requirements: mergeRequirements(HUMAN_REVIEW_REQUIREMENTS, BOUNDED_POLICY_REQUIREMENTS),
        metadata,
      }, action, actor)
    }

    if (action.status === 'blocked') {
      return this.withIndependentAudit({
        subjectType: 'healing_action',
        subjectId: action.id,
        action: governanceAction,
        verdict: 'blocked',
        reason: action.reason,
        actor,
        requirements: BOUNDED_POLICY_REQUIREMENTS,
        metadata,
      }, action, actor)
    }

    if (action.automatic && action.status === 'applied') {
      return this.withIndependentAudit({
        subjectType: 'healing_action',
        subjectId: action.id,
        action: governanceAction,
        verdict: 'allowed',
        reason: 'Automatic healing action permitted by bounded policy',
        actor,
        requirements: BOUNDED_POLICY_REQUIREMENTS,
        metadata,
      }, action, actor)
    }

    return this.withIndependentAudit({
      subjectType: 'healing_action',
      subjectId: action.id,
      action: governanceAction,
      verdict: 'allowed',
      reason: 'Healing action requires human review before application',
      actor,
      requirements: HUMAN_REVIEW_REQUIREMENTS,
      metadata,
    }, action, actor)
  }

  recordScenarioDraftDecision(
    draft: ScenarioDraft,
    governanceAction: ScenarioDraftGovernanceAction = inferScenarioDraftGovernanceAction(draft),
    actor = draft.reviewedBy ?? 'human_reviewer',
  ): GovernanceDecision {
    return this.recordGovernanceDecision(
      this.decideScenarioDraftAction(draft, governanceAction, actor),
    )
  }

  recordScenarioDraftTransitionDecision(
    draft: ScenarioDraft,
    status: ScenarioDraft['status'],
    actor = 'human_reviewer',
  ): GovernanceDecision {
    return this.recordGovernanceDecision(
      this.decideScenarioDraftAction({ ...draft, status, reviewedBy: actor }, inferScenarioDraftGovernanceAction({ ...draft, status }), actor),
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

    return this.withIndependentAudit({
      subjectType: 'scenario_draft',
      subjectId: draft.id,
      action: governanceAction,
      verdict: 'allowed',
      reason: scenarioDraftReason(draft.status),
      actor,
      requirements: HUMAN_REVIEW_REQUIREMENTS,
      metadata,
    }, draft, actor)
  }

  private withIndependentAudit(
    decision: GovernanceDecisionInput,
    subject: LearningProposal | ScenarioDraft | HealingAction,
    actor?: string,
  ): GovernanceDecisionInput {
    const audit = this.auditor.evaluateGovernanceAction({
      subjectType: decision.subjectType,
      subject,
      action: decision.action,
      actor,
      sessionService: this.sessionService,
    })
    const requirements = mergeRequirements(INDEPENDENT_AUDIT_REQUIREMENTS, decision.requirements)
    const metadata = {
      ...(decision.metadata ?? {}),
      independentAudit: serializeAudit(audit),
    }

    if (audit.verdict === 'failed') {
      return {
        ...decision,
        verdict: 'blocked',
        reason: `Independent audit failed: ${audit.findings.map((finding) => finding.code).join(', ')}`,
        requirements,
        metadata,
      }
    }

    return {
      ...decision,
      requirements,
      metadata,
    }
  }

  private recordGovernanceDecision(input: GovernanceDecisionInput): GovernanceDecision {
    const decision = this.sessionService.recordGovernanceDecision(input)
    defaultRuntimeHookBus.emitSync('onGovernanceDecision', {
      payload: {
        subjectType: decision.subjectType,
        subjectId: decision.subjectId,
        action: decision.action,
        verdict: decision.verdict,
        actor: decision.actor,
      },
    })
    return decision
  }
}

function mergeRequirements(...groups: (string[] | undefined)[]): string[] {
  return [...new Set(groups.flatMap((group) => group ?? []))]
}

function serializeAudit(audit: GovernanceAuditEvaluation): Record<string, unknown> {
  return {
    verdict: audit.verdict,
    checkedAt: audit.checkedAt,
    findings: audit.findings.map((finding) => ({
      severity: finding.severity,
      code: finding.code,
      message: finding.message,
      evidence: finding.evidence,
    })),
    requirements: audit.summary.requirements,
  }
}

function inferHealingGovernanceAction(action: HealingAction): HealingGovernanceAction {
  return action.status === 'applied' || action.status === 'blocked' ? 'apply' : 'evaluate'
}

function inferScenarioDraftGovernanceAction(draft: ScenarioDraft): ScenarioDraftGovernanceAction {
  if (draft.status === 'approved') return 'approve'
  if (draft.status === 'rejected') return 'reject'
  if (draft.status === 'promoted') return 'promote'
  return 'evaluate'
}

function scenarioDraftReason(status: ScenarioDraft['status']): string {
  if (status === 'approved') return 'Scenario draft approved by human review'
  if (status === 'rejected') return 'Scenario draft rejected by human review'
  if (status === 'revised') return 'Scenario draft marked for revision by human review'
  if (status === 'promoted') return 'Scenario draft promoted into active scenario review set'
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

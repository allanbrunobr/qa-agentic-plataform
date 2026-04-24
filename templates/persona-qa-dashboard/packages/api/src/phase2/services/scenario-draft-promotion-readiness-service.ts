import { GovernancePolicyService } from './governance-policy-service.js'
import {
  getScenarioDraftGraphReadiness,
  getScenarioDraftMappingReview,
  isScenarioDraftGraphReady,
  isScenarioDraftMappingReviewComplete,
  requiresDomainMappingReview,
  requiresGraphReadinessGate,
  type ScenarioDraftGraphReadiness,
  type ScenarioDraftMappingReview,
} from './scenario-draft-mapping-review.js'
import type { GovernanceDecisionInput, ScenarioDraft, SessionService } from './session-service.js'

export type ScenarioDraftPromotionRequirementStatus = 'passed' | 'blocked' | 'warning' | 'not_applicable'
export type ScenarioDraftPromotionAction = 'approve' | 'promote'

export interface ScenarioDraftPromotionRequirement {
  id: string
  label: string
  status: ScenarioDraftPromotionRequirementStatus
  blocking: boolean
  detail: string
  evidence?: Record<string, unknown>
}

export interface ScenarioDraftPromotionActionReadiness {
  action: ScenarioDraftPromotionAction
  allowed: boolean
  verdict: GovernanceDecisionInput['verdict']
  reason: string
  requirements: string[]
}

export interface ScenarioDraftPromotionReadinessReport {
  draftId: string
  scenarioId: string
  status: ScenarioDraft['status']
  actor: string
  readyForApproval: boolean
  readyForPromotion: boolean
  graphReadiness: ScenarioDraftGraphReadiness | null
  mappingReview: ScenarioDraftMappingReview | null
  requirements: ScenarioDraftPromotionRequirement[]
  actions: {
    approve: ScenarioDraftPromotionActionReadiness
    promote: ScenarioDraftPromotionActionReadiness
  }
  nextSteps: string[]
}

export class ScenarioDraftPromotionReadinessService {
  constructor(private readonly sessionService: SessionService) {}

  buildReport(draft: ScenarioDraft, actor = draft.reviewedBy ?? 'human_reviewer'): ScenarioDraftPromotionReadinessReport {
    const governance = new GovernancePolicyService(this.sessionService)
    const approveDecision = governance.decideScenarioDraftAction(draft, 'approve', actor)
    const promoteDecision = governance.decideScenarioDraftAction({ ...draft, status: 'promoted' }, 'promote', actor)
    const requirements = buildRequirements(draft, this.sessionService, actor)
    const readyForApproval = approveDecision.verdict === 'allowed'
    const readyForPromotion = draft.status === 'approved' && promoteDecision.verdict === 'allowed'

    return {
      draftId: draft.id,
      scenarioId: draft.scenarioId,
      status: draft.status,
      actor,
      readyForApproval,
      readyForPromotion,
      graphReadiness: getScenarioDraftGraphReadiness(draft),
      mappingReview: requiresDomainMappingReview(draft) ? getScenarioDraftMappingReview(draft) : null,
      requirements,
      actions: {
        approve: actionReadiness('approve', approveDecision),
        promote: {
          ...actionReadiness('promote', promoteDecision),
          allowed: readyForPromotion,
          reason: draft.status === 'approved'
            ? promoteDecision.reason
            : 'Scenario draft must be approved before promotion',
        },
      },
      nextSteps: requirements
        .filter((requirement) => requirement.blocking)
        .map((requirement) => requirement.detail),
    }
  }
}

function buildRequirements(
  draft: ScenarioDraft,
  sessionService: SessionService,
  actor: string,
): ScenarioDraftPromotionRequirement[] {
  return [
    explicitReviewerRequirement(actor),
    graphReadinessRequirement(draft),
    domainMappingRequirement(draft),
    approvedStatusRequirement(draft),
    approvalGovernanceRequirement(draft, sessionService),
  ]
}

function explicitReviewerRequirement(actor: string): ScenarioDraftPromotionRequirement {
  const explicit = Boolean(actor && actor !== 'system' && actor !== 'human_reviewer')
  return {
    id: 'explicit_reviewer',
    label: 'Explicit reviewer',
    status: explicit ? 'passed' : 'blocked',
    blocking: !explicit,
    detail: explicit
      ? `Reviewer ${actor} is explicit.`
      : 'Set an explicit human reviewer before approval or promotion.',
    evidence: { actor },
  }
}

function graphReadinessRequirement(draft: ScenarioDraft): ScenarioDraftPromotionRequirement {
  const readiness = getScenarioDraftGraphReadiness(draft)
  if (!requiresGraphReadinessGate(draft)) {
    return {
      id: 'graph_readiness_fully_mapped',
      label: 'Graph readiness',
      status: 'not_applicable',
      blocking: false,
      detail: 'No graph readiness snapshot is attached to this draft.',
    }
  }

  const ready = isScenarioDraftGraphReady(draft)
  return {
    id: 'graph_readiness_fully_mapped',
    label: 'Graph readiness',
    status: ready ? 'passed' : 'blocked',
    blocking: !ready,
    detail: ready
      ? 'All required capabilities are mapped by graph evidence.'
      : `Graph readiness is ${readiness?.status ?? 'unknown'}; missing capabilities: ${readiness?.missingCapabilityIds.join(', ') || 'unknown'}.`,
    evidence: readiness ? { ...readiness } : undefined,
  }
}

function domainMappingRequirement(draft: ScenarioDraft): ScenarioDraftPromotionRequirement {
  if (!requiresDomainMappingReview(draft)) {
    return {
      id: 'domain_mapping_review_complete',
      label: 'Domain mapping review',
      status: 'not_applicable',
      blocking: false,
      detail: 'This draft does not require domain mapping review.',
    }
  }

  const review = getScenarioDraftMappingReview(draft)
  const complete = isScenarioDraftMappingReviewComplete(draft)
  return {
    id: 'domain_mapping_review_complete',
    label: 'Domain mapping review',
    status: complete ? 'passed' : 'blocked',
    blocking: !complete,
    detail: complete
      ? 'Selectors, auth, test data, assertions, and reviewer are mapped.'
      : 'Complete selectors, auth, test data, assertions, and reviewer mapping before approval.',
    evidence: { ...review },
  }
}

function approvedStatusRequirement(draft: ScenarioDraft): ScenarioDraftPromotionRequirement {
  const approved = draft.status === 'approved' || draft.status === 'promoted'
  return {
    id: 'approved_status_before_promotion',
    label: 'Approved status',
    status: approved ? 'passed' : 'blocked',
    blocking: !approved,
    detail: approved
      ? 'Draft status allows promotion.'
      : `Draft status is ${draft.status}; approve it before promotion.`,
    evidence: { status: draft.status },
  }
}

function approvalGovernanceRequirement(
  draft: ScenarioDraft,
  sessionService: SessionService,
): ScenarioDraftPromotionRequirement {
  const approvals = sessionService.listGovernanceDecisions({
    subjectType: 'scenario_draft',
    subjectId: draft.id,
    limit: 100,
  }).filter((decision) => decision.action === 'approve' && decision.verdict === 'allowed')
  const approved = approvals.length > 0

  return {
    id: 'approval_governance_evidence',
    label: 'Approval governance evidence',
    status: approved ? 'passed' : 'blocked',
    blocking: !approved,
    detail: approved
      ? 'Prior allowed approval governance decision exists.'
      : 'Record an allowed approval governance decision before promotion.',
    evidence: { allowedApprovalDecisions: approvals.length },
  }
}

function actionReadiness(
  action: ScenarioDraftPromotionAction,
  decision: GovernanceDecisionInput,
): ScenarioDraftPromotionActionReadiness {
  return {
    action,
    allowed: decision.verdict === 'allowed',
    verdict: decision.verdict,
    reason: decision.reason,
    requirements: decision.requirements ?? [],
  }
}

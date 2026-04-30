import { GovernancePolicyService } from './governance-policy-service.js'
import {
  classifyScenarioDraftPromotionPriority,
  type L5KnowledgePromotionPriority,
} from './l5-audit-bundle-service.js'
import {
  getScenarioDraftGraphReadiness,
  getScenarioDraftMappingReview,
  hasScenarioDraftGraphStructuralEvidence,
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

export interface ScenarioDraftPromotionRecommendation {
  priority: L5KnowledgePromotionPriority
  action: 'review' | 'approve' | 'promote' | 'none'
  structurallyPromotable: boolean
  summary: string
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
  recommendation: ScenarioDraftPromotionRecommendation
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
    const recommendation = deriveScenarioDraftPromotionRecommendation(draft, requirements, readyForApproval, readyForPromotion)

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
      recommendation,
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
    graphEvidenceDepthRequirement(draft),
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
  const structurallyShallow = readiness?.status === 'fully_mapped' && readiness && !hasScenarioDraftGraphStructuralEvidence(readiness)
  return {
    id: 'graph_readiness_fully_mapped',
    label: 'Graph readiness',
    status: ready ? 'passed' : 'blocked',
    blocking: !ready,
    detail: ready
      ? 'All required capabilities are mapped by graph evidence.'
      : structurallyShallow
        ? `Graph readiness is fully_mapped, but structural evidence depth is insufficient (handlers=${readiness.supportHandlerCount}, endpoints=${readiness.supportEndpointCount}, http=${readiness.supportHttpCallCount}, data=${readiness.supportDataAccessCount}).`
        : `Graph readiness is ${readiness?.status ?? 'unknown'}; missing capabilities: ${readiness?.missingCapabilityIds.join(', ') || 'unknown'}.`,
    evidence: readiness ? { ...readiness } : undefined,
  }
}

function graphEvidenceDepthRequirement(draft: ScenarioDraft): ScenarioDraftPromotionRequirement {
  const readiness = getScenarioDraftGraphReadiness(draft)
  if (!readiness) {
    return {
      id: 'graph_evidence_depth',
      label: 'Graph evidence depth',
      status: 'not_applicable',
      blocking: false,
      detail: 'No graph readiness snapshot is attached to this draft.',
    }
  }

  const passed = hasScenarioDraftGraphStructuralEvidence(readiness)
  return {
    id: 'graph_evidence_depth',
    label: 'Graph evidence depth',
    status: passed ? 'passed' : 'blocked',
    blocking: !passed,
    detail: passed
      ? `Structural evidence is present (handlers=${readiness.supportHandlerCount}, endpoints=${readiness.supportEndpointCount}, http=${readiness.supportHttpCallCount}, data=${readiness.supportDataAccessCount}).`
      : `Graph evidence is too shallow (handlers=${readiness.supportHandlerCount}, endpoints=${readiness.supportEndpointCount}, http=${readiness.supportHttpCallCount}, data=${readiness.supportDataAccessCount}).`,
    evidence: { ...readiness },
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

export function deriveScenarioDraftPromotionRecommendation(
  draft: ScenarioDraft,
  requirements: ScenarioDraftPromotionRequirement[],
  readyForApproval: boolean,
  readyForPromotion: boolean,
): ScenarioDraftPromotionRecommendation {
  const graphReadiness = getScenarioDraftGraphReadiness(draft)
  const structuralReady = graphReadiness ? hasScenarioDraftGraphStructuralEvidence(graphReadiness) : false
  const mappingReady = !requiresDomainMappingReview(draft) || isScenarioDraftMappingReviewComplete(draft)
  const structurallyPromotable = graphReadiness?.status === 'fully_mapped' && structuralReady && mappingReady
  const priority = classifyScenarioDraftPromotionPriority({
    draftStatus: draft.status,
    candidateStatus: candidateStatusForDraft(draft),
    graphReadinessStatus: graphReadiness?.status,
    structuralReady,
    mappingReady,
  })
  const blocking = requirements.filter((requirement) => requirement.blocking)

  if (draft.status === 'promoted') {
    return {
      priority,
      action: 'none',
      structurallyPromotable,
      summary: 'Draft is already promoted and does not require further governance action.',
    }
  }

  if (readyForPromotion) {
    return {
      priority,
      action: 'promote',
      structurallyPromotable,
      summary: 'Structurally promotion-ready. Graph, mapping, and approval governance gates are satisfied.',
    }
  }

  if (readyForApproval) {
    return {
      priority,
      action: 'approve',
      structurallyPromotable,
      summary: structurallyPromotable
        ? 'Structurally promotion-ready after approval. Record approval now, then promote.'
        : 'Approval is allowed, but promotion still depends on stronger structural evidence or mapping completeness.',
    }
  }

  const structureRequirement = blocking.find((requirement) => requirement.id === 'graph_evidence_depth')
  if (structureRequirement && graphReadiness?.status === 'fully_mapped') {
    return {
      priority,
      action: 'review',
      structurallyPromotable,
      summary: structureRequirement.detail,
    }
  }

  const graphRequirement = blocking.find((requirement) => requirement.id === 'graph_readiness_fully_mapped')
  if (graphRequirement) {
    return {
      priority,
      action: 'review',
      structurallyPromotable,
      summary: graphRequirement.detail,
    }
  }

  const mappingRequirement = blocking.find((requirement) => requirement.id === 'domain_mapping_review_complete')
  if (mappingRequirement) {
    return {
      priority,
      action: 'review',
      structurallyPromotable,
      summary: mappingRequirement.detail,
    }
  }

  const nextRequirement = blocking[0]
  return {
    priority,
    action: 'review',
    structurallyPromotable,
    summary: nextRequirement?.detail ?? 'Keep this draft in review until promotion requirements are satisfied.',
  }
}

function candidateStatusForDraft(draft: ScenarioDraft): 'requires_review' | 'approved' | 'materialized' | 'rejected' {
  if (draft.status === 'rejected') return 'rejected'
  if (draft.status === 'promoted') return 'approved'
  if (draft.status === 'approved') return 'approved'
  return 'requires_review'
}

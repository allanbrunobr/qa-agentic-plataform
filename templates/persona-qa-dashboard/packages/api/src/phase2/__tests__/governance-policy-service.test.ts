import { describe, expect, it } from 'vitest'
import { GovernancePolicyService } from '../services/governance-policy-service.js'
import { LearningControlService } from '../services/learning-control-service.js'
import { SelfHealingService } from '../services/self-healing-service.js'
import { SessionService, type LearningProposalPatchKind } from '../services/session-service.js'

describe('GovernancePolicyService', () => {
  it('records allowed approval and apply decisions for safe learning overlays', () => {
    const service = new SessionService(':memory:')
    const proposal = createProposal(service, 'safe-overlay', 'prompt_overlay')
    const learning = new LearningControlService(service)

    const approved = learning.approveProposal(proposal.id)
    const applied = learning.applyProposal(proposal.id)
    const decisions = service.listGovernanceDecisions({
      subjectType: 'learning_proposal',
      subjectId: proposal.id,
    })

    expect(approved.status).toBe('approved')
    expect(applied.status).toBe('applied')
    expect(decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'approve',
        verdict: 'allowed',
        requirements: expect.arrayContaining(['independent_audit', 'human_review']),
      }),
      expect.objectContaining({
        action: 'apply',
        verdict: 'allowed',
        requirements: expect.arrayContaining(['independent_audit', 'human_review', 'approved_learning_proposal']),
      }),
    ]))
  })

  it('blocks apply before approval and records the decision', () => {
    const service = new SessionService(':memory:')
    const proposal = createProposal(service, 'unapproved-overlay', 'prompt_overlay')
    const learning = new LearningControlService(service)

    expect(() => learning.applyProposal(proposal.id)).toThrow('Independent audit failed')

    expect(service.listGovernanceDecisions({ subjectId: proposal.id })).toContainEqual(
      expect.objectContaining({ action: 'apply', verdict: 'blocked' }),
    )
  })

  it('blocks automatic apply for capability patches after approval', () => {
    const service = new SessionService(':memory:')
    const proposal = createProposal(service, 'capability-patch', 'capability_patch')
    const learning = new LearningControlService(service)

    learning.approveProposal(proposal.id)

    expect(() => learning.applyProposal(proposal.id)).toThrow('Independent audit failed')
    expect(service.getLearningProposal(proposal.id)?.status).toBe('approved')
    expect(service.listGovernanceDecisions({ subjectId: proposal.id })).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'approve', verdict: 'allowed' }),
      expect.objectContaining({
        action: 'apply',
        verdict: 'blocked',
        metadata: expect.objectContaining({
          independentAudit: expect.objectContaining({
            verdict: 'failed',
          }),
        }),
      }),
    ]))
  })

  it('blocks apply when an approved proposal lacks prior approval governance evidence', () => {
    const service = new SessionService(':memory:')
    const proposal = createProposal(service, 'approved-without-decision', 'prompt_overlay')
    service.updateLearningProposalStatus(proposal.id, 'approved')

    expect(() => new LearningControlService(service).applyProposal(proposal.id)).toThrow('Independent audit failed')
    expect(service.getLearningProposal(proposal.id)?.status).toBe('approved')
    expect(service.listGovernanceDecisions({ subjectId: proposal.id })).toContainEqual(
      expect.objectContaining({
        action: 'apply',
        verdict: 'blocked',
        requirements: expect.arrayContaining(['independent_audit']),
        metadata: expect.objectContaining({
          independentAudit: expect.objectContaining({
            findings: expect.arrayContaining([
              expect.objectContaining({ code: 'learning_apply_without_approval_decision' }),
            ]),
          }),
        }),
      }),
    )
  })

  it('blocks automatic healing actions that are outside the audited allowlist', () => {
    const service = new SessionService(':memory:')
    const action = service.recordHealingAction({
      type: 'rewrite_capability_source',
      target: 'scenario:step',
      reason: 'unsafe test action',
      automatic: true,
      status: 'applied',
    })

    const decision = new GovernancePolicyService(service).recordHealingActionDecision(action)

    expect(decision.verdict).toBe('blocked')
    expect(decision.requirements).toEqual(expect.arrayContaining(['independent_audit', 'bounded_policy']))
    expect(decision.metadata).toEqual(expect.objectContaining({
      independentAudit: expect.objectContaining({
        findings: expect.arrayContaining([
          expect.objectContaining({ code: 'healing_auto_action_not_allowlisted' }),
          expect.objectContaining({ code: 'healing_auto_action_unbounded' }),
        ]),
      }),
    }))
  })

  it('marks self-healing actions as blocked when the independent audit fails', () => {
    const service = new SessionService(':memory:')
    const session = service.createSession('first_order')

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      service.recordStepPerformance({
        sessionId: session.id,
        scenarioId: 'first_order',
        stepId: 'create_customer',
        agentId: 'sales-associate',
        status: 'timeout',
        success: false,
        attempt,
        durationMs: 90_000,
        errorMessage: 'timeout',
      })
    }

    const actions = new SelfHealingService(service, {
      maxTimeoutIncreasePercent: 80,
      maxAutoRetries: 5,
      modelRotationCooldownMs: 3_600_000,
      quarantineRequiresHuman: true,
      maxAutoHealingActionsPerHour: 10,
      duplicateActionCooldownMs: 3_600_000,
    }).evaluateRecentFailures()

    expect(actions[0]).toEqual(expect.objectContaining({
      type: 'increase_timeout_pool',
      status: 'blocked',
      automatic: true,
      metadata: expect.objectContaining({
        governanceBlocked: true,
      }),
    }))
  })
})

function createProposal(
  service: SessionService,
  recommendationId: string,
  patchKind: LearningProposalPatchKind,
) {
  return service.createLearningProposal({
    recommendationId,
    scenarioId: 'first_order',
    stepId: 'create_customer',
    agentId: 'sales-associate',
    type: patchKind === 'capability_patch' ? 'capability_patch' : 'prompt_patch',
    severity: 'medium',
    recommendation: {
      id: recommendationId,
      reason: 'test recommendation',
      suggestedAction: 'test action',
    },
    patchKind,
    target: 'agent:sales-associate',
    patchContent: patchKind === 'prompt_overlay' ? '[LEARNING OVERLAY]' : undefined,
  })
}

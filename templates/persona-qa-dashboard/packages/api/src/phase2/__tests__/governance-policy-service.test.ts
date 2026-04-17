import { describe, expect, it } from 'vitest'
import { LearningControlService } from '../services/learning-control-service.js'
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
      expect.objectContaining({ action: 'approve', verdict: 'allowed' }),
      expect.objectContaining({ action: 'apply', verdict: 'allowed' }),
    ]))
  })

  it('blocks apply before approval and records the decision', () => {
    const service = new SessionService(':memory:')
    const proposal = createProposal(service, 'unapproved-overlay', 'prompt_overlay')
    const learning = new LearningControlService(service)

    expect(() => learning.applyProposal(proposal.id)).toThrow('must be approved before apply')

    expect(service.listGovernanceDecisions({ subjectId: proposal.id })).toContainEqual(
      expect.objectContaining({ action: 'apply', verdict: 'blocked' }),
    )
  })

  it('blocks automatic apply for capability patches after approval', () => {
    const service = new SessionService(':memory:')
    const proposal = createProposal(service, 'capability-patch', 'capability_patch')
    const learning = new LearningControlService(service)

    learning.approveProposal(proposal.id)

    expect(() => learning.applyProposal(proposal.id)).toThrow('requires manual implementation')
    expect(service.getLearningProposal(proposal.id)?.status).toBe('approved')
    expect(service.listGovernanceDecisions({ subjectId: proposal.id })).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'approve', verdict: 'allowed' }),
      expect.objectContaining({ action: 'apply', verdict: 'blocked' }),
    ]))
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

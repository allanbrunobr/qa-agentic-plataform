import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { L5GovernancePanel } from '../L5GovernancePanel'
import type {
  Phase2GovernanceDecision,
  Phase2HealingAction,
  Phase2LearningProposal,
  Phase2ScenarioDraft,
} from '@/lib/api'

const now = '2026-04-17T12:00:00.000Z'

describe('L5GovernancePanel', () => {
  it('renders governance, healing, learning, and draft summaries', () => {
    render(
      <L5GovernancePanel
        healingActions={[
          healingAction({ id: 'heal-1', status: 'applied', automatic: true }),
          healingAction({ id: 'heal-2', status: 'proposed', automatic: false }),
        ]}
        governanceDecisions={[
          governanceDecision({ id: 'gov-1', verdict: 'allowed', requirements: ['bounded_policy'] }),
          governanceDecision({ id: 'gov-2', verdict: 'blocked', requirements: ['bounded_policy'] }),
        ]}
        learningProposals={[
          learningProposal({ id: 'proposal-1', status: 'applied' }),
          learningProposal({ id: 'proposal-2', status: 'proposed' }),
        ]}
        scenarioDrafts={[
          scenarioDraft({ id: 'draft-1', status: 'pending', updatedAt: '2026-04-17T12:01:00.000Z' }),
        ]}
      />,
    )

    expect(screen.getByText('L5 control plane')).toBeInTheDocument()
    expect(screen.getByText('Review queue')).toBeInTheDocument()
    expect(screen.getAllByText('Self-healing').length).toBeGreaterThan(0)
    expect(screen.getByText('Learning applied')).toBeInTheDocument()
    expect(screen.getByText('Bounded actions')).toBeInTheDocument()
    expect(screen.getAllByText('increase_timeout_pool on scenario:step').length).toBeGreaterThan(0)
    expect(screen.getAllByText('prompt_overlay for sales-associate').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Missing coverage').length).toBeGreaterThan(0)
  })

  it('renders an empty governance activity state', () => {
    render(
      <L5GovernancePanel
        healingActions={[]}
        governanceDecisions={[]}
        learningProposals={[]}
        scenarioDrafts={[]}
      />,
    )

    expect(screen.getByText('No L5 governance activity yet.')).toBeInTheDocument()
  })

  it('invokes review action callbacks', () => {
    const onApproveProposal = vi.fn()
    const onRejectDraft = vi.fn()
    const onPromoteDraft = vi.fn()

    render(
      <L5GovernancePanel
        healingActions={[]}
        governanceDecisions={[]}
        learningProposals={[learningProposal({ id: 'proposal-2', status: 'proposed' })]}
        scenarioDrafts={[
          scenarioDraft({ id: 'draft-1', status: 'pending' }),
          scenarioDraft({ id: 'draft-2', status: 'approved', name: 'Approved coverage' }),
        ]}
        onApproveProposal={onApproveProposal}
        onPromoteDraft={onPromoteDraft}
        onRejectDraft={onRejectDraft}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Approve' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Promote' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Reject' })[0]!)

    expect(onApproveProposal).toHaveBeenCalledWith('proposal-2')
    expect(onPromoteDraft).toHaveBeenCalledWith('draft-2')
    expect(onRejectDraft).toHaveBeenCalledWith('draft-1')
  })

  it('requires mapping confirmation before domain draft approval actions are shown', () => {
    const onConfirmDraftMapping = vi.fn()
    const onApproveDraft = vi.fn()

    const { rerender } = render(
      <L5GovernancePanel
        healingActions={[]}
        governanceDecisions={[]}
        learningProposals={[]}
        scenarioDrafts={[domainScenarioDraft({ id: 'domain-draft-1', status: 'pending' })]}
        onConfirmDraftMapping={onConfirmDraftMapping}
        onApproveDraft={onApproveDraft}
      />,
    )

    expect(screen.getByText('Mapping review required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm mapping' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm mapping' }))
    expect(onConfirmDraftMapping).toHaveBeenCalledWith('domain-draft-1')

    rerender(
      <L5GovernancePanel
        healingActions={[]}
        governanceDecisions={[]}
        learningProposals={[]}
        scenarioDrafts={[domainScenarioDraft({
          id: 'domain-draft-1',
          status: 'pending',
          contract: {
            domainDiscovery: {
              mappingRequired: true,
              mappingReview: {
                selectorsMapped: true,
                authMapped: true,
                testDataMapped: true,
                assertionsMapped: true,
                reviewedBy: 'qa_lead',
              },
            },
          },
        })]}
        onConfirmDraftMapping={onConfirmDraftMapping}
        onApproveDraft={onApproveDraft}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Confirm mapping' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(onApproveDraft).toHaveBeenCalledWith('domain-draft-1')
  })

  it('surfaces graph readiness blockers for domain scenario drafts', () => {
    render(
      <L5GovernancePanel
        healingActions={[]}
        governanceDecisions={[]}
        learningProposals={[]}
        scenarioDrafts={[domainScenarioDraft({
          id: 'domain-draft-graph',
          contract: {
            domainDiscovery: {
              mappingRequired: true,
              graphReadiness: {
                status: 'partially_mapped',
                requiredCapabilityCount: 2,
                mappedCapabilityCount: 1,
                mappedCapabilityIds: ['submitOrder'],
                missingCapabilityIds: ['fillCustomerEmail'],
              },
              mappingReview: {
                selectorsMapped: true,
                authMapped: true,
                testDataMapped: true,
                assertionsMapped: true,
                reviewedBy: 'qa_lead',
              },
            },
          },
        })]}
      />,
    )

    expect(screen.getByText('Graph readiness')).toBeInTheDocument()
    expect(screen.getByText('partially mapped')).toBeInTheDocument()
    expect(screen.getByText(/1\/2 capabilities mapped; missing fillCustomerEmail/)).toBeInTheDocument()
  })
})

function healingAction(overrides: Partial<Phase2HealingAction> = {}): Phase2HealingAction {
  return {
    id: 'heal',
    type: 'increase_timeout_pool',
    target: 'scenario:step',
    reason: 'Repeated timeout failures',
    automatic: true,
    status: 'applied',
    createdAt: now,
    ...overrides,
  }
}

function governanceDecision(overrides: Partial<Phase2GovernanceDecision> = {}): Phase2GovernanceDecision {
  return {
    id: 'gov',
    subjectType: 'healing_action',
    subjectId: 'heal',
    action: 'apply',
    verdict: 'allowed',
    reason: 'Automatic healing action permitted by bounded policy',
    actor: 'self_healing',
    requirements: ['bounded_policy'],
    createdAt: now,
    ...overrides,
  }
}

function learningProposal(overrides: Partial<Phase2LearningProposal> = {}): Phase2LearningProposal {
  return {
    id: 'proposal',
    recommendationId: 'rec',
    scenarioId: 'scenario',
    stepId: 'step',
    agentId: 'sales-associate',
    type: 'prompt_overlay',
    severity: 'medium',
    status: 'proposed',
    recommendation: { description: 'Persist customer artifact' },
    patchKind: 'prompt_overlay',
    createdAt: now,
    ...overrides,
  }
}

function scenarioDraft(overrides: Partial<Phase2ScenarioDraft> = {}): Phase2ScenarioDraft {
  return {
    id: 'draft',
    scenarioId: 'new_scenario',
    name: 'Missing coverage',
    description: 'Exercise missing order path',
    contract: {},
    gapType: 'coverage_gap',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function domainScenarioDraft(overrides: Partial<Phase2ScenarioDraft> = {}): Phase2ScenarioDraft {
  return scenarioDraft({
    id: 'domain-draft',
    scenarioId: 'domain_commerce_place_order',
    name: 'Domain draft: Place order',
    gapType: 'domain_discovery_mapping',
    contract: {
      domainDiscovery: {
        mappingRequired: true,
        mappingReview: {
          selectorsMapped: false,
          authMapped: false,
          testDataMapped: false,
          assertionsMapped: false,
          reviewedBy: null,
        },
      },
    },
    ...overrides,
  })
}

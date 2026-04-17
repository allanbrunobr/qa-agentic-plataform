import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    expect(screen.getByText('Missing coverage')).toBeInTheDocument()
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

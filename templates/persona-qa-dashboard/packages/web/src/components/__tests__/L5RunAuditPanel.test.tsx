import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { L5RunAuditPanel } from '../L5RunAuditPanel'
import type { Phase2ClosedLoopRun, Phase2GovernanceDecision } from '@/lib/api'

const now = '2026-04-20T18:00:00.000Z'

describe('L5RunAuditPanel', () => {
  it('renders an empty run audit state', () => {
    render(<L5RunAuditPanel run={null} />)

    expect(screen.getByText('L5 Run Audit')).toBeInTheDocument()
    expect(screen.getByText('Nenhuma iteração L5 registrada para auditar.')).toBeInTheDocument()
  })

  it('renders lifecycle, actions, verification, and governance evidence', () => {
    render(
      <L5RunAuditPanel
        run={closedLoopRun()}
        guards={[
          {
            loop: 'learning',
            status: 'open',
            reason: 'Learning queue is within bounds.',
            current: 1,
            limit: 20,
          },
          {
            loop: 'materialization',
            status: 'blocked',
            reason: 'Blocked decisions need review.',
            current: 5,
            limit: 5,
          },
        ]}
        governanceDecisions={[governanceDecision()]}
      />,
    )

    expect(screen.getByText('needs review')).toBeInTheDocument()
    expect(screen.getByText('Lifecycle recente')).toBeInTheDocument()
    expect(screen.getByText('loop completed - self healing')).toBeInTheDocument()
    expect(screen.getByText('self healing evaluated')).toBeInTheDocument()
    expect(screen.getByText('Circuit breakers bloqueados')).toBeInTheDocument()
    expect(screen.getByText('Governança recente')).toBeInTheDocument()
    expect(screen.getByText('apply - healing action')).toBeInTheDocument()
    expect(screen.getByText('Self-healing action permitted by bounded policy.')).toBeInTheDocument()
  })
})

function closedLoopRun(): Phase2ClosedLoopRun {
  return {
    id: 'run-1',
    status: 'needs_review',
    mode: 'observe',
    queuedScenarios: ['first_order'],
    actions: [
      {
        type: 'self_healing_evaluated',
        actionId: 'heal-1',
        healingType: 'increase_timeout_pool',
        status: 'applied',
      },
    ],
    verification: {
      rerunRequired: true,
      recommendation: 'Reexecute affected scenarios.',
      comparisons: [{ verdict: 'insufficient_history' }],
    },
    summary: {
      statusReason: 'Closed loop produced items that require review.',
      pendingReviews: 1,
      improvedScenarios: 0,
      regressedScenarios: 0,
    },
    metadata: {
      lifecycle: [
        {
          type: 'closed_loop_started',
          timestamp: now,
          status: 'running',
        },
        {
          type: 'loop_completed',
          timestamp: now,
          loop: 'self_healing',
          status: 'evaluated',
        },
      ],
    },
    startedAt: now,
    completedAt: now,
  }
}

function governanceDecision(): Phase2GovernanceDecision {
  return {
    id: 'decision-1',
    subjectType: 'healing_action',
    subjectId: 'heal-1',
    action: 'apply',
    verdict: 'allowed',
    reason: 'Self-healing action permitted by bounded policy.',
    requirements: ['independent_audit', 'bounded_policy'],
    actor: 'self_healing',
    createdAt: now,
  }
}

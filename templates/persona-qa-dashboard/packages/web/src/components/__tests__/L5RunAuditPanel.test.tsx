import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

    expect(screen.getAllByText('needs review')).toHaveLength(2)
    expect(screen.getByText('Lifecycle recente')).toBeInTheDocument()
    expect(screen.getByText('loop completed - self healing')).toBeInTheDocument()
    expect(screen.getByText('self healing evaluated')).toBeInTheDocument()
    expect(screen.getByText('Circuit breakers bloqueados')).toBeInTheDocument()
    expect(screen.getByText('Governança recente')).toBeInTheDocument()
    expect(screen.getByText('apply - healing action')).toBeInTheDocument()
    expect(screen.getByText('Self-healing action permitted by bounded policy.')).toBeInTheDocument()
  })

  it('renders recent run history and emits selected run changes', () => {
    const onSelectRun = vi.fn()
    const currentRun = closedLoopRun({ id: 'run-current' })
    const historicalRun = closedLoopRun({
      id: 'run-historical',
      status: 'completed',
      scenarioId: 'retorno',
      actions: [],
      summary: {
        statusReason: 'Historical closed loop completed.',
        pendingReviews: 0,
        improvedScenarios: 1,
        regressedScenarios: 0,
      },
      completedAt: '2026-04-20T17:00:00.000Z',
      startedAt: '2026-04-20T17:00:00.000Z',
    })

    render(
      <L5RunAuditPanel
        run={currentRun}
        runs={[currentRun, historicalRun]}
        selectedRunId="run-current"
        onSelectRun={onSelectRun}
      />,
    )

    expect(screen.getByText('Histórico L5')).toBeInTheDocument()
    fireEvent.click(screen.getByText('retorno').closest('button')!)

    expect(onSelectRun).toHaveBeenCalledWith('run-historical')
  })
})

function closedLoopRun(overrides: Partial<Phase2ClosedLoopRun> = {}): Phase2ClosedLoopRun {
  const run: Phase2ClosedLoopRun = {
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

  return {
    ...run,
    ...overrides,
    verification: {
      ...run.verification,
      ...overrides.verification,
    },
    summary: {
      ...run.summary,
      ...overrides.summary,
    },
    metadata: {
      ...run.metadata,
      ...overrides.metadata,
    },
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

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { L5RunAuditPanel } from '../L5RunAuditPanel'
import type { Phase2ClosedLoopAuditBundle, Phase2ClosedLoopRun, Phase2GovernanceDecision } from '@/lib/api'

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
        auditBundleUrl="/api/p2/closed-loop/runs/run-1/audit-bundle"
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
    expect(screen.getByRole('link', { name: 'Exportar bundle' })).toHaveAttribute(
      'href',
      '/api/p2/closed-loop/runs/run-1/audit-bundle',
    )
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

  it('renders safe replay controls from a loaded bundle preview', () => {
    const onLoadReplayPreview = vi.fn()
    const onRunSafeReplay = vi.fn()
    const onRunPromotionAction = vi.fn()
    const promotion = promotionPreview()

    render(
      <L5RunAuditPanel
        run={closedLoopRun()}
        replayPreview={{
          endpoint: '/api/p2/closed-loop/run',
          method: 'POST',
          safeReplayPayload: {
            scenarioId: 'first_order',
            maxScenarios: 1,
            applyApprovedChanges: false,
            generateScenarioDrafts: false,
          },
          originalIntent: {
            mode: 'apply_approved',
            scenarioId: 'first_order',
            maxScenarios: 1,
            applyApprovedChanges: true,
            generateScenarioDrafts: true,
          },
          notes: ['Replay is observe only.'],
        }}
        promotionPreview={promotion}
        onLoadReplayPreview={onLoadReplayPreview}
        onRunSafeReplay={onRunSafeReplay}
        onRunPromotionAction={onRunPromotionAction}
      />,
    )

    expect(screen.getByText('Replay seguro')).toBeInTheDocument()
    expect(screen.getByText('Replay bloqueia aplicação automática e geração de cenários; apenas reavalia o loop.')).toBeInTheDocument()
    expect(screen.getByText('Promoção de conhecimento')).toBeInTheDocument()
    expect(screen.getByText('Prompt patch for create_customer')).toBeInTheDocument()
    expect(screen.getByText('next: approve')).toBeInTheDocument()
    expect(screen.getByText('v abc123def456')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Preparar replay' }))
    fireEvent.click(screen.getByRole('button', { name: 'Executar observe' }))
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }))

    expect(onLoadReplayPreview).toHaveBeenCalledTimes(1)
    expect(onRunSafeReplay).toHaveBeenCalledTimes(1)
    expect(onRunPromotionAction).toHaveBeenCalledWith(promotion.candidates[0])
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

function promotionPreview(): Phase2ClosedLoopAuditBundle['promotion'] {
  return {
    candidates: [
      {
        id: 'learning_proposal:proposal-1:abc123def456',
        sourceRunId: 'run-1',
        subjectType: 'learning_proposal',
        subjectId: 'proposal-1',
        promotionType: 'learning_overlay',
        status: 'requires_review',
        version: 'abc123def4567890abc123def4567890abc123def4567890abc123def4567890',
        title: 'Prompt patch for create_customer',
        target: 'agent:sales-associate',
        reason: 'Step success rate is below the adaptive threshold.',
        approvalRequired: true,
        materializationReady: false,
        nextAction: 'approve',
        evidence: {
          scenarioId: 'first_order',
          stepId: 'create_customer',
          governanceEvidence: 1,
        },
      },
    ],
    notes: ['Promotion candidates are derived from the audit bundle and do not mutate runtime behavior.'],
  }
}

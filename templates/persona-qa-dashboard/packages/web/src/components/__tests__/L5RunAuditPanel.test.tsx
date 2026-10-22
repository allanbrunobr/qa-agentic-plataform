import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { L5RunAuditPanel } from '../L5RunAuditPanel'
import type {
  Phase2ClosedLoopAuditBundle,
  Phase2ClosedLoopRun,
  Phase2GovernanceDecision,
  Phase2KnowledgePromotionEvent,
} from '@/lib/api'

const now = '2026-04-20T18:00:00.000Z'

describe('L5RunAuditPanel', () => {
  it('renders an empty run audit state', () => {
    render(<L5RunAuditPanel run={null} />)

    expect(screen.getByText('L5 Run Audit')).toBeInTheDocument()
    expect(screen.getByText('No L5 iterations recorded to audit.')).toBeInTheDocument()
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
    expect(screen.getByText('Recent lifecycle')).toBeInTheDocument()
    expect(screen.getByText('loop completed - self healing')).toBeInTheDocument()
    expect(screen.getByText('self healing evaluated')).toBeInTheDocument()
    expect(screen.getByText('Blocked circuit breakers')).toBeInTheDocument()
    expect(screen.getByText('Independent auditor')).toBeInTheDocument()
    expect(screen.getAllByText('warning').length).toBeGreaterThan(0)
    expect(screen.getByText('Audited sessions')).toBeInTheDocument()
    expect(screen.getByText('Auditor findings')).toBeInTheDocument()
    expect(screen.getByText('Recent governance')).toBeInTheDocument()
    expect(screen.getByText('apply - healing action')).toBeInTheDocument()
    expect(screen.getByText('Self-healing action permitted by bounded policy.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Export bundle' })).toHaveAttribute(
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
      scenarioId: 'reorder',
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

    expect(screen.getByText('L5 history')).toBeInTheDocument()
    fireEvent.click(screen.getByText('reorder').closest('button')!)

    expect(onSelectRun).toHaveBeenCalledWith('run-historical')
  })

  it('emits independent audit review actions for failed auditor runs', () => {
    const onReviewIndependentAudit = vi.fn()
    const run = closedLoopRun({
      verification: {
        independentAudit: {
          agentRole: 'auditor',
          verdict: 'failed',
          checkedAt: now,
          sessionAudits: [],
          findings: [{ severity: 'error', code: 'agent_start_without_stop' }],
          summary: {
            auditedSessions: 1,
            failedSessionAudits: 1,
            warningSessionAudits: 0,
            lifecycleFindings: 1,
            findings: 1,
            actionCount: 0,
            pendingReviews: 1,
            materializedChanges: 0,
          },
        },
      },
    })

    render(
      <L5RunAuditPanel
        run={run}
        onReviewIndependentAudit={onReviewIndependentAudit}
      />,
    )

    expect(screen.getByText('Independent audit failed; record a review to release the L5 circuit breaker.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark audit as reviewed' })).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('Review reason'), {
      target: { value: 'Finding accepted after manual triage.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Mark audit as reviewed' }))

    expect(onReviewIndependentAudit).toHaveBeenCalledWith(run, 'Finding accepted after manual triage.')
  })

  it('renders audit review queue and reviewed history', () => {
    const onSelectRun = vi.fn()
    const run = closedLoopRun()

    render(
      <L5RunAuditPanel
        run={run}
        auditReviews={[{
          id: 'review-1',
          runId: run.id,
          status: 'reviewed',
          actor: 'qa_lead',
          reason: 'Warning reviewed.',
          createdAt: now,
        }]}
        auditReviewQueue={[{
          runId: 'run-pending',
          status: 'needs_review',
          scenarioId: 'quarterly_reorder',
          verdict: 'warning',
          findingCount: 2,
          auditedSessions: 1,
          statusReason: 'Pending independent audit review.',
          completedAt: now,
        }]}
        learningSignals={[{
          id: 'signal-1',
          sourceType: 'independent_audit_review',
          sourceId: 'review-1',
          signalType: 'audit_reviewed',
          sourceRunId: run.id,
          scenarioId: 'first_order',
          version: 'review:review-1',
          confidence: 0.8,
          status: 'retained',
          summary: 'Warning reviewed.',
          createdAt: now,
        }, {
          id: 'signal-2',
          sourceType: 'closed_loop_replay',
          sourceId: 'replay:queue:session-stable-1',
          signalType: 'replay_verified',
          scenarioId: 'first_order',
          version: 'replay:session-stable-1:passed',
          confidence: 0.9,
          status: 'retained',
          summary: 'Autonomous replay stable.',
          evidence: {
            replayStatus: 'passed',
            sourceSessionId: 'session-stable-1',
          },
          metadata: {
            conflictResolution: {
              supersededSignalIds: ['signal-1'],
            },
          },
          createdAt: now,
        }]}
        onSelectRun={onSelectRun}
      />,
    )

    expect(screen.getByText('L5 review queue')).toBeInTheDocument()
    expect(screen.getByText('quarterly reorder')).toBeInTheDocument()
    expect(screen.getByText('Audit reviewed by qa_lead: Warning reviewed.')).toBeInTheDocument()
    expect(screen.getByText('L5 memory')).toBeInTheDocument()
    expect(screen.getByText('audit reviewed')).toBeInTheDocument()
    expect(screen.getByText('Warning reviewed.')).toBeInTheDocument()
    expect(screen.getByText('replay verified')).toBeInTheDocument()
    expect(screen.getByText('Autonomous replay stable.')).toBeInTheDocument()
    expect(screen.getByText('replay passed')).toBeInTheDocument()
    expect(screen.getByText('sess session-')).toBeInTheDocument()
    expect(screen.getByText('superseded 1')).toBeInTheDocument()

    fireEvent.click(screen.getByText('quarterly reorder').closest('button')!)
    expect(onSelectRun).toHaveBeenCalledWith('run-pending')
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
        promotionEvents={[promotionEvent()]}
        auditReviews={[auditReview('run-1')]}
        onLoadReplayPreview={onLoadReplayPreview}
        onRunSafeReplay={onRunSafeReplay}
        onRunPromotionAction={onRunPromotionAction}
      />,
    )

    expect(screen.getByText('Safe replay')).toBeInTheDocument()
    expect(screen.getByText('Replay blocks automatic apply and scenario generation; it only re-evaluates the loop.')).toBeInTheDocument()
    expect(screen.getByText('Knowledge promotion')).toBeInTheDocument()
    expect(screen.getByText('Prompt patch for register_customer')).toBeInTheDocument()
    expect(screen.getByText('next: approve')).toBeInTheDocument()
    expect(screen.getByText('v abc123def456')).toBeInTheDocument()
    expect(screen.getByText('Promotion history')).toBeInTheDocument()
    expect(screen.getByText('approve - learning proposal')).toBeInTheDocument()
    expect(screen.getByText('qa_lead / v abc123def456')).toBeInTheDocument()
    expect(screen.getByText('gate: passed')).toBeInTheDocument()
    expect(screen.getByText('2 checks')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Prepare replay' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run observe' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

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
      independentAudit: {
        agentRole: 'auditor',
        verdict: 'warning',
        checkedAt: now,
        sessionAudits: [],
        findings: [
          {
            severity: 'warning',
            code: 'closed_loop_terminal_session_missing',
            message: 'No terminal session is available for independent scenario audit.',
            evidence: { scenarioId: 'first_order' },
          },
        ],
        summary: {
          auditedSessions: 0,
          failedSessionAudits: 0,
          warningSessionAudits: 0,
          lifecycleFindings: 0,
          findings: 1,
          actionCount: 1,
          pendingReviews: 1,
          materializedChanges: 0,
        },
      },
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

function auditReview(runId: string) {
  return {
    id: `review-${runId}`,
    runId,
    status: 'reviewed' as const,
    actor: 'qa_lead',
    reason: 'Reviewed for test.',
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
        title: 'Prompt patch for register_customer',
        target: 'agent:sales_associate',
        reason: 'Step success rate is below the adaptive threshold.',
        priority: 'high',
        approvalRequired: true,
        materializationReady: false,
        nextAction: 'approve',
        evidence: {
          scenarioId: 'first_order',
          stepId: 'register_customer',
          governanceEvidence: 1,
        },
      },
    ],
    notes: ['Promotion candidates are derived from the audit bundle and do not mutate runtime behavior.'],
  }
}

function promotionEvent(): Phase2KnowledgePromotionEvent {
  return {
    id: 'promotion-event-1',
    sourceRunId: 'run-1',
    candidateId: 'learning_proposal:proposal-1:abc123def456',
    candidateVersion: 'abc123def4567890abc123def4567890abc123def4567890abc123def4567890',
    subjectType: 'learning_proposal',
    subjectId: 'proposal-1',
    promotionType: 'learning_overlay',
    action: 'approve',
    status: 'completed',
    actor: 'qa_lead',
    target: 'agent:sales_associate',
    result: {
      proposalStatus: 'approved',
      postPromotionVerification: {
        status: 'passed',
        checkedAt: now,
        subjectType: 'learning_proposal',
        subjectId: 'proposal-1',
        action: 'approve',
        checks: [
          {
            id: 'source_run_available',
            status: 'passed',
            detail: 'Source run is available.',
          },
          {
            id: 'allowed_governance_decision',
            status: 'passed',
            detail: 'Allowed governance decision exists.',
          },
        ],
        recommendation: 'Promotion completed and post-promotion verification passed.',
      },
    },
    createdAt: now,
  }
}

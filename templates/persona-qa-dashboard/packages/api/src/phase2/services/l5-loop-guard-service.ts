import type { SessionService } from './session-service.js'

export type L5LoopId = 'learning' | 'scenario_generation' | 'self_healing' | 'materialization' | 'meta_orchestration'
export type L5LoopGuardStatus = 'open' | 'blocked'

export interface L5LoopGuardLimits {
  maxPendingLearningProposals: number
  maxPendingScenarioDrafts: number
  maxBlockedGovernanceDecisions: number
  maxAutomaticHealingActionsPerHour: number
  maxFailedIndependentAudits: number
}

export interface L5LoopGuard {
  loop: L5LoopId
  status: L5LoopGuardStatus
  reason: string
  current: number
  limit: number
}

export const DEFAULT_L5_LOOP_GUARD_LIMITS: L5LoopGuardLimits = {
  maxPendingLearningProposals: 20,
  maxPendingScenarioDrafts: 20,
  maxBlockedGovernanceDecisions: 5,
  maxAutomaticHealingActionsPerHour: 10,
  maxFailedIndependentAudits: 1,
}

export class L5LoopGuardService {
  constructor(
    private readonly sessionService: SessionService,
    private readonly limits: L5LoopGuardLimits = DEFAULT_L5_LOOP_GUARD_LIMITS,
  ) {}

  summarize(): L5LoopGuard[] {
    return [
      this.learningGuard(),
      this.scenarioGenerationGuard(),
      this.selfHealingGuard(),
      this.materializationGuard(),
      this.metaOrchestrationGuard(),
    ]
  }

  assertLoopOpen(loop: L5LoopId): void {
    const guard = this.summarize().find((candidate) => candidate.loop === loop)
    if (!guard || guard.status === 'open') return
    throw new Error(`L5 ${loop} circuit breaker is blocked: ${guard.reason}`)
  }

  private learningGuard(): L5LoopGuard {
    const pending = this.sessionService.listLearningProposals({ status: 'proposed', limit: 500 }).length
    return boundedGuard({
      loop: 'learning',
      current: pending,
      limit: this.limits.maxPendingLearningProposals,
      openReason: 'Learning proposal queue is within review bounds.',
      blockedReason: 'Learning proposal queue requires human review before generating more proposals.',
    })
  }

  private scenarioGenerationGuard(): L5LoopGuard {
    const pending = this.sessionService.listScenarioDrafts({ status: 'pending', limit: 500 }).length
    return boundedGuard({
      loop: 'scenario_generation',
      current: pending,
      limit: this.limits.maxPendingScenarioDrafts,
      openReason: 'Scenario draft queue is within review bounds.',
      blockedReason: 'Scenario draft queue requires human review before generating more drafts.',
    })
  }

  private selfHealingGuard(): L5LoopGuard {
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
    const recentAutomatic = this.sessionService.countAutomaticHealingActionsSince(oneHourAgo)
    return boundedGuard({
      loop: 'self_healing',
      current: recentAutomatic,
      limit: this.limits.maxAutomaticHealingActionsPerHour,
      openReason: 'Self-healing automatic actions are within hourly bounds.',
      blockedReason: 'Self-healing hourly automatic action budget has been exhausted.',
    })
  }

  private materializationGuard(): L5LoopGuard {
    const blocked = this.countBlockedGovernanceDecisions()
    return boundedGuard({
      loop: 'materialization',
      current: blocked,
      limit: this.limits.maxBlockedGovernanceDecisions,
      openReason: 'Materialization is allowed because governance blocks are within bounds.',
      blockedReason: 'Materialization is blocked until governance failures are reviewed.',
    })
  }

  private metaOrchestrationGuard(): L5LoopGuard {
    const failedIndependentAudits = this.countFailedIndependentAudits()
    if (failedIndependentAudits >= this.limits.maxFailedIndependentAudits) {
      return {
        loop: 'meta_orchestration',
        status: 'blocked',
        reason: 'Meta-orchestration is blocked until failed independent audits are reviewed.',
        current: failedIndependentAudits,
        limit: this.limits.maxFailedIndependentAudits,
      }
    }

    const blocked = this.countBlockedGovernanceDecisions()
    return boundedGuard({
      loop: 'meta_orchestration',
      current: blocked,
      limit: this.limits.maxBlockedGovernanceDecisions,
      openReason: 'Meta-orchestration can produce governed queue recommendations.',
      blockedReason: 'Meta-orchestration is blocked until governance failures are reviewed.',
    })
  }

  private countBlockedGovernanceDecisions(): number {
    return this.sessionService
      .listGovernanceDecisions({ limit: 500 })
      .filter((decision) => decision.verdict === 'blocked')
      .length
  }

  private countFailedIndependentAudits(): number {
    const reviewedRunIds = new Set(
      this.sessionService
        .listL5IndependentAuditReviews({ limit: 500 })
        .filter((review) => review.status === 'reviewed')
        .map((review) => review.runId),
    )

    return this.sessionService
      .listL5ClosedLoopRuns({ limit: 100 })
      .filter((run) => {
        if (reviewedRunIds.has(run.id)) return false
        const independentAudit = run.verification['independentAudit']
        return independentAudit
          && typeof independentAudit === 'object'
          && !Array.isArray(independentAudit)
          && (independentAudit as Record<string, unknown>)['verdict'] === 'failed'
      })
      .length
  }
}

function boundedGuard(input: {
  loop: L5LoopId
  current: number
  limit: number
  openReason: string
  blockedReason: string
}): L5LoopGuard {
  if (input.current >= input.limit) {
    return {
      loop: input.loop,
      status: 'blocked',
      reason: input.blockedReason,
      current: input.current,
      limit: input.limit,
    }
  }

  return {
    loop: input.loop,
    status: 'open',
    reason: input.openReason,
    current: input.current,
    limit: input.limit,
  }
}

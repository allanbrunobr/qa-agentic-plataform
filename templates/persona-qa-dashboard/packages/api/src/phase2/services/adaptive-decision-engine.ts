import type {
  AdaptiveDecision,
  OrchestratorDecision,
  ScenarioStep,
} from '../types/scenario-types.js'
import type { SessionService, StepHistoryStats } from './session-service.js'

export interface AdaptiveDecisionContext {
  scenarioId: string
  step: ScenarioStep
  attempt: number
  maxAttempts: number
  previousError?: string
  sessionId?: string
}

export class AdaptiveDecisionEngine {
  private readonly adaptationCounters = new Map<string, number>()

  constructor(private readonly sessionService: SessionService) {}

  makeDecision(context: AdaptiveDecisionContext): OrchestratorDecision {
    const stats = this.sessionService.getStepHistoryStats(context.scenarioId, context.step.id, 50)
    const hasHistory = stats.totalExecutions >= 5
    const adaptations = hasHistory ? this.evaluateAdaptations(context, stats) : []

    for (const adaptation of adaptations) {
      this.sessionService.recordAdaptationEvent({
        sessionId: context.sessionId,
        scenarioId: context.scenarioId,
        stepId: context.step.id,
        type: adaptation.type,
        previousValue: adaptation.previousValue,
        newValue: adaptation.newValue,
        reason: adaptation.reason,
        confidence: adaptation.confidence,
        outcome: adaptation.applied ? 'applied' : 'proposed',
        metadata: {
          circuitBreakerOpen: adaptation.circuitBreakerOpen ?? false,
          historicalContext: adaptation.historicalContext,
        },
      })
    }

    const retry = context.attempt > 1
    return {
      stepId: context.step.id,
      decision: retry ? 'retry' : 'delegate',
      reason: retry
        ? `Retrying step ${context.step.id} with prior error context`
        : `Delegating step ${context.step.id} to agent`,
      attempt: context.attempt,
      timestamp: new Date().toISOString(),
      status: retry ? 'recoverable_failed' : undefined,
      recovery: retry
        ? {
            cause: context.previousError ?? 'previous attempt failed',
            decision: 'retry_with_context',
            factors: adaptations.map((adaptation) => adaptation.reason),
          }
        : undefined,
      adaptations,
      historicalContext: hasHistory ? {
        totalExecutions: stats.totalExecutions,
        successRate: stats.successRate,
        p95DurationMs: stats.p95DurationMs,
        retryRecoveryRate: stats.retryRecoveryRate,
        failureBreakdown: stats.failureBreakdown,
      } : undefined,
    }
  }

  private evaluateAdaptations(
    context: AdaptiveDecisionContext,
    stats: StepHistoryStats,
  ): AdaptiveDecision[] {
    const decisions: AdaptiveDecision[] = []
    const circuitBreaker = this.checkCircuitBreaker(context.scenarioId, context.step.id)

    if (circuitBreaker) {
      return [{
        type: 'circuit_breaker',
        applied: false,
        reason: 'Adaptive loop limit reached for this step',
        confidence: 1,
        circuitBreakerOpen: true,
      }]
    }

    if (context.step.timeoutMs && stats.p95DurationMs > context.step.timeoutMs * 0.8) {
      decisions.push({
        type: 'timeout',
        applied: true,
        reason: 'Historical p95 duration approaches configured timeout',
        confidence: 0.75,
        previousValue: context.step.timeoutMs,
        newValue: Math.min(Math.ceil(stats.p95DurationMs * 1.25), context.step.timeoutMs * 2),
        historicalContext: { p95DurationMs: stats.p95DurationMs },
      })
    }

    if (stats.retryRecoveryRate >= 0.5 && context.attempt > 1) {
      decisions.push({
        type: 'retry',
        applied: true,
        reason: 'Historical retry recovery rate supports another attempt',
        confidence: stats.retryRecoveryRate,
        previousValue: context.maxAttempts,
        newValue: Math.min(context.maxAttempts + 1, 3),
        historicalContext: { retryRecoveryRate: stats.retryRecoveryRate },
      })
    }

    if (context.attempt > 1 && stats.failureBreakdown['model'] && stats.successRate < 0.8) {
      decisions.push({
        type: 'model',
        applied: true,
        reason: 'Model-related failures dominate recent history on retry',
        confidence: 0.7,
        previousValue: 'current',
        newValue: 'next_stronger_model',
        historicalContext: { failureBreakdown: stats.failureBreakdown },
      })
    }

    return decisions
  }

  private checkCircuitBreaker(scenarioId: string, stepId: string): boolean {
    const key = `${scenarioId}:${stepId}`
    const next = (this.adaptationCounters.get(key) ?? 0) + 1
    this.adaptationCounters.set(key, next)
    return next > 5
  }
}

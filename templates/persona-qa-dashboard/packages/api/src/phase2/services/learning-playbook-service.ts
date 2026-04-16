import { FailurePatternService } from './failure-pattern-service.js'
import type { SessionService, StepHistoryStats } from './session-service.js'

export type LearningRecommendationType =
  | 'environment_secret_validation'
  | 'capability_patch'
  | 'prompt_patch'
  | 'timeout_strategy'
  | 'retry_strategy'
  | 'scenario_monitoring'

export interface LearningRecommendation {
  id: string
  scenarioId: string
  stepId: string
  agentId?: string
  level: 'L5_candidate'
  type: LearningRecommendationType
  severity: 'info' | 'medium' | 'high'
  reason: string
  evidence: Record<string, unknown>
  suggestedAction: string
  status: 'proposed'
  createdAt: string
}

export interface LearningPlaybook {
  scenarioId?: string
  generatedAt: string
  totalRecommendations: number
  recommendations: LearningRecommendation[]
}

export class LearningPlaybookService {
  constructor(private readonly sessionService: SessionService) {}

  buildPlaybook(filter: { scenarioId?: string; limit?: number } = {}): LearningPlaybook {
    const limit = Math.max(1, Math.min(filter.limit ?? 50, 500))
    const records = this.sessionService.listStepPerformance({
      scenarioId: filter.scenarioId,
      limit,
    })
    const stepKeys = Array.from(
      new Set(records.map((record) => `${record.scenarioId}:${record.stepId}`)),
    )

    const recommendations = stepKeys.flatMap((key) => {
      const [scenarioId, stepId] = key.split(':') as [string, string]
      const stats = this.sessionService.getStepHistoryStats(scenarioId, stepId, limit)
      return this.recommendForStep(stats)
    })

    return {
      scenarioId: filter.scenarioId,
      generatedAt: new Date().toISOString(),
      totalRecommendations: recommendations.length,
      recommendations,
    }
  }

  private recommendForStep(stats: StepHistoryStats): LearningRecommendation[] {
    const recommendations: LearningRecommendation[] = []
    const patterns = new FailurePatternService(this.sessionService).analyzeStep(
      stats.scenarioId,
      stats.stepId,
    )
    const dominantPattern = patterns[0]
    const createdAt = new Date().toISOString()

    if (dominantPattern?.category === 'auth') {
      recommendations.push(this.recommendation({
        stats,
        createdAt,
        type: 'environment_secret_validation',
        severity: 'high',
        reason: 'Authentication failures are recurring for this step.',
        evidence: { pattern: dominantPattern, failureBreakdown: stats.failureBreakdown },
        suggestedAction: 'Validate secret propagation before run start and block only when the execution provider rejects the key.',
      }))
    }

    if (dominantPattern?.category === 'capability') {
      recommendations.push(this.recommendation({
        stats,
        createdAt,
        type: 'capability_patch',
        severity: 'high',
        reason: 'Capability module resolution is failing repeatedly.',
        evidence: { pattern: dominantPattern },
        suggestedAction: 'Patch adapter discovery snapshot rules and add this missing module path to the install-local regression contract.',
      }))
    }

    if (stats.totalExecutions >= 3 && stats.successRate < 0.7) {
      recommendations.push(this.recommendation({
        stats,
        createdAt,
        type: 'prompt_patch',
        severity: 'medium',
        reason: 'Step success rate is below the adaptive threshold.',
        evidence: {
          totalExecutions: stats.totalExecutions,
          successRate: stats.successRate,
          failureBreakdown: stats.failureBreakdown,
        },
        suggestedAction: 'Generate a bounded role prompt patch from the dominant failure pattern and require human approval before applying it.',
      }))
    }

    if (stats.totalExecutions >= 5 && stats.retryRecoveryRate >= 0.5) {
      recommendations.push(this.recommendation({
        stats,
        createdAt,
        type: 'retry_strategy',
        severity: 'info',
        reason: 'Retries recover this step often enough to justify preserving retry context.',
        evidence: { retryRecoveryRate: stats.retryRecoveryRate },
        suggestedAction: 'Keep retry-with-context enabled and include the previous failure signature in the next attempt.',
      }))
    }

    if (stats.totalExecutions >= 5 && stats.p95DurationMs > 0) {
      recommendations.push(this.recommendation({
        stats,
        createdAt,
        type: 'timeout_strategy',
        severity: 'info',
        reason: 'Duration history is available for timeout tuning.',
        evidence: {
          p95DurationMs: stats.p95DurationMs,
          averageDurationMs: stats.averageDurationMs,
        },
        suggestedAction: 'Use p95 duration as the upper bound signal for future timeout adaptations.',
      }))
    }

    if (recommendations.length === 0 && stats.totalExecutions > 0) {
      recommendations.push(this.recommendation({
        stats,
        createdAt,
        type: 'scenario_monitoring',
        severity: 'info',
        reason: 'No active learning action is recommended yet.',
        evidence: {
          totalExecutions: stats.totalExecutions,
          successRate: stats.successRate,
        },
        suggestedAction: 'Keep collecting step history until enough signal exists for a safe adaptive change.',
      }))
    }

    return recommendations
  }

  private recommendation(input: {
    stats: StepHistoryStats
    createdAt: string
    type: LearningRecommendationType
    severity: LearningRecommendation['severity']
    reason: string
    evidence: Record<string, unknown>
    suggestedAction: string
  }): LearningRecommendation {
    return {
      id: [
        input.stats.scenarioId,
        input.stats.stepId,
        input.type,
      ].join(':'),
      scenarioId: input.stats.scenarioId,
      stepId: input.stats.stepId,
      agentId: input.stats.recentExecutions[0]?.agentId,
      level: 'L5_candidate',
      type: input.type,
      severity: input.severity,
      reason: input.reason,
      evidence: input.evidence,
      suggestedAction: input.suggestedAction,
      status: 'proposed',
      createdAt: input.createdAt,
    }
  }
}

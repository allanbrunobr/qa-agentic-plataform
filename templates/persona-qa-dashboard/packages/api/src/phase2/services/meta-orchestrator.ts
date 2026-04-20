import { listScenarios, loadScenario } from '../scenarios/index.js'
import type { SessionService } from './session-service.js'
import { L5LoopGuardService, type L5LoopGuard } from './l5-loop-guard-service.js'

export interface ScheduleRecommendation {
  scenarioId: string
  priority: 'critical' | 'high' | 'normal' | 'low'
  reason: string
  suggestedFrequency: 'every_commit' | 'daily' | 'weekly' | 'on_demand'
  lastRunAt: string | null
  riskScore: number
}

export interface MetaOrchestrationQueueItem extends ScheduleRecommendation {
  queueId: string
  position: number
  status: 'queued' | 'blocked'
  guard: L5LoopGuard
}

export class MetaOrchestrator {
  constructor(private readonly sessionService: SessionService) {}

  recommendSchedule(): ScheduleRecommendation[] {
    return listScenarios()
      .map((scenarioId) => this.buildRecommendation(scenarioId))
      .sort((a, b) => b.riskScore - a.riskScore || a.scenarioId.localeCompare(b.scenarioId))
  }

  optimizeRunOrder(scenarioIds: string[]): string[] {
    const riskByScenario = new Map(this.recommendSchedule().map((item) => [item.scenarioId, item.riskScore]))
    return [...scenarioIds].sort((a, b) => (riskByScenario.get(b) ?? 0) - (riskByScenario.get(a) ?? 0))
  }

  buildGovernedRunQueue(limit = 10): MetaOrchestrationQueueItem[] {
    const guard = new L5LoopGuardService(this.sessionService)
      .summarize()
      .find((candidate) => candidate.loop === 'meta_orchestration')
    const metaGuard = guard ?? {
      loop: 'meta_orchestration' as const,
      status: 'open' as const,
      reason: 'Meta-orchestration guard unavailable; defaulting to recommendation-only mode.',
      current: 0,
      limit: 0,
    }

    return this.recommendSchedule()
      .slice(0, Math.max(1, Math.min(limit, 50)))
      .map((recommendation, index) => ({
        ...recommendation,
        queueId: `${recommendation.scenarioId}:${index + 1}`,
        position: index + 1,
        status: metaGuard.status === 'open' ? 'queued' : 'blocked',
        guard: metaGuard,
      }))
  }

  private buildRecommendation(scenarioId: string): ScheduleRecommendation {
    const sessions = this.sessionService.getAllSessions()
      .filter((session) => session.scenarioId === scenarioId)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    const lastRunAt = sessions[0]?.startedAt ?? null
    const daysSinceLastRun = lastRunAt
      ? Math.floor((Date.now() - new Date(lastRunAt).getTime()) / 86_400_000)
      : 999
    const recent = this.sessionService.listStepPerformance({ scenarioId, limit: 50 })
    const failureRate = recent.length ? recent.filter((record) => !record.success).length / recent.length : 0
    const timeoutRate = recent.length ? recent.filter((record) => record.errorCategory === 'timeout').length / recent.length : 0
    const scenario = loadScenario(scenarioId)
    const criticalStepRatio = scenario.steps.filter((step) => step.handoff || step.requiredArtifacts.length > 0).length
      / Math.max(1, scenario.steps.length)
    const riskScore = calculateRiskScore({
      daysSinceLastRun,
      failureRate,
      timeoutRate,
      criticalStepRatio,
      hasNeverRun: sessions.length === 0,
    })

    return {
      scenarioId,
      priority: riskScore >= 0.75 ? 'critical' : riskScore >= 0.5 ? 'high' : riskScore >= 0.2 ? 'normal' : 'low',
      reason: buildReason({ daysSinceLastRun, failureRate, timeoutRate, hasNeverRun: sessions.length === 0 }),
      suggestedFrequency: riskScore >= 0.75 ? 'every_commit' : riskScore >= 0.5 ? 'daily' : riskScore >= 0.2 ? 'weekly' : 'on_demand',
      lastRunAt,
      riskScore,
    }
  }
}

export function calculateRiskScore(input: {
  daysSinceLastRun: number
  failureRate: number
  timeoutRate: number
  criticalStepRatio: number
  hasNeverRun?: boolean
}): number {
  let score = input.hasNeverRun ? 0.35 : 0
  if (input.daysSinceLastRun > 7) score += 0.1
  if (input.daysSinceLastRun > 30) score += 0.2
  score += Math.min(input.failureRate, 1) * 0.3
  score += Math.min(input.timeoutRate, 1) * 0.15
  score += Math.min(input.criticalStepRatio, 1) * 0.1
  return Math.min(1, Number(score.toFixed(2)))
}

function buildReason(input: {
  daysSinceLastRun: number
  failureRate: number
  timeoutRate: number
  hasNeverRun: boolean
}): string {
  if (input.hasNeverRun) return 'Scenario has no completed execution history.'
  const parts = [`last run ${input.daysSinceLastRun} day(s) ago`]
  if (input.failureRate > 0) parts.push(`failure rate ${(input.failureRate * 100).toFixed(0)}%`)
  if (input.timeoutRate > 0) parts.push(`timeout rate ${(input.timeoutRate * 100).toFixed(0)}%`)
  return parts.join('; ')
}

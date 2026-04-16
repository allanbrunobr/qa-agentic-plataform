import { listProfiles } from '../profiles/agent-profiles.js'
import type { AgentProfile } from '../types/agent-types.js'
import type { SessionService } from './session-service.js'

export interface ProfileTuningRecommendation {
  agentId: string
  field: keyof AgentProfile
  currentValue: unknown
  recommendedValue: unknown
  reason: string
  dataPoints: number
  impact: 'high' | 'medium' | 'low'
}

export class ProfileTuningService {
  constructor(private readonly sessionService: SessionService) {}

  generateRecommendations(): ProfileTuningRecommendation[] {
    const recommendations: ProfileTuningRecommendation[] = []

    for (const profile of listProfiles()) {
      const records = this.sessionService.listStepPerformance({
        agentId: profile.role,
        limit: 500,
      })
      if (records.length === 0) continue

      const durations = records.map((record) => record.durationMs).sort((a, b) => a - b)
      const p95 = percentile(durations, 0.95)
      if (p95 > profile.timeoutMs * 0.9) {
        recommendations.push({
          agentId: profile.role,
          field: 'timeoutMs',
          currentValue: profile.timeoutMs,
          recommendedValue: Math.min(300_000, Math.max(profile.timeoutMs + 15_000, Math.ceil(p95 * 1.5))),
          reason: `p95 duration ${p95}ms is above 90% of timeout ${profile.timeoutMs}ms.`,
          dataPoints: records.length,
          impact: p95 > profile.timeoutMs ? 'high' : 'medium',
        })
      }

      const retryAttempts = records.filter((record) => record.attempt > 1)
      const retrySuccessRate = retryAttempts.length
        ? retryAttempts.filter((record) => record.success).length / retryAttempts.length
        : 1
      if (retryAttempts.length >= 3 && retrySuccessRate < 0.25) {
        recommendations.push({
          agentId: profile.role,
          field: 'retryPolicy',
          currentValue: profile.retryPolicy,
          recommendedValue: {
            ...profile.retryPolicy,
            maxAttempts: Math.max(1, profile.retryPolicy.maxAttempts - 1),
          },
          reason: `Retry success rate ${(retrySuccessRate * 100).toFixed(0)}% is below 25%.`,
          dataPoints: retryAttempts.length,
          impact: 'medium',
        })
      }

      const failureRate = records.filter((record) => !record.success).length / records.length
      if (records.length >= 5 && failureRate < 0.05 && profile.model?.includes('sonnet')) {
        recommendations.push({
          agentId: profile.role,
          field: 'model',
          currentValue: profile.model,
          recommendedValue: 'claude-haiku-4-5-20251001',
          reason: `Agent has ${(100 - failureRate * 100).toFixed(0)}% success rate; cheaper model can be evaluated.`,
          dataPoints: records.length,
          impact: 'low',
        })
      }
    }

    return recommendations
  }
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0
  const index = Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)
  return values[index] ?? 0
}

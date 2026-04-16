import type { AdapterContractEvaluation } from './contract-evaluation.ts'

export type ScenarioQualityGateStatus = 'open' | 'review_required' | 'restricted'

export interface ScenarioQualityGate {
  adapterId: string
  scenarioId: string
  status: ScenarioQualityGateStatus
  reason: string
  recentFinalSessions: number
  recentViolated: number
  recentDrift: number
  consecutiveViolated: number
  consecutiveFailures: number
}

export interface ScenarioEvaluationInput {
  adapterId: string
  scenarioId: string
  sessionStatus: 'pending' | 'running' | 'complete' | 'failed'
  startedAt: string
  contractEvaluation: AdapterContractEvaluation | null
}

const FINAL_SESSION_LIMIT = 5

function computeConsecutiveCount<T>(items: T[], predicate: (item: T) => boolean): number {
  let count = 0
  for (const item of items) {
    if (!predicate(item)) break
    count += 1
  }
  return count
}

export function buildScenarioQualityGate(
  adapterId: string,
  scenarioId: string,
  evaluations: ScenarioEvaluationInput[],
): ScenarioQualityGate {
  const finalEvaluations = evaluations
    .filter((item) => item.adapterId === adapterId && item.scenarioId === scenarioId)
    .filter((item) => item.sessionStatus === 'complete' || item.sessionStatus === 'failed')
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, FINAL_SESSION_LIMIT)

  const recentViolated = finalEvaluations.filter((item) => item.contractEvaluation?.verdict === 'contract_violated').length
  const recentDrift = finalEvaluations.filter((item) => item.contractEvaluation?.verdict === 'contract_drift').length
  const consecutiveViolated = computeConsecutiveCount(
    finalEvaluations,
    (item) => item.contractEvaluation?.verdict === 'contract_violated',
  )
  const consecutiveFailures = computeConsecutiveCount(finalEvaluations, (item) => item.sessionStatus === 'failed')

  if (recentViolated >= 3 || consecutiveViolated >= 3) {
    return {
      adapterId,
      scenarioId,
      status: 'restricted',
      reason: 'Scenario automatically restricted after repeated contract violations in recent runs.',
      recentFinalSessions: finalEvaluations.length,
      recentViolated,
      recentDrift,
      consecutiveViolated,
      consecutiveFailures,
    }
  }

  if (recentViolated >= 1 || recentDrift >= 3 || consecutiveFailures >= 2) {
    return {
      adapterId,
      scenarioId,
      status: 'review_required',
      reason: 'Scenario requires review due to recent violations, drift, or repeated failures.',
      recentFinalSessions: finalEvaluations.length,
      recentViolated,
      recentDrift,
      consecutiveViolated,
      consecutiveFailures,
    }
  }

  return {
    adapterId,
    scenarioId,
    status: 'open',
    reason: 'Scenario is within current quality thresholds.',
    recentFinalSessions: finalEvaluations.length,
    recentViolated,
    recentDrift,
    consecutiveViolated,
    consecutiveFailures,
  }
}

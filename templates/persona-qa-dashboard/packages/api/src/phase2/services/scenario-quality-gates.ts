import { buildContractEvaluation } from './contract-evaluation.js'
import { filterSessionsForAvailableScenarios, getAvailableScenarioIds } from './available-scenarios.js'
import type { Session } from '../types/session-types.js'
import type { SessionService } from './session-service.js'

export type ScenarioQualityGateStatus = 'open' | 'review_required' | 'restricted'

export interface ScenarioQualityGate {
  scenarioId: string
  status: ScenarioQualityGateStatus
  reason: string
  recentFinalSessions: number
  recentViolated: number
  recentDrift: number
  consecutiveViolated: number
  consecutiveFailures: number
}

const FINAL_SESSION_LIMIT = 5

function byRecent(a: Session, b: Session): number {
  return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
}

function computeConsecutiveCount<T>(items: T[], predicate: (item: T) => boolean): number {
  let count = 0
  for (const item of items) {
    if (!predicate(item)) break
    count += 1
  }
  return count
}

export function buildScenarioQualityGateForSessions(
  scenarioId: string,
  sessions: Session[],
): ScenarioQualityGate {
  const finalSessions = sessions
    .filter((session) => session.scenarioId === scenarioId)
    .filter((session) => session.status === 'complete' || session.status === 'failed')
    .sort(byRecent)
    .slice(0, FINAL_SESSION_LIMIT)

  const evaluations = finalSessions.map((session) => ({
    session,
    evaluation: buildContractEvaluation(session).contractEvaluation,
  }))

  const recentViolated = evaluations.filter(({ evaluation }) => evaluation?.verdict === 'contract_violated').length
  const recentDrift = evaluations.filter(({ evaluation }) => evaluation?.verdict === 'contract_drift').length
  const consecutiveViolated = computeConsecutiveCount(
    evaluations,
    ({ evaluation }) => evaluation?.verdict === 'contract_violated',
  )
  const consecutiveFailures = computeConsecutiveCount(finalSessions, (session) => session.status === 'failed')

  if (recentViolated >= 3 || consecutiveViolated >= 3) {
    return {
      scenarioId,
      status: 'restricted',
      reason: 'Scenario automatically restricted after repeated contract violations in recent runs.',
      recentFinalSessions: finalSessions.length,
      recentViolated,
      recentDrift,
      consecutiveViolated,
      consecutiveFailures,
    }
  }

  if (recentViolated >= 1 || recentDrift >= 3 || consecutiveFailures >= 2) {
    return {
      scenarioId,
      status: 'review_required',
      reason: 'Scenario requires review due to recent violations, drift, or repeated failures.',
      recentFinalSessions: finalSessions.length,
      recentViolated,
      recentDrift,
      consecutiveViolated,
      consecutiveFailures,
    }
  }

  return {
    scenarioId,
    status: 'open',
    reason: 'Scenario is within current quality thresholds.',
    recentFinalSessions: finalSessions.length,
    recentViolated,
    recentDrift,
    consecutiveViolated,
    consecutiveFailures,
  }
}

export function buildScenarioQualityGateMap(sessionService: SessionService): Record<string, ScenarioQualityGate> {
  const sessions = filterSessionsForAvailableScenarios(sessionService.getAllSessions())
  const scenarioIds = getAvailableScenarioIds()
  return Object.fromEntries(
    scenarioIds.map((scenarioId) => [scenarioId, buildScenarioQualityGateForSessions(scenarioId, sessions)]),
  )
}

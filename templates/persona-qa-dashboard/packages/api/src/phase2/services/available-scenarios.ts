import { listScenarios } from '../scenarios/index.js'
import type { Session } from '../types/session-types.js'

export function getAvailableScenarioIds(): string[] {
  return listScenarios()
}

export function getAvailableScenarioIdSet(): Set<string> {
  return new Set(getAvailableScenarioIds())
}

export function isAvailableScenarioId(scenarioId: string): boolean {
  if (process.env['PERSONA_QA_STRICT_AVAILABLE_SCENARIOS'] === '1') {
    return getAvailableScenarioIdSet().has(scenarioId)
  }
  return true
}

export function filterSessionsForAvailableScenarios<T extends Pick<Session, 'scenarioId'>>(sessions: T[]): T[] {
  if (process.env['PERSONA_QA_STRICT_AVAILABLE_SCENARIOS'] === '1') {
    const availableScenarioIds = getAvailableScenarioIdSet()
    return sessions.filter((session) => availableScenarioIds.has(session.scenarioId))
  }
  return sessions
}

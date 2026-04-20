import { listScenarios, loadScenario } from '../scenarios/index.js'
import type { ScenarioContract } from '../types/scenario-types.js'
import type { SessionService, ScenarioDraft } from './session-service.js'
import { L5LoopGuardService } from './l5-loop-guard-service.js'

export type CoverageGapType = 'capability_uncovered' | 'role_combination_untested' | 'edge_case_suggested'

export interface CoverageGap {
  id: string
  type: CoverageGapType
  description: string
  suggestedScenario: Partial<ScenarioContract>
  confidence: number
  evidence: string[]
}

export class CoverageAnalysisService {
  constructor(private readonly sessionService: SessionService) {}

  analyzeGaps(): CoverageGap[] {
    const gaps: CoverageGap[] = []

    for (const scenarioId of listScenarios()) {
      const scenario = loadScenario(scenarioId)
      for (const step of scenario.steps) {
        const history = this.sessionService.listStepPerformance({
          scenarioId,
          stepId: step.id,
          limit: 1,
        })

        if (history.length === 0 && step.capabilityId) {
          gaps.push({
            id: `${scenarioId}:${step.id}:capability_uncovered`,
            type: 'capability_uncovered',
            description: `Capability "${step.capabilityId}" has no recorded execution for step "${step.id}".`,
            suggestedScenario: this.buildDraftScenario(scenario, step.id),
            confidence: 0.82,
            evidence: [
              `scenario=${scenarioId}`,
              `step=${step.id}`,
              `agent=${step.agentId}`,
              `capability=${step.capabilityId}`,
            ],
          })
        }
      }

      const rolePairs = new Set<string>()
      for (let index = 0; index < scenario.steps.length - 1; index += 1) {
        const from = scenario.steps[index]
        const to = scenario.steps[index + 1]
        if (!from || !to) continue
        if (from.agentId !== to.agentId) rolePairs.add(`${from.agentId}->${to.agentId}`)
      }

      for (const pair of rolePairs) {
        const sessions = this.sessionService.getAllSessions()
          .filter((session) => session.scenarioId === scenarioId)
        const exercised = sessions.some((session) => (
          session.events.some((event) => {
            const payload = (event.payload ?? event.data ?? {}) as Record<string, unknown>
            return event.type === 'handoff_accepted'
              && `${payload['fromAgentId']}->${payload['toAgentId']}` === pair
          })
        ))

        if (!exercised) {
          gaps.push({
            id: `${scenarioId}:${pair}:role_combination_untested`,
            type: 'role_combination_untested',
            description: `Role handoff "${pair}" has no explicit handoff_completed evidence.`,
            suggestedScenario: this.buildDraftScenario(scenario, pair.replace('->', '_to_')),
            confidence: 0.64,
            evidence: [`scenario=${scenarioId}`, `handoff=${pair}`],
          })
        }
      }
    }

    return gaps
  }

  createDraftFromGap(gap: CoverageGap): ScenarioDraft {
    new L5LoopGuardService(this.sessionService).assertLoopOpen('scenario_generation')
    const scenarioId = gap.suggestedScenario.id ?? `draft_${gap.id.replace(/[^a-z0-9_]+/gi, '_').toLowerCase()}`
    return this.sessionService.createScenarioDraft({
      scenarioId,
      name: gap.suggestedScenario.name ?? `Draft for ${gap.type}`,
      description: gap.description,
      contract: gap.suggestedScenario as Record<string, unknown>,
      gapType: gap.type,
      gapEvidence: gap.evidence,
    })
  }

  private buildDraftScenario(scenario: ScenarioContract, suffix: string): Partial<ScenarioContract> {
    return {
      ...scenario,
      id: `draft_${scenario.id}_${suffix}`.replace(/[^a-z0-9_]+/gi, '_').toLowerCase(),
      name: `Draft: ${scenario.name}`,
      description: `Human-reviewed draft generated from coverage analysis for ${scenario.id}.`,
    }
  }
}

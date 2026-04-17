import type { HealingAction, SessionService, StepPerformanceRecord } from './session-service.js'

export interface HealingBounds {
  maxTimeoutIncreasePercent: number
  maxAutoRetries: number
  modelRotationCooldownMs: number
  quarantineRequiresHuman: boolean
  maxAutoHealingActionsPerHour: number
  duplicateActionCooldownMs: number
}

export const DEFAULT_HEALING_BOUNDS: HealingBounds = {
  maxTimeoutIncreasePercent: 50,
  maxAutoRetries: 5,
  modelRotationCooldownMs: 3_600_000,
  quarantineRequiresHuman: true,
  maxAutoHealingActionsPerHour: 10,
  duplicateActionCooldownMs: 3_600_000,
}

export class SelfHealingService {
  constructor(
    private readonly sessionService: SessionService,
    private readonly bounds: HealingBounds = DEFAULT_HEALING_BOUNDS,
  ) {}

  evaluateRecentFailures(): HealingAction[] {
    const actions: HealingAction[] = []
    const records = this.sessionService.listStepPerformance({ limit: 500 })
    const grouped = groupByStep(records)

    for (const [target, stepRecords] of grouped) {
      const recentThree = stepRecords.slice(0, 3)
      if (
        recentThree.length === 3
        && recentThree.every((record) => !record.success && record.errorCategory === 'timeout')
      ) {
        actions.push(this.recordAutomaticAction({
          type: 'increase_timeout_pool',
          target,
          reason: 'Step has 3 consecutive timeout failures.',
          metadata: {
            maxTimeoutIncreasePercent: this.bounds.maxTimeoutIncreasePercent,
            observedDurations: recentThree.map((record) => record.durationMs),
          },
        }))
        continue
      }

      const recentFive = stepRecords.slice(0, 5)
      if (
        recentFive.length === 5
        && recentFive.filter((record) => !record.success).length / recentFive.length >= 0.8
      ) {
        actions.push(this.recordActionOnce({
          type: 'quarantine_step',
          target,
          reason: 'Step success rate is below safety threshold in the latest executions.',
          automatic: false,
          status: 'proposed',
          metadata: { quarantineRequiresHuman: this.bounds.quarantineRequiresHuman },
        }))
      }
    }

    return actions
  }

  listLog(limit = 100): HealingAction[] {
    return this.sessionService.listHealingActions({ limit })
  }

  private recordAutomaticAction(input: {
    type: string
    target: string
    reason: string
    metadata?: Record<string, unknown>
  }): HealingAction {
    const existing = this.findRecentAction(input.type, input.target)
    if (existing) return existing

    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
    const recentActions = this.sessionService.countAutomaticHealingActionsSince(oneHourAgo)
    if (recentActions >= this.bounds.maxAutoHealingActionsPerHour) {
      return this.sessionService.recordHealingAction({
        ...input,
        automatic: false,
        status: 'blocked',
        metadata: {
          ...input.metadata,
          bound: 'maxAutoHealingActionsPerHour',
          limit: this.bounds.maxAutoHealingActionsPerHour,
        },
      })
    }

    return this.sessionService.recordHealingAction({
      ...input,
      automatic: true,
      status: 'applied',
    })
  }

  private recordActionOnce(input: {
    type: string
    target: string
    reason: string
    automatic: boolean
    status: HealingAction['status']
    metadata?: Record<string, unknown>
  }): HealingAction {
    const existing = this.findRecentAction(input.type, input.target)
    if (existing) return existing
    return this.sessionService.recordHealingAction(input)
  }

  private findRecentAction(type: string, target: string): HealingAction | undefined {
    const cutoff = Date.now() - this.bounds.duplicateActionCooldownMs
    return this.sessionService.listHealingActions({ limit: 500 }).find((action) => (
      action.type === type
      && action.target === target
      && Date.parse(action.createdAt) >= cutoff
    ))
  }
}

function groupByStep(records: StepPerformanceRecord[]): Map<string, StepPerformanceRecord[]> {
  const grouped = new Map<string, StepPerformanceRecord[]>()
  for (const record of records) {
    const key = `${record.scenarioId}:${record.stepId}`
    const bucket = grouped.get(key) ?? []
    bucket.push(record)
    grouped.set(key, bucket)
  }
  return grouped
}

import type { HealingAction, SessionService, StepPerformanceRecord } from './session-service.js'
import { GovernancePolicyService } from './governance-policy-service.js'

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
  private readonly governance: GovernancePolicyService

  constructor(
    private readonly sessionService: SessionService,
    private readonly bounds: HealingBounds = DEFAULT_HEALING_BOUNDS,
  ) {
    this.governance = new GovernancePolicyService(sessionService)
  }

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

  applyAction(id: string, actor = 'human_reviewer'): HealingAction {
    const action = this.sessionService.getHealingAction(id)
    if (!action) throw new Error(`Healing action ${id} not found`)

    const decision = this.governance.recordHealingActionDecision(action, 'apply', actor)
    if (decision.verdict === 'blocked') {
      throw new Error(decision.reason)
    }

    if (action.status === 'applied') return action

    const metadata = {
      ...(action.metadata ?? {}),
      appliedAt: new Date().toISOString(),
      appliedBy: actor,
      rollbackAvailable: true,
      appliedEffect: describeHealingEffect(action),
    }

    return this.sessionService.updateHealingActionStatus(action.id, 'applied', metadata) ?? action
  }

  rollbackAction(id: string, actor = 'human_reviewer'): HealingAction {
    const action = this.sessionService.getHealingAction(id)
    if (!action) throw new Error(`Healing action ${id} not found`)

    const decision = this.governance.recordHealingActionDecision(action, 'rollback', actor)
    if (decision.verdict === 'blocked') {
      throw new Error(decision.reason)
    }

    const metadata = {
      ...(action.metadata ?? {}),
      rolledBackAt: new Date().toISOString(),
      rolledBackBy: actor,
      rollbackOfStatus: action.status,
      rollbackEffect: describeRollbackEffect(action),
    }

    return this.sessionService.updateHealingActionStatus(action.id, 'rolled_back', metadata) ?? action
  }

  private recordAutomaticAction(input: {
    type: string
    target: string
    reason: string
    metadata?: Record<string, unknown>
  }): HealingAction {
    const existing = this.findRecentAction(input.type, input.target)
    if (existing) return this.recordReuseDecision(existing)

    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
    const recentActions = this.sessionService.countAutomaticHealingActionsSince(oneHourAgo)
    if (recentActions >= this.bounds.maxAutoHealingActionsPerHour) {
      return this.recordGovernedAction({
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

    return this.recordGovernedAction({
      ...input,
      automatic: true,
      status: 'applied',
      metadata: {
        ...(input.metadata ?? {}),
        appliedAt: new Date().toISOString(),
        appliedBy: 'self_healing',
        rollbackAvailable: true,
        appliedEffect: describeHealingEffect(input),
      },
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
    if (existing) return this.recordReuseDecision(existing)
    return this.recordGovernedAction(input)
  }

  private recordGovernedAction(input: {
    type: string
    target: string
    reason: string
    automatic: boolean
    status: HealingAction['status']
    metadata?: Record<string, unknown>
  }): HealingAction {
    const action = this.sessionService.recordHealingAction(input)
    const decision = this.governance.recordHealingActionDecision(action)
    if (decision.verdict === 'blocked' && action.status !== 'blocked') {
      return this.sessionService.updateHealingActionStatus(action.id, 'blocked', {
        ...(action.metadata ?? {}),
        governanceBlocked: true,
        governanceReason: decision.reason,
      }) ?? action
    }
    return action
  }

  private recordReuseDecision(action: HealingAction): HealingAction {
    this.governance.recordHealingActionDecision(action, 'evaluate')
    return action
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

function describeHealingEffect(action: { type: string; target: string; metadata?: Record<string, unknown> }): Record<string, unknown> {
  if (action.type === 'increase_timeout_pool') {
    return {
      kind: 'timeout_pool_multiplier',
      target: action.target,
      maxTimeoutIncreasePercent: action.metadata?.['maxTimeoutIncreasePercent'],
    }
  }

  if (action.type === 'quarantine_step') {
    return {
      kind: 'step_quarantine',
      target: action.target,
    }
  }

  return {
    kind: 'manual_review_required',
    target: action.target,
  }
}

function describeRollbackEffect(action: HealingAction): Record<string, unknown> {
  return {
    kind: 'metadata_rollback',
    target: action.target,
    originalEffect: action.metadata?.['appliedEffect'],
  }
}

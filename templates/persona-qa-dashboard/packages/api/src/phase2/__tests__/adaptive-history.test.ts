import { describe, expect, it } from 'vitest'
import { AdaptiveDecisionEngine } from '../services/adaptive-decision-engine.js'
import { FailurePatternService } from '../services/failure-pattern-service.js'
import { SessionService } from '../services/session-service.js'
import type { ScenarioStep } from '../types/scenario-types.js'

function recordStep(
  service: SessionService,
  overrides: Partial<Parameters<SessionService['recordStepPerformance']>[0]> = {},
) {
  const session = service.createSession(overrides.scenarioId ?? 'first_order')

  return service.recordStepPerformance({
    sessionId: session.id,
    scenarioId: 'first_order',
    stepId: 'register_customer',
    agentId: 'sales_associate',
    status: 'completed',
    success: true,
    attempt: 1,
    durationMs: 1000,
    ...overrides,
  })
}

function step(overrides: Partial<ScenarioStep> = {}): ScenarioStep {
  return {
    id: 'register_customer',
    name: 'Create customer',
    order: 0,
    agentId: 'sales_associate',
    requiredArtifacts: [],
    producedArtifacts: ['customerId'],
    timeoutMs: 1000,
    ...overrides,
  }
}

describe('Adaptive history foundation', () => {
  it('persists step performance and computes deterministic history stats', () => {
    const service = new SessionService()

    recordStep(service, { durationMs: 100, success: true, status: 'completed' })
    recordStep(service, { durationMs: 200, success: true, status: 'completed' })
    recordStep(service, {
      durationMs: 300,
      success: false,
      status: 'failed',
      errorMessage: '401 invalid api key',
    })
    recordStep(service, {
      durationMs: 400,
      success: true,
      status: 'completed',
      attempt: 2,
    })

    const stats = service.getStepHistoryStats('first_order', 'register_customer')

    expect(stats.totalExecutions).toBe(4)
    expect(stats.successRate).toBe(0.75)
    expect(stats.averageDurationMs).toBe(250)
    expect(stats.p95DurationMs).toBe(400)
    expect(stats.retryRecoveryRate).toBe(1)
    expect(stats.failureBreakdown).toEqual({ auth: 1 })
  })

  it('derives normalized failure patterns with mitigation hints', () => {
    const service = new SessionService()

    recordStep(service, {
      success: false,
      status: 'failed',
      errorMessage: 'Cannot find module abc123456789 from customers.ts',
    })
    recordStep(service, {
      success: false,
      status: 'failed',
      errorMessage: 'Cannot find module def987654321 from customers.ts',
    })

    const patterns = new FailurePatternService(service).analyzeStep(
      'first_order',
      'register_customer',
    )

    expect(patterns).toHaveLength(1)
    expect(patterns[0]).toMatchObject({
      category: 'capability',
      count: 2,
      mitigation: 'Check host source snapshot and capability module resolution.',
    })
    expect(patterns[0]!.signature).toContain('<id>')
  })

  it('keeps L3 fallback when history is insufficient', () => {
    const service = new SessionService()
    const decision = new AdaptiveDecisionEngine(service).makeDecision({
      scenarioId: 'first_order',
      step: step(),
      attempt: 1,
      maxAttempts: 2,
    })

    expect(decision.decision).toBe('delegate')
    expect(decision.adaptations).toEqual([])
    expect(decision.historicalContext).toBeUndefined()
  })

  it('records explainable adaptations only after sufficient history exists', () => {
    const service = new SessionService()
    const session = service.createSession('first_order')

    for (const durationMs of [900, 950, 1000, 1100, 1200]) {
      recordStep(service, { durationMs, success: true, status: 'completed' })
    }

    const decision = new AdaptiveDecisionEngine(service).makeDecision({
      scenarioId: 'first_order',
      step: step({ timeoutMs: 1000 }),
      attempt: 1,
      maxAttempts: 2,
      sessionId: session.id,
    })
    const adaptations = service.listAdaptationEvents({
      scenarioId: 'first_order',
      stepId: 'register_customer',
    })

    expect(decision.historicalContext?.totalExecutions).toBe(5)
    expect(decision.adaptations).toEqual([
      expect.objectContaining({
        type: 'timeout',
        applied: true,
        previousValue: 1000,
        newValue: 1500,
        reason: 'Historical p95 duration approaches configured timeout',
      }),
    ])
    expect(adaptations).toHaveLength(1)
    expect(adaptations[0]).toMatchObject({
      type: 'timeout',
      outcome: 'applied',
      confidence: 0.75,
    })
    expect(service.getSession(session.id)?.events.map((event) => event.type)).toContain(
      'adaptation_decision',
    )
  })
})

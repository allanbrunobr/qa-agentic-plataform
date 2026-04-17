import { describe, expect, it } from 'vitest'
import { CoverageAnalysisService } from '../services/coverage-analysis-service.js'
import { calculateRiskScore, MetaOrchestrator } from '../services/meta-orchestrator.js'
import { ProfileTuningService } from '../services/profile-tuning-service.js'
import { SelfHealingService } from '../services/self-healing-service.js'
import { SessionService } from '../services/session-service.js'

describe('L5 controlled feedback services', () => {
  it('detects uncovered scenario capabilities and stores human-reviewed drafts', () => {
    const service = new SessionService(':memory:')
    const coverage = new CoverageAnalysisService(service)

    const gaps = coverage.analyzeGaps()
    const capabilityGap = gaps.find((gap) => gap.type === 'capability_uncovered')
    expect(capabilityGap).toBeTruthy()

    const draft = coverage.createDraftFromGap(capabilityGap!)
    expect(draft.status).toBe('pending')
    expect(draft.gapType).toBe('capability_uncovered')
    expect(service.listScenarioDrafts()).toHaveLength(1)
  })

  it('recommends timeout tuning when p95 duration approaches profile timeout', () => {
    const service = new SessionService(':memory:')
    const session = service.createSession('first_order')

    service.recordStepPerformance({
      sessionId: session.id,
      scenarioId: 'first_order',
      stepId: 'create_customer',
      agentId: 'sales-associate',
      status: 'completed',
      success: true,
      attempt: 1,
      durationMs: 89_000,
    })

    const recommendations = new ProfileTuningService(service).generateRecommendations()
    expect(recommendations).toContainEqual(expect.objectContaining({
      agentId: 'sales-associate',
      field: 'timeoutMs',
    }))
  })

  it('prioritizes stale and failing scenarios in schedule recommendations', () => {
    const riskScore = calculateRiskScore({
      daysSinceLastRun: 10,
      failureRate: 0.8,
      timeoutRate: 0.5,
      criticalStepRatio: 1,
    })
    expect(riskScore).toBeGreaterThan(0.5)

    const service = new SessionService(':memory:')
    const session = service.createSession('first_order')
    service.recordStepPerformance({
      sessionId: session.id,
      scenarioId: 'first_order',
      stepId: 'create_customer',
      agentId: 'sales-associate',
      status: 'failed',
      success: false,
      attempt: 1,
      durationMs: 1_000,
      errorMessage: 'timeout',
    })

    const recommendations = new MetaOrchestrator(service).recommendSchedule()
    expect(recommendations[0]?.scenarioId).toBeTruthy()
    expect(recommendations[0]?.riskScore).toBeGreaterThan(0)
  })

  it('records bounded self-healing actions for repeated timeout failures', () => {
    const service = new SessionService(':memory:')
    const session = service.createSession('first_order')

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      service.recordStepPerformance({
        sessionId: session.id,
        scenarioId: 'first_order',
        stepId: 'create_customer',
        agentId: 'sales-associate',
        status: 'timeout',
        success: false,
        attempt,
        durationMs: 90_000,
        errorMessage: 'timeout',
      })
    }

    const healing = new SelfHealingService(service)
    const actions = healing.evaluateRecentFailures()
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'increase_timeout_pool',
      status: 'applied',
      automatic: true,
    }))
    expect(healing.listLog()).toHaveLength(1)
    expect(service.listGovernanceDecisions({
      subjectType: 'healing_action',
      subjectId: actions[0]?.id,
    })).toContainEqual(expect.objectContaining({
      action: 'apply',
      verdict: 'allowed',
      requirements: expect.arrayContaining(['independent_audit', 'bounded_policy']),
    }))
  })

  it('blocks automatic self-healing when hourly bounds are exceeded', () => {
    const service = new SessionService(':memory:')
    const session = service.createSession('first_order')

    for (let index = 0; index < 10; index += 1) {
      service.recordHealingAction({
        type: 'increase_timeout_pool',
        target: `scenario:step:${index}`,
        reason: 'seed',
        automatic: true,
        status: 'applied',
      })
    }

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      service.recordStepPerformance({
        sessionId: session.id,
        scenarioId: 'first_order',
        stepId: 'create_customer',
        agentId: 'sales-associate',
        status: 'timeout',
        success: false,
        attempt,
        durationMs: 90_000,
        errorMessage: 'timeout',
      })
    }

    const actions = new SelfHealingService(service).evaluateRecentFailures()
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'increase_timeout_pool',
      status: 'blocked',
      automatic: false,
    }))
    expect(service.listGovernanceDecisions({
      subjectType: 'healing_action',
      subjectId: actions[0]?.id,
    })).toContainEqual(expect.objectContaining({
      action: 'apply',
      verdict: 'blocked',
      requirements: expect.arrayContaining(['independent_audit', 'bounded_policy']),
    }))
  })

  it('records human-review governance decisions for proposed quarantine actions', () => {
    const service = new SessionService(':memory:')
    const session = service.createSession('first_order')

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      service.recordStepPerformance({
        sessionId: session.id,
        scenarioId: 'first_order',
        stepId: 'schedule_order',
        agentId: 'sales-associate',
        status: attempt <= 4 ? 'failed' : 'completed',
        success: attempt > 4,
        attempt,
        durationMs: 1_000,
        errorMessage: attempt <= 4 ? 'sensor validation failed' : undefined,
      })
    }

    const actions = new SelfHealingService(service).evaluateRecentFailures()

    expect(actions).toContainEqual(expect.objectContaining({
      type: 'quarantine_step',
      status: 'proposed',
      automatic: false,
    }))
    expect(service.listGovernanceDecisions({
      subjectType: 'healing_action',
      subjectId: actions[0]?.id,
    })).toContainEqual(expect.objectContaining({
      action: 'evaluate',
      verdict: 'allowed',
      requirements: expect.arrayContaining(['independent_audit', 'human_review']),
    }))
  })

  it('does not duplicate self-healing actions for unchanged failure evidence', () => {
    const service = new SessionService(':memory:')
    const session = service.createSession('first_order')

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      service.recordStepPerformance({
        sessionId: session.id,
        scenarioId: 'first_order',
        stepId: 'create_customer',
        agentId: 'sales-associate',
        status: 'timeout',
        success: false,
        attempt,
        durationMs: 90_000,
        errorMessage: 'timeout',
      })
    }

    const healing = new SelfHealingService(service)
    const first = healing.evaluateRecentFailures()
    const second = healing.evaluateRecentFailures()

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(second[0]?.id).toBe(first[0]?.id)
    expect(healing.listLog()).toHaveLength(1)
    expect(service.listGovernanceDecisions({
      subjectType: 'healing_action',
      subjectId: first[0]?.id,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'apply', verdict: 'allowed' }),
      expect.objectContaining({ action: 'evaluate', verdict: 'allowed' }),
    ]))
  })
})

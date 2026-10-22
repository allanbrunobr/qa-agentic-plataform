import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildScenarioQualityGateForSessions } from '../services/scenario-quality-gates.js'
import type { Session, SessionEvent } from '../types/session-types.js'

// `fulfillTool` lets a test simulate capability drift on the fulfill_order step.
function makeCompletedWorkflowEvents(sessionId: string, fulfillTool = 'fulfillOrder'): SessionEvent[] {
  const now = new Date().toISOString()
  return [
    { id: randomUUID(), sessionId, type: 'step_started', timestamp: now, payload: { stepId: 'register_customer' } },
    { id: randomUUID(), sessionId, type: 'tool_call', timestamp: now, payload: { toolName: 'registerCustomer' } },
    { id: randomUUID(), sessionId, type: 'step_completed', timestamp: now, payload: { stepId: 'register_customer' } },
    { id: randomUUID(), sessionId, type: 'step_started', timestamp: now, payload: { stepId: 'create_order' } },
    { id: randomUUID(), sessionId, type: 'tool_call', timestamp: now, payload: { toolName: 'createOrder' } },
    { id: randomUUID(), sessionId, type: 'step_completed', timestamp: now, payload: { stepId: 'create_order' } },
    { id: randomUUID(), sessionId, type: 'step_started', timestamp: now, payload: { stepId: 'fulfill_order' } },
    { id: randomUUID(), sessionId, type: 'tool_call', timestamp: now, payload: { toolName: fulfillTool } },
    { id: randomUUID(), sessionId, type: 'step_completed', timestamp: now, payload: { stepId: 'fulfill_order' } },
  ]
}

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: overrides.id ?? randomUUID(),
    scenarioId: overrides.scenarioId ?? 'first_order_multi_role',
    status: overrides.status ?? 'complete',
    startedAt: overrides.startedAt ?? new Date().toISOString(),
    completedAt: overrides.completedAt,
    events: overrides.events ?? [],
    artifacts: overrides.artifacts ?? {},
    findings: overrides.findings ?? [],
    checkpoint: overrides.checkpoint ?? { lastCompletedStep: -1, cursor: 0 },
    runId: overrides.runId,
  }
}

describe('scenario quality gates', () => {
  // The gate evaluates sessions against the bundled reference scenario contract.
  let previousReferenceFlag: string | undefined

  beforeAll(() => {
    previousReferenceFlag = process.env.PERSONA_QA_USE_REFERENCE_SCENARIOS
    process.env.PERSONA_QA_USE_REFERENCE_SCENARIOS = '1'
  })

  afterAll(() => {
    if (previousReferenceFlag === undefined) {
      delete process.env.PERSONA_QA_USE_REFERENCE_SCENARIOS
    } else {
      process.env.PERSONA_QA_USE_REFERENCE_SCENARIOS = previousReferenceFlag
    }
  })

  it('marks scenario as restricted after repeated recent contract violations', () => {
    const sessions = [
      makeSession({ status: 'failed', startedAt: '2026-04-14T10:00:00.000Z' }),
      makeSession({ status: 'failed', startedAt: '2026-04-14T09:00:00.000Z' }),
      makeSession({ status: 'failed', startedAt: '2026-04-14T08:00:00.000Z' }),
    ]

    const gate = buildScenarioQualityGateForSessions('first_order_multi_role', sessions)

    expect(gate.status).toBe('restricted')
    expect(gate.recentViolated).toBe(3)
  })

  it('marks scenario as review_required when there is recent drift without repeated violations', () => {
    const sessions = [
      makeSession({
        id: 'sess-1',
        status: 'complete',
        startedAt: '2026-04-14T10:00:00.000Z',
        artifacts: { customerId: '1', orderId: '2', orderFulfilled: true, extra: 'x' },
        events: makeCompletedWorkflowEvents('sess-1', 'openOrderDetails'),
      }),
      makeSession({
        id: 'sess-2',
        status: 'complete',
        startedAt: '2026-04-14T09:00:00.000Z',
        artifacts: { customerId: '1', orderId: '2', orderFulfilled: true, extra: 'y' },
        events: makeCompletedWorkflowEvents('sess-2', 'openOrderDetails'),
      }),
      makeSession({
        id: 'sess-3',
        status: 'complete',
        startedAt: '2026-04-14T08:00:00.000Z',
        artifacts: { customerId: '1', orderId: '2', orderFulfilled: true, extra: 'z' },
        events: makeCompletedWorkflowEvents('sess-3', 'openOrderDetails'),
      }),
    ]

    const gate = buildScenarioQualityGateForSessions('first_order_multi_role', sessions)

    expect(gate.status).toBe('review_required')
    expect(gate.recentDrift).toBe(3)
    expect(gate.recentViolated).toBe(0)
  })
})

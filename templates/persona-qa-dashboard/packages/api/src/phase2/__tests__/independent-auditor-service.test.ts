import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { IndependentAuditorService } from '../services/independent-auditor-service.js'
import type { Session, SessionEvent } from '../types/session-types.js'

function event(type: SessionEvent['type'], payload: Record<string, unknown>): SessionEvent {
  return {
    id: randomUUID(),
    sessionId: 'session-1',
    type,
    timestamp: new Date().toISOString(),
    payload,
  }
}

function session(events: SessionEvent[], status: Session['status'] = 'complete'): Session {
  return {
    id: 'session-1',
    scenarioId: 'first_order',
    status,
    startedAt: new Date().toISOString(),
    events,
    artifacts: {},
    findings: [],
    checkpoint: { lastCompletedStep: -1, cursor: 0 },
  }
}

describe('IndependentAuditorService', () => {
  it('passes when agent lifecycle and terminal session events are balanced', () => {
    const evaluation = new IndependentAuditorService().evaluateSession(session([
      event('agent_started', { agentId: 'sales-associate', stepId: 'create_customer', attempt: 1 }),
      event('agent_stopped', { agentId: 'sales-associate', stepId: 'create_customer', attempt: 1, status: 'completed' }),
      event('session_completed', { scenarioId: 'first_order' }),
    ]))

    expect(evaluation.verdict).toBe('passed')
    expect(evaluation.summary.agentStarted).toBe(1)
    expect(evaluation.summary.agentStopped).toBe(1)
    expect(evaluation.findings).toEqual([])
  })

  it('fails when an agent start has no matching stop', () => {
    const evaluation = new IndependentAuditorService().evaluateSession(session([
      event('agent_started', { agentId: 'sales-associate', stepId: 'create_customer', attempt: 1 }),
      event('session_completed', { scenarioId: 'first_order' }),
    ]))

    expect(evaluation.verdict).toBe('failed')
    expect(evaluation.findings).toContainEqual(expect.objectContaining({
      code: 'agent_start_without_stop',
      severity: 'error',
    }))
  })

  it('warns when a completed legacy session lacks terminal lifecycle event', () => {
    const evaluation = new IndependentAuditorService().evaluateSession(session([
      event('agent_started', { agentId: 'sales-associate', stepId: 'create_customer', attempt: 1 }),
      event('agent_stopped', { agentId: 'sales-associate', stepId: 'create_customer', attempt: 1, status: 'completed' }),
    ]))

    expect(evaluation.verdict).toBe('warning')
    expect(evaluation.findings).toContainEqual(expect.objectContaining({
      code: 'missing_session_completed',
      severity: 'warning',
    }))
  })
})

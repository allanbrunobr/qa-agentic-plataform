import type { Session, SessionEvent } from '../types/session-types.js'

export type AuditorVerdict = 'passed' | 'warning' | 'failed'
export type AuditorFindingSeverity = 'error' | 'warning'

export interface AuditorFinding {
  severity: AuditorFindingSeverity
  code: string
  message: string
  evidence: Record<string, unknown>
}

export interface AuditorEvaluation {
  sessionId: string
  verdict: AuditorVerdict
  checkedAt: string
  findings: AuditorFinding[]
  summary: {
    agentStarted: number
    agentStopped: number
    terminalEvents: number
  }
}

export class IndependentAuditorService {
  evaluateSession(session: Session): AuditorEvaluation {
    const findings: AuditorFinding[] = []
    const openAgents = new Map<string, SessionEvent[]>()
    let agentStarted = 0
    let agentStopped = 0

    for (const event of session.events) {
      if (event.type === 'agent_started') {
        agentStarted += 1
        const key = lifecycleKey(event)
        const bucket = openAgents.get(key) ?? []
        bucket.push(event)
        openAgents.set(key, bucket)
        continue
      }

      if (event.type === 'agent_stopped') {
        agentStopped += 1
        const key = lifecycleKey(event)
        const bucket = openAgents.get(key) ?? []
        if (bucket.length === 0) {
          findings.push({
            severity: 'error',
            code: 'agent_stop_without_start',
            message: 'Agent stopped event has no matching agent started event.',
            evidence: { eventId: event.id, key },
          })
          continue
        }

        bucket.shift()
        if (bucket.length === 0) {
          openAgents.delete(key)
        } else {
          openAgents.set(key, bucket)
        }
      }
    }

    for (const [key, events] of openAgents) {
      for (const event of events) {
        findings.push({
          severity: 'error',
          code: 'agent_start_without_stop',
          message: 'Agent started event has no matching agent stopped event.',
          evidence: { eventId: event.id, key },
        })
      }
    }

    const terminalEvents = session.events.filter((event) => (
      event.type === 'session_completed' || event.type === 'session_failed'
    ))

    if (session.status === 'complete' && !terminalEvents.some((event) => event.type === 'session_completed')) {
      findings.push({
        severity: 'warning',
        code: 'missing_session_completed',
        message: 'Completed session is missing a session_completed lifecycle event.',
        evidence: { sessionStatus: session.status },
      })
    }

    if (session.status === 'failed' && !terminalEvents.some((event) => event.type === 'session_failed')) {
      findings.push({
        severity: 'warning',
        code: 'missing_session_failed',
        message: 'Failed session is missing a session_failed lifecycle event.',
        evidence: { sessionStatus: session.status },
      })
    }

    if (
      terminalEvents.some((event) => event.type === 'session_completed')
      && terminalEvents.some((event) => event.type === 'session_failed')
    ) {
      findings.push({
        severity: 'error',
        code: 'conflicting_terminal_events',
        message: 'Session has both completed and failed lifecycle events.',
        evidence: { terminalEvents: terminalEvents.map((event) => event.type) },
      })
    }

    return {
      sessionId: session.id,
      verdict: findings.some((finding) => finding.severity === 'error')
        ? 'failed'
        : findings.length > 0
          ? 'warning'
          : 'passed',
      checkedAt: new Date().toISOString(),
      findings,
      summary: {
        agentStarted,
        agentStopped,
        terminalEvents: terminalEvents.length,
      },
    }
  }
}

function lifecycleKey(event: SessionEvent): string {
  const payload = (event.payload ?? event.data ?? {}) as Record<string, unknown>
  const agentId = typeof payload['agentId'] === 'string' ? payload['agentId'] : 'unknown_agent'
  const stepId = typeof payload['stepId'] === 'string' ? payload['stepId'] : 'unknown_step'
  const attempt = typeof payload['attempt'] === 'number' || typeof payload['attempt'] === 'string'
    ? String(payload['attempt'])
    : 'unknown_attempt'
  return `${agentId}:${stepId}:${attempt}`
}

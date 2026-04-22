import { describe, expect, it } from 'vitest'
import { L5ClosedLoopService } from '../services/l5-closed-loop-service.js'
import { MetaOrchestrator } from '../services/meta-orchestrator.js'
import { SessionService } from '../services/session-service.js'

describe('L5 closed-loop soak', () => {
  it('keeps replay learning bounded across repeated autonomous cycles', async () => {
    const service = new SessionService(':memory:')

    for (let cycle = 0; cycle < 6; cycle += 1) {
      const terminalSession = recordCompliantFirstOrderSession(service, cycle)
      const riskSignal = service.recordL5LearningSignal({
        sourceType: 'independent_audit_review',
        sourceId: `review-soak-risk-${cycle}`,
        signalType: 'audit_reviewed',
        sourceRunId: `loop-soak-risk-${cycle}`,
        scenarioId: 'first_order',
        version: `review:soak-risk-${cycle}`,
        confidence: 0.8,
        summary: `Reviewed warning requires replay before cycle ${cycle}.`,
        evidence: {
          auditVerdict: 'warning',
          findingCount: 1,
        },
      })

      expect(new MetaOrchestrator(service).recommendSchedule()
        .find((item) => item.scenarioId === 'first_order')?.l5SignalPolicy)
        .toEqual(expect.objectContaining({
          requiresReplay: true,
          signalIds: [riskSignal.id],
        }))

      const loop = await new L5ClosedLoopService(service).runOnce({
        scenarioId: 'first_order',
        maxScenarios: 1,
      })

      expect(loop.status).toBe('completed')
      expect(loop.summary).toEqual(expect.objectContaining({
        l5PolicyReplayVerifications: 1,
        l5PolicyReplayPassed: 1,
        l5PolicyReplayNeedsReview: 0,
      }))
      expect(loop.verification['replayVerifications']).toContainEqual(expect.objectContaining({
        scenarioId: 'first_order',
        status: 'passed',
        sourceSessionId: terminalSession.id,
        policySignalIds: [riskSignal.id],
      }))

      const policy = new MetaOrchestrator(service).recommendSchedule()
        .find((item) => item.scenarioId === 'first_order')?.l5SignalPolicy
      expect(policy).toEqual(expect.objectContaining({
        retainedSignals: 1,
        riskModifier: 0,
        requiresReplay: false,
        requiresIndependentAudit: false,
      }))
    }

    const summary = service.summarizeL5LearningSignals({
      scenarioId: 'first_order',
      limit: 500,
    })
    expect(summary.retained).toBe(1)
    expect(summary.superseded).toBe(11)
    expect(summary.bySignalType).toEqual(expect.objectContaining({
      audit_reviewed: 6,
      replay_verified: 6,
    }))
  })
})

function recordCompliantFirstOrderSession(service: SessionService, cycle: number) {
  const session = service.createSession('first_order')
  const steps = [
    { stepId: 'create_customer', artifact: 'customerId', value: `customer-${cycle}` },
    { stepId: 'schedule_order', artifact: 'eventId', value: `event-${cycle}` },
  ]

  for (const step of steps) {
    service.appendEvent(session.id, {
      type: 'step_started',
      payload: { stepId: step.stepId, agentId: 'sales-associate', attempt: 1 },
    })
    service.appendEvent(session.id, {
      type: 'agent_started',
      agentRole: 'sales-associate',
      payload: { agentId: 'sales-associate', stepId: step.stepId, attempt: 1 },
    })
    service.appendEvent(session.id, {
      type: 'agent_stopped',
      agentRole: 'sales-associate',
      payload: { agentId: 'sales-associate', stepId: step.stepId, attempt: 1 },
    })
    service.setArtifact(session.id, step.artifact, step.value)
    service.appendEvent(session.id, {
      type: 'step_completed',
      payload: { stepId: step.stepId, agentId: 'sales-associate', durationMs: 1000 },
    })
  }

  service.appendEvent(session.id, {
    type: 'session_completed',
    payload: { scenarioId: 'first_order', stepsCompleted: steps.length },
  })
  service.updateStatus(session.id, 'complete')
  return service.getSession(session.id)!
}

import { describe, expect, it } from 'vitest'
import { diagnoseFailureMessage, diagnoseSessionFailure } from '../services/failure-diagnosis-service.js'
import { SessionService } from '../services/session-service.js'

describe('FailureDiagnosisService', () => {
  it('separates provider auth from application login failures', () => {
    expect(diagnoseFailureMessage('401 {"error":{"type":"authentication_error","message":"invalid x-api-key"}}')).toMatchObject({
      rootCause: 'provider_auth',
      failureCategory: 'auth',
      retryable: false,
    })

    expect(diagnoseFailureMessage('Login timeout para dev@example.test')).toMatchObject({
      rootCause: 'application_login',
      failureCategory: 'auth',
      retryable: true,
    })
  })

  it('classifies target environment, UI, contract, and AP runtime failures', () => {
    expect(diagnoseFailureMessage('net::ERR_CONNECTION_REFUSED at http://localhost:3012')).toMatchObject({
      rootCause: 'backend_unavailable',
    })
    expect(diagnoseFailureMessage("Locator: getByRole('button', { name: 'Finalizar pedido' }) Expected: visible")).toMatchObject({
      rootCause: 'ui_selector',
    })
    expect(diagnoseFailureMessage('Missing handoff contract for step register_customer')).toMatchObject({
      rootCause: 'workflow_contract',
    })
    expect(diagnoseFailureMessage("TypeError: Cannot read properties of undefined (reading 'startedAt')")).toMatchObject({
      rootCause: 'platform_bug',
      retryable: false,
    })
  })

  it('extracts the latest failing event from a session', () => {
    const service = new SessionService(':memory:')
    const session = service.createSession('first_order')

    service.addEvent(session.id, 'step_completed', { stepId: 'register_customer' })
    service.addEvent(session.id, 'tool_result', {
      toolName: 'fulfillOrder',
      ok: false,
      error: { code: 'capability_error', message: 'Cannot find module support/auth/login.ts' },
      stepId: 'fulfill_order',
      agentId: 'fulfillment_agent',
    })

    const diagnosis = diagnoseSessionFailure(service.getSession(session.id)!)

    expect(diagnosis).toMatchObject({
      rootCause: 'capability_module',
      failureCategory: 'capability',
      sourceEventType: 'tool_result',
      sourceStepId: 'fulfill_order',
      sourceAgentId: 'fulfillment_agent',
    })
  })
})

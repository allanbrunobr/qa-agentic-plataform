import { randomUUID } from 'node:crypto'
import type { SessionEvent } from '../contracts/session-types.ts'
import type { SessionStore } from './core-runtime-contracts.ts'

export interface SessionLifecycleHooks {
  onStarted?: () => Promise<void> | void
  onStepStarted?: (stepId: string, index: number) => Promise<void> | void
  onStepCompleted?: (stepId: string, index: number) => Promise<void> | void
  onCompleted?: (completedAt: string) => Promise<void> | void
}

export interface SessionLifecycleRunInput {
  sessionStore: SessionStore
  sessionId: string
  executionId: string
  steps: string[]
  stepDelayMs?: number
  hooks?: SessionLifecycleHooks
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runSessionLifecycle(input: SessionLifecycleRunInput) {
  const { executionId, hooks, sessionId, sessionStore, steps } = input
  const stepDelayMs = input.stepDelayMs ?? 250
  const startedAt = new Date().toISOString()

  await sessionStore.updateSession(sessionId, { status: 'running' })
  await sessionStore.appendEvent({
    id: randomUUID(),
    sessionId,
    type: 'info',
    timestamp: startedAt,
    data: {
      message: 'Execution started',
      executionId,
    },
  } satisfies SessionEvent)
  await hooks?.onStarted?.()

  for (let index = 0; index < steps.length; index += 1) {
    const stepId = steps[index]
    await sessionStore.appendEvent({
      id: randomUUID(),
      sessionId,
      type: 'step_started',
      timestamp: new Date().toISOString(),
      data: { stepId, index },
    } satisfies SessionEvent)
    await hooks?.onStepStarted?.(stepId, index)
    await sleep(stepDelayMs)

    await sessionStore.appendEvent({
      id: randomUUID(),
      sessionId,
      type: 'step_completed',
      timestamp: new Date().toISOString(),
      data: { stepId, index },
    } satisfies SessionEvent)
    await hooks?.onStepCompleted?.(stepId, index)
    await sessionStore.updateSession(sessionId, {
      checkpoint: {
        lastCompletedStep: index,
        cursor: index + 1,
      },
    })
  }

  const completedAt = new Date().toISOString()
  await sessionStore.updateSession(sessionId, { status: 'complete', completedAt })
  await sessionStore.appendEvent({
    id: randomUUID(),
    sessionId,
    type: 'run_completed',
    timestamp: completedAt,
    data: {
      executionId,
      stepsCompleted: steps.length,
    },
  } satisfies SessionEvent)
  await hooks?.onCompleted?.(completedAt)
}

import { FileSessionStore, runAdapterExecutionEngine } from '../../../core/src/index.ts'
import type { AdapterExecutionDraft } from '../../../host-sdk/src/adapter-model.ts'
import type { AdapterRuntimeHooks } from '../../../host-sdk/src/runtime-hooks.ts'
import { appendExecutionEvent, updateExecutionStatus } from './execution-store.ts'
import { getAdapter } from './adapter-service.ts'
import { SESSIONS_DATA_PATH } from '../config/platform-paths.ts'

const sessionStore = new FileSessionStore({
  dataPath: SESSIONS_DATA_PATH,
})

export async function runExecutionLifecycle(draft: AdapterExecutionDraft, sessionId: string) {
  const adapter = getAdapter(draft.adapterId)
  await updateExecutionStatus(draft.executionId, 'running')
  await runAdapterExecutionEngine({
    sessionStore,
    sessionId,
    execution: draft,
    model: adapter.model,
    hooks: adapter.runtimeHooks as AdapterRuntimeHooks,
    onExecutionStarted: async () => {
      await appendExecutionEvent(draft.executionId, 'execution_started', { sessionId })
    },
    onStepStarted: async (stepId, index) => {
      await appendExecutionEvent(draft.executionId, 'step_started', { stepId, index })
    },
    onStepCompleted: async (stepId, index) => {
      await appendExecutionEvent(draft.executionId, 'step_completed', { stepId, index })
    },
    onStepFailed: async (stepId, index, errorMessage, attempt) => {
      await appendExecutionEvent(draft.executionId, 'step_failed', { stepId, index, errorMessage, attempt })
    },
    onExecutionFailed: async (stepId, index, errorMessage) => {
      await appendExecutionEvent(draft.executionId, 'execution_failed', { sessionId, stepId, index, errorMessage })
      await updateExecutionStatus(draft.executionId, 'failed')
    },
    onExecutionCancelled: async () => {
      await appendExecutionEvent(draft.executionId, 'execution_cancelled', { sessionId })
      await updateExecutionStatus(draft.executionId, 'cancelled')
    },
    onExecutionCompleted: async (completedAt) => {
      await appendExecutionEvent(draft.executionId, 'execution_completed', { sessionId, completedAt })
      await updateExecutionStatus(draft.executionId, 'complete')
    },
  })
}

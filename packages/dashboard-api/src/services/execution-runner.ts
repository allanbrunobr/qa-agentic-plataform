import path from 'node:path'
import { FileSessionStore, runAdapterExecutionEngine } from '../../../core/src/index.ts'
import type { AdapterExecutionDraft } from '../../../host-sdk/src/adapter-model.ts'
import type { AdapterRuntimeHooks } from '../../../host-sdk/src/runtime-hooks.ts'
import { appendExecutionEvent, updateExecutionStatus } from './execution-store.ts'
import { getAdapter } from './adapter-service.ts'

const sessionStore = new FileSessionStore({
  dataPath: path.resolve('/path/to/projects/agentic-platform/data/sessions.json'),
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
    onExecutionStarted: () => appendExecutionEvent(draft.executionId, 'execution_started', { sessionId }),
    onStepStarted: (stepId, index) => appendExecutionEvent(draft.executionId, 'step_started', { stepId, index }),
    onStepCompleted: (stepId, index) => appendExecutionEvent(draft.executionId, 'step_completed', { stepId, index }),
    onStepFailed: (stepId, index, errorMessage, attempt) =>
      appendExecutionEvent(draft.executionId, 'step_failed', { stepId, index, errorMessage, attempt }),
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

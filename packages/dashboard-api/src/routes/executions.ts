import { randomUUID } from 'node:crypto'
import { FileSessionStore, type SessionRecord } from '../../../core/src/index.ts'
import type { ExecutionDetailResponse, ExecutionInitRequest, ExecutionInitResponse, ExecutionListResponse } from '../types/api.ts'
import { initializeExecution } from '../services/adapter-service.ts'
import { createExecutionRecord, getExecutionRecord, listExecutionRecords } from '../services/execution-store.ts'
import { buildScenarioQualityGatesForAdapter } from '../services/governance-service.ts'
import { runExecutionLifecycle } from '../services/execution-runner.ts'
import { SESSIONS_DATA_PATH } from '../config/platform-paths.ts'

const sessionStore = new FileSessionStore({
  dataPath: SESSIONS_DATA_PATH,
})

export async function handleExecutionInitRequest(body: ExecutionInitRequest): Promise<ExecutionInitResponse> {
  if (!body.adapterId) throw new Error('adapterId is required')
  if (!body.scenarioId) throw new Error('scenarioId is required')
  if (!body.repoPath) throw new Error('repoPath is required')

  const gates = await buildScenarioQualityGatesForAdapter(body.adapterId)
  const gate = gates[body.scenarioId]
  if (gate?.status === 'restricted') {
    throw new Error(`Scenario restricted by quality gate: ${gate.reason}`)
  }

  const draft = initializeExecution(body)
  const now = new Date().toISOString()
  const sessionId = randomUUID()
  const session: SessionRecord = {
    id: sessionId,
    scenarioId: draft.scenarioId,
    status: 'pending',
    startedAt: now,
    completedAt: undefined,
    events: [
      {
        id: randomUUID(),
        sessionId,
        type: 'session_started',
        timestamp: now,
        data: {
          executionId: draft.executionId,
          adapterId: draft.adapterId,
          hostProjectPath: draft.hostProjectPath,
          personas: draft.personas,
          steps: draft.steps,
        },
      },
    ],
    artifacts: {},
    findings: [],
    checkpoint: { lastCompletedStep: -1, cursor: 0 },
  }
  await sessionStore.createSession(session)
  const execution = await createExecutionRecord(draft, sessionId)
  void runExecutionLifecycle(draft, sessionId)

  return { execution }
}

export async function handleExecutionListRequest(): Promise<ExecutionListResponse> {
  return { executions: await listExecutionRecords() }
}

export async function handleExecutionDetailRequest(executionId: string): Promise<ExecutionDetailResponse> {
  const execution = await getExecutionRecord(executionId)
  if (!execution) throw new Error(`Execution not found: ${executionId}`)
  return { execution }
}

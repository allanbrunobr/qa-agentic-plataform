import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import type { AdapterExecutionDraft } from '../../../host-sdk/src/adapter-model.ts'
import type { ExecutionEventRecord, ExecutionRecord } from '../types/api.ts'
import { EXECUTIONS_DATA_PATH as DATA_PATH } from '../config/platform-paths.ts'

async function ensureStore() {
  try {
    await fs.access(DATA_PATH)
  } catch {
    await fs.mkdir(path.dirname(DATA_PATH), { recursive: true })
    await fs.writeFile(DATA_PATH, '[]', 'utf8')
  }
}

async function readStore(): Promise<ExecutionRecord[]> {
  await ensureStore()
  const raw = await fs.readFile(DATA_PATH, 'utf8')
  return JSON.parse(raw)
}

async function writeStore(records: ExecutionRecord[]) {
  await ensureStore()
  await fs.writeFile(DATA_PATH, JSON.stringify(records, null, 2), 'utf8')
}

async function mutateRecord(
  executionId: string,
  mutator: (record: ExecutionRecord) => void,
): Promise<ExecutionRecord> {
  const records = await readStore()
  const index = records.findIndex((record) => record.executionId === executionId)
  if (index === -1) throw new Error(`Execution not found: ${executionId}`)
  mutator(records[index])
  records[index].updatedAt = new Date().toISOString()
  await writeStore(records)
  return records[index]
}

export async function createExecutionRecord(draft: AdapterExecutionDraft, sessionId: string): Promise<ExecutionRecord> {
  const now = new Date().toISOString()
  const event: ExecutionEventRecord = {
    id: randomUUID(),
    executionId: draft.executionId,
    type: 'execution_initialized',
    timestamp: now,
    payload: {
      adapterId: draft.adapterId,
      scenarioId: draft.scenarioId,
      personas: draft.personas,
      steps: draft.steps,
    },
  }
  const record: ExecutionRecord = {
    ...draft,
    sessionId,
    createdAt: now,
    updatedAt: now,
    events: [event],
  }
  const records = await readStore()
  records.unshift(record)
  await writeStore(records)
  return record
}

export async function listExecutionRecords(limit = 20): Promise<ExecutionRecord[]> {
  const records = await readStore()
  return records.slice(0, limit)
}

export async function getExecutionRecord(executionId: string): Promise<ExecutionRecord | null> {
  const records = await readStore()
  return records.find((record) => record.executionId === executionId) ?? null
}

export async function getExecutionRecordBySessionId(sessionId: string): Promise<ExecutionRecord | null> {
  const records = await readStore()
  return records.find((record) => record.sessionId === sessionId) ?? null
}

export async function appendExecutionEvent(
  executionId: string,
  type: ExecutionEventRecord['type'],
  payload: Record<string, unknown>,
): Promise<ExecutionRecord> {
  return mutateRecord(executionId, (record) => {
    record.events.push({
      id: randomUUID(),
      executionId,
      type,
      timestamp: new Date().toISOString(),
      payload,
    })
  })
}

export async function updateExecutionStatus(
  executionId: string,
  status: ExecutionRecord['status'],
): Promise<ExecutionRecord> {
  return mutateRecord(executionId, (record) => {
    record.status = status
  })
}

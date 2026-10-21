import { promises as fs } from 'node:fs'
import path from 'node:path'

import { ADAPTER_PROMOTIONS_DATA_PATH as DATA_PATH } from '../config/platform-paths.ts'

export type PersistedPromotionState = 'generated' | 'reviewed' | 'certified'

export interface AdapterPromotionRecord {
  adapterId: string
  state: PersistedPromotionState
  reason: string
  updatedAt: string
}

async function ensureStore() {
  try {
    await fs.access(DATA_PATH)
  } catch {
    await fs.mkdir(path.dirname(DATA_PATH), { recursive: true })
    await fs.writeFile(DATA_PATH, '{}', 'utf8')
  }
}

async function readStore(): Promise<Record<string, AdapterPromotionRecord>> {
  await ensureStore()
  const raw = await fs.readFile(DATA_PATH, 'utf8')
  return JSON.parse(raw) as Record<string, AdapterPromotionRecord>
}

async function writeStore(store: Record<string, AdapterPromotionRecord>) {
  await ensureStore()
  await fs.writeFile(DATA_PATH, JSON.stringify(store, null, 2), 'utf8')
}

export async function getAdapterPromotionRecord(adapterId: string): Promise<AdapterPromotionRecord | null> {
  const store = await readStore()
  return store[adapterId] ?? null
}

export async function saveAdapterPromotionRecord(
  adapterId: string,
  state: PersistedPromotionState,
  reason: string,
): Promise<AdapterPromotionRecord> {
  const store = await readStore()
  const record: AdapterPromotionRecord = {
    adapterId,
    state,
    reason,
    updatedAt: new Date().toISOString(),
  }
  store[adapterId] = record
  await writeStore(store)
  return record
}

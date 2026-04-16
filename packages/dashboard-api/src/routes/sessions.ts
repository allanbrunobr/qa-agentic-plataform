import path from 'node:path'
import { FileSessionStore } from '../../../core/src/index.ts'
import type { SessionDetailResponse, SessionListResponse } from '../types/api.ts'
import { buildSessionGovernance } from '../services/governance-service.ts'

const sessionStore = new FileSessionStore({
  dataPath: path.resolve('/path/to/projects/agentic-platform/data/sessions.json'),
})

export async function handleSessionListRequest(): Promise<SessionListResponse> {
  const sessions = await sessionStore.listSessions()
  const enrichedSessions = await Promise.all(
    sessions.map(async (session) => {
      const governance = await buildSessionGovernance(session.id)
      return {
        ...session,
        contractEvaluation: governance?.contractEvaluation ?? null,
        executionId: governance?.executionId ?? null,
        adapterId: governance?.adapterId ?? null,
      }
    }),
  )
  return { sessions: enrichedSessions }
}

export async function handleSessionDetailRequest(sessionId: string): Promise<SessionDetailResponse> {
  const session = await sessionStore.getSession(sessionId)
  if (!session) throw new Error(`Session not found: ${sessionId}`)
  const governance = await buildSessionGovernance(sessionId)
  return {
    session: {
      ...session,
      contractEvaluation: governance?.contractEvaluation ?? null,
      executionId: governance?.executionId ?? null,
      adapterId: governance?.adapterId ?? null,
    },
  }
}

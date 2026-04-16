import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Session, SessionArtifact, SessionEvent, SessionFinding, SessionRecord } from '../contracts/session-types.ts'
import type { SessionStore } from './core-runtime-contracts.ts'

type FileSessionStoreOptions = {
  dataPath: string
}

async function ensureStore(dataPath: string) {
  try {
    await fs.access(dataPath)
  } catch {
    await fs.mkdir(path.dirname(dataPath), { recursive: true })
    await fs.writeFile(dataPath, '[]', 'utf8')
  }
}

async function readStore(dataPath: string): Promise<SessionRecord[]> {
  await ensureStore(dataPath)
  const raw = await fs.readFile(dataPath, 'utf8')
  return JSON.parse(raw) as SessionRecord[]
}

async function writeStore(dataPath: string, sessions: SessionRecord[]) {
  await ensureStore(dataPath)
  await fs.writeFile(dataPath, JSON.stringify(sessions, null, 2), 'utf8')
}

export class FileSessionStore implements SessionStore {
  private readonly dataPath: string

  constructor(options: FileSessionStoreOptions) {
    this.dataPath = options.dataPath
  }

  async createSession(session: SessionRecord): Promise<void> {
    const sessions = await readStore(this.dataPath)
    sessions.unshift(session)
    await writeStore(this.dataPath, sessions)
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const sessions = await readStore(this.dataPath)
    return sessions.find((session) => session.id === sessionId) ?? null
  }

  async listSessions(limit = 20): Promise<Session[]> {
    const sessions = await readStore(this.dataPath)
    return sessions.slice(0, limit)
  }

  async appendEvent(event: SessionEvent): Promise<void> {
    const sessions = await readStore(this.dataPath)
    const session = sessions.find((item) => item.id === event.sessionId)
    if (!session) throw new Error(`Session not found: ${event.sessionId}`)
    session.events = [...(session.events ?? []), event]
    await writeStore(this.dataPath, sessions)
  }

  async appendArtifact(artifact: SessionArtifact): Promise<void> {
    const sessions = await readStore(this.dataPath)
    const session = sessions.find((item) => item.id === artifact.sessionId)
    if (!session) throw new Error(`Session not found: ${artifact.sessionId}`)
    const artifacts = (session.artifacts ?? {}) as Record<string, unknown>
    artifacts[artifact.id] = artifact
    session.artifacts = artifacts
    await writeStore(this.dataPath, sessions)
  }

  async appendFinding(finding: SessionFinding): Promise<void> {
    const sessions = await readStore(this.dataPath)
    const session = sessions.find((item) => item.id === finding.sessionId)
    if (!session) throw new Error(`Session not found: ${finding.sessionId}`)
    session.findings = [...(session.findings ?? []), finding]
    await writeStore(this.dataPath, sessions)
  }

  async updateSession(sessionId: string, patch: Partial<SessionRecord>): Promise<void> {
    const sessions = await readStore(this.dataPath)
    const index = sessions.findIndex((item) => item.id === sessionId)
    if (index === -1) throw new Error(`Session not found: ${sessionId}`)
    sessions[index] = {
      ...sessions[index],
      ...patch,
      events: patch.events ?? sessions[index].events,
      findings: patch.findings ?? sessions[index].findings,
      artifacts: patch.artifacts ?? sessions[index].artifacts,
      checkpoint: patch.checkpoint ?? sessions[index].checkpoint,
    }
    await writeStore(this.dataPath, sessions)
  }
}


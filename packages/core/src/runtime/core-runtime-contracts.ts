import type { AgentProfile, ModelProvider } from '../contracts/agent-types.ts'
import type { ScenarioContract, RunResult } from '../contracts/scenario-types.ts'
import type { Session, SessionArtifact, SessionEvent, SessionFinding, SessionRecord } from '../contracts/session-types.ts'
import type { ToolContext, ToolHandler, ToolMetadata, ToolPolicy, ToolResult } from '../contracts/tool-types.ts'

export interface SessionStore {
  createSession(session: SessionRecord): Promise<void>
  getSession(sessionId: string): Promise<Session | null>
  listSessions(limit?: number): Promise<Session[]>
  appendEvent(event: SessionEvent): Promise<void>
  appendArtifact(artifact: SessionArtifact): Promise<void>
  appendFinding(finding: SessionFinding): Promise<void>
  updateSession(sessionId: string, patch: Partial<SessionRecord>): Promise<void>
}

export interface ToolRegistry {
  listToolMetadata(): ToolMetadata[]
  resolve(toolName: string): ToolHandler | undefined
  isAllowed(toolName: string, policy: ToolPolicy): boolean
  invoke(toolName: string, input: unknown, context: ToolContext): Promise<ToolResult>
}

export interface AgentRegistry {
  listProfiles(): AgentProfile[]
  getProfile(agentId: string): AgentProfile | undefined
}

export interface ScenarioRegistry {
  listScenarios(): ScenarioContract[]
  getScenario(scenarioId: string): ScenarioContract | undefined
}

export interface RuntimeContext {
  sessionStore: SessionStore
  toolRegistry: ToolRegistry
  agentRegistry: AgentRegistry
  scenarioRegistry: ScenarioRegistry
  modelProvider: ModelProvider
}

export interface Orchestrator {
  runScenario(scenarioId: string, context: RuntimeContext): Promise<RunResult>
}

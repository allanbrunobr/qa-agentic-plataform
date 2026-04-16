import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAnthropicProvider } from '../providers/anthropic-provider.js'
import { getProfile } from '../profiles/agent-profiles.js'
import { artifactSensor } from '../sensors/artifact-sensor.js'
import { outputSensor } from '../sensors/output-sensor.js'
import { schemaSensor } from '../sensors/schema-sensor.js'
import { timeoutSensor } from '../sensors/timeout-sensor.js'
import { toolPolicySensor } from '../sensors/tool-policy-sensor.js'
import { AgentRuntime } from './agent-runtime.js'
import { Orchestrator } from './orchestrator.js'
import { SensorRunner } from './sensor-runner.js'
import { SessionService } from './session-service.js'
import { getSessionService, setSessionService } from '../routes/sessions.js'
import { ToolRegistry } from './tool-registry.js'
import { registerEvidenceTools } from '../tools/evidence-tools.js'
import { registerWorkflowTools } from '../tools/workflow-tools.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const API_PACKAGE_ROOT = path.resolve(__dirname, '../../..')

export interface Phase2RuntimeOptions {
  dbPath?: string
  model?: string
}

export function createPhase2Runtime(options: Phase2RuntimeOptions = {}) {
  const dbPath = options.dbPath ?? path.join(API_PACKAGE_ROOT, 'persona-qa.db')
  const sessionService = options.dbPath
    ? new SessionService(dbPath)
    : getSessionService()

  if (options.dbPath) {
    setSessionService(sessionService)
  }
  const toolRegistry = new ToolRegistry()

  registerWorkflowTools(toolRegistry)
  registerEvidenceTools(toolRegistry, sessionService)

  const sales-associate = getProfile('sales-associate')
  const provider = createAnthropicProvider(options.model ?? sales-associate.model ?? 'claude-haiku-4-5-20251001')
  const agentRuntime = new AgentRuntime(provider, toolRegistry, sessionService)
  const sensorRunner = new SensorRunner()

  sensorRunner.registerSensor('schema', schemaSensor)
  sensorRunner.registerSensor('tool_policy', toolPolicySensor)
  sensorRunner.registerSensor('artifact_completeness', artifactSensor)
  sensorRunner.registerSensor('output', outputSensor)
  sensorRunner.registerSensor('timeout', timeoutSensor)

  agentRuntime.registerAgent(sales-associate)
  agentRuntime.registerAgent(getProfile('fulfillment-agent'))
  agentRuntime.registerAgent(getProfile('billing_clerk'))
  agentRuntime.registerAgent(getProfile('store_manager'))
  agentRuntime.registerAgent(getProfile('orchestrator'))

  const orchestrator = new Orchestrator(agentRuntime, sessionService, sensorRunner)

  return {
    dbPath,
    sessionService,
    toolRegistry,
    agentRuntime,
    sensorRunner,
    orchestrator,
  }
}

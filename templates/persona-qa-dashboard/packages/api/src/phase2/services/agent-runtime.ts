import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  AgentProfile,
  AgentStepOutput,
  ModelMessage,
  ModelProvider,
  ToolDefinition,
} from '../types/agent-types.js'
import type { ScenarioStep } from '../types/scenario-types.js'
import type { ToolContext } from '../types/tool-types.js'
import { buildStepInstructionEnvelope, getGlobalAgenticInstructions } from './instruction-layer.js'
import type { SessionService } from './session-service.js'
import type { ToolRegistry } from './tool-registry.js'

export interface StepContext {
  sessionId: string
  messages: ModelMessage[]
  page?: unknown
}

const MAX_TOOL_ROUNDS = 10
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '../../../../../..')

export class AgentRuntime {
  private readonly agents = new Map<string, AgentProfile>()

  constructor(
    private readonly provider?: ModelProvider,
    private readonly toolRegistry?: ToolRegistry,
    private readonly sessionService?: SessionService,
  ) {}

  registerAgent(profile: AgentProfile): void {
    const id = profile.id ?? profile.role
    this.agents.set(id, profile)
  }

  getAgent(agentId: string): AgentProfile | undefined {
    return this.agents.get(agentId)
  }

  async executeStep(profile: AgentProfile, stepContext: StepContext): Promise<AgentStepOutput>
  async executeStep(agentId: string, step: ScenarioStep, context: Record<string, unknown>): Promise<AgentStepOutput>
  async executeStep(
    profileOrAgentId: AgentProfile | string,
    stepOrContext: StepContext | ScenarioStep,
    maybeContext?: Record<string, unknown>,
  ): Promise<AgentStepOutput> {
    if (typeof profileOrAgentId === 'string') {
      const profile = this.agents.get(profileOrAgentId)
      if (!profile) {
        throw new Error(`Agent ${profileOrAgentId} not registered`)
      }

      const step = stepOrContext as ScenarioStep
      const context = maybeContext ?? {}
      const availableArtifacts = Object.fromEntries(
        Object.entries(context).filter(([key]) => key !== 'page' && key !== 'sessionId'),
      )
      const runtimeInstructions = buildStepInstructionEnvelope(step, availableArtifacts)
      const result = await this.executeStep(profile, {
        sessionId: String(context['sessionId'] ?? 'orchestrator-session'),
        messages: [{
          role: 'user',
          content: JSON.stringify({
            scenarioStep: step.id,
            description: step.description ?? step.name,
            requiredArtifacts: step.requiredArtifacts,
            producedArtifacts: step.producedArtifacts,
            availableArtifacts,
            instructions: runtimeInstructions,
          }),
        }],
        page: context['page'],
      })

      return {
        ...result,
        stepIndex: step.order,
        agentId: profileOrAgentId,
        output: result.output ?? {},
        durationMs: result.durationMs ?? 0,
        success: result.success ?? result.status === 'completed',
      }
    }

    if (!this.provider || !this.toolRegistry || !this.sessionService) {
      throw new Error('AgentRuntime requires provider, tool registry, and session service for profile execution')
    }

    const profile = profileOrAgentId
    const { sessionId, page } = stepOrContext as StepContext
    const messages = [...(stepOrContext as StepContext).messages]
    const collectedFindings: AgentStepOutput['findings'] = []
    const collectedEvidence: string[] = []
    const accumulatedOutput: Record<string, unknown> = {}

    const allTools = this.toolRegistry.listTools()
    const toolDefs: ToolDefinition[] = allTools
      .filter((tool) => this.isToolAllowed(tool.name, profile))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
      }))

    const promptText = this.loadPromptText(profile)
    const globalInstructions = getGlobalAgenticInstructions()
    const learningOverlay = this.loadLearningOverlay(profile)
    const systemParts: string[] = []
    if (globalInstructions) {
      systemParts.push(globalInstructions)
    }
    if (promptText) {
      systemParts.push(promptText)
    } else if (profile.systemPrompt) {
      systemParts.push(profile.systemPrompt)
    }
    if (learningOverlay) {
      systemParts.push(learningOverlay)
    }
    if (systemParts.length > 0) {
      messages.unshift({ role: 'system', content: systemParts.join('\n\n') })
    }

    const startedAt = Date.now()
    const deadline = startedAt + profile.timeoutMs

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (Date.now() > deadline) {
        this.sessionService.appendEvent(sessionId, {
          type: 'error',
          agentRole: profile.role,
          payload: { reason: 'timeout', round },
        })
        return {
          status: 'timeout',
          toolCalls: [],
          findings: collectedFindings,
          output: accumulatedOutput,
          durationMs: Date.now() - startedAt,
          success: false,
          error: `Agent timeout after ${profile.timeoutMs}ms`,
        }
      }

      let response
      try {
        response = await this.provider.chat(messages, toolDefs, { maxTokens: 4096, model: profile.model })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          status: 'failed',
          toolCalls: [],
          findings: collectedFindings,
          output: accumulatedOutput,
          durationMs: Date.now() - startedAt,
          success: false,
          error: message,
        }
      }

      this.sessionService.appendEvent(sessionId, {
        type: 'info',
        agentRole: profile.role,
        payload: {
          event: 'model_response',
          stopReason: response.stopReason,
          toolCallCount: response.toolCalls.length,
          usage: response.usage,
        },
      })

      if (response.toolCalls.length === 0 || response.stopReason === 'end_turn') {
        const evidenceValidation = this.validateFindingEvidence(profile, collectedEvidence)
        if (!evidenceValidation.valid && collectedFindings.length > 0) {
          return {
            status: 'failed',
            text: response.text,
            toolCalls: response.toolCalls,
            findings: [],
            output: accumulatedOutput,
            durationMs: Date.now() - startedAt,
            success: false,
            error: evidenceValidation.reason,
          }
        }

        return {
          status: 'completed',
          text: response.text,
          toolCalls: response.toolCalls,
          findings: collectedFindings,
          output: accumulatedOutput,
          durationMs: Date.now() - startedAt,
          success: true,
        }
      }

      const toolResultMessages: string[] = []

      for (const toolCall of response.toolCalls) {
        this.sessionService.appendEvent(sessionId, {
          type: 'tool_call',
          agentRole: profile.role,
          payload: { toolName: toolCall.name, toolCallId: toolCall.id, input: toolCall.input },
        })

        const toolContext: ToolContext = {
          page,
          sessionId,
          agentRole: profile.role,
          artifacts: accumulatedOutput,
        }

        const toolName = toolCall.name ?? toolCall.tool ?? 'unknown'
        const result = this.isToolAllowed(toolName, profile)
          ? await this.toolRegistry.execute(
            toolName,
            toolCall.input ?? toolCall.args ?? {},
            profile.toolPolicy,
            toolContext,
          )
          : {
            ok: false as const,
            error: {
              code: 'tool_not_allowed',
              message: `Agent policy does not allow tool "${toolName}"`,
              retryable: false,
            },
          }

        this.sessionService.appendEvent(sessionId, {
          type: 'tool_result',
          agentRole: profile.role,
          payload: {
            toolName: toolCall.name ?? toolCall.tool,
            toolCallId: toolCall.id,
            ok: result.ok,
            ...(result.ok ? { output: result.output } : { error: result.error }),
          },
        })

        if (result.ok && ['captureScreenshot', 'collectDomSnippet'].includes(toolCall.name ?? '')) {
          const output = result.output as Record<string, unknown>
          if (output?.artifactId) {
            collectedEvidence.push(String(output.artifactId))
          }
        }

        if (result.ok && result.output && typeof result.output === 'object' && !Array.isArray(result.output)) {
          Object.assign(accumulatedOutput, result.output as Record<string, unknown>)
        }

        toolResultMessages.push(
          `[Tool result for ${toolCall.name ?? toolCall.tool} (${toolCall.id ?? 'no-id'})]: ${JSON.stringify(result.ok ? result.output : result.error)}`,
        )
      }

      if (response.text) {
        messages.push({ role: 'assistant', content: response.text })
      }
      messages.push({ role: 'user', content: toolResultMessages.join('\n\n') })
    }

    return {
      status: 'failed',
      toolCalls: [],
      findings: [],
      output: accumulatedOutput,
      durationMs: Date.now() - startedAt,
      success: false,
      error: `Exceeded maximum tool rounds (${MAX_TOOL_ROUNDS})`,
    }
  }

  validateFindingEvidence(
    profile: AgentProfile,
    evidence: string[],
  ): { valid: boolean; reason?: string } {
    if (profile.evidencePolicy.requireScreenshotForFinding && evidence.length === 0) {
      return { valid: false, reason: 'Evidence policy requires screenshot but none attached' }
    }
    return { valid: true }
  }

  private isToolAllowed(toolName: string, profile: AgentProfile): boolean {
    const policy = profile.toolPolicy
    if (policy.deniedTools?.includes(toolName)) return false
    if (policy.allowedTools && !policy.allowedTools.includes(toolName)) return false

    const riskPolicy = profile.riskPolicy
    if (!riskPolicy) return true

    const riskLevel = this.toolRegistry?.getRiskLevel(toolName) ?? 'read'
    if (riskPolicy.denyRiskLevels.includes(riskLevel)) return false
    if (riskPolicy.requireApprovalFor.includes(riskLevel)) return false
    if (!riskPolicy.allowedRiskLevels.includes(riskLevel)) return false

    return true
  }

  private loadPromptText(profile: AgentProfile): string | undefined {
    if (!profile.promptPath) return undefined

    const candidates = [
      path.resolve(process.cwd(), profile.promptPath),
      path.resolve(REPO_ROOT, profile.promptPath),
    ]

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return fs.readFileSync(candidate, 'utf8')
      }
    }

    return undefined
  }

  private loadLearningOverlay(profile: AgentProfile): string | undefined {
    const overlays = this.sessionService?.listAppliedPromptOverlays(profile.role) ?? []
    const content = overlays
      .map((overlay) => overlay.patchContent)
      .filter((item): item is string => Boolean(item))

    if (content.length === 0) return undefined

    return [
      '[APPLIED LEARNING OVERLAYS]',
      ...content,
    ].join('\n\n')
  }
}

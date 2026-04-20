import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  AgentProfile,
  AgentStepOutput,
  ModelMessage,
  ModelProvider,
  SyntheticToolResult,
  ToolDefinition,
} from '../types/agent-types.js'
import type { ScenarioStep } from '../types/scenario-types.js'
import type { ToolContext, ToolResult } from '../types/tool-types.js'
import { buildStepInstructionEnvelope, getGlobalAgenticInstructions } from './instruction-layer.js'
import type { SessionService } from './session-service.js'
import { defaultRuntimeHookBus, type RuntimeHookBus } from './runtime-hooks.js'
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

interface PendingToolCall {
  toolCallId: string
  toolName: string
  originalStartedAt: string
}

class ModelDeadlineExceededError extends Error {
  constructor(timeoutMs: number) {
    super(`Agent timeout after ${timeoutMs}ms`)
    this.name = 'ModelDeadlineExceededError'
  }
}

export class AgentRuntime {
  private readonly agents = new Map<string, AgentProfile>()
  private readonly pendingToolCalls = new Map<string, Map<string, PendingToolCall>>()

  constructor(
    private readonly provider?: ModelProvider,
    private readonly toolRegistry?: ToolRegistry,
    private readonly sessionService?: SessionService,
    private readonly hooks: RuntimeHookBus = defaultRuntimeHookBus,
  ) {}

  registerAgent(profile: AgentProfile): void {
    const id = profile.id ?? profile.role
    this.agents.set(id, profile)
  }

  getAgent(agentId: string): AgentProfile | undefined {
    return this.agents.get(agentId)
  }

  closePendingToolCalls(sessionId: string, reason: SyntheticToolResult['reason']): SyntheticToolResult[] {
    if (!this.sessionService) return []

    const pending = this.pendingToolCalls.get(sessionId)
    if (!pending || pending.size === 0) return []

    const closed: SyntheticToolResult[] = []
    for (const call of pending.values()) {
      if (this.sessionService.isToolCallClosed(sessionId, call.toolCallId)) continue

      const closedAt = new Date().toISOString()
      const recorded = this.sessionService.recordToolClosure(
        sessionId,
        call.toolCallId,
        call.toolName,
        reason,
        call.originalStartedAt,
      )
      if (!recorded) continue

      const syntheticResult: SyntheticToolResult = {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        reason,
        closedAt,
        originalStartedAt: call.originalStartedAt,
      }
      this.sessionService.appendEvent(sessionId, {
        type: 'tool_result',
        payload: {
          toolName: call.toolName,
          toolCallId: call.toolCallId,
          ok: false,
          synthetic: true,
          error: {
            code: 'synthetic_tool_result',
            message: `Tool call closed synthetically because the agent step ended by ${reason}.`,
            retryable: reason === 'timeout',
          },
        },
      })
      closed.push(syntheticResult)
    }

    this.pendingToolCalls.delete(sessionId)
    return closed
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
    const expectedArtifacts = this.extractExpectedArtifacts(messages)

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
        const completedFromToolOutput = this.completeFromToolOutputIfValid(
          profile,
          sessionId,
          responseTextFromArtifacts(accumulatedOutput),
          accumulatedOutput,
          collectedFindings,
          collectedEvidence,
          expectedArtifacts,
          startedAt,
        )
        if (completedFromToolOutput) return this.finishStep(sessionId, profile, completedFromToolOutput)

        const syntheticClosures = this.closePendingToolCalls(sessionId, 'timeout')
        await this.hooks.emit('onTimeout', {
          sessionId,
          agentRole: profile.role,
          payload: { reason: 'deadline_exceeded_before_model_call', round, syntheticClosures },
        })
        this.sessionService.appendEvent(sessionId, {
          type: 'error',
          agentRole: profile.role,
          payload: { reason: 'timeout', round },
        })
        return this.finishStep(sessionId, profile, {
          status: 'timeout',
          toolCalls: [],
          findings: collectedFindings,
          output: accumulatedOutput,
          durationMs: Date.now() - startedAt,
          success: false,
          error: `Agent timeout after ${profile.timeoutMs}ms`,
        })
      }

      let response
      try {
        await this.hooks.emit('beforeModelCall', {
          sessionId,
          agentRole: profile.role,
          payload: { round, toolCount: toolDefs.length },
        })
        response = await this.chatBeforeDeadline(messages, toolDefs, profile, deadline)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (error instanceof ModelDeadlineExceededError) {
          const completedFromToolOutput = this.completeFromToolOutputIfValid(
            profile,
            sessionId,
            message,
            accumulatedOutput,
            collectedFindings,
            collectedEvidence,
            expectedArtifacts,
            startedAt,
          )
          if (completedFromToolOutput) return this.finishStep(sessionId, profile, completedFromToolOutput)

          const syntheticClosures = this.closePendingToolCalls(sessionId, 'timeout')
          await this.hooks.emit('onTimeout', {
            sessionId,
            agentRole: profile.role,
            payload: { reason: 'model_deadline_exceeded', syntheticClosures },
          })
        }
        return this.finishStep(sessionId, profile, {
          status: error instanceof ModelDeadlineExceededError ? 'timeout' : 'failed',
          toolCalls: [],
          findings: collectedFindings,
          output: accumulatedOutput,
          durationMs: Date.now() - startedAt,
          success: false,
          error: message,
        })
      }

      await this.hooks.emit('afterModelResponse', {
        sessionId,
        agentRole: profile.role,
        payload: {
          round,
          stopReason: response.stopReason,
          toolCallCount: response.toolCalls.length,
          usage: response.usage,
        },
      })

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
          return this.finishStep(sessionId, profile, {
            status: 'failed',
            text: response.text,
            toolCalls: response.toolCalls,
            findings: [],
            output: accumulatedOutput,
            durationMs: Date.now() - startedAt,
            success: false,
            error: evidenceValidation.reason,
          })
        }

        return this.finishStep(sessionId, profile, {
          status: 'completed',
          text: response.text,
          toolCalls: response.toolCalls,
          findings: collectedFindings,
          output: accumulatedOutput,
          durationMs: Date.now() - startedAt,
          success: true,
        })
      }

      const toolResultMessages: string[] = []

      for (const toolCall of response.toolCalls) {
        const toolName = toolCall.name ?? toolCall.tool ?? 'unknown'
        const toolCallId = toolCall.id ?? `${toolName}-${round}-${toolResultMessages.length}`
        const originalStartedAt = new Date().toISOString()
        this.trackPendingToolCall(sessionId, { toolCallId, toolName, originalStartedAt })

        this.sessionService.appendEvent(sessionId, {
          type: 'tool_call',
          agentRole: profile.role,
          payload: { toolName, toolCallId, input: toolCall.input ?? toolCall.args ?? {} },
        })
        await this.hooks.emit('beforeToolCall', {
          sessionId,
          agentRole: profile.role,
          toolName,
          toolCallId,
          payload: { input: toolCall.input ?? toolCall.args ?? {} },
        })

        const toolContext: ToolContext = {
          page,
          sessionId,
          agentRole: profile.role,
          artifacts: accumulatedOutput,
        }

        let result: ToolResult
        try {
          result = this.isToolAllowed(toolName, profile)
            ? await this.executeToolBeforeDeadline(
              toolName,
              toolCall.input ?? toolCall.args ?? {},
              profile,
              toolContext,
              deadline,
            )
            : {
            ok: false as const,
            error: {
              code: 'tool_not_allowed',
              message: `Agent policy does not allow tool "${toolName}"`,
              retryable: false,
            },
          }
        } catch (error) {
          if (error instanceof ModelDeadlineExceededError) {
            const syntheticClosures = this.closePendingToolCalls(sessionId, 'timeout')
            await this.hooks.emit('onTimeout', {
              sessionId,
              agentRole: profile.role,
              toolName,
              toolCallId,
              payload: { reason: 'tool_deadline_exceeded', syntheticClosures },
            })
            return this.finishStep(sessionId, profile, {
              status: 'timeout',
              toolCalls: response.toolCalls,
              findings: collectedFindings,
              output: accumulatedOutput,
              durationMs: Date.now() - startedAt,
              success: false,
              error: error.message,
            })
          }
          throw error
        }

        this.sessionService.appendEvent(sessionId, {
          type: 'tool_result',
          agentRole: profile.role,
          payload: {
            toolName,
            toolCallId,
            ok: result.ok,
            ...(result.ok ? { output: result.output } : { error: result.error }),
          },
        })
        this.markToolCallClosed(sessionId, toolCallId)
        await this.hooks.emit('afterToolResult', {
          sessionId,
          agentRole: profile.role,
          toolName,
          toolCallId,
          payload: { ok: result.ok },
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

        const completedFromToolOutput = this.completeFromToolOutputIfValid(
          profile,
          sessionId,
          responseTextFromArtifacts(accumulatedOutput),
          accumulatedOutput,
          collectedFindings,
          collectedEvidence,
          expectedArtifacts,
          startedAt,
          'required_artifacts_produced_by_tool',
          response.toolCalls,
        )
        if (completedFromToolOutput) return this.finishStep(sessionId, profile, completedFromToolOutput)

        toolResultMessages.push(
          `[Tool result for ${toolName} (${toolCallId})]: ${JSON.stringify(result.ok ? result.output : result.error)}`,
        )
      }

      if (response.text) {
        messages.push({ role: 'assistant', content: response.text })
      }
      messages.push({ role: 'user', content: toolResultMessages.join('\n\n') })
    }

    this.closePendingToolCalls(sessionId, 'interruption')
    return this.finishStep(sessionId, profile, {
      status: 'failed',
      toolCalls: [],
      findings: [],
      output: accumulatedOutput,
      durationMs: Date.now() - startedAt,
      success: false,
      error: `Exceeded maximum tool rounds (${MAX_TOOL_ROUNDS})`,
    })
  }

  private async finishStep(
    sessionId: string,
    profile: AgentProfile,
    output: AgentStepOutput,
  ): Promise<AgentStepOutput> {
    await this.hooks.emit('beforeStepComplete', {
      sessionId,
      agentRole: profile.role,
      payload: { status: output.status, success: output.success },
    })
    await this.hooks.emit('afterStepComplete', {
      sessionId,
      agentRole: profile.role,
      payload: { status: output.status, success: output.success },
    })
    return output
  }

  private trackPendingToolCall(sessionId: string, call: PendingToolCall): void {
    const bucket = this.pendingToolCalls.get(sessionId) ?? new Map<string, PendingToolCall>()
    bucket.set(call.toolCallId, call)
    this.pendingToolCalls.set(sessionId, bucket)
  }

  private markToolCallClosed(sessionId: string, toolCallId: string): void {
    const bucket = this.pendingToolCalls.get(sessionId)
    if (!bucket) return
    bucket.delete(toolCallId)
    if (bucket.size === 0) {
      this.pendingToolCalls.delete(sessionId)
    }
  }

  private async executeToolBeforeDeadline(
    toolName: string,
    input: unknown,
    profile: AgentProfile,
    toolContext: ToolContext,
    deadline: number,
  ): Promise<ToolResult> {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      throw new ModelDeadlineExceededError(profile.timeoutMs)
    }

    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        this.toolRegistry!.execute(toolName, input, profile.toolPolicy, toolContext),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new ModelDeadlineExceededError(profile.timeoutMs)), remainingMs)
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
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

  private async chatBeforeDeadline(
    messages: ModelMessage[],
    toolDefs: ToolDefinition[],
    profile: AgentProfile,
    deadline: number,
  ) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      throw new ModelDeadlineExceededError(profile.timeoutMs)
    }

    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        this.provider!.chat(messages, toolDefs, { maxTokens: 4096, model: profile.model }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new ModelDeadlineExceededError(profile.timeoutMs)), remainingMs)
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  private completeFromToolOutputIfValid(
    profile: AgentProfile,
    sessionId: string,
    text: string,
    accumulatedOutput: Record<string, unknown>,
    collectedFindings: AgentStepOutput['findings'],
    collectedEvidence: string[],
    expectedArtifacts: string[],
    startedAt: number,
    reason = 'model_followup_deadline_exceeded_after_required_artifacts',
    toolCalls: AgentStepOutput['toolCalls'] = [],
  ): AgentStepOutput | undefined {
    if (!this.hasExpectedArtifacts(accumulatedOutput, expectedArtifacts)) {
      return undefined
    }

    const evidenceValidation = this.validateFindingEvidence(profile, collectedEvidence)
    if (!evidenceValidation.valid && collectedFindings.length > 0) {
      return {
        status: 'failed',
        toolCalls: [],
        findings: [],
        output: accumulatedOutput,
        durationMs: Date.now() - startedAt,
        success: false,
        error: evidenceValidation.reason,
      }
    }

    this.sessionService?.appendEvent(sessionId, {
      type: 'info',
      agentRole: profile.role,
      payload: {
        event: 'completed_from_tool_output',
        reason,
        expectedArtifacts,
      },
    })

    return {
      status: 'completed',
      text,
      toolCalls,
      findings: collectedFindings,
      output: accumulatedOutput,
      durationMs: Date.now() - startedAt,
      success: true,
    }
  }

  private extractExpectedArtifacts(messages: ModelMessage[]): string[] {
    for (const message of messages) {
      if (message.role !== 'user') continue

      try {
        const parsed = JSON.parse(message.content)
        const producedArtifacts = Array.isArray(parsed?.producedArtifacts) ? parsed.producedArtifacts : []
        const requiredArtifacts = Array.isArray(parsed?.requiredArtifacts) ? parsed.requiredArtifacts : []
        const artifacts = producedArtifacts.length > 0 ? producedArtifacts : requiredArtifacts
        return artifacts.filter((item: unknown): item is string => typeof item === 'string' && item.length > 0)
      } catch {
        continue
      }
    }

    return []
  }

  private hasExpectedArtifacts(output: Record<string, unknown>, expectedArtifacts: string[]): boolean {
    if (expectedArtifacts.length === 0) return false
    return expectedArtifacts.every((artifact) => output[artifact] !== undefined && output[artifact] !== null)
  }
}

function responseTextFromArtifacts(output: Record<string, unknown>): string {
  return `Completed using tool output: ${JSON.stringify(output)}`
}

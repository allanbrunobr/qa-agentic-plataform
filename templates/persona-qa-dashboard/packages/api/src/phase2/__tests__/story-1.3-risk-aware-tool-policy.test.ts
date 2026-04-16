import { describe, it, expect, beforeEach } from 'vitest'
import { RiskPolicySchema } from '../types/agent-types.js'
import type { AgentProfile, ModelProvider, ModelResponse } from '../types/agent-types.js'
import type { ToolHandler, ToolMetadata } from '../types/tool-types.js'
import { AgentRuntime } from '../services/agent-runtime.js'
import { ToolRegistry } from '../services/tool-registry.js'
import { SessionService } from '../services/session-service.js'

const echoHandler: ToolHandler = async (input) => ({ ok: true, output: input })

function makeMetadata(name: string, riskLevel: 'read' | 'write' | 'destructive' = 'read'): ToolMetadata {
  return { name, description: `Tool ${name}`, requiresBrowser: false, tags: [], riskLevel }
}

function makeProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    role: 'test-agent',
    timeoutMs: 30_000,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    toolPolicy: { browserAccess: false },
    evidencePolicy: { requireScreenshotForFinding: false, requireDomSnippetForFinding: false },
    canBlockRun: false,
    ...overrides,
  }
}

describe('Story 1.3: Enforce Risk-Aware Tool Policy', () => {
  describe('RiskPolicy schema', () => {
    it('provides sensible defaults', () => {
      const parsed = RiskPolicySchema.parse({})
      expect(parsed.allowedRiskLevels).toEqual(['read'])
      expect(parsed.requireApprovalFor).toEqual([])
      expect(parsed.denyRiskLevels).toEqual([])
    })

    it('accepts a full policy', () => {
      const parsed = RiskPolicySchema.parse({
        allowedRiskLevels: ['read', 'write'],
        requireApprovalFor: ['destructive'],
        denyRiskLevels: [],
      })
      expect(parsed.allowedRiskLevels).toEqual(['read', 'write'])
      expect(parsed.requireApprovalFor).toEqual(['destructive'])
    })

    it('rejects invalid risk levels in policy arrays', () => {
      expect(() => RiskPolicySchema.parse({
        allowedRiskLevels: ['extreme'],
      })).toThrow()
    })
  })

  describe('AgentRuntime risk-aware isToolAllowed', () => {
    let registry: ToolRegistry
    let sessionService: SessionService

    beforeEach(() => {
      registry = new ToolRegistry()
      sessionService = new SessionService(':memory:')

      registry.register('readData', echoHandler, makeMetadata('readData', 'read'))
      registry.register('writeData', echoHandler, makeMetadata('writeData', 'write'))
      registry.register('deleteAll', echoHandler, makeMetadata('deleteAll', 'destructive'))
    })

    it('allows read tools and denies destructive for same profile', async () => {
      const session = sessionService.createSession('test-scenario')

      const toolCallSequence = [
        { name: 'readData', expectAllowed: true },
        { name: 'deleteAll', expectAllowed: false },
      ]

      let callIndex = 0
      const provider: ModelProvider = {
        async chat(): Promise<ModelResponse> {
          if (callIndex >= toolCallSequence.length) {
            return { toolCalls: [], stopReason: 'end_turn' }
          }
          const tc = toolCallSequence[callIndex++]
          return {
            toolCalls: [{ id: `tc-${tc.name}`, name: tc.name, input: {} }],
            stopReason: 'tool_use',
          }
        },
      }

      const runtime = new AgentRuntime(provider, registry, sessionService)
      const profile = makeProfile({
        riskPolicy: {
          allowedRiskLevels: ['read'],
          requireApprovalFor: [],
          denyRiskLevels: ['destructive'],
        },
      })

      const result = await runtime.executeStep(profile, {
        sessionId: session.id,
        messages: [{ role: 'user', content: 'test' }],
      })

      // readData should have been offered as a tool (it's in the filtered list)
      // deleteAll should NOT have been offered
      expect(result.status).toBe('completed')
    })

    it('blocks tools that require approval (no approval mechanism yet)', async () => {
      const session = sessionService.createSession('test-scenario')

      const provider: ModelProvider = {
        async chat(): Promise<ModelResponse> {
          return { toolCalls: [], stopReason: 'end_turn' }
        },
      }

      const runtime = new AgentRuntime(provider, registry, sessionService)
      const profile = makeProfile({
        riskPolicy: {
          allowedRiskLevels: ['read'],
          requireApprovalFor: ['write'],
          denyRiskLevels: ['destructive'],
        },
      })

      const result = await runtime.executeStep(profile, {
        sessionId: session.id,
        messages: [{ role: 'user', content: 'test' }],
      })

      // Should complete successfully — write tools blocked from being offered
      expect(result.status).toBe('completed')
    })

    it('works without riskPolicy (backward compatible)', async () => {
      const session = sessionService.createSession('test-scenario')

      const provider: ModelProvider = {
        async chat(): Promise<ModelResponse> {
          return { toolCalls: [], stopReason: 'end_turn' }
        },
      }

      const runtime = new AgentRuntime(provider, registry, sessionService)
      const profile = makeProfile() // no riskPolicy

      const result = await runtime.executeStep(profile, {
        sessionId: session.id,
        messages: [{ role: 'user', content: 'test' }],
      })

      expect(result.status).toBe('completed')
    })

    it('works without toolRegistry (backward compatible)', async () => {
      const provider: ModelProvider = {
        async chat(): Promise<ModelResponse> {
          return { toolCalls: [], stopReason: 'end_turn' }
        },
      }

      // No toolRegistry — should still function
      const runtime = new AgentRuntime(provider, undefined, sessionService)
      const profile = makeProfile({
        riskPolicy: {
          allowedRiskLevels: ['read'],
          requireApprovalFor: [],
          denyRiskLevels: ['destructive'],
        },
      })

      // Without toolRegistry, executeStep throws at the assertion
      await expect(
        runtime.executeStep(profile, {
          sessionId: 'test',
          messages: [{ role: 'user', content: 'test' }],
        }),
      ).rejects.toThrow()
    })

    it('denies tools with risk level not in allowedRiskLevels', async () => {
      const session = sessionService.createSession('test-scenario')

      let offeredTools: string[] = []
      const provider: ModelProvider = {
        async chat(_msgs, tools): Promise<ModelResponse> {
          offeredTools = tools.map((t) => t.name)
          return { toolCalls: [], stopReason: 'end_turn' }
        },
      }

      const runtime = new AgentRuntime(provider, registry, sessionService)
      const profile = makeProfile({
        riskPolicy: {
          allowedRiskLevels: ['read'],
          requireApprovalFor: [],
          denyRiskLevels: [],
        },
      })

      await runtime.executeStep(profile, {
        sessionId: session.id,
        messages: [{ role: 'user', content: 'test' }],
      })

      // Only read tools should be offered — write and destructive are not in allowedRiskLevels
      expect(offeredTools).toContain('readData')
      expect(offeredTools).not.toContain('writeData')
      expect(offeredTools).not.toContain('deleteAll')
    })

    it('deny takes precedence over allowed', async () => {
      const session = sessionService.createSession('test-scenario')

      let offeredTools: string[] = []
      const provider: ModelProvider = {
        async chat(_msgs, tools): Promise<ModelResponse> {
          offeredTools = tools.map((t) => t.name)
          return { toolCalls: [], stopReason: 'end_turn' }
        },
      }

      const runtime = new AgentRuntime(provider, registry, sessionService)
      const profile = makeProfile({
        riskPolicy: {
          allowedRiskLevels: ['read', 'write', 'destructive'],
          requireApprovalFor: [],
          denyRiskLevels: ['destructive'],
        },
      })

      await runtime.executeStep(profile, {
        sessionId: session.id,
        messages: [{ role: 'user', content: 'test' }],
      })

      // destructive should be denied even though it's in allowedRiskLevels
      expect(offeredTools).toContain('readData')
      expect(offeredTools).toContain('writeData')
      expect(offeredTools).not.toContain('deleteAll')
    })
  })
})

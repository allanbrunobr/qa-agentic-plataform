import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentRuntime, type StepContext } from '../services/agent-runtime.js'
import { ToolRegistry } from '../services/tool-registry.js'
import { createSessionServiceStub } from '../services/session-service.js'
import type { ModelProvider, AgentProfile, ModelResponse } from '../types/agent-types.js'
import type { SessionService } from '../services/session-service.js'

function makeProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    role: 'sales-associate',
    model: 'claude-haiku-4-5-20251001',
    timeoutMs: 30000,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    toolPolicy: { browserAccess: true },
    evidencePolicy: { requireScreenshotForFinding: true, requireDomSnippetForFinding: false },
    canBlockRun: false,
    ...overrides,
  }
}

function makeStepContext(overrides: Partial<StepContext> = {}): StepContext {
  return {
    sessionId: 'sess-1',
    messages: [{ role: 'user', content: 'Create a customer named João' }],
    ...overrides,
  }
}

function mockProvider(responses: ModelResponse[]): ModelProvider {
  let callIndex = 0
  return {
    chat: vi.fn(async () => {
      const response = responses[callIndex]
      if (!response) throw new Error('No more mock responses')
      callIndex++
      return response
    }),
  }
}

describe('AgentRuntime', () => {
  let registry: ToolRegistry
  let sessionService: SessionService

  beforeEach(() => {
    registry = new ToolRegistry()
    sessionService = createSessionServiceStub()
  })

  describe('executeStep — simple text response', () => {
    it('returns completed with text when model has no tool calls', async () => {
      const provider = mockProvider([{
        text: 'Customer created successfully.',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 5 },
      }])

      const runtime = new AgentRuntime(provider, registry, sessionService)
      const result = await runtime.executeStep(makeProfile(), makeStepContext())

      expect(result.status).toBe('completed')
      expect(result.text).toBe('Customer created successfully.')
      expect(result.toolCalls).toEqual([])
    })
  })

  describe('executeStep — tool execution loop', () => {
    it('executes tool calls and feeds results back to model', async () => {
      registry.register('echo', async (input) => ({ ok: true, output: input }), {
        name: 'echo',
        description: 'Echo input',
        requiresBrowser: false,
        tags: [],
      })

      const provider = mockProvider([
        {
          text: 'I will echo.',
          toolCalls: [{ id: 'call-1', name: 'echo', input: { msg: 'hello' } }],
          stopReason: 'tool_use',
          usage: { inputTokens: 10, outputTokens: 8 },
        },
        {
          text: 'Done echoing.',
          toolCalls: [],
          stopReason: 'end_turn',
          usage: { inputTokens: 20, outputTokens: 5 },
        },
      ])

      const runtime = new AgentRuntime(provider, registry, sessionService)
      const result = await runtime.executeStep(makeProfile(), makeStepContext())

      expect(result.status).toBe('completed')
      expect(result.text).toBe('Done echoing.')
      expect(result.output).toEqual({ msg: 'hello' })
      expect(provider.chat).toHaveBeenCalledTimes(2)
    })
  })

  describe('executeStep — session events', () => {
    it('emits tool_call and tool_result events', async () => {
      const appendEventSpy = vi.spyOn(sessionService, 'appendEvent')

      registry.register('noop', async () => ({ ok: true, output: null }), {
        name: 'noop',
        description: 'No-op',
        requiresBrowser: false,
        tags: [],
      })

      const provider = mockProvider([
        {
          toolCalls: [{ id: 'c1', name: 'noop', input: {} }],
          stopReason: 'tool_use',
          usage: { inputTokens: 5, outputTokens: 3 },
        },
        {
          text: 'done',
          toolCalls: [],
          stopReason: 'end_turn',
          usage: { inputTokens: 10, outputTokens: 2 },
        },
      ])

      const runtime = new AgentRuntime(provider, registry, sessionService)
      await runtime.executeStep(makeProfile(), makeStepContext())

      const eventTypes = appendEventSpy.mock.calls.map((c) => c[1].type)
      expect(eventTypes).toContain('tool_call')
      expect(eventTypes).toContain('tool_result')
      expect(eventTypes).toContain('info') // model_response event
    })
  })

  describe('executeStep — timeout', () => {
    it('returns timeout when execution exceeds timeoutMs', async () => {
      const provider: ModelProvider = {
        chat: vi.fn(async () => {
          // Simulate slow model call
          await new Promise((r) => setTimeout(r, 50))
          return {
            text: 'still thinking',
            toolCalls: [{ id: 'c1', name: 'slow', input: {} }],
            stopReason: 'tool_use' as const,
            usage: { inputTokens: 5, outputTokens: 3 },
          }
        }),
      }

      registry.register('slow', async () => {
        await new Promise((r) => setTimeout(r, 50))
        return { ok: true, output: null }
      }, { name: 'slow', description: 'Slow tool', requiresBrowser: false, tags: [] })

      const runtime = new AgentRuntime(provider, registry, sessionService)
      const result = await runtime.executeStep(
        makeProfile({ timeoutMs: 10 }), // very short timeout
        makeStepContext(),
      )

      expect(result.status).toBe('timeout')
      expect(result.error).toContain('timeout')
    })
  })

  describe('executeStep — policy enforcement', () => {
    it('filters tools based on agent tool policy', async () => {
      registry.register('allowed', async () => ({ ok: true, output: 'yes' }), {
        name: 'allowed',
        description: 'Allowed tool',
        requiresBrowser: false,
        tags: [],
      })
      registry.register('denied', async () => ({ ok: true, output: 'no' }), {
        name: 'denied',
        description: 'Denied tool',
        requiresBrowser: false,
        tags: [],
      })

      const provider = mockProvider([{
        text: 'ok',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { inputTokens: 5, outputTokens: 2 },
      }])

      const profile = makeProfile({
        toolPolicy: { allowedTools: ['allowed'], browserAccess: false },
      })

      const runtime = new AgentRuntime(provider, registry, sessionService)
      await runtime.executeStep(profile, makeStepContext())

      // Check that only 'allowed' tool was passed to provider
      const chatCall = vi.mocked(provider.chat).mock.calls[0]!
      const toolNames = (chatCall[1] as Array<{ name: string }>).map((t) => t.name)
      expect(toolNames).toEqual(['allowed'])
    })
  })

  describe('validateFindingEvidence', () => {
    it('rejects finding without screenshot when policy requires it', () => {
      const runtime = new AgentRuntime(
        mockProvider([]),
        registry,
        sessionService,
      )
      const profile = makeProfile({
        evidencePolicy: { requireScreenshotForFinding: true, requireDomSnippetForFinding: false },
      })

      const result = runtime.validateFindingEvidence(profile, [])
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('screenshot')
    })

    it('accepts finding with evidence', () => {
      const runtime = new AgentRuntime(
        mockProvider([]),
        registry,
        sessionService,
      )
      const profile = makeProfile({
        evidencePolicy: { requireScreenshotForFinding: true, requireDomSnippetForFinding: false },
      })

      const result = runtime.validateFindingEvidence(profile, ['artifact-1'])
      expect(result.valid).toBe(true)
    })
  })

  describe('executeStep — model error', () => {
    it('returns failed when model throws', async () => {
      const provider: ModelProvider = {
        chat: vi.fn(async () => { throw new Error('API rate limited') }),
      }

      const runtime = new AgentRuntime(provider, registry, sessionService)
      const result = await runtime.executeStep(makeProfile(), makeStepContext())

      expect(result.status).toBe('failed')
      expect(result.error).toContain('rate limited')
    })
  })
})

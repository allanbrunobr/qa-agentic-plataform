import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AnthropicProvider } from '../providers/anthropic-provider.js'
import type { ModelMessage, ToolDefinition } from '../types/agent-types.js'

// Mock the Anthropic SDK
const mockCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: mockCreate }
    constructor(_opts: unknown) {}
  }
  return { default: MockAnthropic }
})

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider

  beforeEach(() => {
    mockCreate.mockReset()
    provider = new AnthropicProvider({
      apiKey: 'test-key',
      model: 'claude-haiku-4-5-20251001',
    })
  })

  it('translates text response correctly', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Hello, I can help.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    })

    const messages: ModelMessage[] = [
      { role: 'system', content: 'You are a test agent' },
      { role: 'user', content: 'Hello' },
    ]

    const result = await provider.chat(messages, [])

    expect(result.text).toBe('Hello, I can help.')
    expect(result.toolCalls).toEqual([])
    expect(result.stopReason).toBe('end_turn')
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
  })

  it('translates tool_use response correctly', async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: 'text', text: 'I will create a customer.' },
        { type: 'tool_use', id: 'call-1', name: 'registerCustomer', input: { name: 'Alex' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 20, output_tokens: 15 },
    })

    const tools: ToolDefinition[] = [{
      name: 'registerCustomer',
      description: 'Create a customer',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
    }]

    const result = await provider.chat(
      [{ role: 'user', content: 'Create customer Alex' }],
      tools,
    )

    expect(result.text).toBe('I will create a customer.')
    expect(result.toolCalls).toEqual([
      { id: 'call-1', name: 'registerCustomer', input: { name: 'Alex' } },
    ])
    expect(result.stopReason).toBe('tool_use')
  })

  it('translates tool definitions to Anthropic format', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2 },
    })

    const tools: ToolDefinition[] = [{
      name: 'myTool',
      description: 'Does something',
      inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
    }]

    await provider.chat([{ role: 'user', content: 'test' }], tools)

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [{
          name: 'myTool',
          description: 'Does something',
          input_schema: { type: 'object', properties: { x: { type: 'number' } } },
        }],
      }),
    )
  })

  it('passes system message as top-level system param', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2 },
    })

    await provider.chat(
      [
        { role: 'system', content: 'You are sales_associate' },
        { role: 'user', content: 'Hello' },
      ],
      [],
    )

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'You are sales_associate',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    )
  })

  it('ensures conversation starts with user message', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2 },
    })

    await provider.chat(
      [{ role: 'system', content: 'sys' }], // no user message
      [],
    )

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'Begin.' }],
      }),
    )
  })

  it('handles max_tokens stop reason', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'partial' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 5, output_tokens: 4096 },
    })

    const result = await provider.chat([{ role: 'user', content: 'test' }], [])
    expect(result.stopReason).toBe('max_tokens')
  })
})

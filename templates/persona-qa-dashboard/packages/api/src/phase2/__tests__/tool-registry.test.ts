import { describe, it, expect, beforeEach } from 'vitest'
import { ToolRegistry } from '../services/tool-registry.js'
import type { ToolHandler, ToolMetadata, ToolPolicy } from '../types/tool-types.js'

function makeMetadata(overrides: Partial<ToolMetadata> = {}): ToolMetadata {
  return { name: 'test-tool', description: 'A test tool', requiresBrowser: false, tags: [], ...overrides }
}

const echoHandler: ToolHandler = async (input) => ({ ok: true, output: input })

describe('ToolRegistry', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = new ToolRegistry()
  })

  describe('register', () => {
    it('registers a tool successfully', () => {
      registry.register('echo', echoHandler, makeMetadata({ name: 'echo' }))
      expect(registry.has('echo')).toBe(true)
    })

    it('throws on duplicate registration', () => {
      registry.register('echo', echoHandler, makeMetadata({ name: 'echo' }))
      expect(() => registry.register('echo', echoHandler, makeMetadata({ name: 'echo' }))).toThrow('already registered')
    })
  })

  describe('execute', () => {
    it('returns success result with output', async () => {
      registry.register('echo', echoHandler, makeMetadata({ name: 'echo' }))
      const result = await registry.execute('echo', { message: 'hello' })
      expect(result).toEqual({ ok: true, output: { message: 'hello' } })
    })

    it('returns tool_not_found for unregistered tool', async () => {
      const result = await registry.execute('missing', {})
      expect(result).toEqual({
        ok: false,
        error: { code: 'tool_not_found', message: expect.stringContaining('missing'), retryable: false },
      })
    })

    it('catches handler errors and returns tool_execution_error', async () => {
      const failHandler: ToolHandler = async () => { throw new Error('boom') }
      registry.register('fail', failHandler, makeMetadata({ name: 'fail' }))
      const result = await registry.execute('fail', {})
      expect(result).toEqual({
        ok: false,
        error: { code: 'tool_execution_error', message: 'boom', retryable: true },
      })
    })
  })

  describe('policy enforcement', () => {
    it('blocks tool when not in allowedTools', async () => {
      registry.register('echo', echoHandler, makeMetadata({ name: 'echo' }))
      const policy: ToolPolicy = { allowedTools: ['other-tool'], browserAccess: false }
      const result = await registry.execute('echo', {}, policy)
      expect(result).toEqual({
        ok: false,
        error: { code: 'tool_not_allowed', message: expect.stringContaining('echo'), retryable: false },
      })
    })

    it('blocks tool when in deniedTools', async () => {
      registry.register('echo', echoHandler, makeMetadata({ name: 'echo' }))
      const policy: ToolPolicy = { deniedTools: ['echo'], browserAccess: false }
      const result = await registry.execute('echo', {}, policy)
      expect(result).toEqual({
        ok: false,
        error: { code: 'tool_not_allowed', message: expect.stringContaining('echo'), retryable: false },
      })
    })

    it('blocks browser tool when policy disallows browser', async () => {
      registry.register('browser-tool', echoHandler, makeMetadata({ name: 'browser-tool', requiresBrowser: true }))
      const policy: ToolPolicy = { browserAccess: false }
      const result = await registry.execute('browser-tool', {}, policy)
      expect(result).toEqual({
        ok: false,
        error: { code: 'tool_not_allowed', message: expect.stringContaining('browser-tool'), retryable: false },
      })
    })

    it('allows tool when policy permits', async () => {
      registry.register('echo', echoHandler, makeMetadata({ name: 'echo' }))
      const policy: ToolPolicy = { allowedTools: ['echo'], browserAccess: false }
      const result = await registry.execute('echo', { msg: 'ok' }, policy)
      expect(result).toEqual({ ok: true, output: { msg: 'ok' } })
    })
  })

  describe('sensitive data sanitization', () => {
    it('redacts keys matching sensitive patterns', async () => {
      const handler: ToolHandler = async () => ({
        ok: true,
        output: { customerId: '123', api_key: 'sk-secret', password: 'hunter2', name: 'visible' },
      })
      registry.register('leaky', handler, makeMetadata({ name: 'leaky' }))
      const result = await registry.execute('leaky', {})
      expect(result).toEqual({
        ok: true,
        output: { customerId: '123', api_key: '[REDACTED]', password: '[REDACTED]', name: 'visible' },
      })
    })

    it('redacts bearer tokens in string output', async () => {
      const handler: ToolHandler = async () => ({
        ok: true,
        output: 'Auth: Bearer sk-12345-abc',
      })
      registry.register('bearer', handler, makeMetadata({ name: 'bearer' }))
      const result = await registry.execute('bearer', {})
      expect(result).toEqual({ ok: true, output: 'Auth: Bearer [REDACTED]' })
    })
  })

  describe('listTools', () => {
    it('returns metadata for all registered tools', () => {
      registry.register('a', echoHandler, makeMetadata({ name: 'a', description: 'Tool A' }))
      registry.register('b', echoHandler, makeMetadata({ name: 'b', description: 'Tool B' }))
      const list = registry.listTools()
      expect(list).toHaveLength(2)
      expect(list.map((t) => t.name).sort()).toEqual(['a', 'b'])
    })
  })
})

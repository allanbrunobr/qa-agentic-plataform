import type {
  ToolHandler,
  ToolMetadata,
  ToolPolicy,
  ToolResult,
  ToolContext,
} from '../types/tool-types.js'
import { SENSITIVE_PATTERNS } from '../types/tool-types.js'

interface RegisteredTool {
  handler: ToolHandler
  metadata: ToolMetadata
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>()

  register(name: string, handler: ToolHandler, metadata: ToolMetadata): void {
    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered`)
    }
    this.tools.set(name, { handler, metadata })
  }

  async execute(
    name: string,
    input: unknown,
    agentPolicy?: ToolPolicy,
    context: ToolContext = {},
  ): Promise<ToolResult> {
    // Check if tool exists
    const tool = this.tools.get(name)
    if (!tool) {
      return { ok: false, error: { code: 'tool_not_found', message: `Tool "${name}" is not registered`, retryable: false } }
    }

    // Check policy
    if (agentPolicy) {
      if (!this.isPolicyAllowed(name, tool.metadata, agentPolicy)) {
        return { ok: false, error: { code: 'tool_not_allowed', message: `Agent policy does not allow tool "${name}"`, retryable: false } }
      }
    }

    // Execute
    try {
      const result = await tool.handler(input, context)
      return result.ok ? { ok: true, output: sanitizeOutput(result.output) } : result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code: 'tool_execution_error', message, retryable: true } }
    }
  }

  listTools(): ToolMetadata[] {
    return Array.from(this.tools.values()).map((t) => t.metadata)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  getMetadata(name: string): ToolMetadata | undefined {
    return this.tools.get(name)?.metadata
  }

  private isPolicyAllowed(name: string, metadata: ToolMetadata, policy: ToolPolicy): boolean {
    // Browser access check
    if (metadata.requiresBrowser && !policy.browserAccess) {
      return false
    }

    // Denied list takes precedence
    if (policy.deniedTools?.includes(name)) {
      return false
    }

    // If allowedTools is defined, tool must be in it
    if (policy.allowedTools && !policy.allowedTools.includes(name)) {
      return false
    }

    return true
  }
}

function sanitizeOutput(output: unknown): unknown {
  if (output == null) return output
  if (typeof output === 'string') return sanitizeString(output)
  if (Array.isArray(output)) return output.map(sanitizeOutput)
  if (typeof output === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(output as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        result[key] = '[REDACTED]'
      } else {
        result[key] = sanitizeOutput(value)
      }
    }
    return result
  }
  return output
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(key))
}

function sanitizeString(value: string): string {
  // Redact bearer tokens inline
  return value.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
}

export type RuntimeHookName =
  | 'beforeModelCall'
  | 'afterModelResponse'
  | 'beforeToolCall'
  | 'afterToolResult'
  | 'beforeStepComplete'
  | 'afterStepComplete'
  | 'onTimeout'
  | 'onGovernanceDecision'

export interface RuntimeHookEvent {
  name: RuntimeHookName
  timestamp: string
  sessionId?: string
  agentRole?: string
  stepId?: string
  attempt?: number
  toolName?: string
  toolCallId?: string
  payload?: Record<string, unknown>
}

export type RuntimeHookHandler = (event: RuntimeHookEvent) => void | Promise<void>

export interface RuntimeHookFailure {
  hookName: RuntimeHookName
  message: string
}

export class RuntimeHookBus {
  private readonly handlers = new Map<RuntimeHookName, Set<RuntimeHookHandler>>()

  register(name: RuntimeHookName, handler: RuntimeHookHandler): () => void {
    const handlers = this.handlers.get(name) ?? new Set<RuntimeHookHandler>()
    handlers.add(handler)
    this.handlers.set(name, handlers)
    return () => {
      handlers.delete(handler)
      if (handlers.size === 0) this.handlers.delete(name)
    }
  }

  listHooks(): RuntimeHookName[] {
    return [...this.handlers.keys()]
  }

  async emit(
    name: RuntimeHookName,
    event: Omit<RuntimeHookEvent, 'name' | 'timestamp'> = {},
  ): Promise<RuntimeHookFailure[]> {
    const failures: RuntimeHookFailure[] = []
    for (const handler of this.handlers.get(name) ?? []) {
      try {
        await handler({ name, timestamp: new Date().toISOString(), ...event })
      } catch (error) {
        failures.push({ hookName: name, message: error instanceof Error ? error.message : String(error) })
      }
    }
    return failures
  }

  emitSync(
    name: RuntimeHookName,
    event: Omit<RuntimeHookEvent, 'name' | 'timestamp'> = {},
  ): RuntimeHookFailure[] {
    const failures: RuntimeHookFailure[] = []
    for (const handler of this.handlers.get(name) ?? []) {
      try {
        const result = handler({ name, timestamp: new Date().toISOString(), ...event })
        if (isPromiseLike(result)) {
          failures.push({ hookName: name, message: 'Async hook registered for sync emit path' })
        }
      } catch (error) {
        failures.push({ hookName: name, message: error instanceof Error ? error.message : String(error) })
      }
    }
    return failures
  }
}

export const defaultRuntimeHookBus = new RuntimeHookBus()

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return typeof value === 'object' && value !== null && 'then' in value
}

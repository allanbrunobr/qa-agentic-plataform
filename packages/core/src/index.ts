export * from './contracts/agent-types.ts'
export * from './contracts/scenario-types.ts'
export * from './contracts/session-types.ts'
export * from './contracts/tool-types.ts'
export * from './runtime/core-runtime-contracts.ts'
export * from './runtime/file-session-store.ts'
export * from './runtime/adapter-execution-engine.ts'
export * from './runtime/session-lifecycle-runner.ts'
export * from './runtime/instruction-layer.ts'
export * from './runtime/contract-evaluation.ts'
export * from './runtime/scenario-quality-gates.ts'

export interface CoreRuntimeManifest {
  purpose: string
  capabilities: string[]
}

export const coreRuntimeManifest: CoreRuntimeManifest = {
  purpose: 'host-agnostic agentic runtime core',
  capabilities: [
    'sessions',
    'events',
    'orchestrator',
    'agents',
    'sensors',
    'providers',
    'artifacts',
  ],
}

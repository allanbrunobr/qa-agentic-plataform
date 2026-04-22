import type {
  BootstrapDraft,
  DiscoveryHintsProvider,
  DiscoveryReport,
  RepositoryClassification,
  DiscoveredRole,
  DiscoveredSurface,
  HostProjectPointer,
} from './contracts.ts'

export interface FileSignal {
  path: string
  reason: string
}

export interface DiscoverySnapshot {
  pointer: HostProjectPointer
  framework: string | null
  repository?: RepositoryClassification
  signals: FileSignal[]
  roles: DiscoveredRole[]
  surfaces: DiscoveredSurface[]
  risks: string[]
}

export function createDiscoverySnapshot(input: {
  pointer: HostProjectPointer
  framework?: string | null
  repository?: RepositoryClassification
  signals?: FileSignal[]
  roles?: DiscoveredRole[]
  surfaces?: DiscoveredSurface[]
  risks?: string[]
}): DiscoverySnapshot {
  return {
    pointer: input.pointer,
    framework: input.framework ?? null,
    repository: input.repository,
    signals: input.signals ?? [],
    roles: input.roles ?? [],
    surfaces: input.surfaces ?? [],
    risks: input.risks ?? [],
  }
}

export function snapshotToReport(snapshot: DiscoverySnapshot): DiscoveryReport {
  return {
    framework: snapshot.framework,
    repository: snapshot.repository,
    roles: snapshot.roles,
    surfaces: snapshot.surfaces,
    risks: snapshot.risks,
  }
}

export function createBootstrapDraft(input: BootstrapDraft): BootstrapDraft {
  return {
    personas: input.personas,
    scenarios: input.scenarios,
    capabilityCandidates: input.capabilityCandidates,
    hostNotes: input.hostNotes,
  }
}

export abstract class BaseDiscoveryHintsProvider implements DiscoveryHintsProvider {
  abstract readonly id: string

  abstract discover(pointer: HostProjectPointer): Promise<DiscoveryReport>

  abstract synthesize(report: DiscoveryReport): Promise<BootstrapDraft>
}

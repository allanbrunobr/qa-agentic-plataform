import type { DomainDiscoveryBundle } from './domain-discovery-contracts.ts'

export interface HostProjectPointer {
  repoPath: string
  appPath?: string
  baseUrl?: string
}

export type RepositoryKind = 'frontend' | 'backend_api' | 'cli' | 'library' | 'monorepo' | 'unknown'

export interface RepositoryClassification {
  kind: RepositoryKind
  secondaryKinds: RepositoryKind[]
  language: string | null
  frameworks: string[]
  packageManager: string | null
  confidence: number
  evidence: string[]
  runtimeHints: string[]
}

export interface DiscoveredRole {
  id: string
  confidence: number
  evidence: string[]
}

export interface DiscoveredSurface {
  id: string
  kind: 'route' | 'module' | 'feature' | 'permission'
  label: string
  evidence: string[]
}

export interface DiscoveryReport {
  framework: string | null
  repository?: RepositoryClassification
  domainDiscovery?: DomainDiscoveryBundle
  surfaces: DiscoveredSurface[]
  roles: DiscoveredRole[]
  risks: string[]
}

export interface GeneratedPersonaDraft {
  id: string
  title: string
  rationale: string
  allowedTools: string[]
}

export interface GeneratedScenarioDraft {
  id: string
  title: string
  participatingRoles: string[]
  rationale: string
  candidateSteps: string[]
}

export interface BootstrapDraft {
  personas: GeneratedPersonaDraft[]
  scenarios: GeneratedScenarioDraft[]
  capabilityCandidates: string[]
  hostNotes: string[]
}

export interface BrowserHostAdapter {
  id: string
  login(route: string, roleId: string): Promise<void>
  navigate(route: string): Promise<void>
}

export interface CapabilityAdapter {
  id: string
  listCapabilities(): string[]
}

export interface ScenarioPack {
  id: string
  listScenarios(): string[]
}

export interface AgentPack {
  id: string
  listAgents(): string[]
}

export interface DiscoveryHintsProvider {
  id: string
  discover(pointer: HostProjectPointer): Promise<DiscoveryReport>
  synthesize(report: DiscoveryReport): Promise<BootstrapDraft>
}

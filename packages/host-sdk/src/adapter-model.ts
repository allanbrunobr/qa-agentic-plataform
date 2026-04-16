export type AdapterExecutionStatus = 'initialized' | 'running' | 'complete' | 'failed' | 'cancelled'

export interface AdapterAuthModel {
  loginEntryPoint: string
  supportsRoleSwitch: boolean
  sessionHints: string[]
}

export interface AdapterRouteModel {
  id: string
  path: string
  purpose: string
}

export interface AdapterCapabilityModel {
  id: string
  purpose: string
  sourceHint: string
}

export interface AdapterPersonaModel {
  id: string
  title: string
  goal: string
  allowedCapabilities: string[]
}

export interface AdapterScenarioModel {
  id: string
  title: string
  roles: string[]
  steps: string[]
  expectedArtifacts: string[]
  stepDefinitions?: AdapterScenarioStepModel[]
}

export interface AdapterScenarioStepModel {
  id: string
  roleId: string
  capabilityId: string
  producesArtifacts?: string[]
}

export interface AdapterManifestModel {
  id: string
  label: string
  hostProduct: string
  framework: string
  status: 'draft' | 'certified'
}

export interface AdapterModelBundle {
  manifest: AdapterManifestModel
  auth: AdapterAuthModel
  routes: AdapterRouteModel[]
  capabilities: AdapterCapabilityModel[]
  personas: AdapterPersonaModel[]
  scenarios: AdapterScenarioModel[]
}

export interface AdapterExecutionInit {
  adapterId: string
  scenarioId: string
  repoPath: string
  baseUrl?: string
  runtimeFlags?: {
    simulateRetryStep?: string
    cancelExecution?: boolean
  }
}

export interface AdapterExecutionDraft {
  executionId: string
  adapterId: string
  scenarioId: string
  hostProjectPath: string
  status: AdapterExecutionStatus
  personas: string[]
  steps: string[]
  notes: string[]
  runtimeFlags?: AdapterExecutionInit['runtimeFlags']
}

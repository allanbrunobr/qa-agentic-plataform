import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { BootstrapDraft, DiscoveryReport } from '../../../host-sdk/src/contracts.ts'

const ADAPTERS_ROOT = path.resolve('/path/to/projects/agentic-platform/adapters')

function toConstName(targetAdapterId: string, suffix: string) {
  const normalized = targetAdapterId.replace(/[-_]+(.)/g, (_, char: string) => char.toUpperCase())
  return `${normalized}${suffix}`
}

function inferTargetAdapterId(repoPath: string, explicit?: string) {
  if (explicit) return explicit
  const base = path.basename(repoPath).trim().toLowerCase()
  return base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'generated-host'
}

function print(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function inferStepRole(stepId: string, fallbackRoles: string[]) {
  if (stepId.includes('customer') || stepId.includes('schedule')) return 'sales-associate'
  if (stepId.includes('fulfillment')) return 'fulfillment-agent'
  if (stepId.includes('billing') || stepId.includes('guide')) return 'billing_clerk'
  if (stepId.includes('closure') || stepId.includes('finance') || stepId.includes('report')) return 'store_manager'
  return fallbackRoles[0] ?? 'unknown'
}

function inferCapabilityId(stepId: string) {
  if (stepId === 'create_customer') return 'createCustomer'
  if (stepId === 'schedule_order' || stepId === 'schedule_return') return 'scheduleOrder'
  if (stepId === 'complete_fulfillment' || stepId === 'complete_return_fulfillment') return 'completeFulfillment'
  if (stepId === 'review_billing_guide') return 'findBillingGuideByEventId'
  if (stepId === 'validate_closure') return 'validateManagementClosure'
  return 'TODO'
}

function inferProducedArtifacts(stepId: string) {
  if (stepId === 'create_customer') return ['customerId']
  if (stepId === 'schedule_order' || stepId === 'schedule_return') return ['eventId']
  if (stepId === 'complete_fulfillment' || stepId === 'complete_return_fulfillment') return ['fulfillmentCompleted']
  if (stepId === 'review_billing_guide') return ['billingGuideValidated']
  if (stepId === 'validate_closure') return ['financeValidated', 'reportsValidated']
  return []
}

export async function materializeAdapterDraft(input: {
  repoPath: string
  report: DiscoveryReport
  draft: BootstrapDraft
  targetAdapterId?: string
}) {
  const targetAdapterId = inferTargetAdapterId(input.repoPath, input.targetAdapterId)
  const outputDir = path.join(ADAPTERS_ROOT, targetAdapterId, 'src', 'model', 'generated')
  await fs.mkdir(outputDir, { recursive: true })

  const manifestConst = toConstName(targetAdapterId, 'GeneratedManifest')
  const authConst = toConstName(targetAdapterId, 'GeneratedAuth')
  const routesConst = toConstName(targetAdapterId, 'GeneratedRoutes')
  const capabilitiesConst = toConstName(targetAdapterId, 'GeneratedCapabilities')
  const personasConst = toConstName(targetAdapterId, 'GeneratedPersonas')
  const scenariosConst = toConstName(targetAdapterId, 'GeneratedScenarios')

  const manifestContent = `import type { AdapterManifestModel } from '../../../../../packages/host-sdk/src/adapter-model.ts'

export const ${manifestConst}: AdapterManifestModel = ${print({
    id: targetAdapterId,
    label: targetAdapterId,
    hostProduct: targetAdapterId,
    framework: input.report.framework ?? 'unknown',
    status: 'draft',
  })} as const
`

  const authContent = `import type { AdapterAuthModel } from '../../../../../packages/host-sdk/src/adapter-model.ts'

export const ${authConst}: AdapterAuthModel = ${print({
    loginEntryPoint: '/login',
    supportsRoleSwitch: true,
    sessionHints: ['generated bootstrap draft - review auth flow'],
  })} as const
`

  const routesContent = `import type { AdapterRouteModel } from '../../../../../packages/host-sdk/src/adapter-model.ts'

export const ${routesConst}: AdapterRouteModel[] = ${print(
    input.report.surfaces.map((surface) => ({
      id: surface.id,
      path: '/TODO',
      purpose: `${surface.kind}: ${surface.label}`,
    })),
  )} as const
`

  const capabilitiesContent = `import type { AdapterCapabilityModel } from '../../../../../packages/host-sdk/src/adapter-model.ts'

export const ${capabilitiesConst}: AdapterCapabilityModel[] = ${print(
    input.draft.capabilityCandidates.map((capabilityId) => ({
      id: capabilityId,
      purpose: 'Generated from discovery/bootstrap draft',
      sourceHint: 'Review and map this capability to host-specific automation',
    })),
  )} as const
`

  const personasContent = `import type { AdapterPersonaModel } from '../../../../../packages/host-sdk/src/adapter-model.ts'

export const ${personasConst}: AdapterPersonaModel[] = ${print(
    input.draft.personas.map((persona) => ({
      id: persona.id,
      title: persona.title,
      goal: persona.rationale,
      allowedCapabilities: persona.allowedTools,
    })),
  )} as const
`

  const scenariosContent = `import type { AdapterScenarioModel } from '../../../../../packages/host-sdk/src/adapter-model.ts'

export const ${scenariosConst}: AdapterScenarioModel[] = ${print(
    input.draft.scenarios.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      roles: scenario.participatingRoles,
      steps: scenario.candidateSteps,
      expectedArtifacts: scenario.candidateSteps.flatMap((stepId) => inferProducedArtifacts(stepId)),
      stepDefinitions: scenario.candidateSteps.map((stepId) => ({
        id: stepId,
        roleId: inferStepRole(stepId, scenario.participatingRoles),
        capabilityId: inferCapabilityId(stepId),
        producesArtifacts: inferProducedArtifacts(stepId),
      })),
    })),
  )} as const
`

  const indexContent = `export * from './manifest.generated.ts'
export * from './auth.generated.ts'
export * from './routes.generated.ts'
export * from './capabilities.generated.ts'
export * from './personas.generated.ts'
export * from './scenarios.generated.ts'
`

  const files = [
    ['manifest.generated.ts', manifestContent],
    ['auth.generated.ts', authContent],
    ['routes.generated.ts', routesContent],
    ['capabilities.generated.ts', capabilitiesContent],
    ['personas.generated.ts', personasContent],
    ['scenarios.generated.ts', scenariosContent],
    ['index.generated.ts', indexContent],
  ] as const

  await Promise.all(
    files.map(([filename, content]) => fs.writeFile(path.join(outputDir, filename), content, 'utf8')),
  )

  return {
    targetAdapterId,
    outputDir,
    files: files.map(([filename]) => path.join(outputDir, filename)),
  }
}

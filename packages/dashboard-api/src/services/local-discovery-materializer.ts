import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  BootstrapDraft,
  DiscoveryReport,
  GeneratedPersonaDraft,
  GeneratedScenarioDraft,
} from '../../../host-sdk/src/contracts.ts'
import { buildCodeGraph } from './code-graph-builder.ts'

type NormalizedStep = string

interface MaterializedPersona {
  id: string
  title: string
  goal: string
  allowedCapabilities: string[]
}

interface MaterializedScenario {
  id: string
  title: string
  roles: string[]
  steps: NormalizedStep[]
  expectedArtifacts: string[]
  stepDefinitions: Array<{
    id: NormalizedStep
    roleId: string
    capabilityId: string
    producesArtifacts: string[]
  }>
}

interface MaterializedRoute {
  id: string
  path: string
  purpose: string
  evidence: string[]
}

interface MaterializedCapability {
  id: string
  purpose: string
  sourceHint: string
  routeHint?: string
}

interface RuntimePlan {
  loginEntryPoint: string
  providers: string[]
  repositoryKind?: string
  runtimeMode: 'browser_model' | 'deterministic_non_browser'
  requiresBrowser: boolean
  requiresAnthropicModel: boolean
  routeCoverage: Array<{
    routeId: string
    path: string
    purpose: string
  }>
  capabilityCoverage: Array<{
    capabilityId: string
    routeHint?: string
    implementationStatus: 'stub'
  }>
  scenarioCoverage: Array<{
    scenarioId: string
    steps: NormalizedStep[]
  }>
}

interface ReferenceBridgeEntry {
  capabilityId: string
  modulePath: string
  exports: string[]
  type: 'direct' | 'composite'
}

function inferTargetId(repoPath: string) {
  const base = path.basename(repoPath).trim().toLowerCase()
  return base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'generated-host'
}

function normalizeConfidence(value: number) {
  if (!Number.isFinite(value)) return 0
  if (value > 1) return Math.max(0, Math.min(1, value / 10))
  return Math.max(0, Math.min(1, value))
}

function normalizeId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function toCamelCase(value: string) {
  return value.replace(/_+([a-z0-9])/g, (_, char: string) => char.toUpperCase())
}

function toTitle(value: string) {
  return normalizeId(value)
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function toLowerEvidence(value: string) {
  return value.normalize('NFKD').toLowerCase()
}

function legacyStoreFallbackEnabled() {
  return process.env.AGENTIC_PLATFORM_ENABLE_LEGACY_STORE_FALLBACK === '1'
}

function extractRoutePathFromEvidence(evidence: string) {
  const normalized = evidence.replace(/\\/g, '/')
  const marker = '/src/app/'
  const markerIndex = normalized.indexOf(marker)
  if (markerIndex === -1) return null
  let appPath = normalized.slice(markerIndex + marker.length)
  appPath = appPath.replace(/\.(tsx|ts|js|jsx)$/, '')
  appPath = appPath.replace(/^(\(internal\)|\(auth\)|\(layout-redirect\))\//, '')
  appPath = appPath.replace(/\/page$/, '')
  appPath = appPath.replace(/\/layout$/, '')
  appPath = appPath.replace(/\/loading$/, '')
  appPath = appPath.replace(/\/error$/, '')
  if (!appPath || appPath === 'page') return '/'
  return '/' + appPath
}

function inferProducedArtifacts(stepId: NormalizedStep) {
  if (legacyStoreFallbackEnabled()) {
    if (stepId === 'create_customer') return ['customerId']
    if (stepId === 'schedule_order' || stepId === 'schedule_return') return ['eventId']
    if (stepId === 'complete_fulfillment' || stepId === 'complete_return_fulfillment') return ['fulfillmentCompleted']
    if (stepId === 'review_billing_guide') return ['billingGuideValidated']
    if (stepId === 'validate_closure') return ['financeValidated', 'reportsValidated']
  }

  if (stepId === 'fill_customer_email') return ['customerEmail']
  if (stepId === 'add_cart_item') return ['cartItemId']
  if (stepId === 'submit_order') return ['orderSubmitted']
  if (stepId === 'open_primary_route') return ['routeLoaded']
  if (stepId === 'interact_with_primary_action') return ['primaryActionCompleted']
  if (stepId === 'verify_primary_feedback') return ['primaryFeedbackVisible']
  if (stepId === 'start_api_service') return ['serviceStarted']
  if (stepId === 'call_health_endpoint' || stepId === 'call_primary_endpoint') return ['apiResponse']
  if (stepId === 'verify_api_response') return ['apiContractVerified']
  if (stepId === 'run_cli_help') return ['cliHelpOutput']
  if (stepId === 'verify_cli_output') return ['cliOutputVerified']
  if (stepId === 'inspect_package_exports') return ['packageExports']
  if (stepId === 'verify_public_api_docs') return ['publicApiDocsVerified']
  if (stepId === 'inspect_repository_structure') return ['repositoryStructure']
  if (stepId === 'identify_test_entrypoints') return ['testEntrypoints']
  if (stepId.includes('verify') || stepId.includes('validate') || stepId.includes('assert')) return ['verificationResult']
  if (stepId.includes('call') || stepId.includes('request') || stepId.includes('endpoint')) return ['response']
  if (stepId.includes('inspect') || stepId.includes('identify') || stepId.includes('discover')) return ['inspectionResult']
  if (stepId.includes('run') || stepId.includes('command') || stepId.includes('cli')) return ['commandResult']
  if (stepId.includes('open') || stepId.includes('navigate') || stepId.includes('visit')) return ['pageLoaded']
  if (stepId.includes('fill') || stepId.includes('add') || stepId.includes('submit') || stepId.includes('interact')) {
    return ['interactionResult']
  }
  return [`${toCamelCase(normalizeId(stepId))}Result`]
}

function inferCapabilityId(stepId: NormalizedStep) {
  if (stepId === 'fill_customer_email') return 'fillCustomerEmail'
  if (stepId === 'add_cart_item') return 'addCartItem'
  if (stepId === 'submit_order') return 'submitOrder'
  if (stepId === 'open_primary_route') return 'openPrimaryRoute'
  if (stepId === 'interact_with_primary_action') return 'interactWithPrimaryAction'
  if (stepId === 'verify_primary_feedback') return 'verifyPrimaryFeedback'
  if (stepId === 'start_api_service') return 'startApiService'
  if (stepId === 'call_health_endpoint') return 'callHealthEndpoint'
  if (stepId === 'call_primary_endpoint') return 'callPrimaryEndpoint'
  if (stepId === 'verify_api_response') return 'verifyApiResponse'
  if (stepId === 'run_cli_help') return 'runCliHelp'
  if (stepId === 'verify_cli_output') return 'verifyCliOutput'
  if (stepId === 'inspect_package_exports') return 'inspectPackageExports'
  if (stepId === 'verify_public_api_docs') return 'verifyPublicApiDocs'
  if (stepId === 'inspect_repository_structure') return 'inspectRepositoryStructure'
  if (stepId === 'identify_test_entrypoints') return 'identifyTestEntrypoints'
  return toCamelCase(normalizeId(stepId))
}

function inferStepRole(stepId: NormalizedStep, fallbackRoles: string[]) {
  if (legacyStoreFallbackEnabled()) {
    if (stepId === 'create_customer' || stepId === 'schedule_order' || stepId === 'schedule_return') return 'sales-associate'
    if (stepId === 'complete_fulfillment' || stepId === 'complete_return_fulfillment') return 'fulfillment-agent'
    if (stepId === 'review_billing_guide') return 'billing_clerk'
    if (stepId === 'validate_closure') return 'store_manager'
  }

  if (
    stepId === 'fill_customer_email' ||
    stepId === 'add_cart_item' ||
    stepId === 'submit_order' ||
    stepId === 'open_primary_route' ||
    stepId === 'interact_with_primary_action' ||
    stepId === 'verify_primary_feedback'
  ) return 'primary_user'
  if (
    stepId === 'start_api_service' ||
    stepId === 'call_health_endpoint' ||
    stepId === 'call_primary_endpoint' ||
    stepId === 'verify_api_response'
  ) return 'api_consumer'
  if (stepId === 'run_cli_help' || stepId === 'verify_cli_output') return 'cli_user'
  if (stepId === 'inspect_package_exports' || stepId === 'verify_public_api_docs') return 'integration_developer'
  if (stepId === 'inspect_repository_structure' || stepId === 'identify_test_entrypoints') return 'repository_reviewer'
  return fallbackRoles[0] ?? 'primary_user'
}

function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return pad + '[]'
    return value
      .map((item) => {
        if (item && typeof item === 'object') {
          const nested = toYaml(item, indent + 1)
          const lines = nested.split('\n')
          return pad + '- ' + lines[0].trimStart() + (lines.length > 1 ? '\n' + lines.slice(1).join('\n') : '')
        }
        return pad + '- ' + String(item)
      })
      .join('\n')
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        if (Array.isArray(item)) {
          if (item.length === 0) return pad + key + ': []'
          return pad + key + ':\n' + toYaml(item, indent + 1)
        }
        if (item && typeof item === 'object') {
          return pad + key + ':\n' + toYaml(item, indent + 1)
        }
        return pad + key + ': ' + String(item)
      })
      .join('\n')
  }

  return pad + String(value)
}

function normalizeReport(report: DiscoveryReport): DiscoveryReport {
  return {
    framework: report.framework,
    repository: report.repository,
    domainDiscovery: report.domainDiscovery,
    surfaces: report.surfaces.map((surface) => ({
      ...surface,
      id: normalizeId(surface.id || surface.label),
    })),
    roles: report.roles.map((role) => ({
      ...role,
      id: normalizeId(role.id),
      confidence: normalizeConfidence(role.confidence),
    })),
    risks: report.risks,
  }
}

function hasSurface(report: DiscoveryReport, tokens: string[]) {
  return report.surfaces.some((surface) => {
    const haystack = [surface.id, surface.label, ...surface.evidence].map(toLowerEvidence).join(' ')
    return tokens.some((token) => haystack.includes(token))
  })
}

function hasRole(report: DiscoveryReport, tokens: string[]) {
  return report.roles.some((role) => {
    const haystack = [role.id, ...role.evidence].map(toLowerEvidence).join(' ')
    return tokens.some((token) => haystack.includes(token))
  })
}

function inferRouteForSurface(surface: DiscoveryReport['surfaces'][number]) {
  if (surface.id === 'health_endpoint') return '/health'
  if (surface.id === 'api_service') return '/'
  if (
    surface.id.includes('root') ||
    surface.label.toLowerCase().includes('root') ||
    surface.evidence.some((item) => item.replace(/\\/g, '/').endsWith('index.html'))
  ) return '/'
  if (
    surface.id === 'cli_entrypoint' ||
    surface.id === 'package_api' ||
    surface.id === 'repository_structure'
  ) return 'not_applicable'

  for (const evidence of surface.evidence) {
    const route = extractRoutePathFromEvidence(evidence)
    if (route && route !== '/') return route
  }
  return '/TODO'
}

async function readTextIfExists(filePath: string) {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

async function copyFileIfExists(sourcePath: string, targetPath: string) {
  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.copyFile(sourcePath, targetPath)
    return true
  } catch {
    return false
  }
}

async function copyDirRecursiveIfExists(sourceDir: string, targetDir: string): Promise<string[]> {
  const copied: string[] = []
  try {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true })
    await fs.mkdir(targetDir, { recursive: true })
    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry.name)
      const targetPath = path.join(targetDir, entry.name)
      if (entry.isDirectory()) {
        copied.push(...await copyDirRecursiveIfExists(sourcePath, targetPath))
      } else if (entry.isFile()) {
        await fs.copyFile(sourcePath, targetPath)
        copied.push(targetPath)
      }
    }
  } catch {
    return copied
  }
  return copied
}

async function detectAuth(repoPath: string, report: DiscoveryReport) {
  if (report.repository && report.repository.kind !== 'frontend') {
    return {
      loginEntryPoint: 'not_applicable',
      supportsRoleSwitch: false,
      detectedProviders: [],
      sessionHints: [
        `no browser login inferred for ${report.repository.kind} repository`,
        'map runtime credentials or environment manually before promoting executable scenarios',
      ],
    }
  }

  const loginPage = path.join(repoPath, 'apps/webapp/src/app/(auth)/login/page.tsx')
  const autoLoginPage = path.join(repoPath, 'apps/webapp/src/app/(auth)/(layout-redirect)/auto-login/page.tsx')
  const loginHook = path.join(repoPath, 'apps/webapp/src/modules/auth/login/hooks/use-login-email-password.ts')
  const googleButton = path.join(repoPath, 'apps/webapp/src/modules/auth/login/ui/page-form-signin-google-button.tsx')
  const packageJsonPath = path.join(repoPath, 'apps/webapp/package.json')

  const [loginHookText, googleButtonText, packageJsonText] = await Promise.all([
    readTextIfExists(loginHook),
    readTextIfExists(googleButton),
    readTextIfExists(packageJsonPath),
  ])

  const providers: string[] = []
  if (loginHookText?.includes("signIn('credentials'")) providers.push('credentials')
  if (googleButtonText?.includes("signIn('google'")) providers.push('google')
  if (packageJsonText?.includes('next-auth')) providers.push('next-auth')
  if (packageJsonText?.toLowerCase().includes('keycloak')) providers.push('keycloak')

  return {
    loginEntryPoint: (await readTextIfExists(loginPage)) ? '/login' : '/TODO',
    supportsRoleSwitch: true,
    detectedProviders: providers,
    sessionHints: [
      (await readTextIfExists(autoLoginPage)) ? 'auto-login flow present at /auto-login' : null,
      loginHookText?.includes('callbackUrl') ? 'credentials login uses callback redirect flow' : null,
      googleButtonText?.includes("signIn('google'") ? 'google sign-in flow present' : null,
      providers.length > 0 ? `detected providers: ${providers.join(', ')}` : null,
      'review cookie/session handling and store switching before activation',
    ].filter(Boolean),
  }
}

function buildMaterializedRoutes(report: DiscoveryReport): MaterializedRoute[] {
  return report.surfaces.map((surface) => ({
    id: surface.id,
    path: inferRouteForSurface(surface),
    purpose: `${surface.kind}: ${surface.label}`,
    evidence: surface.evidence,
  }))
}

function inferCapabilityRouteHint(capabilityId: string, routes: MaterializedRoute[]) {
  const routeMap: Record<string, string[]> = {
    fillCustomerEmail: ['/'],
    addCartItem: ['/'],
    submitOrder: ['/'],
    openPrimaryRoute: ['/'],
    interactWithPrimaryAction: ['/'],
    verifyPrimaryFeedback: ['/'],
    startApiService: ['/'],
    callHealthEndpoint: ['/health', '/ready', '/live'],
    callPrimaryEndpoint: ['/'],
    verifyApiResponse: ['/'],
  }
  const candidates = routeMap[capabilityId] ?? []
  const route = routes.find((item) => (
    item.path !== '/TODO' &&
    candidates.some((candidate) => item.path.startsWith(candidate))
  ))
  return route?.path ?? candidates[0]
}

function buildMaterializedCapabilities(capabilityIds: string[], routes: MaterializedRoute[]): MaterializedCapability[] {
  const purposeByCapability: Record<string, string> = {
    fillCustomerEmail: 'Fill the primary customer email or identity field.',
    addCartItem: 'Add an item through the primary frontend interaction.',
    submitOrder: 'Submit the primary order or checkout form.',
    openPrimaryRoute: 'Open the primary frontend route.',
    interactWithPrimaryAction: 'Execute the main visible user action.',
    verifyPrimaryFeedback: 'Verify the primary success, feedback, or confirmation state.',
    captureScreenshot: 'Capture visual evidence from the active frontend page.',
    startApiService: 'Start or connect to the target API service.',
    callHealthEndpoint: 'Call the detected API health/readiness endpoint.',
    callPrimaryEndpoint: 'Call a primary API endpoint selected during review.',
    verifyApiResponse: 'Verify response status, schema, and core API contract expectations.',
    runCliHelp: 'Execute the CLI help command for the detected command-line entrypoint.',
    verifyCliOutput: 'Verify CLI output, exit code, and expected command contract.',
    inspectPackageExports: 'Inspect package export metadata and import surface.',
    verifyPublicApiDocs: 'Verify public API documentation or entrypoint evidence.',
    inspectRepositoryStructure: 'Inspect repository structure and classify available runtime surfaces.',
    identifyTestEntrypoints: 'Identify test commands, smoke commands, or runtime entrypoints.',
  }

  return capabilityIds.map((capabilityId) => ({
    id: capabilityId,
    purpose: purposeByCapability[capabilityId] ?? `Execute ${toTitle(capabilityId)} from the normalized discovery draft.`,
    sourceHint: 'Review and map this capability to host-specific automation',
    routeHint: inferCapabilityRouteHint(capabilityId, routes),
  }))
}

function buildRuntimePlan(input: {
  auth: Awaited<ReturnType<typeof detectAuth>>
  routes: MaterializedRoute[]
  capabilities: MaterializedCapability[]
  scenarios: MaterializedScenario[]
  repositoryKind?: string
}): RuntimePlan {
  const requiresBrowser = !input.repositoryKind || input.repositoryKind === 'frontend'

  return {
    loginEntryPoint: input.auth.loginEntryPoint,
    providers: input.auth.detectedProviders,
    repositoryKind: input.repositoryKind,
    runtimeMode: requiresBrowser ? 'browser_model' : 'deterministic_non_browser',
    requiresBrowser,
    requiresAnthropicModel: requiresBrowser,
    routeCoverage: input.routes.map((route) => ({
      routeId: route.id,
      path: route.path,
      purpose: route.purpose,
    })),
    capabilityCoverage: input.capabilities.map((capability) => ({
      capabilityId: capability.id,
      routeHint: capability.routeHint,
      implementationStatus: 'stub',
    })),
    scenarioCoverage: input.scenarios.map((scenario) => ({
      scenarioId: scenario.id,
      steps: scenario.steps,
    })),
  }
}

function buildAuthRuntimeStub(auth: Awaited<ReturnType<typeof detectAuth>>) {
  if (auth.loginEntryPoint === 'not_applicable') {
    return `export const generatedAuthRuntime = {
  loginEntryPoint: ${JSON.stringify(auth.loginEntryPoint)},
  supportsRoleSwitch: false,
  detectedProviders: [],
  sessionHints: ${JSON.stringify(auth.sessionHints, null, 2)},
} as const

export async function performHostLogin() {
  throw new Error('Browser login is not applicable for this generated adapter type.')
}

export async function switchHostRole() {
  throw new Error('Role switching is not applicable for this generated adapter type.')
}
`
  }

  const providerComment = auth.detectedProviders.length > 0
    ? auth.detectedProviders.join(', ')
    : 'none detected'
  return `export const generatedAuthRuntime = {
  loginEntryPoint: ${JSON.stringify(auth.loginEntryPoint)},
  supportsRoleSwitch: ${auth.supportsRoleSwitch ? 'true' : 'false'},
  detectedProviders: ${JSON.stringify(auth.detectedProviders)},
  sessionHints: ${JSON.stringify(auth.sessionHints, null, 2)},
} as const

export async function performHostLogin() {
  throw new Error('TODO: implement host login flow. Detected providers: ${providerComment}.')
}

export async function switchHostRole() {
  throw new Error('TODO: implement role switching / store switching for this host.')
}
`
}

function buildCapabilityRuntimeStub(capabilities: MaterializedCapability[]) {
  const handlers = capabilities
    .map((capability) => `  ${JSON.stringify(capability.id)}: async () => {
    throw new Error('TODO: implement ${capability.id}${capability.routeHint ? ` using route ${capability.routeHint}` : ''}.')
  },`)
    .join('\n')

  return `export const generatedCapabilityHandlers = {
${handlers}
} as const
`
}

function buildAssertionsStub(scenarios: MaterializedScenario[]) {
  const assertions = scenarios
    .map((scenario) => {
      const functionName = `assert_${scenario.id}`
      return `export async function ${functionName}() {
  throw new Error('TODO: implement assertions for ${scenario.id} (${scenario.steps.join(' -> ')}).')
}`
    })
    .join('\n\n')

  return `${assertions}
`
}

function buildReferenceBridge(capabilities: MaterializedCapability[]): ReferenceBridgeEntry[] {
  if (!legacyStoreFallbackEnabled()) return []

  const mapping: Record<string, Omit<ReferenceBridgeEntry, 'capabilityId'>> = {
    createCustomer: {
      modulePath: 'host-source-snapshot/integration-test/persona-tests/support/capabilities/customers.ts',
      exports: ['createCustomer'],
      type: 'direct',
    },
    scheduleOrder: {
      modulePath: 'host-source-snapshot/integration-test/persona-tests/support/capabilities/orders.ts',
      exports: ['scheduleOrder'],
      type: 'direct',
    },
    openOrderDetails: {
      modulePath: 'host-source-snapshot/integration-test/persona-tests/support/capabilities/order-details.ts',
      exports: ['openOrderDetails'],
      type: 'direct',
    },
    completeFulfillment: {
      modulePath: 'host-source-snapshot/integration-test/persona-tests/support/capabilities/order-details.ts',
      exports: ['completeFulfillment'],
      type: 'direct',
    },
    findBillingGuideByEventId: {
      modulePath: 'host-source-snapshot/integration-test/persona-tests/support/capabilities/billing.ts',
      exports: ['findGuideByEventId'],
      type: 'direct',
    },
    verifyFinanceDashboard: {
      modulePath: 'host-source-snapshot/integration-test/persona-tests/support/capabilities/finance.ts',
      exports: ['openFinanceDashboard', 'assertDashboardLoaded'],
      type: 'direct',
    },
    verifyReportsPage: {
      modulePath: 'host-source-snapshot/integration-test/persona-tests/support/capabilities/reports.ts',
      exports: ['openReportsPage', 'assertReportsPageLoaded'],
      type: 'direct',
    },
    validateManagementClosure: {
      modulePath: 'host-source-snapshot/integration-test/persona-tests/support/capabilities',
      exports: ['openFinanceDashboard', 'assertDashboardLoaded', 'openReportsPage', 'assertReportsPageLoaded'],
      type: 'composite',
    },
  }

  return capabilities
    .filter((capability) => mapping[capability.id])
    .map((capability) => ({
      capabilityId: capability.id,
      ...mapping[capability.id],
    }))
}

function appendUnique<T extends string>(items: T[], value: T | null | undefined) {
  if (!value) return
  if (!items.includes(value)) items.push(value)
}

function buildNormalizedPersonas(report: DiscoveryReport, draft: BootstrapDraft): GeneratedPersonaDraft[] {
  const personas: GeneratedPersonaDraft[] = []

  if (report.repository) {
    return draft.personas.map((persona) => ({
      id: normalizeId(persona.id),
      title: persona.title,
      rationale: persona.rationale,
      allowedTools: persona.allowedTools,
    }))
  }

  if (!legacyStoreFallbackEnabled()) {
    return draft.personas.map((persona) => ({
      id: normalizeId(persona.id),
      title: persona.title,
      rationale: persona.rationale,
      allowedTools: persona.allowedTools,
    }))
  }

  if (hasRole(report, ['sales-associate', 'receptionist']) || hasSurface(report, ['agenda', 'customers', 'customer'])) {
    personas.push({
      id: 'sales-associate',
      title: 'Sales Associate',
      rationale: 'Lente operacional de atendimento inicial, cadastro de customers e pedido.',
      allowedTools: ['createCustomer', 'scheduleOrder'],
    })
  }

  if (hasRole(report, ['operador', 'fulfillment-agent', 'fulfillment-agent', 'agent']) || hasSurface(report, ['registro', 'order details', 'customer management'])) {
    personas.push({
      id: 'fulfillment-agent',
      title: 'Fulfillment Agent',
      rationale: 'Lente storea focada em registro, atendimento e conclusao da pedido.',
      allowedTools: ['openOrderDetails', 'completeFulfillment'],
    })
  }

  if (hasSurface(report, ['billing', 'insurance'])) {
    personas.push({
      id: 'billing_clerk',
      title: 'Billing clerk',
      rationale: 'Lente de faturamento e validacao de guias Billing.',
      allowedTools: ['findBillingGuideByEventId'],
    })
  }

  if (
    hasRole(report, ['admin', 'administrator']) ||
    hasSurface(report, ['financas', 'finance', 'antecipacao', 'reports', 'configuracoes'])
  ) {
    personas.push({
      id: 'store_manager',
      title: 'Gestor da Storea',
      rationale: 'Lente gerencial focada em fechamento financeiro, configuracoes e validacao operacional.',
      allowedTools: ['verifyFinanceDashboard', 'verifyReportsPage'],
    })
  }

  if (personas.length > 0) return personas

  return draft.personas.map((persona) => ({
    id: normalizeId(persona.id),
    title: persona.title,
    rationale: persona.rationale,
    allowedTools: persona.allowedTools,
  }))
}

function buildScenario(id: string, title: string, roles: string[], steps: NormalizedStep[]): GeneratedScenarioDraft {
  return {
    id,
    title,
    participatingRoles: roles,
    rationale: `Generated from product surfaces for ${title}.`,
    candidateSteps: steps,
  }
}

function buildNormalizedScenarios(report: DiscoveryReport, draft: BootstrapDraft, personas: GeneratedPersonaDraft[]): GeneratedScenarioDraft[] {
  const scenarios: GeneratedScenarioDraft[] = []
  const personaIds = personas.map((persona) => persona.id)
  const hasReception = personaIds.includes('sales-associate')
  const hasAgent = personaIds.includes('fulfillment-agent')
  const hasBilling = personaIds.includes('billing_clerk')
  const hasManager = personaIds.includes('store_manager')
  const hasCustomerModule = hasSurface(report, ['customers', 'customer'])
  const hasScheduleModule = hasSurface(report, ['agenda', 'schedule'])
  const hasFinanceModule = hasSurface(report, ['financas', 'finance', 'antecipacao'])

  if (report.repository) {
    return draft.scenarios.map((scenario) => ({
      id: normalizeId(scenario.id),
      title: scenario.title,
      participatingRoles: scenario.participatingRoles.map(normalizeId),
      rationale: scenario.rationale,
      candidateSteps: normalizeFallbackSteps(scenario.candidateSteps),
    }))
  }

  if (!legacyStoreFallbackEnabled()) {
    return draft.scenarios.map((scenario) => ({
      id: normalizeId(scenario.id),
      title: scenario.title,
      participatingRoles: scenario.participatingRoles.map(normalizeId),
      rationale: scenario.rationale,
      candidateSteps: normalizeFallbackSteps(scenario.candidateSteps),
    }))
  }

  if (hasReception && hasAgent && (hasCustomerModule || hasScheduleModule)) {
    scenarios.push(buildScenario(
      'first_order',
      'First order',
      ['sales-associate'],
      ['create_customer', 'schedule_order'],
    ))
    scenarios.push(buildScenario(
      'first_order_multi_role',
      'First order multi-role',
      ['sales-associate', 'fulfillment-agent'],
      ['create_customer', 'schedule_order', 'complete_fulfillment'],
    ))
  }

  if (hasReception && hasAgent && hasBilling) {
    scenarios.push(buildScenario(
      'quarterly_reorder_multi_role',
      'Quarterly reorder multi-role',
      ['sales-associate', 'fulfillment-agent', 'billing_clerk'],
      ['create_customer', 'schedule_return', 'complete_return_fulfillment', 'review_billing_guide'],
    ))
  }

  if (hasReception && hasAgent && hasBilling && hasManager && hasFinanceModule) {
    scenarios.push(buildScenario(
      'quarterly_reorder_closure_multi_role',
      'Quarterly reorder closure multi-role',
      ['sales-associate', 'fulfillment-agent', 'billing_clerk', 'store_manager'],
      ['create_customer', 'schedule_return', 'complete_return_fulfillment', 'review_billing_guide', 'validate_closure'],
    ))
  }

  if (scenarios.length > 0) return scenarios

  return draft.scenarios.map((scenario) => ({
    id: normalizeId(scenario.id),
    title: scenario.title,
    participatingRoles: scenario.participatingRoles.map(normalizeId),
    rationale: scenario.rationale,
    candidateSteps: normalizeFallbackSteps(scenario.candidateSteps),
  }))
}

function normalizeFallbackSteps(steps: string[]): string[] {
  const normalized: string[] = []
  for (const step of steps) {
    const candidate = classifyFallbackStep(step)
    appendUnique(normalized, candidate ?? normalizeId(step))
  }
  return normalized
}

function classifyFallbackStep(step: string): NormalizedStep | null {
  const text = toLowerEvidence(step)
  if (text.includes('email')) return 'fill_customer_email'
  if (text.includes('cart') || text.includes('item')) return 'add_cart_item'
  if (text.includes('order') || text.includes('submit') || text.includes('checkout')) return 'submit_order'
  if (text.includes('open') && (text.includes('route') || text.includes('page'))) return 'open_primary_route'
  if (text.includes('action') || text.includes('button') || text.includes('interact')) return 'interact_with_primary_action'
  if (text.includes('feedback') || text.includes('confirmation') || text.includes('success')) return 'verify_primary_feedback'
  if (text.includes('health') || text.includes('readiness') || text.includes('liveness')) return 'call_health_endpoint'
  if (text.includes('api') && (text.includes('call') || text.includes('request') || text.includes('endpoint'))) return 'call_primary_endpoint'
  if (text.includes('response') || text.includes('schema') || text.includes('contract')) return 'verify_api_response'
  if (text.includes('cli') && text.includes('help')) return 'run_cli_help'
  if (text.includes('cli') || text.includes('output') || text.includes('exit code')) return 'verify_cli_output'
  if (text.includes('export') || text.includes('import') || text.includes('package')) return 'inspect_package_exports'
  if (text.includes('docs') || text.includes('public api')) return 'verify_public_api_docs'
  if (text.includes('repository') || text.includes('structure')) return 'inspect_repository_structure'
  if (text.includes('test') || text.includes('entrypoint')) return 'identify_test_entrypoints'
  if (!legacyStoreFallbackEnabled()) return null
  if (text.includes('customer') && (text.includes('create') || text.includes('register') || text.includes('cadast'))) return 'create_customer'
  if ((text.includes('schedule') || text.includes('book') || text.includes('agenda')) && text.includes('return')) return 'schedule_return'
  if (text.includes('schedule') || text.includes('book') || text.includes('agenda')) return 'schedule_order'
  if ((text.includes('consult') || text.includes('registro') || text.includes('order details')) && text.includes('return')) return 'complete_return_fulfillment'
  if (text.includes('consult') || text.includes('registro') || text.includes('order details')) return 'complete_fulfillment'
  if (text.includes('billing') || text.includes('guide') || text.includes('insurance')) return 'review_billing_guide'
  if (text.includes('finance') || text.includes('payment') || text.includes('closure') || text.includes('report')) return 'validate_closure'
  return null
}

function buildNormalizedDraft(report: DiscoveryReport, draft: BootstrapDraft): BootstrapDraft {
  const personas = buildNormalizedPersonas(report, draft)
  const scenarios = buildNormalizedScenarios(report, draft, personas)
  const capabilities = new Set<string>()

  for (const persona of personas) {
    for (const tool of persona.allowedTools) capabilities.add(tool)
  }

  for (const scenario of scenarios) {
    for (const step of scenario.candidateSteps) {
      const normalizedStep = step as NormalizedStep
      if (normalizedStep) {
        capabilities.add(inferCapabilityId(normalizedStep))
      }
    }
  }

  return {
    personas,
    scenarios,
    capabilityCandidates: [...capabilities],
    hostNotes: [
      ...draft.hostNotes,
      'Normalized from product surfaces and roles into agentic QA personas and executable scenario steps.',
    ],
  }
}

function buildMaterializedScenarios(scenarios: GeneratedScenarioDraft[]): MaterializedScenario[] {
  return scenarios.map((scenario) => {
    const normalizedSteps = scenario.candidateSteps as NormalizedStep[]
    return {
      id: scenario.id,
      title: scenario.title,
      roles: scenario.participatingRoles,
      steps: normalizedSteps,
      expectedArtifacts: normalizedSteps.flatMap((stepId) => inferProducedArtifacts(stepId)),
      stepDefinitions: normalizedSteps.map((stepId) => ({
        id: stepId,
        roleId: inferStepRole(stepId, scenario.participatingRoles),
        capabilityId: inferCapabilityId(stepId),
        producesArtifacts: inferProducedArtifacts(stepId),
      })),
    }
  })
}

export async function materializeLocalDiscovery(input: {
  repoPath: string
  report: DiscoveryReport
  draft: BootstrapDraft
}) {
  const localRoot = path.join(input.repoPath, '.agentic-qa')
  const adapterRoot = path.join(localRoot, 'adapter')
  const hostId = inferTargetId(input.repoPath)
  const normalizedReport = normalizeReport(input.report)
  const normalizedDraft = buildNormalizedDraft(normalizedReport, input.draft)
  const codeGraph = await buildCodeGraph({
    targetId: hostId,
    report: normalizedReport,
    draft: normalizedDraft,
    repoPath: input.repoPath,
  })
  const routes = buildMaterializedRoutes(normalizedReport)
  const auth = await detectAuth(input.repoPath, normalizedReport)

  const manifest = {
    id: hostId,
    label: hostId,
    hostProduct: hostId,
    framework: normalizedReport.framework ?? 'unknown',
    status: 'draft',
  }
  const capabilities = buildMaterializedCapabilities(normalizedDraft.capabilityCandidates, routes)

  const personas: MaterializedPersona[] = normalizedDraft.personas.map((persona) => ({
    id: persona.id,
    title: persona.title,
    goal: persona.rationale,
    allowedCapabilities: persona.allowedTools,
  }))

  const scenarios = buildMaterializedScenarios(normalizedDraft.scenarios)
  const runtimePlan = buildRuntimePlan({
    auth,
    routes,
    capabilities,
    scenarios,
    repositoryKind: normalizedReport.repository?.kind,
  })
  const authRuntimeStub = buildAuthRuntimeStub(auth)
  const capabilityRuntimeStub = buildCapabilityRuntimeStub(capabilities)
  const assertionsRuntimeStub = buildAssertionsStub(scenarios)
  const referenceBridge = buildReferenceBridge(capabilities)

  const workflowContracts = scenarios.map((scenario) => ({
    scenarioId: scenario.id,
    version: '1.0',
    deterministic: true,
    steps: scenario.stepDefinitions.map((step, index) => ({
      id: step.id,
      order: index,
      roleId: step.roleId,
      capabilityId: step.capabilityId,
      expectedArtifacts: [],
      producedArtifacts: step.producesArtifacts ?? [],
    })),
  }))

  const outputFiles: Array<readonly [string, unknown]> = [
    [path.join(adapterRoot, 'manifest', 'adapter-manifest.generated.json'), manifest],
    [path.join(adapterRoot, 'auth', 'auth.generated.json'), auth],
    [path.join(adapterRoot, 'routes', 'routes.generated.json'), routes],
    [path.join(adapterRoot, 'capabilities', 'capabilities.generated.json'), capabilities],
    [path.join(adapterRoot, 'personas', 'personas.generated.json'), personas],
    [path.join(adapterRoot, 'scenarios', 'scenarios.generated.json'), scenarios],
    [path.join(adapterRoot, 'config', 'discovery-report.generated.json'), normalizedReport],
    [path.join(adapterRoot, 'config', 'bootstrap-draft.generated.json'), normalizedDraft],
    [path.join(adapterRoot, 'config', 'code-graph.generated.json'), codeGraph],
  ]

  if (normalizedReport.domainDiscovery) {
    outputFiles.push(
      [path.join(adapterRoot, 'config', 'domain-discovery-bundle.generated.json'), normalizedReport.domainDiscovery],
      [path.join(adapterRoot, 'config', 'frontend-surface-map.generated.json'), normalizedReport.domainDiscovery.surfaceMap],
    )
  }

  const writtenFiles: string[] = []
  for (const [filePath, payload] of outputFiles) {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')
    writtenFiles.push(filePath)
  }

  const runtimeFiles: Array<[string, string]> = [
    [path.join(adapterRoot, 'runtime', 'runtime-plan.generated.json'), JSON.stringify(runtimePlan, null, 2)],
    [path.join(adapterRoot, 'runtime', 'auth-runtime.generated.ts'), authRuntimeStub],
    [path.join(adapterRoot, 'runtime', 'capability-handlers.generated.ts'), capabilityRuntimeStub],
    [path.join(adapterRoot, 'assertions', 'assertions.generated.ts'), assertionsRuntimeStub],
  ]

  for (const [filePath, content] of runtimeFiles) {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, 'utf8')
    writtenFiles.push(filePath)
  }

  const referenceBridgePath = path.join(adapterRoot, 'runtime', 'reference-bridge.generated.json')
  await fs.writeFile(referenceBridgePath, JSON.stringify(referenceBridge, null, 2), 'utf8')
  writtenFiles.push(referenceBridgePath)

  const snapshotRoot = path.join(adapterRoot, 'runtime', 'host-source-snapshot')
  const supportSource = path.join(input.repoPath, 'integration-test', 'persona-tests', 'support')
  const supportTarget = path.join(snapshotRoot, 'integration-test', 'persona-tests', 'support')
  writtenFiles.push(...await copyDirRecursiveIfExists(supportSource, supportTarget))

  const personaUtilsSource = path.join(input.repoPath, 'integration-test', 'persona-tests', 'utils')
  const personaUtilsTarget = path.join(snapshotRoot, 'integration-test', 'persona-tests', 'utils')
  writtenFiles.push(...await copyDirRecursiveIfExists(personaUtilsSource, personaUtilsTarget))

  const integrationUtilsSource = path.join(input.repoPath, 'integration-test', 'utils')
  const integrationUtilsTarget = path.join(snapshotRoot, 'integration-test', 'utils')
  writtenFiles.push(...await copyDirRecursiveIfExists(integrationUtilsSource, integrationUtilsTarget))

  const workflowIndex = workflowContracts.map((contract) => ({
    scenarioId: contract.scenarioId,
    file: path.join('workflow-contracts', contract.scenarioId + '.generated.yaml'),
  }))
  const workflowIndexPath = path.join(adapterRoot, 'workflow-contracts', 'index.generated.json')
  await fs.mkdir(path.dirname(workflowIndexPath), { recursive: true })
  await fs.writeFile(workflowIndexPath, JSON.stringify(workflowIndex, null, 2), 'utf8')
  writtenFiles.push(workflowIndexPath)

  for (const contract of workflowContracts) {
    const filePath = path.join(adapterRoot, 'workflow-contracts', contract.scenarioId + '.generated.yaml')
    await fs.writeFile(filePath, toYaml(contract) + '\n', 'utf8')
    writtenFiles.push(filePath)
  }

  return {
    repoPath: input.repoPath,
    localPackagePath: localRoot,
    adapterRoot,
    hostId,
    files: writtenFiles,
    report: normalizedReport,
    draft: normalizedDraft,
  }
}

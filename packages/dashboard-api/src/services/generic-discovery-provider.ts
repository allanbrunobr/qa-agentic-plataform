import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  BootstrapDraft,
  DiscoveryHintsProvider,
  DiscoveryReport,
  HostProjectPointer,
  RepositoryClassification,
  RepositoryKind,
} from '../../../host-sdk/src/contracts.ts'
import { inferDomainDiscoveryBundle } from './domain-specialist-service.ts'
import { classifyRepository } from './repository-classifier.ts'
import { scanStaticFrontend } from './static-frontend-scanner.ts'

export class GenericFrontendDiscoveryProvider implements DiscoveryHintsProvider {
  readonly id = 'generic-repository-discovery'
  private readonly cache = new Map<string, Promise<{ report: DiscoveryReport; draft: BootstrapDraft }>>()
  private lastRepoPath: string | null = null

  private analyze(pointer: HostProjectPointer) {
    this.lastRepoPath = pointer.repoPath
    if (!this.cache.has(pointer.repoPath)) {
      this.cache.set(pointer.repoPath, analyzeGenericFrontend(pointer.repoPath))
    }
    return this.cache.get(pointer.repoPath)!
  }

  async discover(pointer: HostProjectPointer): Promise<DiscoveryReport> {
    const result = await this.analyze(pointer)
    return result.report
  }

  async synthesize(_report: DiscoveryReport): Promise<BootstrapDraft> {
    if (!this.lastRepoPath) return fallbackGenericDraft()
    const cached = this.cache.get(this.lastRepoPath)
    return cached ? (await cached).draft : fallbackGenericDraft()
  }
}

async function analyzeGenericFrontend(repoPath: string): Promise<{ report: DiscoveryReport; draft: BootstrapDraft }> {
  const packageJson = await readJson(path.join(repoPath, 'package.json'))
  const sourceFiles = await listSourceFiles(repoPath)
  const sourceText = await readSourcePreview(sourceFiles)
  const repository = await classifyRepository(repoPath)
  const framework = detectFramework(packageJson, sourceFiles, repository)
  const surfaces = buildSurfaces(repoPath, packageJson, sourceFiles, sourceText, repository)
  const domainDiscovery = repository.kind === 'frontend'
    ? inferDomainDiscoveryBundle(await scanStaticFrontend(repoPath))
    : undefined

  const report: DiscoveryReport = {
    framework,
    repository,
    ...(domainDiscovery ? { domainDiscovery } : {}),
    surfaces,
    roles: buildRoles(repoPath, sourceFiles, repository),
    risks: buildRisks(repository),
  }

  return {
    report,
    draft: buildGenericDraft(sourceText, repository),
  }
}

function detectFramework(
  packageJson: Record<string, unknown> | null,
  sourceFiles: string[],
  repository: RepositoryClassification,
): string {
  if (repository.frameworks.length > 0) return repository.frameworks[0]!
  const deps = {
    ...recordValue(packageJson?.['dependencies']),
    ...recordValue(packageJson?.['devDependencies']),
  }
  if ('next' in deps || sourceFiles.some((filePath) => filePath.includes('/src/app/'))) return 'nextjs'
  if ('vite' in deps) return 'vite'
  if ('react' in deps) return 'react'
  if ('vue' in deps) return 'vue'
  if (repository.kind === 'backend_api') return repository.language ? `${repository.language}-api` : 'backend-api'
  if (repository.kind === 'cli') return repository.language ? `${repository.language}-cli` : 'cli'
  if (repository.kind === 'library') return repository.language ? `${repository.language}-library` : 'library'
  if (repository.kind === 'monorepo') return 'monorepo'
  return 'unknown'
}

function buildGenericDraft(sourceText: string, repository: RepositoryClassification): BootstrapDraft {
  if (repository.kind === 'backend_api') {
    const hasHealth = /health|heartbeat|readiness|liveness/i.test(sourceText)
    return {
      personas: [
        {
          id: 'api_consumer',
          title: 'API Consumer',
          rationale: 'Validates the primary service contract exposed by the target API repository.',
          allowedTools: hasHealth
            ? ['startApiService', 'callHealthEndpoint', 'verifyApiResponse']
            : ['startApiService', 'callPrimaryEndpoint', 'verifyApiResponse'],
        },
      ],
      scenarios: [
        {
          id: hasHealth ? 'api_health_smoke' : 'api_contract_smoke',
          title: hasHealth ? 'API health smoke flow' : 'API contract smoke flow',
          participatingRoles: ['api_consumer'],
          rationale: 'Generated from backend/API repository signatures.',
          candidateSteps: hasHealth
            ? ['start_api_service', 'call_health_endpoint', 'verify_api_response']
            : ['start_api_service', 'call_primary_endpoint', 'verify_api_response'],
        },
      ],
      capabilityCandidates: hasHealth
        ? ['startApiService', 'callHealthEndpoint', 'verifyApiResponse']
        : ['startApiService', 'callPrimaryEndpoint', 'verifyApiResponse'],
      hostNotes: [
        'Backend/API adapter generated from deterministic repository classification.',
        'Generated capabilities are draft stubs until endpoint URLs, auth, seed data, and assertions are mapped.',
      ],
    }
  }

  if (repository.kind === 'cli') {
    return {
      personas: [
        {
          id: 'cli_user',
          title: 'CLI User',
          rationale: 'Validates the command-line entrypoint and its observable output contract.',
          allowedTools: ['runCliHelp', 'verifyCliOutput'],
        },
      ],
      scenarios: [
        {
          id: 'cli_help_smoke',
          title: 'CLI help smoke flow',
          participatingRoles: ['cli_user'],
          rationale: 'Generated from CLI entrypoint metadata.',
          candidateSteps: ['run_cli_help', 'verify_cli_output'],
        },
      ],
      capabilityCandidates: ['runCliHelp', 'verifyCliOutput'],
      hostNotes: [
        'CLI adapter generated from deterministic repository classification.',
        'Generated capabilities are draft stubs until command invocation, environment, and expected output are mapped.',
      ],
    }
  }

  if (repository.kind === 'library') {
    return {
      personas: [
        {
          id: 'integration_developer',
          title: 'Integration Developer',
          rationale: 'Validates package metadata and public API surfaces from a developer integration perspective.',
          allowedTools: ['inspectPackageExports', 'verifyPublicApiDocs'],
        },
      ],
      scenarios: [
        {
          id: 'package_import_smoke',
          title: 'Package import smoke flow',
          participatingRoles: ['integration_developer'],
          rationale: 'Generated from package/library metadata.',
          candidateSteps: ['inspect_package_exports', 'verify_public_api_docs'],
        },
      ],
      capabilityCandidates: ['inspectPackageExports', 'verifyPublicApiDocs'],
      hostNotes: [
        'Library adapter generated from deterministic repository classification.',
        'Generated capabilities are draft stubs until build/import commands and public API assertions are mapped.',
      ],
    }
  }

  if (repository.kind === 'unknown' || repository.kind === 'monorepo') {
    return {
      personas: [
        {
          id: 'repository_reviewer',
          title: 'Repository Reviewer',
          rationale: 'Inspects repository structure when AP cannot infer a more specific executable runtime.',
          allowedTools: ['inspectRepositoryStructure', 'identifyTestEntrypoints'],
        },
      ],
      scenarios: [
        {
          id: 'repository_structure_smoke',
          title: 'Repository structure smoke flow',
          participatingRoles: ['repository_reviewer'],
          rationale: 'Generated as a safe fallback when runtime type is ambiguous.',
          candidateSteps: ['inspect_repository_structure', 'identify_test_entrypoints'],
        },
      ],
      capabilityCandidates: ['inspectRepositoryStructure', 'identifyTestEntrypoints'],
      hostNotes: [
        'Fallback adapter generated because repository type is ambiguous or unsupported.',
        'No scenario should be promoted to runnable until a concrete runtime is selected.',
      ],
    }
  }

  const hasCart = /cart|checkout|order|submit/i.test(sourceText)
  const scenarioTitle = hasCart ? 'Checkout smoke flow' : 'Primary user smoke flow'
  const scenarioId = hasCart ? 'checkout_smoke' : 'primary_user_smoke'
  const allowedTools = hasCart
    ? ['fillCustomerEmail', 'addCartItem', 'submitOrder', 'captureScreenshot']
    : ['openPrimaryRoute', 'interactWithPrimaryAction', 'verifyPrimaryFeedback', 'captureScreenshot']

  return {
    personas: [
      {
        id: 'primary_user',
        title: 'Primary User',
        rationale: 'Validates the main visible user journey detected in the target frontend.',
        allowedTools,
      },
    ],
    scenarios: [
      {
        id: scenarioId,
        title: scenarioTitle,
        participatingRoles: ['primary_user'],
        rationale: 'Generated from deterministic generic frontend discovery.',
        candidateSteps: hasCart
          ? ['fill_customer_email', 'add_cart_item', 'submit_order']
          : ['open_primary_route', 'interact_with_primary_action', 'verify_primary_feedback'],
      },
    ],
    capabilityCandidates: allowedTools,
    hostNotes: [
      'Generic frontend adapter generated from static route and UI evidence.',
      'Replace generated capability stubs with host-specific Playwright actions before certifying this adapter.',
    ],
  }
}

function buildRoles(
  repoPath: string,
  sourceFiles: string[],
  repository: RepositoryClassification,
): DiscoveryReport['roles'] {
  const evidence = [
    `repository kind: ${repository.kind}`,
    ...sourceFiles.slice(0, 3).map((filePath) => path.relative(repoPath, filePath)),
  ]

  const roleByKind: Record<RepositoryKind, DiscoveryReport['roles'][number]> = {
    frontend: {
      id: 'primary_user',
      confidence: 0.72,
      evidence: [
        'Generic frontend discovery inferred an end-user role from visible UI controls.',
        ...evidence,
      ],
    },
    backend_api: {
      id: 'api_consumer',
      confidence: repository.confidence,
      evidence: ['Backend/API repository signatures imply a service consumer role.', ...evidence],
    },
    cli: {
      id: 'cli_user',
      confidence: repository.confidence,
      evidence: ['CLI entrypoint metadata implies a command-line user role.', ...evidence],
    },
    library: {
      id: 'integration_developer',
      confidence: repository.confidence,
      evidence: ['Package metadata implies a developer integration role.', ...evidence],
    },
    monorepo: {
      id: 'repository_reviewer',
      confidence: repository.confidence,
      evidence: ['Monorepo metadata requires runtime selection before scenario activation.', ...evidence],
    },
    unknown: {
      id: 'repository_reviewer',
      confidence: repository.confidence,
      evidence: ['No specific runtime signature was detected.', ...evidence],
    },
  }

  return [roleByKind[repository.kind]]
}

function buildRisks(repository: RepositoryClassification): string[] {
  const common = [
    'Generic repository discovery used deterministic static analysis; review generated personas and scenarios before activation.',
    'Capability handlers are generated as host-specific stubs until mapped to real automation.',
  ]
  if (repository.kind === 'frontend') return common
  if (repository.kind === 'backend_api') {
    return [
      ...common,
      'Backend/API scenarios require endpoint, auth, environment, and seed data mapping before becoming runnable.',
    ]
  }
  if (repository.kind === 'cli') {
    return [
      ...common,
      'CLI scenarios require command invocation, working directory, environment, and output assertions before becoming runnable.',
    ]
  }
  if (repository.kind === 'library') {
    return [
      ...common,
      'Library scenarios require build/import commands and public API assertions before becoming runnable.',
    ]
  }
  return [
    ...common,
    'Repository type is ambiguous; generated scenarios are structure review drafts only.',
  ]
}

function buildSurfaces(
  repoPath: string,
  packageJson: Record<string, unknown> | null,
  sourceFiles: string[],
  sourceText: string,
  repository: RepositoryClassification,
): DiscoveryReport['surfaces'] {
  const surfaces: DiscoveryReport['surfaces'] = []
  const relativeSources = sourceFiles.map((filePath) => path.relative(repoPath, filePath))
  const hasPackageScripts = Object.keys(recordValue(packageJson?.['scripts'])).length > 0
  const hasMainEntry = relativeSources.some((filePath) => /(^|\/)main\.[jt]sx?$/.test(filePath))

  if (repository.kind === 'backend_api') {
    surfaces.push({
      id: 'api_service',
      kind: 'module',
      label: 'API Service',
      evidence: repository.evidence,
    })
    if (/health|heartbeat|readiness|liveness/i.test(sourceText)) {
      surfaces.push({
        id: 'health_endpoint',
        kind: 'route',
        label: 'Health Endpoint',
        evidence: matchingEvidence(relativeSources, sourceText, ['health', 'heartbeat', 'readiness', 'liveness']),
      })
    }
  } else if (repository.kind === 'cli') {
    surfaces.push({
      id: 'cli_entrypoint',
      kind: 'module',
      label: 'CLI Entrypoint',
      evidence: matchingEvidence(relativeSources, sourceText, ['cli', 'command', 'bin']),
    })
  } else if (repository.kind === 'library') {
    surfaces.push({
      id: 'package_api',
      kind: 'module',
      label: 'Package API',
      evidence: ['package.json', ...matchingEvidence(relativeSources, sourceText, ['export', 'public', 'index'])],
    })
  } else if (repository.kind === 'unknown' || repository.kind === 'monorepo') {
    surfaces.push({
      id: 'repository_structure',
      kind: 'module',
      label: 'Repository Structure',
      evidence: repository.evidence.length > 0 ? repository.evidence : relativeSources.slice(0, 5),
    })
  } else if (hasPackageScripts || hasMainEntry) {
    surfaces.push({
      id: 'root_app',
      kind: 'route',
      label: 'Root App',
      evidence: ['index.html', ...relativeSources.filter((filePath) => /src\/main\.[jt]sx?$/.test(filePath)).slice(0, 1)],
    })
  }

  if (repository.kind === 'frontend' && /checkout|cart|order/i.test(sourceText)) {
    surfaces.push({
      id: 'checkout',
      kind: 'feature',
      label: 'Checkout',
      evidence: matchingEvidence(relativeSources, sourceText, ['checkout', 'cart', 'order']),
    })
  }

  if (repository.kind === 'frontend' && /email|input|form/i.test(sourceText)) {
    surfaces.push({
      id: 'form_entry',
      kind: 'feature',
      label: 'Form Entry',
      evidence: matchingEvidence(relativeSources, sourceText, ['email', 'input', 'form']),
    })
  }

  if (surfaces.length === 0) {
    surfaces.push({
      id: 'frontend_shell',
      kind: 'module',
      label: 'Frontend Shell',
      evidence: relativeSources.slice(0, 5),
    })
  }

  if (packageJson?.['name']) {
    surfaces[0] = {
      ...surfaces[0],
      evidence: [`package:${String(packageJson['name'])}`, ...surfaces[0].evidence],
    }
  }

  return surfaces
}

function matchingEvidence(relativeSources: string[], sourceText: string, tokens: string[]): string[] {
  const matched = relativeSources.filter((filePath) => tokens.some((token) => filePath.toLowerCase().includes(token)))
  if (matched.length > 0) return matched.slice(0, 5)
  const textToken = tokens.find((token) => sourceText.toLowerCase().includes(token))
  return textToken ? [`source contains "${textToken}"`] : relativeSources.slice(0, 3)
}

async function listSourceFiles(repoPath: string): Promise<string[]> {
  const roots = ['src', 'app', 'pages', 'routes', 'server', 'lib', 'bin', 'cmd', 'apps', 'packages']
    .map((entry) => path.join(repoPath, entry))
  const files: string[] = []
  for (const root of roots) {
    files.push(...await walkSource(root))
  }
  return files.slice(0, 200)
}

async function walkSource(root: string): Promise<string[]> {
  const files: string[] = []
  let entries: Awaited<ReturnType<typeof fs.readdir>>
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return files
  }

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build', 'coverage'].includes(entry.name)) continue
      files.push(...await walkSource(entryPath))
    } else if (/\.(tsx|ts|jsx|js|mjs|cjs|vue|svelte|html|css|py|go|rs)$/.test(entry.name)) {
      files.push(entryPath)
    }
  }
  return files
}

async function readSourcePreview(sourceFiles: string[]): Promise<string> {
  const chunks: string[] = []
  for (const filePath of sourceFiles.slice(0, 30)) {
    try {
      chunks.push(await fs.readFile(filePath, 'utf8'))
    } catch {
      // ignore unreadable source file
    }
  }
  return chunks.join('\n').slice(0, 80_000)
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function fallbackGenericDraft(): BootstrapDraft {
  return buildGenericDraft('', {
    kind: 'unknown',
    secondaryKinds: [],
    language: null,
    frameworks: [],
    packageManager: null,
    confidence: 0.2,
    evidence: ['fallback repository classification'],
    runtimeHints: [],
  })
}

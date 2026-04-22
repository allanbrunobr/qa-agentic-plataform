import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  BootstrapDraft,
  DiscoveryHintsProvider,
  DiscoveryReport,
  HostProjectPointer,
} from '../../../host-sdk/src/contracts.ts'

export class GenericFrontendDiscoveryProvider implements DiscoveryHintsProvider {
  readonly id = 'generic-frontend-discovery'
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
  const framework = detectFramework(packageJson, sourceFiles)
  const surfaces = buildSurfaces(repoPath, packageJson, sourceFiles, sourceText)

  const report: DiscoveryReport = {
    framework,
    surfaces,
    roles: [
      {
        id: 'primary_user',
        confidence: 0.72,
        evidence: [
          'Generic frontend discovery inferred an end-user role from visible UI controls.',
          ...sourceFiles.slice(0, 3).map((filePath) => path.relative(repoPath, filePath)),
        ],
      },
    ],
    risks: [
      'Generic frontend discovery used deterministic static analysis; review generated personas and scenarios before activation.',
      'Capability handlers are generated as host-specific stubs until mapped to real automation.',
    ],
  }

  return {
    report,
    draft: buildGenericDraft(sourceText),
  }
}

function detectFramework(packageJson: Record<string, unknown> | null, sourceFiles: string[]): string {
  const deps = {
    ...recordValue(packageJson?.['dependencies']),
    ...recordValue(packageJson?.['devDependencies']),
  }
  if ('next' in deps || sourceFiles.some((filePath) => filePath.includes('/src/app/'))) return 'nextjs'
  if ('vite' in deps) return 'vite'
  if ('react' in deps) return 'react'
  if ('vue' in deps) return 'vue'
  return 'frontend'
}

function buildGenericDraft(sourceText: string): BootstrapDraft {
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

function buildSurfaces(
  repoPath: string,
  packageJson: Record<string, unknown> | null,
  sourceFiles: string[],
  sourceText: string,
): DiscoveryReport['surfaces'] {
  const surfaces: DiscoveryReport['surfaces'] = []
  const relativeSources = sourceFiles.map((filePath) => path.relative(repoPath, filePath))
  const hasPackageScripts = Object.keys(recordValue(packageJson?.['scripts'])).length > 0
  const hasMainEntry = relativeSources.some((filePath) => /(^|\/)main\.[jt]sx?$/.test(filePath))

  if (hasPackageScripts || hasMainEntry) {
    surfaces.push({
      id: 'root_app',
      kind: 'route',
      label: 'Root App',
      evidence: ['index.html', ...relativeSources.filter((filePath) => /src\/main\.[jt]sx?$/.test(filePath)).slice(0, 1)],
    })
  }

  if (/checkout|cart|order/i.test(sourceText)) {
    surfaces.push({
      id: 'checkout',
      kind: 'feature',
      label: 'Checkout',
      evidence: matchingEvidence(relativeSources, sourceText, ['checkout', 'cart', 'order']),
    })
  }

  if (/email|input|form/i.test(sourceText)) {
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
  const roots = ['src', 'app', 'pages'].map((entry) => path.join(repoPath, entry))
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
    } else if (/\.(tsx|ts|jsx|js|vue|svelte|html|css)$/.test(entry.name)) {
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
  return buildGenericDraft('')
}

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type GeneratedRepositoryKind = 'frontend' | 'backend_api' | 'cli' | 'library' | 'monorepo' | 'unknown'

interface GeneratedDiscoveryReport {
  repository?: {
    kind?: unknown
  }
}

interface GeneratedInstallMetadata {
  repoPath?: unknown
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const AGENTIC_QA_ROOT = path.resolve(__dirname, '../../../../../')

const REPOSITORY_KINDS: GeneratedRepositoryKind[] = [
  'frontend',
  'backend_api',
  'cli',
  'library',
  'monorepo',
  'unknown',
]

export function findGeneratedAdapterFile(relativePath: string, envName?: string): string | null {
  const envPath = envName ? process.env[envName] : undefined
  const candidates = [
    envPath,
    path.resolve(process.cwd(), 'adapter', relativePath),
    path.resolve(process.cwd(), '..', '..', 'adapter', relativePath),
    path.resolve(AGENTIC_QA_ROOT, 'adapter', relativePath),
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  return null
}

export function readGeneratedAdapterJson<T = unknown>(relativePath: string, envName?: string): T | null {
  const filePath = findGeneratedAdapterFile(relativePath, envName)
  if (!filePath) return null

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

export function getGeneratedAdapterRoot(): string | null {
  const reportPath = findGeneratedAdapterFile(
    'config/discovery-report.generated.json',
    'PERSONA_QA_DISCOVERY_REPORT_FILE',
  )
  if (!reportPath) return null

  return path.dirname(path.dirname(reportPath))
}

export function getGeneratedRepositoryKind(): GeneratedRepositoryKind | null {
  const envKind = normalizeRepositoryKind(process.env['AGENTIC_QA_REPOSITORY_KIND'])
  if (envKind) return envKind

  const report = readGeneratedAdapterJson<GeneratedDiscoveryReport>(
    'config/discovery-report.generated.json',
    'PERSONA_QA_DISCOVERY_REPORT_FILE',
  )

  return normalizeRepositoryKind(report?.repository?.kind)
}

export function generatedAdapterRequiresBrowserRuntime(): boolean {
  const kind = getGeneratedRepositoryKind()
  return kind === null || kind === 'frontend'
}

export function isGeneratedNonFrontendRuntime(): boolean {
  const kind = getGeneratedRepositoryKind()
  return kind !== null && kind !== 'frontend'
}

export function resolveGeneratedTargetRepoPath(): string {
  const envPath = process.env['AGENTIC_QA_TARGET_REPO']
  if (envPath) return path.resolve(envPath)

  const metadata = readGeneratedAdapterJson<GeneratedInstallMetadata>(
    'config/install-metadata.generated.json',
    'PERSONA_QA_INSTALL_METADATA_FILE',
  )
  if (typeof metadata?.repoPath === 'string' && metadata.repoPath.length > 0) {
    return path.resolve(metadata.repoPath)
  }

  const adapterRoot = getGeneratedAdapterRoot()
  if (adapterRoot) {
    return path.dirname(path.dirname(adapterRoot))
  }

  return process.cwd()
}

function normalizeRepositoryKind(value: unknown): GeneratedRepositoryKind | null {
  if (typeof value !== 'string') return null
  return REPOSITORY_KINDS.includes(value as GeneratedRepositoryKind)
    ? value as GeneratedRepositoryKind
    : null
}

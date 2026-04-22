import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ToolHandler, ToolMetadata, ToolResult } from '../types/tool-types.js'
import type { ToolRegistry } from '../services/tool-registry.js'
import {
  getGeneratedRepositoryKind,
  readGeneratedAdapterJson,
  resolveGeneratedTargetRepoPath,
} from '../services/generated-adapter-runtime.js'

interface PackageJson {
  name?: unknown
  scripts?: unknown
  bin?: unknown
  exports?: unknown
  types?: unknown
  main?: unknown
  module?: unknown
}

interface RuntimePlan {
  routeCoverage?: Array<{ path?: unknown; purpose?: unknown }>
}

interface ProcessResult {
  command: string
  args: string[]
  cwd: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  error?: string
  timedOut?: boolean
}

const IGNORED_TOP_LEVEL_NAMES = new Set([
  '.agentic-qa',
  '.git',
  '.next',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
])

export function registerGeneratedAdapterTools(registry: ToolRegistry): void {
  registry.register('startApiService', startApiServiceHandler, metadata({
    name: 'startApiService',
    description: 'Prepare the generated adapter to call the target API service',
    tags: ['generated-adapter', 'api'],
  }))
  registry.register('callHealthEndpoint', callHealthEndpointHandler, metadata({
    name: 'callHealthEndpoint',
    description: 'Call the configured or detected API health endpoint',
    inputSchema: pathInputSchema('/health'),
    tags: ['generated-adapter', 'api'],
  }))
  registry.register('callPrimaryEndpoint', callPrimaryEndpointHandler, metadata({
    name: 'callPrimaryEndpoint',
    description: 'Call the configured or detected primary API endpoint',
    inputSchema: pathInputSchema('/'),
    tags: ['generated-adapter', 'api'],
  }))
  registry.register('verifyApiResponse', verifyApiResponseHandler, metadata({
    name: 'verifyApiResponse',
    description: 'Verify the API response artifact produced by the generated adapter',
    tags: ['generated-adapter', 'api'],
  }))
  registry.register('runCliHelp', runCliHelpHandler, metadata({
    name: 'runCliHelp',
    description: 'Run the target CLI help command when a command entrypoint is available',
    inputSchema: {
      type: 'object',
      properties: {
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'CLI arguments to pass to the command.',
        },
      },
    },
    tags: ['generated-adapter', 'cli'],
  }))
  registry.register('verifyCliOutput', verifyCliOutputHandler, metadata({
    name: 'verifyCliOutput',
    description: 'Verify CLI output, exit code, and command discovery evidence',
    tags: ['generated-adapter', 'cli'],
  }))
  registry.register('inspectPackageExports', inspectPackageExportsHandler, metadata({
    name: 'inspectPackageExports',
    description: 'Inspect package metadata and public export entrypoints',
    tags: ['generated-adapter', 'library'],
  }))
  registry.register('verifyPublicApiDocs', verifyPublicApiDocsHandler, metadata({
    name: 'verifyPublicApiDocs',
    description: 'Verify package README, types, exports, or public API documentation evidence',
    tags: ['generated-adapter', 'library'],
  }))
  registry.register('inspectRepositoryStructure', inspectRepositoryStructureHandler, metadata({
    name: 'inspectRepositoryStructure',
    description: 'Inspect target repository structure without assuming a browser runtime',
    tags: ['generated-adapter', 'repository'],
  }))
  registry.register('identifyTestEntrypoints', identifyTestEntrypointsHandler, metadata({
    name: 'identifyTestEntrypoints',
    description: 'Identify test, build, smoke, or runtime entrypoints from package scripts and files',
    tags: ['generated-adapter', 'repository'],
  }))
}

const startApiServiceHandler: ToolHandler = async (): Promise<ToolResult> => {
  const targetRepoPath = resolveGeneratedTargetRepoPath()
  const baseUrl = resolveApiBaseUrl()
  const runtimePlan = readGeneratedAdapterJson<RuntimePlan>('runtime/runtime-plan.generated.json')

  return ok({
    serviceStarted: {
      mode: baseUrl ? 'external_service_configured' : 'adapter_runtime_ready',
      repositoryKind: getGeneratedRepositoryKind(),
      targetRepoPath,
      apiBaseUrl: baseUrl,
      routeHints: runtimePlan?.routeCoverage?.map((route) => ({
        path: typeof route.path === 'string' ? route.path : null,
        purpose: typeof route.purpose === 'string' ? route.purpose : null,
      })) ?? [],
      note: baseUrl
        ? 'The adapter will call the configured API base URL.'
        : 'No API base URL was configured; endpoint calls will produce a dry-run artifact instead of failing the run.',
    },
  })
}

const callHealthEndpointHandler: ToolHandler = async (input: unknown): Promise<ToolResult> => {
  const endpointPath = normalizeEndpointPath(input, detectHealthEndpointPath())
  return ok({ apiResponse: await callEndpoint(endpointPath) })
}

const callPrimaryEndpointHandler: ToolHandler = async (input: unknown): Promise<ToolResult> => {
  const endpointPath = normalizeEndpointPath(input, detectPrimaryEndpointPath())
  return ok({ apiResponse: await callEndpoint(endpointPath) })
}

const verifyApiResponseHandler: ToolHandler = async (_input, context): Promise<ToolResult> => {
  const apiResponse = asRecord(context.artifacts?.['apiResponse'])
  const executed = apiResponse?.['executed'] === true
  const status = typeof apiResponse?.['status'] === 'number' ? apiResponse['status'] : null
  const okStatus = typeof status === 'number' && status >= 200 && status < 500

  return ok({
    apiContractVerified: {
      checked: true,
      executed,
      status,
      passed: executed ? okStatus : false,
      mode: executed ? 'http_response' : 'dry_run',
      reason: executed
        ? okStatus
          ? 'Endpoint returned an HTTP response in the accepted smoke range.'
          : 'Endpoint returned an HTTP response outside the accepted smoke range.'
        : 'No API base URL was configured for this generated adapter run.',
    },
  })
}

const runCliHelpHandler: ToolHandler = async (input: unknown): Promise<ToolResult> => {
  const targetRepoPath = resolveGeneratedTargetRepoPath()
  const args = normalizeArgs(input)
  const command = await resolveCliCommand(targetRepoPath, args)
  if (!command) {
    return ok({
      cliHelpOutput: {
        executed: false,
        reason: 'No CLI command was configured and no package.json bin entry was found.',
        targetRepoPath,
      },
    })
  }

  const result = await runProcess(command.command, command.args, targetRepoPath, 8_000)
  return ok({
    cliHelpOutput: {
      executed: true,
      command: result.command,
      args: result.args,
      exitCode: result.exitCode,
      signal: result.signal,
      stdoutPreview: truncate(result.stdout),
      stderrPreview: truncate(result.stderr),
      error: result.error,
      timedOut: result.timedOut === true,
    },
  })
}

const verifyCliOutputHandler: ToolHandler = async (_input, context): Promise<ToolResult> => {
  const cliHelpOutput = asRecord(context.artifacts?.['cliHelpOutput'])
  const executed = cliHelpOutput?.['executed'] === true
  const exitCode = typeof cliHelpOutput?.['exitCode'] === 'number' ? cliHelpOutput['exitCode'] : null
  const stdout = typeof cliHelpOutput?.['stdoutPreview'] === 'string' ? cliHelpOutput['stdoutPreview'] : ''
  const stderr = typeof cliHelpOutput?.['stderrPreview'] === 'string' ? cliHelpOutput['stderrPreview'] : ''

  return ok({
    cliOutputVerified: {
      checked: true,
      executed,
      exitCode,
      hasOutput: stdout.length > 0 || stderr.length > 0,
      passed: executed && exitCode === 0,
      reason: executed
        ? exitCode === 0
          ? 'CLI help command exited successfully.'
          : 'CLI command was discovered but did not exit successfully; install target dependencies or map the command manually.'
        : 'No CLI command artifact was produced.',
    },
  })
}

const inspectPackageExportsHandler: ToolHandler = async (): Promise<ToolResult> => {
  const targetRepoPath = resolveGeneratedTargetRepoPath()
  const packageJson = await readPackageJson(targetRepoPath)

  return ok({
    packageExports: {
      targetRepoPath,
      packageName: typeof packageJson?.name === 'string' ? packageJson.name : null,
      exports: packageJson?.exports ?? null,
      main: packageJson?.main ?? null,
      module: packageJson?.module ?? null,
      types: packageJson?.types ?? null,
      hasPackageJson: Boolean(packageJson),
    },
  })
}

const verifyPublicApiDocsHandler: ToolHandler = async (_input, context): Promise<ToolResult> => {
  const targetRepoPath = resolveGeneratedTargetRepoPath()
  const packageExports = asRecord(context.artifacts?.['packageExports'])
  const hasExports = packageExports?.['exports'] !== null && packageExports?.['exports'] !== undefined
  const hasTypes = packageExports?.['types'] !== null && packageExports?.['types'] !== undefined
  const readmePath = await findFirstExisting([
    path.join(targetRepoPath, 'README.md'),
    path.join(targetRepoPath, 'readme.md'),
    path.join(targetRepoPath, 'docs', 'README.md'),
  ])

  return ok({
    publicApiDocsVerified: {
      checked: true,
      hasReadme: Boolean(readmePath),
      readmePath,
      hasExports,
      hasTypes,
      passed: Boolean(readmePath) || hasExports || hasTypes,
    },
  })
}

const inspectRepositoryStructureHandler: ToolHandler = async (): Promise<ToolResult> => {
  const targetRepoPath = resolveGeneratedTargetRepoPath()
  const entries = await listTopLevelEntries(targetRepoPath)

  return ok({
    repositoryStructure: {
      targetRepoPath,
      repositoryKind: getGeneratedRepositoryKind(),
      entries,
      hasPackageJson: entries.some((entry) => entry.name === 'package.json'),
      hasSourceDirectory: entries.some((entry) => ['src', 'app', 'apps', 'packages'].includes(entry.name)),
    },
  })
}

const identifyTestEntrypointsHandler: ToolHandler = async (): Promise<ToolResult> => {
  const targetRepoPath = resolveGeneratedTargetRepoPath()
  const packageJson = await readPackageJson(targetRepoPath)
  const scripts = asStringRecord(packageJson?.scripts)
  const interestingScripts = Object.entries(scripts).filter(([name]) => (
    /test|spec|e2e|smoke|verify|build|dev|start/i.test(name)
  ))
  const files = await findFirstExisting([
    path.join(targetRepoPath, 'vitest.config.ts'),
    path.join(targetRepoPath, 'vitest.config.js'),
    path.join(targetRepoPath, 'playwright.config.ts'),
    path.join(targetRepoPath, 'jest.config.js'),
    path.join(targetRepoPath, 'pytest.ini'),
    path.join(targetRepoPath, 'go.mod'),
    path.join(targetRepoPath, 'Cargo.toml'),
  ])

  return ok({
    testEntrypoints: {
      targetRepoPath,
      scripts: Object.fromEntries(interestingScripts),
      configFile: files,
      hasEntrypoint: interestingScripts.length > 0 || Boolean(files),
    },
  })
}

function metadata(input: Omit<ToolMetadata, 'requiresBrowser' | 'riskLevel'>): ToolMetadata {
  return {
    requiresBrowser: false,
    riskLevel: 'read',
    ...input,
  }
}

function pathInputSchema(defaultPath: string): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: `Endpoint path to call. Defaults to ${defaultPath}.`,
      },
    },
  }
}

function ok(output: Record<string, unknown>): ToolResult {
  return { ok: true, output }
}

function resolveApiBaseUrl(): string | null {
  return process.env['GENERIC_API_BASE_URL']
    ?? process.env['TARGET_API_BASE_URL']
    ?? process.env['API_BASE_URL']
    ?? null
}

function normalizeEndpointPath(input: unknown, fallback: string): string {
  const inputRecord = asRecord(input)
  const value = typeof inputRecord?.['path'] === 'string' ? inputRecord['path'] : fallback
  return value.startsWith('/') ? value : `/${value}`
}

function detectHealthEndpointPath(): string {
  const runtimePlan = readGeneratedAdapterJson<RuntimePlan>('runtime/runtime-plan.generated.json')
  const route = runtimePlan?.routeCoverage?.find((item) => (
    typeof item.path === 'string' && /health|ready|live/i.test(item.path)
  ))
  return typeof route?.path === 'string' ? route.path : '/health'
}

function detectPrimaryEndpointPath(): string {
  const runtimePlan = readGeneratedAdapterJson<RuntimePlan>('runtime/runtime-plan.generated.json')
  const route = runtimePlan?.routeCoverage?.find((item) => (
    typeof item.path === 'string' && item.path.length > 0
  ))
  return typeof route?.path === 'string' ? route.path : '/'
}

async function callEndpoint(endpointPath: string): Promise<Record<string, unknown>> {
  const baseUrl = resolveApiBaseUrl()
  if (!baseUrl) {
    return {
      executed: false,
      mode: 'dry_run',
      endpointPath,
      status: null,
      reason: 'GENERIC_API_BASE_URL, TARGET_API_BASE_URL, or API_BASE_URL was not configured.',
    }
  }

  const url = new URL(endpointPath, baseUrl).toString()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)

  try {
    const response = await fetch(url, { signal: controller.signal })
    const body = await response.text()
    return {
      executed: true,
      mode: 'http',
      url,
      endpointPath,
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type'),
      bodyPreview: truncate(body),
    }
  } catch (error) {
    return {
      executed: false,
      mode: 'http_error',
      url,
      endpointPath,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timer)
  }
}

async function resolveCliCommand(
  targetRepoPath: string,
  args: string[],
): Promise<{ command: string; args: string[] } | null> {
  const configured = process.env['GENERIC_CLI_COMMAND'] ?? process.env['TARGET_CLI_COMMAND']
  if (configured) {
    const parts = configured.split(/\s+/).filter(Boolean)
    const command = parts[0]
    if (!command) return null
    return { command, args: [...parts.slice(1), ...args] }
  }

  const packageJson = await readPackageJson(targetRepoPath)
  const bin = resolvePackageBin(packageJson)
  if (!bin) return null

  return {
    command: process.execPath,
    args: [path.resolve(targetRepoPath, bin), ...args],
  }
}

function resolvePackageBin(packageJson: PackageJson | null): string | null {
  if (typeof packageJson?.bin === 'string') return packageJson.bin
  if (!isRecord(packageJson?.bin)) return null

  const firstBin = Object.values(packageJson.bin).find((value): value is string => typeof value === 'string')
  return firstBin ?? null
}

function normalizeArgs(input: unknown): string[] {
  const inputRecord = asRecord(input)
  const args = Array.isArray(inputRecord?.['args']) ? inputRecord['args'] : ['--help']
  return args.filter((arg): arg is string => typeof arg === 'string')
}

function runProcess(command: string, args: string[], cwd: string, timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        command,
        args,
        cwd,
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        error: error.message,
        timedOut,
      })
    })

    child.once('close', (exitCode, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        command,
        args,
        cwd,
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
      })
    })
  })
}

async function readPackageJson(targetRepoPath: string): Promise<PackageJson | null> {
  const packageJsonPath = path.join(targetRepoPath, 'package.json')
  try {
    const parsed = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as unknown
    return isRecord(parsed) ? parsed as PackageJson : null
  } catch {
    return null
  }
}

async function listTopLevelEntries(targetRepoPath: string): Promise<Array<{ name: string; type: string }>> {
  try {
    const entries = await fs.readdir(targetRepoPath, { withFileTypes: true })
    return entries
      .filter((entry) => !IGNORED_TOP_LEVEL_NAMES.has(entry.name))
      .map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
  } catch {
    return []
  }
}

async function findFirstExisting(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      continue
    }
  }

  return null
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function truncate(value: string, maxLength = 4000): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...[truncated]`
}

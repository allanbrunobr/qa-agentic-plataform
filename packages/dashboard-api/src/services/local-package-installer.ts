import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PLATFORM_ROOT = path.resolve(__dirname, '../../../..')
const DEFAULT_TEMPLATE_ROOT = path.join(PLATFORM_ROOT, 'templates', 'persona-qa-dashboard')
const LEGACY_TEMPLATE_ROOT = '/path/to/projects/reference-store/reference-store-frontend/persona-qa-dashboard'
const CONFIGURED_TEMPLATE_ROOT = path.resolve(process.env.AGENTIC_QA_TEMPLATE_ROOT ?? DEFAULT_TEMPLATE_ROOT)
const LOCAL_PACKAGE_DIRNAME = '.agentic-qa'

const COPY_ROOT_FILES = [
  'AGENTIC.md',
  'README.md',
  'package.json',
  'package-lock.json',
  'docker-compose.yml',
] as const

const COPY_ROOT_DIRS = [
  'docs',
  path.join('packages', 'api', 'src'),
  path.join('packages', 'web'),
] as const

const COPY_EXTRA_FILES = [
  path.join('packages', 'api', 'package.json'),
  path.join('packages', 'api', 'tsconfig.json'),
  path.join('packages', 'api', 'drizzle.config.ts'),
] as const

const EMPTY_DIRS = [
  'data',
  path.join('adapter', 'manifest'),
  path.join('adapter', 'personas'),
  path.join('adapter', 'scenarios'),
  path.join('adapter', 'workflow-contracts'),
  path.join('adapter', 'capabilities'),
  path.join('adapter', 'auth'),
  path.join('adapter', 'assertions'),
  path.join('adapter', 'routes'),
  path.join('adapter', 'config'),
  path.join('adapter', 'runtime'),
  path.join('packages', 'api', 'artifacts'),
  path.join('packages', 'api', 'artifacts', 'screenshots'),
  path.join('packages', 'api', 'artifacts', 'workflow-contracts'),
] as const

function shouldExclude(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return (
    parts.includes('node_modules')
    || parts.includes('dist')
    || parts.includes('coverage')
    || normalized === 'data'
    || normalized.startsWith('data/')
    || normalized.startsWith('packages/api/artifacts/screenshots/')
    || normalized.startsWith('packages/api/artifacts/workflow-contracts/')
    || normalized === 'packages/api/persona-qa.db-shm'
    || normalized === 'packages/api/persona-qa.db-wal'
    || normalized.endsWith('.tsbuildinfo')
  )
}

async function copyTemplateEntry(fromRoot: string, toRoot: string, relativePath: string) {
  const source = path.join(fromRoot, relativePath)
  const destination = path.join(toRoot, relativePath)
  await fs.cp(source, destination, {
    recursive: true,
    force: true,
    errorOnExist: false,
    filter: (src) => {
      const rel = path.relative(fromRoot, src)
      return !shouldExclude(rel)
    },
  })
}

async function validateAnthropicApiKey(apiKey: string) {
  if (!apiKey) {
    return { ok: false, message: 'missing Anthropic API key' } as const
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    })

    if (response.ok) {
      return { ok: true, message: 'Anthropic API key validated successfully.' } as const
    }

    const text = await response.text().catch(() => '')
    return {
      ok: false,
      message: `Anthropic key validation failed: ${response.status}${text ? ` ${text.slice(0, 240)}` : ''}`,
    } as const
  } catch (error) {
    return {
      ok: false,
      message: `Anthropic key validation error: ${error instanceof Error ? error.message : String(error)}`,
    } as const
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function resolveTemplateRoot(): Promise<string> {
  if (await pathExists(CONFIGURED_TEMPLATE_ROOT)) return CONFIGURED_TEMPLATE_ROOT
  if (!process.env.AGENTIC_QA_TEMPLATE_ROOT && await pathExists(LEGACY_TEMPLATE_ROOT)) {
    return LEGACY_TEMPLATE_ROOT
  }

  throw new Error(
    `Agentic QA template not found at ${CONFIGURED_TEMPLATE_ROOT}. `
    + 'Set AGENTIC_QA_TEMPLATE_ROOT to a valid persona-qa-dashboard template path.',
  )
}

async function readEnvFile(filePath: string): Promise<Record<string, string>> {
  try {
    const text = await fs.readFile(filePath, 'utf8')
    const values: Record<string, string> = {}
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const index = line.indexOf('=')
      if (index === -1) continue
      const key = line.slice(0, index).trim()
      let value = line.slice(index + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      values[key] = value
    }
    return values
  } catch {
    return {}
  }
}

async function resolveAnthropicKey(repoPath: string): Promise<{
  key: string
  source:
    | 'ANTHROPIC_API_KEY_OVERRIDE'
    | 'agentic-platform/.env.local'
    | 'ANTHROPIC_API_KEY'
    | 'ANTHROPIC_API'
    | 'target/.agentic-qa/.env.local'
    | 'missing'
}> {
  if (process.env.ANTHROPIC_API_KEY_OVERRIDE) {
    return { key: process.env.ANTHROPIC_API_KEY_OVERRIDE, source: 'ANTHROPIC_API_KEY_OVERRIDE' }
  }

  const platformEnv = await readEnvFile(path.resolve(process.cwd(), '.env.local'))
  if (platformEnv.ANTHROPIC_API_KEY) {
    return { key: platformEnv.ANTHROPIC_API_KEY, source: 'agentic-platform/.env.local' }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return { key: process.env.ANTHROPIC_API_KEY, source: 'ANTHROPIC_API_KEY' }
  }

  if (process.env.ANTHROPIC_API) {
    return { key: process.env.ANTHROPIC_API, source: 'ANTHROPIC_API' }
  }

  const targetEnv = await readEnvFile(path.join(repoPath, LOCAL_PACKAGE_DIRNAME, '.env.local'))
  if (targetEnv.ANTHROPIC_API_KEY) {
    return { key: targetEnv.ANTHROPIC_API_KEY, source: 'target/.agentic-qa/.env.local' }
  }

  return { key: '', source: 'missing' }
}

async function patchInstalledRuntime(installedPath: string, repoPath: string) {
  const rootPackageJsonPath = path.join(installedPath, 'package.json')
  const envLocalPath = path.join(installedPath, '.env.local')
  const envExamplePath = path.join(installedPath, '.env.example')
  const apiPackageJsonPath = path.join(installedPath, 'packages', 'api', 'package.json')
  const rootLockPath = path.join(installedPath, 'package-lock.json')
  const npmrcPath = path.join(installedPath, '.npmrc')
  const dbIndexPath = path.join(installedPath, 'packages', 'api', 'src', 'db', 'index.ts')
  const sessionServicePath = path.join(installedPath, 'packages', 'api', 'src', 'phase2', 'services', 'session-service.ts')
  const overviewPath = path.join(installedPath, 'packages', 'web', 'src', 'pages', 'Overview.tsx')
  const runnerPath = path.join(installedPath, 'packages', 'api', 'src', 'phase2', 'routes', 'runner.ts')
  const anthropicProviderPath = path.join(installedPath, 'packages', 'api', 'src', 'phase2', 'providers', 'anthropic-provider.ts')
  const workflowToolsPath = path.join(installedPath, 'packages', 'api', 'src', 'phase2', 'tools', 'workflow-tools.ts')
  const runtimeBootstrapPath = path.join(installedPath, 'packages', 'api', 'src', 'phase2', 'services', 'runtime-bootstrap.ts')
  const shimDir = path.join(installedPath, 'vendor', 'better-sqlite3-shim')

  try {
    await fs.unlink(rootLockPath)
  } catch {
    // ignore missing lockfile
  }

  const resolvedAnthropic = await resolveAnthropicKey(repoPath)
  const resolvedAnthropicKey = resolvedAnthropic.key
  const anthropicValidation = await validateAnthropicApiKey(resolvedAnthropicKey)
  await fs.writeFile(
    envExamplePath,
    [
      '# Auto-generated by agentic-platform install-local',
      'ANTHROPIC_API_KEY=',
    ].join('\n') + '\n',
    'utf8',
  )
  if (resolvedAnthropicKey) {
    await fs.writeFile(
      envLocalPath,
      [
        '# Auto-generated by agentic-platform install-local',
        `ANTHROPIC_API_KEY=${resolvedAnthropicKey}`,
      ].join('\n') + '\n',
      'utf8',
    )
  }

  await fs.writeFile(npmrcPath, 'legacy-peer-deps=true\n', 'utf8')

  const rootPackageJson = JSON.parse(await fs.readFile(rootPackageJsonPath, 'utf8')) as {
    engines?: Record<string, string>
  }
  rootPackageJson.engines = {
    ...(rootPackageJson.engines ?? {}),
    node: '>=22.5.0',
  }
  await fs.writeFile(rootPackageJsonPath, JSON.stringify(rootPackageJson, null, 2), 'utf8')

  const apiPackageJson = JSON.parse(await fs.readFile(apiPackageJsonPath, 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  apiPackageJson.dependencies = {
    ...(apiPackageJson.dependencies ?? {}),
    '@playwright/test': '^1.55.0',
    'better-sqlite3': 'file:../../vendor/better-sqlite3-shim',
  }
  if (apiPackageJson.dependencies) {
    apiPackageJson.dependencies['@playwright/test'] = '^1.55.0'
    apiPackageJson.dependencies['better-sqlite3'] = 'file:../../vendor/better-sqlite3-shim'
  }
  if (apiPackageJson.devDependencies) {
    delete apiPackageJson.devDependencies['@types/better-sqlite3']
  }
  await fs.writeFile(apiPackageJsonPath, JSON.stringify(apiPackageJson, null, 2), 'utf8')

  await fs.mkdir(shimDir, { recursive: true })
  await fs.writeFile(
    path.join(shimDir, 'package.json'),
    JSON.stringify({
      name: 'better-sqlite3',
      version: '0.0.0-agentic-shim',
      private: true,
      type: 'module',
      main: './index.js',
      exports: './index.js',
      types: './index.d.ts',
    }, null, 2),
    'utf8',
  )
  await fs.writeFile(
    path.join(shimDir, 'index.js'),
    [
      "import { DatabaseSync } from 'node:sqlite';",
      '',
      'class StatementWrapper {',
      '  constructor(statement, rawMode = false) {',
      '    this.statement = statement;',
      '    this.rawMode = rawMode;',
      '  }',
      '',
      '  applyMode() {',
      "    if (typeof this.statement.setReturnArrays === 'function') {",
      '      this.statement.setReturnArrays(this.rawMode);',
      '    }',
      '  }',
      '',
      '  run(...params) {',
      '    this.applyMode();',
      '    return this.statement.run(...params);',
      '  }',
      '',
      '  get(...params) {',
      '    this.applyMode();',
      '    return this.statement.get(...params);',
      '  }',
      '',
      '  all(...params) {',
      '    this.applyMode();',
      '    return this.statement.all(...params);',
      '  }',
      '',
      '  raw() {',
      '    return new StatementWrapper(this.statement, true);',
      '  }',
      '}',
      '',
      'export default class Database {',
      '  constructor(filename = \':memory:\', options = {}) {',
      '    this.inner = new DatabaseSync(filename, options);',
      '  }',
      '',
      '  prepare(sql) {',
      '    return new StatementWrapper(this.inner.prepare(sql));',
      '  }',
      '',
      '  exec(sql) {',
      '    return this.inner.exec(sql);',
      '  }',
      '',
      '  pragma(statement, options = {}) {',
      "    const sql = statement.trim().toUpperCase().startsWith('PRAGMA') ? statement : `PRAGMA ${statement}`;",
      '    const prepared = this.prepare(sql);',
      '    if (options.simple) {',
      '      const row = prepared.get();',
      '      return row ? Object.values(row)[0] : undefined;',
      '    }',
      '    return prepared.all();',
      '  }',
      '',
      '  transaction(fn) {',
      '    const wrap = (behavior) => (...args) => {',
      '      const begin = behavior === \'deferred\' ? \'BEGIN\' : `BEGIN ${behavior.toUpperCase()}`;',
      '      this.exec(begin);',
      '      try {',
      '        const result = fn(...args);',
      '        this.exec(\'COMMIT\');',
      '        return result;',
      '      } catch (error) {',
      '        try { this.exec(\'ROLLBACK\'); } catch {}',
      '        throw error;',
      '      }',
      '    };',
      '    const deferred = wrap(\'deferred\');',
      '    deferred.deferred = wrap(\'deferred\');',
      '    deferred.immediate = wrap(\'immediate\');',
      '    deferred.exclusive = wrap(\'exclusive\');',
      '    return deferred;',
      '  }',
      '',
      '  close() {',
      '    return this.inner.close();',
      '  }',
      '}',
      '',
      'export class SqliteError extends Error {}',
    ].join('\n'),
    'utf8',
  )
  await fs.writeFile(
    path.join(shimDir, 'index.d.ts'),
    [
      'export type RunResult = { changes: number; lastInsertRowid: number | bigint };',
      'export type Options = Record<string, unknown>;',
      'export interface Statement {',
      '  run(...params: unknown[]): RunResult;',
      '  get(...params: unknown[]): unknown;',
      '  all(...params: unknown[]): unknown[];',
      '  raw(): Statement;',
      '}',
      'export default class Database {',
      '  constructor(filename?: string, options?: Options);',
      '  prepare(sql: string): Statement;',
      '  exec(sql: string): void;',
      '  pragma(statement: string, options?: { simple?: boolean }): unknown;',
      '  transaction<T extends (...args: any[]) => any>(fn: T): T & {',
      '    deferred: T;',
      '    immediate: T;',
      '    exclusive: T;',
      '  };',
      '  close(): void;',
      '}',
    ].join('\n'),
    'utf8',
  )

  const dbIndexSource = await fs.readFile(dbIndexPath, 'utf8')
  const dbIndexPatched = dbIndexSource
    .replace("import { DatabaseSync as Database } from 'node:sqlite';", "import Database from 'better-sqlite3';")
    .replace("let _sqlite: Database | null = null;", "let _sqlite: Database.Database | null = null;")
    .replace("_sqlite.exec('PRAGMA journal_mode = WAL');", "_sqlite.pragma('journal_mode = WAL');")
    .replace("_sqlite.exec('PRAGMA foreign_keys = ON');", "_sqlite.pragma('foreign_keys = ON');")
    .replace("_db = drizzle(_sqlite as any, { schema });", "_db = drizzle(_sqlite, { schema });")
  await fs.writeFile(dbIndexPath, dbIndexPatched, 'utf8')

  const sessionServiceSource = await fs.readFile(sessionServicePath, 'utf8')
  const sessionServicePatched = sessionServiceSource
    .replace("import { DatabaseSync as Database } from 'node:sqlite'", "import Database from 'better-sqlite3'")
    .replace("private readonly sqlite: Database", "private readonly sqlite: Database.Database")
    .replace("this.sqlite.exec('PRAGMA journal_mode = WAL')", "this.sqlite.pragma('journal_mode = WAL')")
    .replace("this.sqlite.exec('PRAGMA foreign_keys = ON')", "this.sqlite.pragma('foreign_keys = ON')")
  await fs.writeFile(sessionServicePath, sessionServicePatched, 'utf8')

  const overviewSource = await fs.readFile(overviewPath, 'utf8')
  const overviewPatched = overviewSource.replace(
    "              Última atividade {formatRelativeTime(orderedSessions[0]!.startedAt)}",
    "              Última atividade {orderedSessions[0] ? formatRelativeTime(orderedSessions[0].startedAt) : 'sem atividade ainda'}",
  )
  await fs.writeFile(overviewPath, overviewPatched, 'utf8')

  const workflowToolsSource = await fs.readFile(workflowToolsPath, 'utf8')
  const workflowToolsPatched = workflowToolsSource
    .replace("const REPO_ROOT = path.resolve(__dirname, '../../../../../..')", "const AGENTIC_QA_ROOT = path.resolve(__dirname, '../../../../../')")
    .replaceAll("path.resolve(REPO_ROOT, 'integration-test/persona-tests/support/capabilities/", "path.resolve(AGENTIC_QA_ROOT, 'adapter/runtime/host-source-snapshot/integration-test/persona-tests/support/capabilities/")
  await fs.writeFile(workflowToolsPath, workflowToolsPatched, 'utf8')

  const runtimeBootstrapSource = await fs.readFile(runtimeBootstrapPath, 'utf8')
  const runtimeBootstrapPatched = runtimeBootstrapSource
    .replace(
      "import { SessionService } from './session-service.js'\n",
      "import { SessionService } from './session-service.js'\nimport { getSessionService, setSessionService } from '../routes/sessions.js'\n",
    )
    .replace(
      "  const dbPath = options.dbPath ?? path.join(API_PACKAGE_ROOT, 'persona-qa.db')\n  const sessionService = new SessionService(dbPath)\n",
      "  const dbPath = options.dbPath ?? path.join(API_PACKAGE_ROOT, 'persona-qa.db')\n  const sessionService = options.dbPath\n    ? new SessionService(dbPath)\n    : getSessionService()\n\n  if (options.dbPath) {\n    setSessionService(sessionService)\n  }\n",
    )
  await fs.writeFile(runtimeBootstrapPath, runtimeBootstrapPatched, 'utf8')

  const anthropicProviderSource = await fs.readFile(anthropicProviderPath, 'utf8')
  if (!anthropicProviderSource.includes('export async function validateAnthropicApiKey')) {
    await fs.writeFile(
      anthropicProviderPath,
      `${anthropicProviderSource}

export async function validateAnthropicApiKey(apiKey: string): Promise<{ ok: boolean; status?: number; message: string }> {
  if (!apiKey) {
    return { ok: false, message: 'ANTHROPIC_API_KEY is missing.' }
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    })

    if (response.ok) {
      return { ok: true, status: response.status, message: 'Anthropic API key validated successfully.' }
    }

    const body = await response.text().catch(() => '')
    return {
      ok: false,
      status: response.status,
      message: body ? body.slice(0, 240) : 'Anthropic API key validation failed.',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
`,
      'utf8',
    )
  }

  const runnerSource = await fs.readFile(runnerPath, 'utf8')
  let runnerPatched = runnerSource
  if (!runnerPatched.includes("validateAnthropicApiKey } from '../providers/anthropic-provider.js'")) {
    runnerPatched = runnerPatched.replace(
      "import { getSessionService } from './sessions.js'",
      "import { getSessionService } from './sessions.js'\nimport { validateAnthropicApiKey } from '../providers/anthropic-provider.js'",
    )
  }
  if (!runnerPatched.includes('const anthropicValidation = await validateAnthropicApiKey')) {
    runnerPatched = runnerPatched.replace(
      "    const scenario = loadScenario(parsed.data.scenario_id)",
      `    if (process.env.STRICT_ANTHROPIC_VALIDATION === '1') {
      const anthropicValidation = await validateAnthropicApiKey(process.env.ANTHROPIC_API_KEY ?? '')
      if (!anthropicValidation.ok) {
        return reply.status(503).send({
          error: 'invalid_anthropic_api_key',
          message: 'The configured ANTHROPIC_API_KEY is invalid for the local .agentic-qa runtime.',
          details: anthropicValidation,
        })
      }
    }

    const scenario = loadScenario(parsed.data.scenario_id)`,
    )
  }
  runnerPatched = runnerPatched.replace(
    "    void (async () => {\n      const { chromium } = await import('@playwright/test')\n      const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' })\n      const page = await browser.newPage({ baseURL: baseUrl })\n\n      try {\n        await runtime.orchestrator.executeRunInSession(session.id, scenario, {\n          page,\n          customerName,\n          customerPhone: parsed.data.customer_phone ?? '11999990000',\n          orderType: parsed.data.order_type ?? 'Primeira Pedido',\n        })\n      } catch (error) {\n        runtime.sessionService.updateStatus(session.id, 'failed')\n        runtime.sessionService.addEvent(session.id, 'run_failed', {\n          scenarioId: scenario.id,\n          error: error instanceof Error ? error.message : String(error),\n        })\n      } finally {\n        await page.close().catch(() => {})\n        await browser.close().catch(() => {})\n      }\n    })()",
    "    void (async () => {\n      let browser: { close(): Promise<void> } | null = null\n      let page: { close(): Promise<void> } | null = null\n\n      try {\n        const { chromium } = await import('@playwright/test')\n        browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' })\n        page = await browser.newPage({ baseURL: baseUrl })\n\n        await runtime.orchestrator.executeRunInSession(session.id, scenario, {\n          page,\n          customerName,\n          customerPhone: parsed.data.customer_phone ?? '11999990000',\n          orderType: parsed.data.order_type ?? 'Primeira Pedido',\n        })\n      } catch (error) {\n        runtime.sessionService.updateStatus(session.id, 'failed')\n        runtime.sessionService.addEvent(session.id, 'run_failed', {\n          scenarioId: scenario.id,\n          error: error instanceof Error ? error.message : String(error),\n        })\n      } finally {\n        await page?.close().catch(() => {})\n        await browser?.close().catch(() => {})\n      }\n    })()",
  )
  await fs.writeFile(runnerPath, runnerPatched, 'utf8')

  return {
    anthropicEnvWritten: Boolean(resolvedAnthropicKey),
    anthropicEnvValidated: anthropicValidation.ok,
    anthropicEnvSource: resolvedAnthropic.source,
    anthropicEnvValidationMessage: anthropicValidation.message,
    envLocalPath,
    envExamplePath,
  } as const
}

export async function installLocalPackage(input: { repoPath: string }) {
  if (!input.repoPath) {
    throw new Error('repoPath is required')
  }

  const templateRoot = await resolveTemplateRoot()
  const installedPath = path.join(input.repoPath, LOCAL_PACKAGE_DIRNAME)
  await fs.mkdir(installedPath, { recursive: true })

  for (const relativePath of COPY_ROOT_FILES) {
    await copyTemplateEntry(templateRoot, installedPath, relativePath)
  }

  for (const relativePath of COPY_ROOT_DIRS) {
    await copyTemplateEntry(templateRoot, installedPath, relativePath)
  }

  for (const relativePath of COPY_EXTRA_FILES) {
    await copyTemplateEntry(templateRoot, installedPath, relativePath)
  }

  for (const relativePath of EMPTY_DIRS) {
    await fs.mkdir(path.join(installedPath, relativePath), { recursive: true })
  }

  const runtimePatchResult = await patchInstalledRuntime(installedPath, input.repoPath)

  const metadataPath = path.join(installedPath, 'adapter', 'config', 'install-metadata.generated.json')
  const launcherPath = path.join(installedPath, 'scripts', 'start-local-dashboard.generated.sh')
  await fs.mkdir(path.dirname(launcherPath), { recursive: true })
  await fs.writeFile(
    launcherPath,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '',
      'ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"',
      'API_PORT="${API_PORT:-3201}"',
      'WEB_PORT="${WEB_PORT:-5176}"',
      'PATH="${PATH:-}"',
      'ENV_FILE="${ROOT_DIR}/.env.local"',
      '',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    --api-port)',
      '      API_PORT="$2"',
      '      shift 2',
      '      ;;',
      '    --web-port)',
      '      WEB_PORT="$2"',
      '      shift 2',
      '      ;;',
      '    *)',
      '      echo "[.agentic-qa] unknown argument: $1" >&2',
      '      exit 1',
      '      ;;',
      '  esac',
      'done',
      '',
      'ensure_workspace_deps() {',
      '  if [ ! -d "${ROOT_DIR}/node_modules" ]; then',
      '    echo "[.agentic-qa] installing workspace deps in ${ROOT_DIR}"',
      '    (cd "${ROOT_DIR}" && npm install --legacy-peer-deps)',
      '  fi',
      '}',
      '',
      'ensure_playwright_browser() {',
      '  local marker_dir="${ROOT_DIR}/.cache"',
      '  local marker_file="${marker_dir}/playwright-chromium-installed"',
      '  mkdir -p "${marker_dir}"',
      '  if [ ! -f "${marker_file}" ]; then',
      '    if (cd "${ROOT_DIR}" && node --input-type=module -e "import { chromium } from \'@playwright/test\'; const path = chromium.executablePath(); if (!path) process.exit(1);" >/dev/null 2>&1); then',
      '      echo "[.agentic-qa] Playwright Chromium already available"',
      '    else',
      '      echo "[.agentic-qa] installing Playwright Chromium browser"',
      '      (cd "${ROOT_DIR}" && npx playwright install chromium)',
      '    fi',
      '    touch "${marker_file}"',
      '  fi',
      '}',
      '',
      'resolve_repository_kind() {',
      '  node --input-type=module -e "import fs from \'node:fs\'; const file = process.argv[1]; if (!fs.existsSync(file)) { console.log(\'frontend\'); process.exit(0); } const report = JSON.parse(fs.readFileSync(file, \'utf8\')); console.log(report.repository?.kind || \'frontend\');" "${ROOT_DIR}/adapter/config/discovery-report.generated.json"',
      '}',
      '',
      'requires_browser_runtime() {',
      '  [ "${REPOSITORY_KIND}" = "frontend" ]',
      '}',
      '',
      'load_env_file() {',
      '  if [ -f "${ENV_FILE}" ]; then',
      '    set -a',
      '    # shellcheck disable=SC1090',
      '    . "${ENV_FILE}"',
      '    set +a',
      '  fi',
      '}',
      '',
      'require_anthropic_env() {',
      '  local resolved_key="${ANTHROPIC_API_KEY:-${ANTHROPIC_API:-}}"',
      '  if [ -z "${resolved_key}" ]; then',
      '    echo "[.agentic-qa] missing ANTHROPIC_API_KEY/ANTHROPIC_API in environment" >&2',
      '    exit 1',
      '  fi',
      '  export ANTHROPIC_API_KEY="${resolved_key}"',
      '}',
      '',
      'ensure_workspace_deps',
      'REPOSITORY_KIND="$(resolve_repository_kind)"',
      'export AGENTIC_QA_REPOSITORY_KIND="${REPOSITORY_KIND}"',
      'echo "[.agentic-qa] repository kind: ${REPOSITORY_KIND}"',
      'load_env_file',
      'if requires_browser_runtime; then',
      '  ensure_playwright_browser',
      '  require_anthropic_env',
      'else',
      '  echo "[.agentic-qa] non-browser generated runtime: skipping Playwright browser and required Anthropic key"',
      '  export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-${ANTHROPIC_API:-}}"',
      'fi',
      '',
      'resolve_tsx_loader() {',
      '  if [ -f "${ROOT_DIR}/node_modules/tsx/dist/loader.mjs" ]; then',
      '    printf "%s\\n" "${ROOT_DIR}/node_modules/tsx/dist/loader.mjs"',
      '    return 0',
      '  fi',
      '',
      '  local global_root=""',
      '  global_root="$(npm root -g 2>/dev/null || true)"',
      '  if [ -n "${global_root}" ] && [ -f "${global_root}/tsx/dist/loader.mjs" ]; then',
      '    printf "%s\\n" "${global_root}/tsx/dist/loader.mjs"',
      '    return 0',
      '  fi',
      '',
      '  echo "[.agentic-qa] tsx loader not found in local or global node_modules" >&2',
      '  exit 1',
      '}',
      '',
      'TSX_LOADER="$(resolve_tsx_loader)"',
      '',
      'echo "[.agentic-qa] starting api on ${API_PORT}"',
      '(cd "${ROOT_DIR}" && NODE_NO_WARNINGS=1 ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" AGENTIC_QA_REPOSITORY_KIND="${AGENTIC_QA_REPOSITORY_KIND}" PORT="${API_PORT}" HOST="127.0.0.1" node --import "${TSX_LOADER}" packages/api/src/index.ts) &',
      'API_PID=$!',
      '',
      'echo "[.agentic-qa] starting web on ${WEB_PORT} -> api ${API_PORT}"',
      'trap \'kill "${API_PID}" >/dev/null 2>&1 || true\' EXIT',
      'cd "${ROOT_DIR}" && NODE_NO_WARNINGS=1 VITE_API_URL="http://localhost:${API_PORT}" npm exec vite -- packages/web --config packages/web/vite.config.ts --host 0.0.0.0 --port "${WEB_PORT}" --strictPort',
      '',
    ].join('\n'),
    'utf8',
  )
  await fs.chmod(launcherPath, 0o755)

  const metadata = {
    installedAt: new Date().toISOString(),
    templateSource: templateRoot,
    installedPath,
    localPackageDirname: LOCAL_PACKAGE_DIRNAME,
    mode: 'host-local-runtime',
    localPorts: {
      api: 3201,
      web: 5176,
    },
    launcherPath,
    anthropicEnvWritten: runtimePatchResult.anthropicEnvWritten,
    anthropicEnvValidated: runtimePatchResult.anthropicEnvValidated,
    anthropicEnvSource: runtimePatchResult.anthropicEnvSource,
    anthropicEnvValidationMessage: runtimePatchResult.anthropicEnvValidationMessage,
    envLocalPath: runtimePatchResult.envLocalPath,
    envExamplePath: runtimePatchResult.envExamplePath,
  }
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8')

  return {
    repoPath: input.repoPath,
    installedPath,
    copiedRootFiles: COPY_ROOT_FILES.map(String),
    copiedRootDirs: COPY_ROOT_DIRS.map(String),
    copiedExtraFiles: COPY_EXTRA_FILES.map(String),
    createdDirs: EMPTY_DIRS.map(String),
    metadataPath,
    launcherPath,
    anthropicEnvWritten: runtimePatchResult.anthropicEnvWritten,
    anthropicEnvValidated: runtimePatchResult.anthropicEnvValidated,
    anthropicEnvSource: runtimePatchResult.anthropicEnvSource,
    anthropicEnvValidationMessage: runtimePatchResult.anthropicEnvValidationMessage,
    envLocalPath: runtimePatchResult.envLocalPath,
    envExamplePath: runtimePatchResult.envExamplePath,
  }
}

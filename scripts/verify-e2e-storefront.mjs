// End-to-end check of the README quick start against examples/storefront.
//
// 1. Copies examples/storefront into a temp dir (the repo copy is never touched).
// 2. Runs install-local and discover-local on the copy.
// 3. Serves the copy over HTTP and starts the generated launcher with the
//    deterministic runtime (no API key needed) and real Chromium.
// 4. Runs `place_order` and expects status=complete, verdict=contract_compliant.
// 5. Breaks the app (success feedback removed) and expects the same scenario to
//    fail with verdict=contract_violated. This guards against false positives.
//
// Usage: npm run test:e2e   (KEEP_E2E_DIR=1 keeps the temp dir for debugging)

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const exampleDir = path.join(repoRoot, 'examples/storefront')
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-e2e-storefront-'))
const targetDir = path.join(workDir, 'storefront')
const tsxLoader = path.join(repoRoot, 'node_modules/tsx/dist/loader.mjs')
const LAUNCH_TIMEOUT_MS = Number(process.env.E2E_LAUNCH_TIMEOUT_MS ?? 15 * 60_000)
const RUN_TIMEOUT_MS = Number(process.env.E2E_RUN_TIMEOUT_MS ?? 5 * 60_000)

const cleanups = []
let launcherLog = ''

function log(message) {
  console.log(`[e2e-storefront] ${message}`)
}

function fail(message) {
  throw new Error(message)
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function runCli(command, cliArgs) {
  log(`${command} ${cliArgs.join(' ')}`)
  const result = spawnSync(process.execPath, ['--import', tsxLoader, 'packages/dashboard-api/src/cli.ts', command, ...cliArgs], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' },
  })
  if (result.status !== 0) {
    fail(`${command} failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`)
  }
}

function serveStatic(rootDir, port) {
  const server = http.createServer((request, response) => {
    const urlPath = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    const filePath = path.join(rootDir, urlPath === '/' ? 'index.html' : urlPath)
    if (!filePath.startsWith(rootDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      response.writeHead(404).end('not found')
      return
    }
    const type = filePath.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8'
    response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
    fs.createReadStream(filePath).pipe(response)
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

async function waitFor(description, timeoutMs, probe) {
  const deadline = Date.now() + timeoutMs
  let lastLog = 0
  while (Date.now() < deadline) {
    try {
      const value = await probe()
      if (value) return value
    } catch {
      // not ready yet
    }
    if (Date.now() - lastLog > 30_000) {
      log(`waiting for ${description}...`)
      lastLog = Date.now()
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  fail(`timed out waiting for ${description}\n--- launcher output (tail) ---\n${launcherLog.slice(-4000)}`)
}

async function api(baseUrl, route, init) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}

async function runScenario(apiUrl, scenarioId) {
  const started = await api(apiUrl, '/api/p2/runs', {
    method: 'POST',
    body: JSON.stringify({ scenario_id: scenarioId }),
  })
  if (started.status !== 202 || !started.body?.session_id) {
    fail(`POST /api/p2/runs returned ${started.status}: ${JSON.stringify(started.body)}`)
  }
  const sessionId = started.body.session_id
  return waitFor(`session ${sessionId}`, RUN_TIMEOUT_MS, async () => {
    const { status, body } = await api(apiUrl, `/api/p2/sessions/${sessionId}`)
    if (status !== 200) return null
    return body.status === 'complete' || body.status === 'failed' ? body : null
  })
}

function describeSession(session) {
  return `status=${session.status} verdict=${session.contractEvaluation?.verdict ?? 'none'}`
}

async function main() {
  if (!fs.existsSync(tsxLoader)) fail('tsx is missing. Run `npm install` at the repository root first.')

  fs.cpSync(exampleDir, targetDir, {
    recursive: true,
    filter: (source) => !/[\\/](\.agentic-qa|node_modules|dist)([\\/]|$)/.test(path.relative(exampleDir, source)),
  })
  log(`working copy: ${targetDir}`)

  runCli('install-local', [targetDir])
  runCli('discover-local', [targetDir])

  const appPort = await freePort()
  const apiPort = await freePort()
  const webPort = await freePort()
  const appServer = await serveStatic(targetDir, appPort)
  cleanups.push(() => new Promise((resolve) => appServer.close(() => resolve())))
  const appUrl = `http://127.0.0.1:${appPort}`
  const apiUrl = `http://127.0.0.1:${apiPort}`
  log(`app ${appUrl}, api ${apiUrl}, web http://127.0.0.1:${webPort}`)

  const runtimeDir = path.join(targetDir, '.agentic-qa')
  const launcher = spawn('bash', ['./scripts/start-local-dashboard.generated.sh', '--api-port', String(apiPort), '--web-port', String(webPort)], {
    cwd: runtimeDir,
    detached: true,
    env: {
      ...process.env,
      AGENTIC_QA_FORCE_DETERMINISTIC_RUNTIME: '1',
      PLAYWRIGHT_BASE_URL: appUrl,
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
    },
  })
  const capture = (chunk) => {
    launcherLog += chunk.toString()
    if (launcherLog.length > 200_000) launcherLog = launcherLog.slice(-100_000)
  }
  launcher.stdout.on('data', capture)
  launcher.stderr.on('data', capture)
  cleanups.push(async () => {
    try {
      process.kill(-launcher.pid, 'SIGTERM')
    } catch {
      // already gone
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  })

  await waitFor('runtime API', LAUNCH_TIMEOUT_MS, async () => {
    if (launcher.exitCode !== null) fail(`launcher exited early (code ${launcher.exitCode})\n${launcherLog.slice(-4000)}`)
    return (await fetch(`${apiUrl}/health`)).ok
  })
  await waitFor('dashboard web', 120_000, async () => (await fetch(`http://127.0.0.1:${webPort}/`)).ok)
  log('runtime API and dashboard are up')

  const scenarios = await api(apiUrl, '/api/p2/scenarios')
  const scenarioIds = (Array.isArray(scenarios.body) ? scenarios.body : scenarios.body?.scenarios ?? []).map((scenario) => scenario.id)
  for (const expected of ['browse_products', 'place_order']) {
    if (!scenarioIds.includes(expected)) fail(`scenario ${expected} not discovered (got ${scenarioIds.join(', ')})`)
  }
  log(`discovered scenarios: ${scenarioIds.join(', ')}`)

  const healthy = await runScenario(apiUrl, 'place_order')
  log(`healthy app: ${describeSession(healthy)}`)
  if (healthy.status !== 'complete' || healthy.contractEvaluation?.verdict !== 'contract_compliant') {
    fail(`expected complete/contract_compliant on the healthy app, got ${describeSession(healthy)}`)
  }

  const indexPath = path.join(targetDir, 'index.html')
  const original = fs.readFileSync(indexPath, 'utf8')
  const broken = original.replace("feedback.textContent = 'Order submitted successfully'", "feedback.textContent = ''")
  if (broken === original) fail('could not inject the regression into index.html (success message not found)')
  fs.writeFileSync(indexPath, broken)

  const regressed = await runScenario(apiUrl, 'place_order')
  log(`broken app: ${describeSession(regressed)}`)
  if (regressed.contractEvaluation?.verdict !== 'contract_violated') {
    fail(`expected contract_violated on the broken app, got ${describeSession(regressed)}`)
  }

  log('PASS')
}

let exitCode = 0
try {
  await main()
} catch (error) {
  exitCode = 1
  console.error(`[e2e-storefront] FAIL: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup()
    } catch {
      // best effort
    }
  }
  if (process.env.KEEP_E2E_DIR === '1') {
    log(`kept ${workDir}`)
  } else {
    fs.rmSync(workDir, { recursive: true, force: true })
  }
}
process.exit(exitCode)

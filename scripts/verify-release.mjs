import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const dashboardRoot = path.join(repoRoot, 'templates/persona-qa-dashboard')
const apiRoot = path.join(dashboardRoot, 'packages/api')
const webRoot = path.join(dashboardRoot, 'packages/web')
const tsxLoader = path.join(dashboardRoot, 'node_modules/tsx/dist/loader.mjs')
const preferredNodeBin = process.env.AGENTIC_RELEASE_NODE_BIN
  ?? path.join(process.env.HOME ?? '', '.nvm/versions/node/v22.13.1/bin')
const preferredNodePath = path.join(preferredNodeBin, 'node')
const releaseNodePath = fs.existsSync(preferredNodePath) ? preferredNodePath : process.execPath
const releasePath = fs.existsSync(preferredNodePath)
  ? `${preferredNodeBin}${path.delimiter}${process.env.PATH ?? ''}`
  : process.env.PATH

const apiReleaseTests = [
  'src/phase2/__tests__/agent-profiles.test.ts',
  'src/phase2/__tests__/scenario-loading.test.ts',
  'src/phase2/__tests__/adaptive-history.test.ts',
  'src/phase2/__tests__/failure-diagnosis-service.test.ts',
  'src/phase2/__tests__/agent-runtime.test.ts',
  'src/phase2/__tests__/workflow-tools.test.ts',
  'src/phase2/__tests__/generic-adapter-runtime.test.ts',
  'src/phase2/__tests__/evidence-tools.test.ts',
  'src/phase2/__tests__/l5-services.test.ts',
  'src/phase2/__tests__/l5-soak.test.ts',
  'src/phase2/__tests__/governance-policy-service.test.ts',
  'src/phase2/__tests__/independent-auditor-service.test.ts',
  'src/phase2/__tests__/sessions-routes.test.ts',
  'src/phase2/__tests__/sensors.test.ts',
  'src/phase2/__tests__/sensors-policy.test.ts',
]

const webReleaseTests = [
  'src/components/__tests__/L5GovernancePanel.test.tsx',
  'src/components/__tests__/MaturityStatusPanel.test.tsx',
  'src/components/__tests__/RunTimeline.test.tsx',
  'src/components/__tests__/RecentFindings.test.tsx',
  'src/components/__tests__/RecentRuns.test.tsx',
  'src/components/__tests__/ScenarioMetrics.test.tsx',
  'src/components/__tests__/SourceBadge.test.tsx',
  'src/components/__tests__/ArtifactsSection.test.tsx',
  'src/components/EvidenceSummary.test.tsx',
  'src/components/RunSourceBadge.test.tsx',
  'src/__tests__/EmptyState.test.tsx',
  'src/__tests__/FilterChip.test.tsx',
  'src/__tests__/RunFilters.test.tsx',
  'src/__tests__/StaleBanner.test.tsx',
  'src/__tests__/filter-url-persistence.test.ts',
]

const portSeed = Number(process.env.RELEASE_PORT_SEED ?? 3280 + (process.pid % 400))
const baseReleaseEnv = {
  ...process.env,
  NODE_NO_WARNINGS: process.env.NODE_NO_WARNINGS ?? '1',
  PATH: releasePath,
}
let releaseEnv = baseReleaseEnv

const steps = [
  {
    name: 'syntax: clean-room verifier',
    command: releaseNodePath,
    args: ['--check', 'scripts/verify-install-local-reference-store.mjs'],
    cwd: repoRoot,
  },
  {
    name: 'syntax: real Reference Store verifier',
    command: releaseNodePath,
    args: ['--check', 'scripts/verify-real-reference-store.mjs'],
    cwd: repoRoot,
  },
  {
    name: 'syntax: generic frontend verifier',
    command: releaseNodePath,
    args: ['--check', 'scripts/verify-generic-frontend.mjs'],
    cwd: repoRoot,
  },
  {
    name: 'syntax: generic repository type verifier',
    command: releaseNodePath,
    args: ['--check', 'scripts/verify-generic-repository-types.mjs'],
    cwd: repoRoot,
  },
  {
    name: 'syntax: generic runtime execution verifier',
    command: releaseNodePath,
    args: ['--check', 'scripts/verify-generic-runtime-execution.mjs'],
    cwd: repoRoot,
  },
  {
    name: 'syntax: domain discovery contract verifier',
    command: releaseNodePath,
    args: ['--check', 'scripts/verify-domain-discovery-contracts.mjs'],
    cwd: repoRoot,
  },
  {
    name: 'syntax: static frontend scanner verifier',
    command: releaseNodePath,
    args: ['--check', 'scripts/verify-static-frontend-scanner.mjs'],
    cwd: repoRoot,
  },
  {
    name: 'syntax: domain fixture matrix verifier',
    command: releaseNodePath,
    args: ['--check', 'scripts/verify-domain-fixture-matrix.mjs'],
    cwd: repoRoot,
  },
  {
    name: 'domain discovery contract verification',
    command: 'npm',
    args: ['run', 'verify:domain-discovery-contracts'],
    cwd: repoRoot,
    env: releaseEnv,
  },
  {
    name: 'static frontend scanner verification',
    command: 'npm',
    args: ['run', 'verify:static-frontend-scanner'],
    cwd: repoRoot,
    env: releaseEnv,
  },
  {
    name: 'domain fixture matrix verification',
    command: 'npm',
    args: ['run', 'verify:domain-fixture-matrix'],
    cwd: repoRoot,
    env: releaseEnv,
  },
  {
    name: 'generic frontend install/discovery smoke',
    command: 'npm',
    args: ['run', 'verify:generic-frontend'],
    cwd: repoRoot,
    env: releaseEnv,
  },
  {
    name: 'generic repository type install/discovery smoke',
    command: 'npm',
    args: ['run', 'verify:generic-repository-types'],
    cwd: repoRoot,
    env: releaseEnv,
  },
  {
    name: 'generic repository deterministic runtime smoke',
    command: 'npm',
    args: ['run', 'verify:generic-runtime-execution'],
    cwd: repoRoot,
    env: releaseEnv,
  },
  {
    name: 'api: adapter personas route node test',
    command: releaseNodePath,
    args: ['--import', tsxLoader, '--test', 'src/routes/__tests__/personas.test.ts'],
    cwd: apiRoot,
  },
  {
    name: 'api: L4/L5 release vitest',
    command: 'npm',
    args: ['exec', '--', 'vitest', 'run', ...apiReleaseTests],
    cwd: apiRoot,
    env: {
      PERSONA_QA_USE_LEGACY_STATIC_SCENARIOS: '1',
    },
  },
  {
    name: 'web: release vitest',
    command: 'npm',
    args: ['exec', '--', 'vitest', 'run', ...webReleaseTests],
    cwd: webRoot,
  },
  {
    name: 'web: build',
    command: 'npm',
    args: ['run', 'build'],
    cwd: webRoot,
  },
  {
    name: 'clean-room install/runtime/dashboard smoke',
    command: 'npm',
    args: ['run', 'verify:install-local:reference-store'],
    cwd: repoRoot,
    env: releaseEnv,
  },
]

function log(message) {
  process.stdout.write(`[verify-release] ${message}\n`)
}

function assertNodeVersion() {
  const result = spawnSync(releaseNodePath, ['-p', 'process.versions.node'], {
    encoding: 'utf8',
  })
  const version = result.stdout.trim() || process.versions.node
  const major = Number(version.split('.')[0])
  if (!Number.isFinite(major) || major < 22) {
    throw new Error(`Node 22+ is required for release verification; current=${version}`)
  }
}

function parsePort(name, value) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a valid TCP port; got=${value}`)
  }
  return port
}

async function canBind(port, host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', (error) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRNOTAVAIL') {
        resolve(true)
        return
      }
      resolve(false)
    })
    server.listen({ port, host, exclusive: true }, () => {
      server.close((error) => {
        if (error) reject(error)
        else resolve(true)
      })
    })
  })
}

async function isPortAvailable(port) {
  return (
    await canBind(port, '127.0.0.1')
    && await canBind(port, '0.0.0.0')
    && await canBind(port, '::')
  )
}

async function findAvailablePort(start, reservedPorts) {
  const normalizedStart = parsePort('RELEASE_PORT_SEED', String(start))
  for (let offset = 0; offset < 2000; offset += 1) {
    const candidate = normalizedStart + offset
    if (candidate > 65535) break
    if (reservedPorts.has(candidate)) continue
    if (await isPortAvailable(candidate)) return candidate
  }
  throw new Error(`could not find available port from ${normalizedStart}`)
}

async function resolveReleasePort(envName, preferredPort, reservedPorts) {
  const override = process.env[envName]
  if (override) {
    const port = parsePort(envName, override)
    if (reservedPorts.has(port)) throw new Error(`${envName}=${port} collides with another release port`)
    if (!await isPortAvailable(port)) throw new Error(`${envName}=${port} is already in use`)
    return port
  }
  return findAvailablePort(preferredPort, reservedPorts)
}

async function prepareReleaseEnv() {
  const reservedPorts = new Set()
  const apiPort = await resolveReleasePort('API_PORT', portSeed, reservedPorts)
  reservedPorts.add(apiPort)
  const webPort = await resolveReleasePort('WEB_PORT', portSeed + 2000, reservedPorts)

  releaseEnv = {
    ...baseReleaseEnv,
    API_PORT: String(apiPort),
    WEB_PORT: String(webPort),
  }
}

function runStep(step) {
  log(`START ${step.name}`)
  const startedAt = Date.now()
  const result = spawnSync(step.command, step.args, {
    cwd: step.cwd,
    env: { ...releaseEnv, ...(step.env ?? {}) },
    stdio: 'inherit',
  })

  const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  if (result.status !== 0) {
    throw new Error(`step failed (${result.status}): ${step.name}`)
  }
  log(`PASS ${step.name} (${durationSeconds}s)`)
}

async function main() {
  assertNodeVersion()
  await prepareReleaseEnv()
  log(`node=${releaseNodePath}`)
  log(`ports api=${releaseEnv.API_PORT} web=${releaseEnv.WEB_PORT}`)
  for (const step of steps) runStep(step)
  log('PASS release verification')
}

try {
  await main()
} catch (error) {
  process.stderr.write(`[verify-release] FAIL ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
}

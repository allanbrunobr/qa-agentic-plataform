import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const dashboardRoot = path.join(repoRoot, 'templates/persona-qa-dashboard')
const apiRoot = path.join(dashboardRoot, 'packages/api')
const webRoot = path.join(dashboardRoot, 'packages/web')

const apiReleaseTests = [
  'src/phase2/__tests__/adaptive-history.test.ts',
  'src/phase2/__tests__/l5-services.test.ts',
  'src/phase2/__tests__/governance-policy-service.test.ts',
  'src/phase2/__tests__/independent-auditor-service.test.ts',
  'src/phase2/__tests__/sessions-routes.test.ts',
  'src/phase2/__tests__/sensors.test.ts',
  'src/phase2/__tests__/sensors-policy.test.ts',
]

const webReleaseTests = [
  'src/components/__tests__/L5GovernancePanel.test.tsx',
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
const releaseEnv = {
  ...process.env,
  API_PORT: process.env.API_PORT ?? String(portSeed),
  WEB_PORT: process.env.WEB_PORT ?? String(portSeed + 2000),
  NODE_NO_WARNINGS: process.env.NODE_NO_WARNINGS ?? '1',
}

const steps = [
  {
    name: 'syntax: clean-room verifier',
    command: process.execPath,
    args: ['--check', 'scripts/verify-install-local-reference-store.mjs'],
    cwd: repoRoot,
  },
  {
    name: 'api: L4/L5 release vitest',
    command: 'npm',
    args: ['exec', '--', 'vitest', 'run', ...apiReleaseTests],
    cwd: apiRoot,
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
  const major = Number(process.versions.node.split('.')[0])
  if (!Number.isFinite(major) || major < 22) {
    throw new Error(`Node 22+ is required for release verification; current=${process.versions.node}`)
  }
}

function runStep(step) {
  log(`START ${step.name}`)
  const startedAt = Date.now()
  const result = spawnSync(step.command, step.args, {
    cwd: step.cwd,
    env: step.env ?? process.env,
    stdio: 'inherit',
  })

  const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  if (result.status !== 0) {
    throw new Error(`step failed (${result.status}): ${step.name}`)
  }
  log(`PASS ${step.name} (${durationSeconds}s)`)
}

function main() {
  assertNodeVersion()
  log(`ports api=${releaseEnv.API_PORT} web=${releaseEnv.WEB_PORT}`)
  for (const step of steps) runStep(step)
  log('PASS release verification')
}

try {
  main()
} catch (error) {
  process.stderr.write(`[verify-release] FAIL ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
}

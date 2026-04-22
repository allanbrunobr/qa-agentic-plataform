import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const dashboardRoot = path.join(repoRoot, 'templates/persona-qa-dashboard')
const apiRoot = path.join(dashboardRoot, 'packages/api')
const webRoot = path.join(dashboardRoot, 'packages/web')
const preferredNodeBin = process.env.AGENTIC_RELEASE_NODE_BIN
  ?? path.join(process.env.HOME ?? '', '.nvm/versions/node/v22.13.1/bin')
const preferredNodePath = path.join(preferredNodeBin, 'node')
const releaseNodePath = fs.existsSync(preferredNodePath) ? preferredNodePath : process.execPath
const releasePath = fs.existsSync(preferredNodePath)
  ? `${preferredNodeBin}${path.delimiter}${process.env.PATH ?? ''}`
  : process.env.PATH

const releaseEnv = {
  ...process.env,
  NODE_NO_WARNINGS: process.env.NODE_NO_WARNINGS ?? '1',
  PATH: releasePath,
}

const steps = [
  {
    name: 'syntax: L5 verifier',
    command: releaseNodePath,
    args: ['--check', 'scripts/verify-l5.mjs'],
    cwd: repoRoot,
  },
  {
    name: 'syntax: L5 soak verifier',
    command: releaseNodePath,
    args: ['--check', 'scripts/verify-l5-soak.mjs'],
    cwd: repoRoot,
  },
  {
    name: 'api: L5 transition and route tests',
    command: 'npm',
    args: [
      'exec',
      '--',
      'vitest',
      'run',
      'src/phase2/__tests__/l5-services.test.ts',
      'src/phase2/__tests__/sessions-routes.test.ts',
    ],
    cwd: apiRoot,
    env: {
      PERSONA_QA_USE_LEGACY_STATIC_SCENARIOS: '1',
    },
  },
  {
    name: 'api: L5 soak',
    command: 'npm',
    args: ['run', 'verify:l5:soak'],
    cwd: repoRoot,
    env: {
      PERSONA_QA_USE_LEGACY_STATIC_SCENARIOS: '1',
    },
  },
  {
    name: 'api: typecheck',
    command: 'npm',
    args: ['exec', '--', 'tsc', '--noEmit'],
    cwd: apiRoot,
  },
  {
    name: 'web: L5 visibility tests',
    command: 'npm',
    args: [
      'exec',
      '--',
      'vitest',
      'run',
      'src/components/__tests__/L5RunAuditPanel.test.tsx',
      'src/components/__tests__/MaturityStatusPanel.test.tsx',
    ],
    cwd: webRoot,
  },
  {
    name: 'web: typecheck',
    command: 'npm',
    args: ['exec', '--', 'tsc', '-p', 'tsconfig.app.json'],
    cwd: webRoot,
  },
]

function log(message) {
  process.stdout.write(`[verify-l5] ${message}\n`)
}

function assertNodeVersion() {
  const result = spawnSync(releaseNodePath, ['-p', 'process.versions.node'], {
    encoding: 'utf8',
  })
  const version = result.stdout.trim() || process.versions.node
  const major = Number(version.split('.')[0])
  if (!Number.isFinite(major) || major < 22) {
    throw new Error(`Node 22+ is required for L5 verification; current=${version}`)
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

try {
  assertNodeVersion()
  log(`node=${releaseNodePath}`)
  for (const step of steps) runStep(step)
  log('PASS L5 verification')
} catch (error) {
  process.stderr.write(`[verify-l5] FAIL ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
}

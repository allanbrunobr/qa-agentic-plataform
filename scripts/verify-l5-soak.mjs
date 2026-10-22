import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const apiRoot = path.join(repoRoot, 'templates/persona-qa-dashboard/packages/api')
const preferredNodeBin = process.env.AGENTIC_RELEASE_NODE_BIN
  ?? path.dirname(process.execPath)
const preferredNodePath = path.join(preferredNodeBin, 'node')
const preferredNpmCliPath = path.join(preferredNodeBin, 'lib/node_modules/npm/bin/npm-cli.js')
const releaseNodePath = fs.existsSync(preferredNodePath) ? preferredNodePath : process.execPath
const releasePath = fs.existsSync(preferredNodePath)
  ? `${preferredNodeBin}${path.delimiter}${process.env.PATH ?? ''}`
  : process.env.PATH
const releaseNpmCliPath = fs.existsSync(preferredNpmCliPath) ? preferredNpmCliPath : null

process.stdout.write('[verify-l5-soak] START api: closed-loop repeated learning soak\n')
const result = spawnSync(releaseNpmCliPath ? releaseNodePath : 'npm', releaseNpmCliPath ? [
  releaseNpmCliPath,
  'exec',
  '--',
  'vitest',
  'run',
  'src/phase2/__tests__/l5-soak.test.ts',
] : [
  'exec',
  '--',
  'vitest',
  'run',
  'src/phase2/__tests__/l5-soak.test.ts',
], {
  cwd: apiRoot,
  env: {
    ...process.env,
    NODE_NO_WARNINGS: process.env.NODE_NO_WARNINGS ?? '1',
    PATH: releasePath,
    PERSONA_QA_USE_REFERENCE_SCENARIOS: '1',
  },
  stdio: 'inherit',
})

if (result.status !== 0) {
  process.stderr.write(`[verify-l5-soak] FAIL api: closed-loop repeated learning soak (${result.status})\n`)
  process.exitCode = result.status ?? 1
} else {
  process.stdout.write('[verify-l5-soak] PASS api: closed-loop repeated learning soak\n')
}

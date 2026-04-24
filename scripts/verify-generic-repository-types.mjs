import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const fixtureRoot = path.join(os.tmpdir(), `agentic-platform-generic-repository-fixtures-${Date.now()}`)
const tsxLoaderCandidates = [
  path.join(repoRoot, 'node_modules/tsx/dist/loader.mjs'),
  path.join(repoRoot, 'templates/persona-qa-dashboard/node_modules/tsx/dist/loader.mjs'),
  path.join(process.env.HOME ?? '', '.nvm/versions/node/v22.13.1/lib/node_modules/tsx/dist/loader.mjs'),
]
const tsxLoader = tsxLoaderCandidates.find((candidate) => fs.existsSync(candidate))
const preferredNodeBin = process.env.AGENTIC_RELEASE_NODE_BIN
  ?? path.join(process.env.HOME ?? '', '.nvm/versions/node/v22.13.1/bin')
const preferredNodePath = path.join(preferredNodeBin, 'node')
const nodePath = fs.existsSync(preferredNodePath) ? preferredNodePath : process.execPath
const verificationEnv = {
  ...process.env,
  PATH: fs.existsSync(preferredNodePath)
    ? `${preferredNodeBin}${path.delimiter}${process.env.PATH ?? ''}`
    : process.env.PATH,
}

function log(message) {
  process.stdout.write(`[verify-generic-repository-types] ${message}\n`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function writeFile(fixtureName, relativePath, content) {
  const filePath = path.join(fixtureRoot, fixtureName, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
}

function readGeneratedJson(fixtureName, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(
    fixtureRoot,
    fixtureName,
    '.agentic-qa/adapter',
    relativePath,
  ), 'utf8'))
}

function createFixtures() {
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
  fs.mkdirSync(fixtureRoot, { recursive: true })

  writeFile('backend-api', 'package.json', `${JSON.stringify({
    name: 'generic-backend-api-fixture',
    private: true,
    type: 'module',
    scripts: {
      'dev:api': 'tsx src/server.ts',
      test: 'node --test',
    },
    dependencies: {
      express: '^latest',
    },
  }, null, 2)}\n`)
  writeFile('backend-api', 'src/server.ts', `import express from 'express'

const app = express()

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' })
})

app.get('/api/accounts', (_request, response) => {
  response.json([{ id: 'acct_1' }])
})

app.listen(3000)
`)

  writeFile('cli-tool', 'package.json', `${JSON.stringify({
    name: 'generic-cli-fixture',
    private: true,
    type: 'module',
    bin: {
      'generic-cli': './bin/generic-cli.js',
    },
    dependencies: {
      commander: '^latest',
    },
  }, null, 2)}\n`)
  writeFile('cli-tool', 'bin/generic-cli.js', `#!/usr/bin/env node
import { Command } from 'commander'

new Command()
  .name('generic-cli')
  .description('Example CLI command surface')
  .option('--format <format>', 'output format')
  .parse()
`)

  writeFile('library-package', 'package.json', `${JSON.stringify({
    name: 'generic-library-fixture',
    private: true,
    type: 'module',
    exports: {
      '.': './src/index.ts',
    },
    types: './src/index.ts',
  }, null, 2)}\n`)
  writeFile('library-package', 'src/index.ts', `export interface AccountSummary {
  id: string
  balance: number
}

export function summarizeAccount(id: string): AccountSummary {
  return { id, balance: 0 }
}
`)

  writeFile('unknown-repo', 'README.md', '# Unknown Repository\n\nDocumentation-only repository fixture.\n')
}

function runCli(command, fixtureName) {
  assert(tsxLoader, 'tsx loader not found; install dependencies before running generic repository verification')
  const fixturePath = path.join(fixtureRoot, fixtureName)
  log(`START ${fixtureName} ${command}`)
  const result = spawnSync(nodePath, ['--import', tsxLoader, 'packages/dashboard-api/src/cli.ts', command, fixturePath], {
    cwd: repoRoot,
    env: verificationEnv,
    encoding: 'utf8',
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  assert(result.status === 0, `${fixtureName} ${command} failed with status ${result.status}`)
  log(`PASS ${fixtureName} ${command}`)
}

function verifyFixture(fixtureName, expected) {
  const report = readGeneratedJson(fixtureName, 'config/discovery-report.generated.json')
  const auth = readGeneratedJson(fixtureName, 'auth/auth.generated.json')
  const personas = readGeneratedJson(fixtureName, 'personas/personas.generated.json')
  const scenarios = readGeneratedJson(fixtureName, 'scenarios/scenarios.generated.json')
  const capabilities = readGeneratedJson(fixtureName, 'capabilities/capabilities.generated.json')
  const codeGraph = readGeneratedJson(fixtureName, 'config/code-graph.generated.json')
  const contractsIndex = readGeneratedJson(fixtureName, 'workflow-contracts/index.generated.json')

  const personaIds = personas.map((persona) => persona.id)
  const scenarioIds = scenarios.map((scenario) => scenario.id)
  const capabilityIds = capabilities.map((capability) => capability.id)
  const surfaceIds = report.surfaces.map((surface) => surface.id)

  assert(report.repository?.kind === expected.kind, `${fixtureName}: expected ${expected.kind}, got ${report.repository?.kind}`)
  assert(codeGraph.schemaVersion === 'code-graph/v1', `${fixtureName}: code graph schema missing`)
  assert(codeGraph.repositoryKind === expected.kind, `${fixtureName}: expected code graph kind ${expected.kind}, got ${codeGraph.repositoryKind}`)
  assert(codeGraph.nodes.some((node) => node.type === 'repository'), `${fixtureName}: code graph repository node missing`)
  assert(codeGraph.nodes.some((node) => node.type === 'persona_candidate'), `${fixtureName}: code graph persona candidate missing`)
  assert(codeGraph.nodes.some((node) => node.type === 'scenario_candidate'), `${fixtureName}: code graph scenario candidate missing`)
  assert(codeGraph.nodes.some((node) => node.type === 'capability_candidate'), `${fixtureName}: code graph capability candidate missing`)
  assert(codeGraph.edges.some((edge) => edge.type === 'requires_capability'), `${fixtureName}: code graph capability edges missing`)
  assert(personaIds.includes(expected.persona), `${fixtureName}: missing persona ${expected.persona}; got ${personaIds.join(', ')}`)
  assert(scenarioIds.includes(expected.scenario), `${fixtureName}: missing scenario ${expected.scenario}; got ${scenarioIds.join(', ')}`)
  for (const capabilityId of expected.capabilities) {
    assert(capabilityIds.includes(capabilityId), `${fixtureName}: missing capability ${capabilityId}; got ${capabilityIds.join(', ')}`)
  }
  assert(!personaIds.includes('sales-associate') && !personaIds.includes('fulfillment-agent'), `${fixtureName}: Reference Store personas leaked into generic adapter`)
  assert(!scenarioIds.includes('first_order'), `${fixtureName}: Reference Store scenario leaked into generic adapter`)
  assert(!surfaceIds.includes('form_entry') && !surfaceIds.includes('checkout'), `${fixtureName}: frontend surfaces leaked into non-frontend adapter`)
  assert(auth.loginEntryPoint === 'not_applicable', `${fixtureName}: expected no browser login, got ${auth.loginEntryPoint}`)
  assert(contractsIndex.some((entry) => entry.scenarioId === expected.scenario), `${fixtureName}: workflow contract missing`)
}

try {
  createFixtures()
  log(`fixtureRoot=${fixtureRoot}`)

  const expectations = [
    {
      fixtureName: 'backend-api',
      kind: 'backend_api',
      persona: 'api_consumer',
      scenario: 'api_health_smoke',
      capabilities: ['startApiService', 'callHealthEndpoint', 'verifyApiResponse'],
    },
    {
      fixtureName: 'cli-tool',
      kind: 'cli',
      persona: 'cli_user',
      scenario: 'cli_help_smoke',
      capabilities: ['runCliHelp', 'verifyCliOutput'],
    },
    {
      fixtureName: 'library-package',
      kind: 'library',
      persona: 'integration_developer',
      scenario: 'package_import_smoke',
      capabilities: ['inspectPackageExports', 'verifyPublicApiDocs'],
    },
    {
      fixtureName: 'unknown-repo',
      kind: 'unknown',
      persona: 'repository_reviewer',
      scenario: 'repository_structure_smoke',
      capabilities: ['inspectRepositoryStructure', 'identifyTestEntrypoints'],
    },
  ]

  for (const expectation of expectations) {
    runCli('install-local', expectation.fixtureName)
    runCli('discover-local', expectation.fixtureName)
    verifyFixture(expectation.fixtureName, expectation)
  }

  log('PASS generic repository type install/discovery verification')
} catch (error) {
  process.stderr.write(`[verify-generic-repository-types] FAIL ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
}

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const fixtureRoot = path.join(os.tmpdir(), `agentic-platform-generic-frontend-fixture-${Date.now()}`)
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
  process.stdout.write(`[verify-generic-frontend] ${message}\n`)
}

function writeFile(relativePath, content) {
  const filePath = path.join(fixtureRoot, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, relativePath), 'utf8'))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function verifyInstalledDocs() {
  const docsDir = path.join(fixtureRoot, '.agentic-qa', 'docs')
  const readmePath = path.join(docsDir, 'README.md')
  assert(fs.existsSync(readmePath), 'generic installed docs README missing')
  const docFiles = fs.readdirSync(docsDir)
  assert(docFiles.length === 1 && docFiles[0] === 'README.md', `legacy docs copied into installed package: ${docFiles.join(', ')}`)
  const text = fs.readFileSync(readmePath, 'utf8')
  assert(!/reference-store|sales-associate|fulfillment-agent|billing_clerk|store_manager|customer|billing|notes/i.test(text), 'installed docs README contains host-specific legacy text')
}

function createFixture() {
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
  fs.mkdirSync(fixtureRoot, { recursive: true })
  writeFile('package.json', `${JSON.stringify({
    name: 'generic-storefront-fixture',
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite --host 127.0.0.1',
      build: 'tsc -b && vite build',
    },
    dependencies: {
      '@vitejs/plugin-react': '^latest',
      vite: '^latest',
      react: '^latest',
      'react-dom': '^latest',
      typescript: '^latest',
    },
    devDependencies: {},
  }, null, 2)}\n`)
  writeFile('index.html', '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n')
  writeFile('tsconfig.json', `${JSON.stringify({
    compilerOptions: {
      jsx: 'react-jsx',
      strict: true,
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      skipLibCheck: true,
    },
    include: ['src'],
  }, null, 2)}\n`)
  writeFile('src/main.tsx', `import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

function App() {
  const [email, setEmail] = useState('')
  const [items, setItems] = useState(0)
  const [message, setMessage] = useState('')

  return (
    <main>
      <h1>Generic Storefront</h1>
      <label>
        Customer email
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="customer@example.com" />
      </label>
      <button onClick={() => setItems((value) => value + 1)}>Add item to cart</button>
      <p>Cart items: {items}</p>
      <button disabled={!email || items === 0} onClick={() => setMessage('Order submitted successfully')}>
        Submit order
      </button>
      <output>{message}</output>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
`)
  writeFile('src/styles.css', 'body { font-family: system-ui, sans-serif; margin: 2rem; } main { display: grid; gap: 1rem; max-width: 32rem; }\n')
}

function runCli(command) {
  assert(tsxLoader, 'tsx loader not found; install dependencies before running generic frontend verification')
  log(`START ${command}`)
  const result = spawnSync(nodePath, ['--import', tsxLoader, 'packages/dashboard-api/src/cli.ts', command, fixtureRoot], {
    cwd: repoRoot,
    env: verificationEnv,
    encoding: 'utf8',
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  assert(result.status === 0, `${command} failed with status ${result.status}`)
  log(`PASS ${command}`)
}

function verifyGeneratedAdapter() {
  const report = readJson('.agentic-qa/adapter/config/discovery-report.generated.json')
  const domainBundle = readJson('.agentic-qa/adapter/config/domain-discovery-bundle.generated.json')
  const surfaceMap = readJson('.agentic-qa/adapter/config/frontend-surface-map.generated.json')
  const manifest = readJson('.agentic-qa/adapter/manifest/adapter-manifest.generated.json')
  const personas = readJson('.agentic-qa/adapter/personas/personas.generated.json')
  const scenarios = readJson('.agentic-qa/adapter/scenarios/scenarios.generated.json')
  const capabilities = readJson('.agentic-qa/adapter/capabilities/capabilities.generated.json')
  const contractsIndex = readJson('.agentic-qa/adapter/workflow-contracts/index.generated.json')

  const personaIds = personas.map((persona) => persona.id)
  const scenarioIds = scenarios.map((scenario) => scenario.id)
  const capabilityIds = capabilities.map((capability) => capability.id)

  assert(fs.existsSync(path.join(fixtureRoot, '.agentic-qa/.env.local')), 'installer did not create .agentic-qa/.env.local')
  verifyInstalledDocs()
  assert(manifest.hostProduct === path.basename(fixtureRoot), `unexpected host product ${manifest.hostProduct}`)
  assert(report.framework === 'vite', `expected vite framework, got ${report.framework}`)
  assert(report.domainDiscovery?.domain?.domain === 'commerce', `expected commerce domain in discovery report, got ${report.domainDiscovery?.domain?.domain}`)
  assert(domainBundle.domain.domain === 'commerce', `expected commerce domain bundle, got ${domainBundle.domain.domain}`)
  assert(domainBundle.personas.some((persona) => persona.id === 'shopper'), 'shopper domain persona candidate missing')
  assert(domainBundle.scenarios.every((scenario) => scenario.status === 'needs_human_mapping'), 'domain scenarios must remain mapping gated')
  assert(surfaceMap.targetId === 'generic_storefront_fixture', `unexpected surface map target ${surfaceMap.targetId}`)
  assert(personaIds.includes('primary_user'), `primary_user persona missing: ${personaIds.join(', ')}`)
  assert(!personaIds.includes('sales-associate') && !personaIds.includes('fulfillment-agent'), `Reference Store personas leaked into generic adapter: ${personaIds.join(', ')}`)
  assert(scenarioIds.includes('checkout_smoke'), `checkout_smoke scenario missing: ${scenarioIds.join(', ')}`)
  assert(!scenarioIds.includes('first_order'), `Reference Store scenario leaked into generic adapter: ${scenarioIds.join(', ')}`)
  assert(capabilityIds.includes('fillCustomerEmail'), `fillCustomerEmail capability missing: ${capabilityIds.join(', ')}`)
  assert(capabilityIds.includes('submitOrder'), `submitOrder capability missing: ${capabilityIds.join(', ')}`)
  assert(contractsIndex.some((entry) => entry.scenarioId === 'checkout_smoke'), 'checkout_smoke workflow contract missing')
}

try {
  createFixture()
  log(`fixture=${fixtureRoot}`)
  runCli('install-local')
  runCli('discover-local')
  verifyGeneratedAdapter()
  log('PASS generic frontend install/discovery verification')
} catch (error) {
  process.stderr.write(`[verify-generic-frontend] FAIL ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
}

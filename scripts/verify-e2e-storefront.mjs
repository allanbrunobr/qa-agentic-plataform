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

import process from 'node:process'
import { createLogger, describeSession, startStorefrontRuntime } from './lib/storefront-runtime.mjs'

const log = createLogger('e2e-storefront')
let runtime
let exitCode = 0

try {
  runtime = await startStorefrontRuntime({ log, keepDir: process.env.KEEP_E2E_DIR === '1' })

  const scenarioIds = await runtime.listScenarioIds()
  for (const expected of ['browse_products', 'place_order']) {
    if (!scenarioIds.includes(expected)) throw new Error(`scenario ${expected} not discovered (got ${scenarioIds.join(', ')})`)
  }
  log(`discovered scenarios: ${scenarioIds.join(', ')}`)

  const healthy = await runtime.waitForSession(await runtime.startScenario('place_order'))
  log(`healthy app: ${describeSession(healthy)}`)
  if (healthy.status !== 'complete' || healthy.contractEvaluation?.verdict !== 'contract_compliant') {
    throw new Error(`expected complete/contract_compliant on the healthy app, got ${describeSession(healthy)}`)
  }

  runtime.breakApp()
  const regressed = await runtime.waitForSession(await runtime.startScenario('place_order'))
  log(`broken app: ${describeSession(regressed)}`)
  if (regressed.contractEvaluation?.verdict !== 'contract_violated') {
    throw new Error(`expected contract_violated on the broken app, got ${describeSession(regressed)}`)
  }

  log('PASS')
} catch (error) {
  exitCode = 1
  console.error(`[e2e-storefront] FAIL: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await runtime?.stop()
}
process.exit(exitCode)

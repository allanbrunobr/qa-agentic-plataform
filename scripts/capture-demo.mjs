// Captures the demo frames used to build docs/images/demo.gif.
//
// Starts the storefront example with the deterministic runtime (no API key,
// real Chromium driving the example app), then drives the dashboard with
// Playwright and saves numbered screenshots plus a manifest with captions.
// It also runs the scenario against a deliberately broken copy of the app so
// the frames show both a passing and a failing contract verdict.
//
// Output (gitignored): artifacts/demo/frames/NN-name.png, artifacts/demo/manifest.json,
// and artifacts/demo/session.webm (Playwright screen recording of the whole walk).
//
// Usage: npm run demo:capture

import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { createLogger, describeSession, repoRoot, startStorefrontRuntime } from './lib/storefront-runtime.mjs'

const log = createLogger('demo-capture')
const require = createRequire(path.join(repoRoot, 'templates/persona-qa-dashboard/packages/api/package.json'))
const { chromium } = require('playwright')

const outDir = path.join(repoRoot, 'artifacts/demo')
const framesDir = path.join(outDir, 'frames')
const VIEWPORT = { width: 1440, height: 900 }

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(framesDir, { recursive: true })

const frames = []
let runtime
let browser
let exitCode = 0

async function settle(page, ms = 1_200) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(ms)
}

async function shot(page, name, caption) {
  const file = `${String(frames.length + 1).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: path.join(framesDir, file) })
  frames.push({ file, caption })
  log(`frame ${file}: ${caption}`)
}

async function open(page, hash) {
  await page.goto(`${runtime.webUrl}/#${hash}`)
  await settle(page)
}

// The run list refreshes on its own timer; give it time to pick up the final
// contract verdict, then reload so the frame shows a consistent state.
async function openFinished(page, hash) {
  await page.waitForTimeout(4_000)
  await open(page, hash)
  await page.reload()
  await settle(page, 2_000)
}

// Scrolls the detail panel so the section with this heading is at the top.
async function scrollToHeading(page, text) {
  const heading = page.locator('h3', { hasText: text }).first()
  if ((await heading.count()) === 0) {
    log(`heading not found: ${text}`)
    return
  }
  await heading.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(800)
}

try {
  runtime = await startStorefrontRuntime({ log })

  browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    recordVideo: { dir: outDir, size: VIEWPORT },
  })
  const page = await context.newPage()

  await page.goto(runtime.appUrl)
  await settle(page, 600)
  await shot(page, 'target-app', 'The app under test: examples/storefront')

  await open(page, 'overview')
  await shot(page, 'overview-empty', 'Fresh install: the dashboard generated for examples/storefront')

  await open(page, 'personas')
  await shot(page, 'personas', 'Personas and capabilities discovered from the repository')

  const healthyId = await runtime.startScenario('place_order')
  await open(page, `agentic-runs?selectedId=${healthyId}`)
  await page.waitForTimeout(1_500)
  await shot(page, 'run-in-progress', 'place_order running: the agent drives the real app in Chromium')

  const healthy = await runtime.waitForSession(healthyId)
  log(`healthy run: ${describeSession(healthy)}`)
  await openFinished(page, `agentic-runs?tab=history&selectedId=${healthyId}`)
  await shot(page, 'run-passed', `Healthy app: ${healthy.contractEvaluation?.verdict ?? healthy.status}`)
  await scrollToHeading(page, 'Spec vs actual run')
  await shot(page, 'run-passed-steps', 'Spec vs actual: every contract step matched')
  await scrollToHeading(page, 'Screenshots')
  await shot(page, 'run-passed-screenshots', 'Screenshots the agent took in the real browser')

  runtime.breakApp()
  log('injected a regression: success feedback removed from the storefront')
  const brokenId = await runtime.startScenario('place_order')
  const broken = await runtime.waitForSession(brokenId)
  log(`broken run: ${describeSession(broken)}`)
  await openFinished(page, `agentic-runs?tab=history&selectedId=${brokenId}`)
  await shot(page, 'run-failed', `Regression injected: ${broken.contractEvaluation?.verdict ?? broken.status}`)
  await scrollToHeading(page, 'Spec vs actual run')
  await shot(page, 'run-failed-evidence', 'Spec vs actual: the order confirmation step failed')

  await open(page, 'overview')
  await shot(page, 'overview-after', 'Overview after one passing and one failing run')

  await open(page, 'insights')
  await shot(page, 'insights', 'Insights: failure patterns and improvement proposals')

  await open(page, 'code-graph')
  await page.waitForTimeout(1_500)
  await shot(page, 'code-graph', 'Code graph of the target repository')

  const video = page.video()
  await context.close()
  if (video) fs.renameSync(await video.path(), path.join(outDir, 'session.webm'))

  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    `${JSON.stringify({ viewport: VIEWPORT, healthy: describeSession(healthy), broken: describeSession(broken), frames }, null, 2)}\n`,
  )
  log(`PASS: ${frames.length} frames in ${path.relative(repoRoot, framesDir)}`)
} catch (error) {
  exitCode = 1
  console.error(`[demo-capture] FAIL: ${error instanceof Error ? error.stack : String(error)}`)
} finally {
  await browser?.close().catch(() => {})
  await runtime?.stop()
}
process.exit(exitCode)

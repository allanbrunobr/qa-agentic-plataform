import process from 'node:process'
import { loadScenario } from '../scenarios/index.js'
import { createPhase2Runtime } from '../services/runtime-bootstrap.js'
import { loadRuntimeSettings } from '../../services/runtime-settings.js'
import { validateProviderCredentials } from '../providers/provider-factory.js'

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== '--')
  const scenarioId = args[0] ?? 'first_order'
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3012'
  const uniqueSuffix = Date.now().toString().slice(-6)
  const customerName = process.env.PHASE2_CUSTOMER_NAME ?? `Phase 2 Customer ${uniqueSuffix}`
  const runtimeSettings = loadRuntimeSettings()

  const providerValidation = await validateProviderCredentials(runtimeSettings.provider)
  if (!providerValidation.ok) {
    throw new Error(`Configured provider "${runtimeSettings.provider}" is not ready: ${providerValidation.message}`)
  }

  await assertBaseUrlReachable(baseUrl)

  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' })
  const page = await browser.newPage({ baseURL: baseUrl })

  try {
    const scenario = loadScenario(scenarioId)
    const { orchestrator, dbPath, providerName, providerModel } = createPhase2Runtime({ providerName: runtimeSettings.provider })
    const result = await orchestrator.executeRun(scenario, {
      page,
      customerName,
      customerPhone: process.env.PHASE2_CUSTOMER_PHONE ?? '5550100',
      orderType: process.env.PHASE2_ORDER_TYPE ?? 'standard',
    })

    console.log(JSON.stringify({
      scenarioId,
      baseUrl,
      customerName,
      dbPath,
      providerName,
      providerModel,
      sessionId: result.sessionId,
      status: result.status,
      stepsCompleted: result.stepsCompleted,
      totalSteps: result.totalSteps,
      durationMs: result.durationMs,
      error: result.error ?? null,
    }, null, 2))

    if (result.status !== 'complete') {
      process.exitCode = 1
    }
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

async function assertBaseUrlReachable(baseUrl: string): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(baseUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    })

    if (!response.ok && response.status !== 302 && response.status !== 307) {
      throw new Error(`Target app responded with status ${response.status}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Cannot reach PLAYWRIGHT_BASE_URL (${baseUrl}): ${message}`)
  } finally {
    clearTimeout(timeout)
  }
}

void main().catch((error) => {
  console.error('[phase2] live run failed')
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

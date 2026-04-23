import process from 'node:process'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { dump } from 'js-yaml'
import { listScenarios, loadScenario } from '../scenarios/index.js'
import { buildScenarioQualityGateForSessions } from '../services/scenario-quality-gates.js'
import { createPhase2Runtime } from '../services/runtime-bootstrap.js'
import {
  isGeneratedNonFrontendRuntime,
  resolveGeneratedTargetRepoPath,
} from '../services/generated-adapter-runtime.js'
import { getSessionService } from './sessions.js'
import { loadRuntimeSettings } from '../../services/runtime-settings.js'
import { validateProviderCredentials } from '../providers/provider-factory.js'

const StartAgenticRunBody = z.object({
  scenario_id: z.string(),
  customer_name: z.string().optional(),
  customer_phone: z.string().optional(),
  order_type: z.string().optional(),
})

export async function phase2RunnerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/p2/scenarios', async (_request, reply) => {
    const sessions = getSessionService().getAllSessions()
    const scenarios = listScenarios().map((scenarioId) => {
      const scenario = loadScenario(scenarioId)
      const gate = buildScenarioQualityGateForSessions(scenario.id, sessions)
      return {
        id: scenario.id,
        name: scenario.name,
        description: scenario.description ?? null,
        roles: scenario.roles,
        step_count: scenario.steps.length,
        quality_gate: gate,
      }
    })

    return reply.send(scenarios)
  })

  app.get('/api/p2/scenarios/:scenarioId/workflow-contract', async (request, reply) => {
    const params = z.object({ scenarioId: z.string() }).safeParse(request.params)
    if (!params.success) {
      return reply.status(400).send({
        error: 'invalid_params',
        details: params.error.flatten(),
      })
    }

    const scenario = loadScenario(params.data.scenarioId)
    if (!scenario.workflowContract) {
      return reply.status(404).send({
        error: 'workflow_contract_not_found',
        scenario_id: scenario.id,
      })
    }

    const yaml = dump(scenario.workflowContract, {
      noRefs: true,
      lineWidth: 120,
      quotingType: "'",
    })

    return reply.send({
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      workflow_contract: scenario.workflowContract,
      workflow_contract_yaml: yaml,
    })
  })

  app.post('/api/p2/runs', async (request, reply) => {
    const parsed = StartAgenticRunBody.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_body',
        details: parsed.error.flatten(),
      })
    }

    const useDeterministicRuntime = isGeneratedNonFrontendRuntime()
    const runtimeSettings = useDeterministicRuntime ? null : loadRuntimeSettings()

    if (runtimeSettings) {
      const providerValidation = await validateProviderCredentials(runtimeSettings.provider)
      if (!providerValidation.ok) {
        return reply.status(503).send({
          error: 'invalid_runtime_provider_configuration',
          provider: runtimeSettings.provider,
          message: `The configured ${runtimeSettings.provider} provider is not ready for the local .agentic-qa runtime.`,
          details: providerValidation,
        })
      }
    }

    const scenario = loadScenario(parsed.data.scenario_id)
    const gate = buildScenarioQualityGateForSessions(scenario.id, getSessionService().getAllSessions())
    if (gate.status === 'restricted') {
      return reply.status(409).send({
        error: 'scenario_restricted_by_quality_gate',
        message: gate.reason,
        scenario_id: scenario.id,
        quality_gate: gate,
      })
    }

    const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3012'
    const uniqueSuffix = Date.now().toString().slice(-6)
    const customerName = parsed.data.customer_name ?? `Maria Agentic ${uniqueSuffix}`

    const runtime = useDeterministicRuntime
      ? createPhase2Runtime({ deterministic: true })
      : createPhase2Runtime({ providerName: runtimeSettings!.provider })
    const session = runtime.sessionService.createSession(scenario.id)

    void (async () => {
      let browser: { close(): Promise<void>; newPage(options: { baseURL: string }): Promise<{ close(): Promise<void> }> } | null = null
      let page: { close(): Promise<void> } | null = null

      try {
        if (useDeterministicRuntime) {
          await runtime.orchestrator.executeRunInSession(session.id, scenario, {
            targetRepoPath: resolveGeneratedTargetRepoPath(),
            runtimeMode: 'generated_non_browser',
          })
          return
        }

        const { chromium } = await import('@playwright/test')
        browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' })
        page = await browser.newPage({ baseURL: baseUrl })

        await runtime.orchestrator.executeRunInSession(session.id, scenario, {
          page,
          customerName,
          customerPhone: parsed.data.customer_phone ?? '11999990000',
          orderType: parsed.data.order_type ?? 'Primeira Pedido',
        })
      } catch (error) {
        runtime.sessionService.updateStatus(session.id, 'failed')
        runtime.sessionService.addEvent(session.id, 'run_failed', {
          scenarioId: scenario.id,
          error: error instanceof Error ? error.message : String(error),
        })
      } finally {
        await page?.close().catch(() => {})
        await browser?.close().catch(() => {})
      }
    })()

    return reply.status(202).send({
      session_id: session.id,
      scenario_id: scenario.id,
      status: 'pending',
      started_at: session.startedAt,
    })
  })
}

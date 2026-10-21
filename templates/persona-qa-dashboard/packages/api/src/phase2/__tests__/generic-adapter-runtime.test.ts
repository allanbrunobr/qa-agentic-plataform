import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDeterministicProvider } from '../providers/deterministic-provider.js'
import { listProfiles } from '../profiles/agent-profiles.js'
import { ToolRegistry } from '../services/tool-registry.js'
import { registerGeneratedAdapterTools } from '../tools/generated-adapter-tools.js'

const ORIGINAL_ENV = {
  AGENTIC_QA_REPOSITORY_KIND: process.env.AGENTIC_QA_REPOSITORY_KIND,
  AGENTIC_QA_TARGET_REPO: process.env.AGENTIC_QA_TARGET_REPO,
  PERSONA_QA_DISCOVERY_REPORT_FILE: process.env.PERSONA_QA_DISCOVERY_REPORT_FILE,
  PERSONA_QA_PERSONAS_FILE: process.env.PERSONA_QA_PERSONAS_FILE,
}

describe('generic generated adapter runtime', () => {
  afterEach(() => {
    restoreEnv('AGENTIC_QA_REPOSITORY_KIND', ORIGINAL_ENV.AGENTIC_QA_REPOSITORY_KIND)
    restoreEnv('AGENTIC_QA_TARGET_REPO', ORIGINAL_ENV.AGENTIC_QA_TARGET_REPO)
    restoreEnv('PERSONA_QA_DISCOVERY_REPORT_FILE', ORIGINAL_ENV.PERSONA_QA_DISCOVERY_REPORT_FILE)
    restoreEnv('PERSONA_QA_PERSONAS_FILE', ORIGINAL_ENV.PERSONA_QA_PERSONAS_FILE)
  })

  it('selects the generated deterministic tool from the scenario step id', async () => {
    const provider = createDeterministicProvider()
    const response = await provider.chat([{
      role: 'user',
      content: JSON.stringify({
        scenarioStep: 'call_health_endpoint',
        producedArtifacts: ['apiResponse'],
      }),
    }], [
      { name: 'startApiService', description: 'start', inputSchema: {} },
      { name: 'callHealthEndpoint', description: 'health', inputSchema: {} },
    ])

    expect(response.stopReason).toBe('tool_use')
    expect(response.toolCalls[0]).toEqual(expect.objectContaining({
      name: 'callHealthEndpoint',
      input: { path: '/health' },
    }))
  })

  it('prefers the exact capability tool name when the scenario step id matches a generated capability', async () => {
    const provider = createDeterministicProvider()
    const response = await provider.chat([{
      role: 'user',
      content: JSON.stringify({
        scenarioStep: 'click_iniciar_pedido',
        producedArtifacts: ['commandResult'],
      }),
    }], [
      { name: 'click_iniciar_pedido', description: 'start fulfillment', inputSchema: {} },
      { name: 'click_copiar_intake', description: 'copy history', inputSchema: {} },
    ])

    expect(response.stopReason).toBe('tool_use')
    expect(response.toolCalls[0]).toEqual(expect.objectContaining({
      name: 'click_iniciar_pedido',
    }))
  })

  it('disables browser evidence requirements for non-frontend generated personas', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'generic-agent-profile-'))
    const personasFile = path.join(fixtureRoot, 'personas.generated.json')
    const reportFile = path.join(fixtureRoot, 'discovery-report.generated.json')

    await writeFile(personasFile, JSON.stringify([{
      id: 'api_consumer',
      title: 'API Consumer',
      allowedCapabilities: ['startApiService', 'callHealthEndpoint', 'verifyApiResponse'],
    }]))
    await writeFile(reportFile, JSON.stringify({
      repository: { kind: 'backend_api' },
    }))

    process.env.PERSONA_QA_PERSONAS_FILE = personasFile
    process.env.PERSONA_QA_DISCOVERY_REPORT_FILE = reportFile
    delete process.env.AGENTIC_QA_REPOSITORY_KIND

    const profile = listProfiles().find((item) => item.role === 'api_consumer')
    expect(profile?.toolPolicy.browserAccess).toBe(false)
    expect(profile?.toolPolicy.api).toBe(true)
    expect(profile?.evidencePolicy.requireScreenshotForFinding).toBe(false)
  })

  it('registers deterministic repository tools that produce expected artifacts', async () => {
    const targetRepo = await mkdtemp(path.join(tmpdir(), 'generic-repo-tool-'))
    await writeFile(path.join(targetRepo, 'package.json'), JSON.stringify({
      name: 'generic-repo-tool-fixture',
      scripts: {
        test: 'node --test',
      },
    }))
    process.env.AGENTIC_QA_TARGET_REPO = targetRepo
    process.env.AGENTIC_QA_REPOSITORY_KIND = 'unknown'

    const registry = new ToolRegistry()
    registerGeneratedAdapterTools(registry)
    const result = await registry.execute('identifyTestEntrypoints', {}, { browserAccess: false })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.output).toEqual(expect.objectContaining({
        testEntrypoints: expect.objectContaining({
          hasEntrypoint: true,
          scripts: { test: 'node --test' },
        }),
      }))
    }
  })

  it('registers generated frontend tools that can drive a browser page context', async () => {
    const registry = new ToolRegistry()
    registerGeneratedAdapterTools(registry)
    const page = createFakePage()
    const policy = {
      browserAccess: true,
      allowedTools: ['openPrimaryRoute', 'fillCustomerEmail', 'addCartItem', 'submitOrder', 'verifyPrimaryFeedback'],
    }

    const openResult = await registry.execute('openPrimaryRoute', {}, policy, { page })
    const fillResult = await registry.execute('fillCustomerEmail', {}, policy, { page })
    const cartResult = await registry.execute('addCartItem', {}, policy, { page })
    const submitResult = await registry.execute('submitOrder', {}, policy, { page })
    const verifyResult = await registry.execute('verifyPrimaryFeedback', {}, policy, { page })

    expect(openResult.ok).toBe(true)
    expect(fillResult.ok).toBe(true)
    expect(cartResult.ok).toBe(true)
    expect(submitResult.ok).toBe(true)
    expect(verifyResult.ok).toBe(true)
    expect(page.filledEmail).toBe('agentic.qa@example.com')
    expect(page.clicks).toEqual(expect.arrayContaining(['Add item to cart', 'Submit order']))
    if (verifyResult.ok) {
      expect(verifyResult.output).toEqual(expect.objectContaining({
        primaryFeedbackVisible: true,
      }))
    }
    if (fillResult.ok) {
      expect(fillResult.output).toEqual(expect.objectContaining({
        commandResult: expect.objectContaining({
          action: 'fill',
          completed: true,
        }),
      }))
    }
    if (submitResult.ok) {
      expect(submitResult.output).toEqual(expect.objectContaining({
        commandResult: expect.objectContaining({
          action: 'click',
          completed: true,
        }),
      }))
    }
  })

  it('fails instead of clicking another control when the submit action is disabled', async () => {
    const registry = new ToolRegistry()
    registerGeneratedAdapterTools(registry)
    const page = createFakePage({ submitDisabled: true })
    const policy = { browserAccess: true, allowedTools: ['openPrimaryRoute', 'submitOrder', 'verifyPrimaryFeedback'] }

    await registry.execute('openPrimaryRoute', {}, policy, { page })
    const submitResult = await registry.execute('submitOrder', {}, policy, { page })
    const verifyResult = await registry.execute('verifyPrimaryFeedback', {}, policy, { page })

    expect(submitResult.ok).toBe(false)
    if (!submitResult.ok) expect(submitResult.error.message).toMatch(/could not be clicked/)
    expect(page.clicks).toEqual([])
    expect(verifyResult.ok).toBe(false)
    if (!verifyResult.ok) expect(verifyResult.error.code).toBe('verification_failed')
  }, 15_000)

  it('does not treat arbitrary page text as success feedback', async () => {
    const registry = new ToolRegistry()
    registerGeneratedAdapterTools(registry)
    const page = createFakePage({ feedbackText: 'Cart items: 0' })
    const policy = { browserAccess: true, allowedTools: ['submitOrder', 'verifyPrimaryFeedback'] }

    const submitResult = await registry.execute('submitOrder', {}, policy, { page })
    const verifyResult = await registry.execute('verifyPrimaryFeedback', {}, policy, { page })

    expect(submitResult.ok).toBe(true)
    expect(verifyResult.ok).toBe(false)
  }, 15_000)
})

function restoreEnv(key: keyof typeof ORIGINAL_ENV, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

function createFakePage(options: { submitDisabled?: boolean; feedbackText?: string } = {}) {
  const state = {
    currentUrl: 'about:blank',
    filledEmail: '',
    feedback: '',
    clicks: [] as string[],
    goto: async (url: string) => {
      state.currentUrl = url
    },
    url: () => state.currentUrl,
    getByLabel: () => locator({
      fill: async (value: string) => {
        state.filledEmail = value
      },
    }),
    getByPlaceholder: () => locator({
      fill: async (value: string) => {
        state.filledEmail = value
      },
    }),
    getByRole: (_role: string, roleOptions?: Record<string, unknown>) => {
      const name = roleOptions?.name instanceof RegExp
        ? roleOptions.name.test('Add item to cart')
          ? 'Add item to cart'
          : 'Submit order'
        : String(roleOptions?.name ?? 'button')
      return locator({
        text: name,
        click: async () => {
          if (name === 'Submit order' && options.submitDisabled) {
            throw new Error('locator.click: Timeout 3000ms exceeded. element is not enabled')
          }
          state.clicks.push(name)
          if (name === 'Submit order') state.feedback = options.feedbackText ?? 'Order submitted successfully'
        },
      })
    },
    getByText: (text: string | RegExp) => locator({
      text: typeof text === 'string' ? text : 'unused',
    }),
    locator: (selector: string) => {
      if (selector.includes(':text-matches(')) {
        const source = selector.match(/:text-matches\("((?:[^"\\]|\\.)*)"/)?.[1] ?? ''
        const pattern = new RegExp(source.replace(/\\\\/g, '\\'), 'i')
        const matches = state.feedback !== '' && pattern.test(state.feedback)
        return locator({ text: state.feedback, count: matches ? 1 : 0 })
      }
      return locator({
        text: selector,
        fill: async (value: string) => {
          state.filledEmail = value
        },
        click: async () => {
          state.clicks.push(selector)
        },
      })
    },
    screenshot: async () => new Uint8Array([1, 2, 3]),
  }

  return state
}

function locator(options: {
  text?: string
  count?: number
  fill?: (value: string) => Promise<void>
  click?: () => Promise<void>
}) {
  return {
    first: () => locator(options),
    count: async () => options.count ?? 1,
    isVisible: async () => (options.count ?? 1) > 0,
    textContent: async () => options.text ?? 'visible text',
    fill: options.fill,
    click: options.click,
  }
}

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
})

function restoreEnv(key: keyof typeof ORIGINAL_ENV, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

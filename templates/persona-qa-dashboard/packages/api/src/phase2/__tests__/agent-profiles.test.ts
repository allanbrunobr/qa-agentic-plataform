import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { getProfile, listProfiles } from '../profiles/agent-profiles.js'

const previousLegacyScenarioFlag = process.env['PERSONA_QA_USE_LEGACY_STATIC_SCENARIOS']

beforeAll(() => {
  process.env['PERSONA_QA_USE_LEGACY_STATIC_SCENARIOS'] = '1'
})

afterAll(() => {
  if (previousLegacyScenarioFlag === undefined) {
    delete process.env['PERSONA_QA_USE_LEGACY_STATIC_SCENARIOS']
  } else {
    process.env['PERSONA_QA_USE_LEGACY_STATIC_SCENARIOS'] = previousLegacyScenarioFlag
  }
})

describe('agent-profiles', () => {
  describe('getProfile — sales-associate', () => {
    it('returns profile with Claude Haiku model', () => {
      const p = getProfile('sales-associate')
      expect(p.model).toBe('claude-haiku-4-5-20251001')
    })

    it('has 90s timeout', () => {
      const p = getProfile('sales-associate')
      expect(p.timeoutMs).toBe(90_000)
    })

    it('has 2 retry attempts', () => {
      const p = getProfile('sales-associate')
      expect(p.retryPolicy.maxAttempts).toBe(2)
    })

    it('has browser access enabled', () => {
      const p = getProfile('sales-associate')
      expect(p.toolPolicy.browserAccess).toBe(true)
    })

    it('requires screenshot for finding', () => {
      const p = getProfile('sales-associate')
      expect(p.evidencePolicy.requireScreenshotForFinding).toBe(true)
    })

    it('cannot block run', () => {
      const p = getProfile('sales-associate')
      expect(p.canBlockRun).toBe(false)
    })
  })

  describe('getProfile — orchestrator', () => {
    it('returns profile with Claude Sonnet model', () => {
      const p = getProfile('orchestrator')
      expect(p.model).toBe('claude-sonnet-4-6')
    })

    it('has no browser access', () => {
      const p = getProfile('orchestrator')
      expect(p.toolPolicy.browserAccess).toBe(false)
    })

    it('can block run', () => {
      const p = getProfile('orchestrator')
      expect(p.canBlockRun).toBe(true)
    })

    it('has 120s timeout', () => {
      const p = getProfile('orchestrator')
      expect(p.timeoutMs).toBe(120_000)
    })
  })

  describe('getProfile — fulfillment-agent', () => {
    it('returns profile with Claude Sonnet model', () => {
      const p = getProfile('fulfillment-agent')
      expect(p.model).toBe('claude-sonnet-4-6')
    })

    it('has browser access enabled', () => {
      const p = getProfile('fulfillment-agent')
      expect(p.toolPolicy.browserAccess).toBe(true)
    })

    it('restricts tools to order-details workflow and evidence tools', () => {
      const p = getProfile('fulfillment-agent')
      expect(p.toolPolicy.allowedTools).toEqual([
        'openOrderDetails',
        'completeFulfillment',
      ])
    })

    it('has extended timeout for real registro flow', () => {
      const p = getProfile('fulfillment-agent')
      expect(p.timeoutMs).toBe(180_000)
    })

    it('uses generated runtime prompt identity without template agent files', () => {
      const p = getProfile('fulfillment-agent')
      expect(p.promptPath).toBeUndefined()
      expect(p.systemPrompt).toContain('fulfillment-agent')
    })
  })

  describe('getProfile — billing_clerk', () => {
    it('returns profile with browser access enabled', () => {
      const p = getProfile('billing_clerk')
      expect(p.toolPolicy.browserAccess).toBe(true)
    })

    it('restricts tools to the Billing review workflow', () => {
      const p = getProfile('billing_clerk')
      expect(p.toolPolicy.allowedTools).toEqual(['findBillingGuideByEventId'])
    })

    it('uses generated runtime prompt identity without template agent files', () => {
      const p = getProfile('billing_clerk')
      expect(p.promptPath).toBeUndefined()
      expect(p.systemPrompt).toContain('billing_clerk')
    })
  })

  describe('getProfile — store_manager', () => {
    it('returns profile with browser access enabled', () => {
      const p = getProfile('store_manager')
      expect(p.toolPolicy.browserAccess).toBe(true)
    })

    it('restricts tools to management validation workflow', () => {
      const p = getProfile('store_manager')
      expect(p.toolPolicy.allowedTools).toEqual(['verifyFinanceDashboard', 'verifyReportsPage'])
    })

    it('uses generated runtime prompt identity without template agent files', () => {
      const p = getProfile('store_manager')
      expect(p.promptPath).toBeUndefined()
      expect(p.systemPrompt).toContain('store_manager')
    })
  })

  describe('getProfile — unknown', () => {
    it('throws for unknown role', () => {
      expect(() => getProfile('unknown')).toThrow('Unknown agent profile')
    })
  })

  describe('listProfiles', () => {
    it('returns at least orchestrator, sales-associate, fulfillment-agent, billing_clerk, and store_manager', () => {
      const profiles = listProfiles()
      expect(profiles.length).toBeGreaterThanOrEqual(5)
      const roles = profiles.map((p) => p.role)
      expect(roles).toContain('orchestrator')
      expect(roles).toContain('sales-associate')
      expect(roles).toContain('fulfillment-agent')
      expect(roles).toContain('billing_clerk')
      expect(roles).toContain('store_manager')
    })
  })
})

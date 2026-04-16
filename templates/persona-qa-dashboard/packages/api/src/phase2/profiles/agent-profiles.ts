import type { AgentProfile, AgentRole } from '../types/agent-types.js'

const profiles: Record<string, AgentProfile> = {
  orchestrator: {
    role: 'orchestrator',
    model: 'claude-sonnet-4-6',
    timeoutMs: 120_000,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    toolPolicy: {
      browserAccess: false,
      deniedTools: ['captureScreenshot', 'collectDomSnippet'],
    },
    evidencePolicy: {
      requireScreenshotForFinding: false,
      requireDomSnippetForFinding: false,
    },
    canBlockRun: true,
    promptPath: 'persona-qa-dashboard/agents/orchestrator.md',
  },
  sales-associate: {
    role: 'sales-associate',
    model: 'claude-haiku-4-5-20251001',
    timeoutMs: 90_000,
    retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
    toolPolicy: {
      browserAccess: true,
    },
    evidencePolicy: {
      requireScreenshotForFinding: true,
      requireDomSnippetForFinding: false,
    },
    canBlockRun: false,
    promptPath: 'persona-qa-dashboard/agents/agent-sales-associate.md',
  },
  fulfillment-agent: {
    role: 'fulfillment-agent',
    model: 'claude-sonnet-4-6',
    timeoutMs: 180_000,
    retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
    toolPolicy: {
      browserAccess: true,
      allowedTools: ['openOrderDetails', 'completeFulfillment'],
    },
    evidencePolicy: {
      requireScreenshotForFinding: true,
      requireDomSnippetForFinding: false,
    },
    canBlockRun: false,
    promptPath: 'persona-qa-dashboard/agents/agent-fulfillment-agent.md',
  },
  billing_clerk: {
    role: 'billing_clerk',
    model: 'claude-sonnet-4-6',
    timeoutMs: 120_000,
    retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
    toolPolicy: {
      browserAccess: true,
      allowedTools: ['findBillingGuideByEventId'],
    },
    evidencePolicy: {
      requireScreenshotForFinding: true,
      requireDomSnippetForFinding: false,
    },
    canBlockRun: false,
    promptPath: 'persona-qa-dashboard/agents/agent-billing-clerk.md',
  },
  store_manager: {
    role: 'store_manager',
    model: 'claude-sonnet-4-6',
    timeoutMs: 120_000,
    retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
    toolPolicy: {
      browserAccess: true,
      allowedTools: ['verifyFinanceDashboard', 'verifyReportsPage'],
    },
    evidencePolicy: {
      requireScreenshotForFinding: true,
      requireDomSnippetForFinding: false,
    },
    canBlockRun: false,
    promptPath: 'persona-qa-dashboard/agents/agent-gestor.md',
  },
}

export function getProfile(role: AgentRole | string): AgentProfile {
  const profile = profiles[role]
  if (!profile) {
    throw new Error(`Unknown agent profile: "${role}". Available: ${Object.keys(profiles).join(', ')}`)
  }
  return profile
}

export function listProfiles(): AgentProfile[] {
  return Object.values(profiles)
}

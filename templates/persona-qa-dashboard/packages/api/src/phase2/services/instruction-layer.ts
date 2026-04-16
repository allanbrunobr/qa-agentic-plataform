import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ScenarioStep } from '../types/scenario-types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DASHBOARD_ROOT = path.resolve(__dirname, '../../..')
const DEFAULT_INSTRUCTION_PATH = path.join(DASHBOARD_ROOT, 'AGENTIC.md')

let cachedInstructionText: string | null | undefined

export function getGlobalAgenticInstructions(): string | undefined {
  if (cachedInstructionText !== undefined) {
    return cachedInstructionText ?? undefined
  }

  if (!fs.existsSync(DEFAULT_INSTRUCTION_PATH)) {
    cachedInstructionText = null
    return undefined
  }

  cachedInstructionText = fs.readFileSync(DEFAULT_INSTRUCTION_PATH, 'utf8').trim()
  return cachedInstructionText ?? undefined
}

export function buildStepInstructionEnvelope(
  step: ScenarioStep,
  availableArtifacts: Record<string, unknown>,
): string[] {
  return [
    `Current step: ${step.id}`,
    `Responsible agent: ${step.agentId}`,
    `Expected capability: ${step.capabilityId ?? 'not_declared'}`,
    `Required artifacts: ${step.requiredArtifacts.join(', ') || 'none'}`,
    `Produced artifacts: ${step.producedArtifacts.join(', ') || 'none'}`,
    `Available artifacts: ${Object.keys(availableArtifacts).join(', ') || 'none'}`,
    'Execute only this step and keep the workflow contract ordering intact.',
    'Do not report success unless the required artifacts for this step were actually produced.',
    'If a required page, route, credential, or artifact is missing, fail explicitly instead of improvising.',
  ]
}

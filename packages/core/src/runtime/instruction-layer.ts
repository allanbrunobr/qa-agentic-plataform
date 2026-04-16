import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AdapterScenarioStepModel } from '../../../host-sdk/src/adapter-model.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PLATFORM_ROOT = path.resolve(__dirname, '../../../../')
const DEFAULT_INSTRUCTION_PATH = path.join(PLATFORM_ROOT, 'AGENTIC.md')

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
  stepId: string,
  stepDefinition: AdapterScenarioStepModel | undefined,
  producedArtifacts: Record<string, unknown>,
): string[] {
  return [
    `Current step: ${stepId}`,
    `Responsible role: ${stepDefinition?.roleId ?? 'unknown'}`,
    `Expected capability: ${stepDefinition?.capabilityId ?? 'unknown'}`,
    `Expected produced artifacts: ${(stepDefinition?.producesArtifacts ?? []).join(', ') || 'none'}`,
    `Currently available artifacts: ${Object.keys(producedArtifacts).join(', ') || 'none'}`,
    'Execute only the current step and preserve scenario order.',
    'Do not report success unless the step produced the expected artifacts.',
    'Fail explicitly if the required capability, route, auth, or artifact path is unavailable.',
  ]
}

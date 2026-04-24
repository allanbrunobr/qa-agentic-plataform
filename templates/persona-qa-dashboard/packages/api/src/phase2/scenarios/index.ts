import fs from 'node:fs'
import path from 'node:path'
import { ScenarioContractSchema, type ScenarioContract } from '../types/scenario-types.js'
import { firstOrder } from './first-order.js'
import { firstOrderMultiRole } from './first-order-multi-role.js'
import { quarterlyReorderMultiRole } from './quarterly-reorder-multi-role.js'
import { quarterlyReorderClosureMultiRole } from './quarterly-reorder-closure-multi-role.js'

interface AdapterScenarioStepModel {
  id: string
  roleId: string
  capabilityId: string
  producesArtifacts?: string[]
}

interface AdapterScenarioModel {
  id: string
  title: string
  roles: string[]
  steps: string[]
  expectedArtifacts?: string[]
  stepDefinitions?: AdapterScenarioStepModel[]
}

const LEGACY_SCENARIOS: Record<string, ScenarioContract> = {
  first_order: firstOrder,
  first_order_multi_role: firstOrderMultiRole,
  quarterly_reorder_multi_role: quarterlyReorderMultiRole,
  quarterly_reorder_closure_multi_role: quarterlyReorderClosureMultiRole,
}

function legacyScenariosEnabled(): boolean {
  return process.env['PERSONA_QA_USE_LEGACY_STATIC_SCENARIOS'] === '1'
}

function getGeneratedScenariosCandidates(): string[] {
  return [
    process.env['PERSONA_QA_SCENARIOS_FILE'],
    path.resolve(process.cwd(), 'adapter', 'scenarios', 'scenarios.generated.json'),
    path.resolve(process.cwd(), '..', '..', 'adapter', 'scenarios', 'scenarios.generated.json'),
  ].filter((candidate): candidate is string => Boolean(candidate))
}

function getPromotedScenariosCandidates(): string[] {
  const generated = process.env['PERSONA_QA_SCENARIOS_FILE']
  return [
    process.env['PERSONA_QA_PROMOTED_SCENARIOS_FILE'],
    generated ? path.join(path.dirname(path.resolve(generated)), 'scenarios.promoted.json') : undefined,
    path.resolve(process.cwd(), 'adapter', 'scenarios', 'scenarios.promoted.json'),
    path.resolve(process.cwd(), '..', '..', 'adapter', 'scenarios', 'scenarios.promoted.json'),
  ].filter((candidate): candidate is string => Boolean(candidate))
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function readScenarioModels(candidates: string[]): AdapterScenarioModel[] {
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue

    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as unknown
      if (!Array.isArray(parsed)) return []

      return parsed.filter((scenario): scenario is AdapterScenarioModel => {
        return (
          typeof scenario === 'object'
          && scenario !== null
          && typeof (scenario as AdapterScenarioModel).id === 'string'
          && typeof (scenario as AdapterScenarioModel).title === 'string'
          && Array.isArray((scenario as AdapterScenarioModel).roles)
          && Array.isArray((scenario as AdapterScenarioModel).steps)
        )
      })
    } catch {
      return []
    }
  }

  return []
}

function readGeneratedScenarioModels(): AdapterScenarioModel[] {
  return readScenarioModels(getGeneratedScenariosCandidates())
}

function readPromotedScenarioModels(): AdapterScenarioModel[] {
  return readScenarioModels(getPromotedScenariosCandidates())
}

function scenarioStepDefinitions(model: AdapterScenarioModel): AdapterScenarioStepModel[] {
  if (model.stepDefinitions?.length) return model.stepDefinitions

  const fallbackRole = model.roles[0] ?? 'generated_role'
  return model.steps.map((stepId) => ({
    id: stepId,
    roleId: fallbackRole,
    capabilityId: stepId,
    producesArtifacts: [],
  }))
}

function toScenarioContract(model: AdapterScenarioModel): ScenarioContract {
  const stepDefinitions = scenarioStepDefinitions(model)
  const steps = stepDefinitions.map((step, index) => ({
    id: step.id,
    name: humanize(step.id),
    description: `Generated adapter step ${step.id}.`,
    agentId: step.roleId,
    capabilityId: step.capabilityId,
    order: index,
    requiredArtifacts: [],
    producedArtifacts: step.producesArtifacts ?? [],
    timeoutMs: 120_000,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  }))

  return ScenarioContractSchema.parse({
    id: model.id,
    name: model.title,
    description: `Generated adapter scenario ${model.title}.`,
    steps,
    workflowContract: {
      version: '1.0',
      deterministic: true,
      steps: steps.map((step) => ({
        id: step.id,
        order: step.order,
        agentId: step.agentId,
        capabilityId: step.capabilityId ?? step.id,
        requiredArtifacts: step.requiredArtifacts,
        producedArtifacts: step.producedArtifacts,
        timeoutMs: step.timeoutMs,
        retryPolicy: step.retryPolicy,
      })),
    },
    roles: model.roles,
    requiredArtifacts: model.expectedArtifacts ?? unique(steps.flatMap((step) => step.producedArtifacts)),
    allowedTools: unique(steps.map((step) => step.capabilityId ?? step.id)),
  })
}

function generatedScenarioMap(): Record<string, ScenarioContract> {
  return Object.fromEntries([...readGeneratedScenarioModels(), ...readPromotedScenarioModels()].map((scenario) => {
    const contract = toScenarioContract(scenario)
    return [contract.id, contract]
  }))
}

export function loadScenario(scenarioId: string): ScenarioContract {
  const generated = generatedScenarioMap()
  const scenario = generated[scenarioId]
  if (scenario) return scenario

  if (legacyScenariosEnabled()) {
    const legacyScenario = LEGACY_SCENARIOS[scenarioId]
    if (legacyScenario) return ScenarioContractSchema.parse(legacyScenario)
  }

  const available = listScenarios()
  throw new Error(`Scenario "${scenarioId}" not found. Available: ${available.length ? available.join(', ') : 'none'}`)
}

export function listScenarios(): string[] {
  const generated = generatedScenarioMap()
  const generatedIds = Object.keys(generated)
  if (generatedIds.length > 0) return generatedIds

  return legacyScenariosEnabled() ? Object.keys(LEGACY_SCENARIOS) : []
}

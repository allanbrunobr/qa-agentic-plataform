import type { AdapterExecutionDraft, AdapterExecutionInit, AdapterModelBundle } from '../../../packages/host-sdk/src/adapter-model.ts'
import type { AdapterRuntimeHooks } from '../../../packages/host-sdk/src/runtime-hooks.ts'
import {
  referenceStoreGeneratedAuth,
  referenceStoreGeneratedCapabilities,
  referenceStoreGeneratedManifest,
  referenceStoreGeneratedPersonas,
  referenceStoreGeneratedRoutes,
  referenceStoreGeneratedScenarios,
} from './model/generated/index.generated.ts'
import { initializeReferenceStoreExecution, referenceStoreRuntimeHooks } from './index.ts'

export const referenceStoreGeneratedAdapterModel: AdapterModelBundle = {
  manifest: {
    ...referenceStoreGeneratedManifest,
    id: 'reference-store-generated',
    label: 'Reference Store Generated Draft',
  },
  auth: referenceStoreGeneratedAuth,
  routes: referenceStoreGeneratedRoutes,
  capabilities: referenceStoreGeneratedCapabilities,
  personas: referenceStoreGeneratedPersonas,
  scenarios: referenceStoreGeneratedScenarios,
}

export const referenceStoreGeneratedRuntimeHooks: AdapterRuntimeHooks = referenceStoreRuntimeHooks

export function initializeReferenceStoreGeneratedExecution(input: AdapterExecutionInit): AdapterExecutionDraft {
  const draft = initializeReferenceStoreExecution({
    ...input,
    adapterId: 'reference-store-generated',
  })

  const scenario = referenceStoreGeneratedAdapterModel.scenarios.find((item) => item.id === input.scenarioId)
  if (!scenario) throw new Error(`Unknown generated Reference Store scenario: ${input.scenarioId}`)

  return {
    ...draft,
    adapterId: 'reference-store-generated',
    personas: scenario.roles,
    steps: scenario.steps,
    notes: [
      `Host repo: ${input.repoPath}`,
      'Execution draft derived from generated Reference Store adapter files',
      `Expected artifacts: ${scenario.expectedArtifacts.join(', ')}`,
    ],
  }
}

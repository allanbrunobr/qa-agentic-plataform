import type { AdapterExecutionDraft, AdapterExecutionInit, AdapterModelBundle } from '../../../host-sdk/src/adapter-model.ts'
import type { AdapterRuntimeHooks } from '../../../host-sdk/src/runtime-hooks.ts'
import { referenceStoreAdapterModel, referenceStoreRuntimeHooks, initializeReferenceStoreExecution } from '../../../../adapters/reference-store/src/index.ts'
import {
  referenceStoreGeneratedAdapterModel,
  referenceStoreGeneratedRuntimeHooks,
  initializeReferenceStoreGeneratedExecution,
} from '../../../../adapters/reference-store/src/generated.ts'

const adapters: Record<string, { model: AdapterModelBundle; initialize: (input: AdapterExecutionInit) => AdapterExecutionDraft; runtimeHooks: AdapterRuntimeHooks }> = {
  'reference-store': {
    model: referenceStoreAdapterModel,
    initialize: initializeReferenceStoreExecution,
    runtimeHooks: referenceStoreRuntimeHooks,
  },
  'reference-store-generated': {
    model: referenceStoreGeneratedAdapterModel,
    initialize: initializeReferenceStoreGeneratedExecution,
    runtimeHooks: referenceStoreGeneratedRuntimeHooks,
  },
}

export function listAdapters() {
  return Object.values(adapters).map(({ model }) => ({
    id: model.manifest.id,
    label: model.manifest.label,
    framework: model.manifest.framework,
    status: model.manifest.status,
    scenarioCount: model.scenarios.length,
  }))
}

export function getAdapter(adapterId: string) {
  const adapter = adapters[adapterId]
  if (!adapter) throw new Error(`Unknown adapter: ${adapterId}`)
  return adapter
}

export function listAdapterScenarios(adapterId: string) {
  return getAdapter(adapterId).model.scenarios
}

export function initializeExecution(input: AdapterExecutionInit) {
  return getAdapter(input.adapterId).initialize(input)
}

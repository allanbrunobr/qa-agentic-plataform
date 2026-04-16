import path from 'node:path'
import {
  FileSessionStore,
  buildAdapterContractEvaluation,
  buildScenarioQualityGate,
  type AdapterContractEvaluation,
  type ScenarioEvaluationInput,
  type ScenarioQualityGate,
} from '../../../core/src/index.ts'
import { getAdapter, listAdapterScenarios } from './adapter-service.ts'
import { syncAdapterBundlePromotion } from './adapter-bundle-sync.ts'
import { listExecutionRecords } from './execution-store.ts'
import { getAdapterPromotionRecord, saveAdapterPromotionRecord } from './adapter-promotion-store.ts'

const sessionStore = new FileSessionStore({
  dataPath: path.resolve('/path/to/projects/agentic-platform/data/sessions.json'),
})

export type AdapterPromotionState = 'generated' | 'reviewed' | 'certified_candidate' | 'certified'

export interface AdapterPromotionSummary {
  promotionState: AdapterPromotionState
  promotionReason: string
  promotionUpdatedAt: string | null
  signals: {
    hasRestrictedScenarios: boolean
    hasReviewRequiredScenarios: boolean
    openScenarioCount: number
    totalScenarioCount: number
  }
}

export async function buildSessionGovernance(sessionId: string): Promise<{
  contractEvaluation: AdapterContractEvaluation | null
  executionId: string | null
  adapterId: string | null
} | null> {
  const sessions = await sessionStore.listSessions(1000)
  const session = sessions.find((item) => item.id === sessionId)
  if (!session) return null

  const executions = await listExecutionRecords(1000)
  const execution = executions.find((item) => item.sessionId === session.id) ?? null
  if (!execution) {
    return { contractEvaluation: null, executionId: null, adapterId: null }
  }

  const adapter = getAdapter(execution.adapterId)
  return {
    contractEvaluation: buildAdapterContractEvaluation(session, execution, adapter.model),
    executionId: execution.executionId,
    adapterId: execution.adapterId,
  }
}

async function buildScenarioEvaluationInputsForAdapter(adapterId: string): Promise<ScenarioEvaluationInput[]> {
  const executions = await listExecutionRecords(1000)
  const sessions = await sessionStore.listSessions(1000)
  const adapter = getAdapter(adapterId)

  return executions
    .filter((execution) => execution.adapterId === adapterId)
    .map((execution) => {
      const session = sessions.find((item) => item.id === execution.sessionId)
      if (!session) return null
      return {
        adapterId,
        scenarioId: execution.scenarioId,
        sessionStatus: session.status,
        startedAt: session.startedAt,
        contractEvaluation: buildAdapterContractEvaluation(session, execution, adapter.model),
      } satisfies ScenarioEvaluationInput
    })
    .filter((item): item is ScenarioEvaluationInput => item !== null)
}

export async function buildScenarioQualityGatesForAdapter(adapterId: string): Promise<Record<string, ScenarioQualityGate>> {
  const scenarioInputs = await buildScenarioEvaluationInputsForAdapter(adapterId)
  const scenarios = listAdapterScenarios(adapterId)

  return Object.fromEntries(
    scenarios.map((scenario) => [
      scenario.id,
      buildScenarioQualityGate(adapterId, scenario.id, scenarioInputs),
    ]),
  )
}

export async function buildAdapterPromotion(adapterId: string): Promise<AdapterPromotionSummary> {
  const adapter = getAdapter(adapterId)
  if (adapter.model.manifest.status === 'certified') {
    return {
      promotionState: 'certified',
      promotionReason: 'Adapter manifest is already certified.',
      promotionUpdatedAt: null,
      signals: {
        hasRestrictedScenarios: false,
        hasReviewRequiredScenarios: false,
        openScenarioCount: adapter.model.scenarios.length,
        totalScenarioCount: adapter.model.scenarios.length,
      },
    }
  }

  const gates = Object.values(await buildScenarioQualityGatesForAdapter(adapterId))
  const signals = {
    hasRestrictedScenarios: gates.some((gate) => gate.status === 'restricted'),
    hasReviewRequiredScenarios: gates.some((gate) => gate.status === 'review_required'),
    openScenarioCount: gates.filter((gate) => gate.status === 'open').length,
    totalScenarioCount: gates.length,
  }
  const persisted = await getAdapterPromotionRecord(adapterId)

  if (gates.length === 0) {
    return {
      promotionState: 'generated',
      promotionReason: 'No scenario governance data exists yet. Run the draft adapter first.',
      promotionUpdatedAt: persisted?.updatedAt ?? null,
      signals,
    }
  }

  if (signals.hasRestrictedScenarios) {
    return {
      promotionState: 'generated',
      promotionReason: 'Restricted scenarios prevent promotion. Stabilize the draft first.',
      promotionUpdatedAt: persisted?.updatedAt ?? null,
      signals,
    }
  }

  if (persisted?.state === 'certified') {
    return {
      promotionState: 'certified',
      promotionReason: persisted.reason,
      promotionUpdatedAt: persisted.updatedAt,
      signals,
    }
  }

  if (signals.hasReviewRequiredScenarios) {
    return {
      promotionState: persisted?.state === 'reviewed' ? 'reviewed' : 'generated',
      promotionReason: 'Recent signals require human review before certification.',
      promotionUpdatedAt: persisted?.updatedAt ?? null,
      signals,
    }
  }

  if (persisted?.state === 'reviewed') {
    return {
      promotionState: 'reviewed',
      promotionReason: persisted.reason,
      promotionUpdatedAt: persisted.updatedAt,
      signals,
    }
  }

  return {
    promotionState: 'certified_candidate',
    promotionReason: 'All known scenarios are open under current quality thresholds.',
    promotionUpdatedAt: persisted?.updatedAt ?? null,
    signals,
  }
}

export async function updateAdapterPromotion(
  adapterId: string,
  targetState: 'reviewed' | 'certified',
): Promise<AdapterPromotionSummary> {
  const adapter = getAdapter(adapterId)
  if (adapter.model.manifest.status === 'certified') {
    return buildAdapterPromotion(adapterId)
  }

  const current = await buildAdapterPromotion(adapterId)

  if (targetState === 'reviewed') {
    await saveAdapterPromotionRecord(adapterId, 'reviewed', 'Human review completed. Adapter marked as reviewed.')
    await syncAdapterBundlePromotion(adapterId, 'reviewed')
    return buildAdapterPromotion(adapterId)
  }

  if (current.signals.hasRestrictedScenarios || current.signals.hasReviewRequiredScenarios) {
    throw new Error('Adapter promotion blocked by scenario quality signals.')
  }

  await saveAdapterPromotionRecord(adapterId, 'certified', 'Adapter promoted manually after clean scenario signals.')
  await syncAdapterBundlePromotion(adapterId, 'certified')
  return buildAdapterPromotion(adapterId)
}

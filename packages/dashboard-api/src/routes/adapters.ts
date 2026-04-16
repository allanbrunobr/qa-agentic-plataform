import type { AdapterListResponse, ScenarioListResponse } from '../types/api.ts'
import { listAdapters, listAdapterScenarios } from '../services/adapter-service.ts'
import { buildAdapterPromotion, buildScenarioQualityGatesForAdapter } from '../services/governance-service.ts'

export async function handleAdaptersRequest(): Promise<AdapterListResponse> {
  const baseAdapters = listAdapters()
  const adapters = await Promise.all(
    baseAdapters.map(async (adapter) => {
      const promotion = await buildAdapterPromotion(adapter.id)
      return {
        ...adapter,
        status: promotion.promotionState === 'certified' ? 'certified' : adapter.status,
        promotionState: promotion.promotionState,
        promotionReason: promotion.promotionReason,
        promotionUpdatedAt: promotion.promotionUpdatedAt,
      }
    }),
  )
  return { adapters }
}

export async function handleAdapterScenariosRequest(adapterId: string): Promise<ScenarioListResponse> {
  const gates = await buildScenarioQualityGatesForAdapter(adapterId)
  return {
    adapterId,
    scenarios: listAdapterScenarios(adapterId).map((scenario) => ({
      ...scenario,
      qualityGate: gates[scenario.id],
    })),
  }
}

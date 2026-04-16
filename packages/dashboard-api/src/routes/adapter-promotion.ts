import type { AdapterPromotionResponse, UpdateAdapterPromotionRequest } from '../types/api.ts'
import { buildAdapterPromotion, updateAdapterPromotion } from '../services/governance-service.ts'

export async function handleAdapterPromotionRequest(adapterId: string): Promise<AdapterPromotionResponse> {
  const promotion = await buildAdapterPromotion(adapterId)
  return {
    adapterId,
    promotionState: promotion.promotionState,
    promotionReason: promotion.promotionReason,
    promotionUpdatedAt: promotion.promotionUpdatedAt,
    signals: promotion.signals,
  }
}

export async function handleAdapterPromotionUpdateRequest(
  adapterId: string,
  body: UpdateAdapterPromotionRequest,
): Promise<AdapterPromotionResponse> {
  const promotion = await updateAdapterPromotion(adapterId, body.targetState)
  return {
    adapterId,
    promotionState: promotion.promotionState,
    promotionReason: promotion.promotionReason,
    promotionUpdatedAt: promotion.promotionUpdatedAt,
    signals: promotion.signals,
  }
}

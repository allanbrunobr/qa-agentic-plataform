import type { DiscoveryRequest, DiscoveryResponse } from '../types/api.ts'
import { runDiscovery } from '../services/discovery-service.ts'

export async function handleDiscoveryRequest(body: DiscoveryRequest): Promise<DiscoveryResponse> {
  return runDiscovery(body)
}

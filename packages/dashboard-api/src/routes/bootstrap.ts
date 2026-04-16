import type { BootstrapRequest, BootstrapResponse } from '../types/api.ts'
import { runBootstrap } from '../services/discovery-service.ts'

export async function handleBootstrapRequest(body: BootstrapRequest): Promise<BootstrapResponse> {
  return runBootstrap(body)
}

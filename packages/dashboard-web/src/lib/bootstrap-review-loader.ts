import { handleBootstrapRequest } from '../../../dashboard-api/src/routes/bootstrap.ts'
import type { BootstrapRequest, BootstrapResponse } from '../../../dashboard-api/src/types/api.ts'

export async function loadBootstrapReview(input: BootstrapRequest): Promise<BootstrapResponse> {
  return handleBootstrapRequest(input)
}

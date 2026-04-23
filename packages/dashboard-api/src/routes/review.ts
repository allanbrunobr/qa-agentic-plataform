import type { BootstrapRequest } from '../types/api.ts'
import { renderBootstrapReviewDocument } from '../../../dashboard-web/src/pages/bootstrap-review.ts'

export interface ReviewResponse {
  adapterId: string
  report: Awaited<ReturnType<typeof renderBootstrapReviewDocument>>['viewModel']
  html: string
}

export async function handleReviewRequest(body: BootstrapRequest): Promise<ReviewResponse> {
  if (!body.repoPath) {
    throw new Error('repoPath is required')
  }

  const result = await renderBootstrapReviewDocument(body)

  return {
    adapterId: body.adapterHint ?? 'generic-repository-discovery',
    report: result.viewModel,
    html: result.html,
  }
}

import type { BootstrapRequest } from '../../../dashboard-api/src/types/api.ts'
import { loadBootstrapReview } from '../lib/bootstrap-review-loader.ts'
import { BootstrapReviewPage, renderBootstrapReviewHtml } from '../components/BootstrapReviewPage.ts'

export async function renderBootstrapReview(input: BootstrapRequest) {
  const response = await loadBootstrapReview(input)

  return BootstrapReviewPage({
    report: response.report,
    draft: response.draft,
  })
}

export async function renderBootstrapReviewDocument(input: BootstrapRequest) {
  const viewModel = await renderBootstrapReview(input)

  return {
    viewModel,
    html: renderBootstrapReviewHtml(viewModel),
  }
}

import { renderBootstrapReviewDocument } from '../../../dashboard-web/src/pages/bootstrap-review.ts'

export async function runReviewCommand(repoPath: string) {
  const result = await renderBootstrapReviewDocument({ repoPath })
  console.log(JSON.stringify(result.viewModel, null, 2))
}

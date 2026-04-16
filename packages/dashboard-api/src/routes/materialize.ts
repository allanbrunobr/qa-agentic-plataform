import type { MaterializeRequest, MaterializeResponse } from '../types/api.ts'
import { runBootstrap } from '../services/discovery-service.ts'
import { materializeAdapterDraft } from '../services/adapter-materializer.ts'

export async function handleMaterializeRequest(body: MaterializeRequest): Promise<MaterializeResponse> {
  const bootstrap = await runBootstrap(body)
  const materialized = await materializeAdapterDraft({
    repoPath: body.repoPath,
    report: bootstrap.report,
    draft: bootstrap.draft,
    targetAdapterId: body.targetAdapterId,
  })

  return {
    adapterId: bootstrap.adapterId,
    targetAdapterId: materialized.targetAdapterId,
    outputDir: materialized.outputDir,
    files: materialized.files,
    report: bootstrap.report,
    draft: bootstrap.draft,
  }
}

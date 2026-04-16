import type { DiscoverLocalRequest, DiscoverLocalResponse } from '../types/api.ts'
import { runBootstrap } from '../services/discovery-service.ts'
import { materializeLocalDiscovery } from '../services/local-discovery-materializer.ts'

export async function handleDiscoverLocalRequest(body: DiscoverLocalRequest): Promise<DiscoverLocalResponse> {
  const bootstrap = await runBootstrap(body)
  const local = await materializeLocalDiscovery({
    repoPath: body.repoPath,
    report: bootstrap.report,
    draft: bootstrap.draft,
  })

  return {
    adapterId: bootstrap.adapterId,
    report: local.report,
    draft: local.draft,
    localPackagePath: local.localPackagePath,
    adapterRoot: local.adapterRoot,
    files: local.files,
  }
}

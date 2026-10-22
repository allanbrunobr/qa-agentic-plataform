import { runBootstrap } from '../services/discovery-service.ts'
import { materializeLocalDiscovery } from '../services/local-discovery-materializer.ts'

export async function runDiscoverLocalCommand(args: string[]) {
  const repoPath = args[0]
  const adapterHint = args[1]
  if (!repoPath) {
    throw new Error('discover-local requires <repoPath> [adapterHint]')
  }

  const bootstrap = await runBootstrap({ repoPath, adapterHint })
  const local = await materializeLocalDiscovery({
    repoPath,
    report: bootstrap.report,
    draft: bootstrap.draft,
  })

  process.stdout.write(`${JSON.stringify({ ...bootstrap, ...local }, null, 2)}
`)
}

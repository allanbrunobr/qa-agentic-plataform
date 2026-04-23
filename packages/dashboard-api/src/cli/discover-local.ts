import { runBootstrap } from '../services/discovery-service.ts'
import { materializeLocalDiscovery } from '../services/local-discovery-materializer.ts'

export async function runDiscoverLocalCommand(args: string[]) {
  const repoPath = args[0]
  const adapterHint = args[1]
  if (!repoPath) {
    throw new Error('discover-local requires <repoPath> [adapterHint]')
  }

  const previousLegacyStoreFallback = process.env.AGENTIC_PLATFORM_ENABLE_LEGACY_STORE_FALLBACK
  if (adapterHint === 'reference-store') {
    process.env.AGENTIC_PLATFORM_ENABLE_LEGACY_STORE_FALLBACK = '1'
  }

  try {
    const bootstrap = await runBootstrap({ repoPath, adapterHint })
    const local = await materializeLocalDiscovery({
      repoPath,
      report: bootstrap.report,
      draft: bootstrap.draft,
    })

    process.stdout.write(`${JSON.stringify({ ...bootstrap, ...local }, null, 2)}
`)
  } finally {
    if (previousLegacyStoreFallback === undefined) {
      delete process.env.AGENTIC_PLATFORM_ENABLE_LEGACY_STORE_FALLBACK
    } else {
      process.env.AGENTIC_PLATFORM_ENABLE_LEGACY_STORE_FALLBACK = previousLegacyStoreFallback
    }
  }
}

import { runDiscovery } from '../services/discovery-service.ts'

export async function runDiscoverCommand(args: string[]) {
  const repoPath = args[0]
  const adapterHint = args[1]

  if (!repoPath) {
    throw new Error('discover requires <repoPath> [adapterHint]')
  }

  const result = await runDiscovery({ repoPath, adapterHint })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

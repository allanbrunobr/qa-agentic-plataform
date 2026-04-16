import type { HostProjectPointer } from '../../../host-sdk/src/contracts.ts'
import { ReferenceStoreDiscoveryProvider } from '../../../../adapters/reference-store/src/discovery.ts'

export async function runBootstrapCommand(args: string[]) {
  const repoPath = args[0]

  if (!repoPath) {
    throw new Error('bootstrap requires <repoPath>')
  }

  const pointer: HostProjectPointer = { repoPath }
  const provider = new ReferenceStoreDiscoveryProvider()
  const report = await provider.discover(pointer)
  const draft = await provider.synthesize(report)

  process.stdout.write(`${JSON.stringify({ report, draft }, null, 2)}\n`)
}

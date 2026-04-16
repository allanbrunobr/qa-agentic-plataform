import type { HostProjectPointer } from '../../../host-sdk/src/contracts.ts'
import { ReferenceStoreDiscoveryProvider } from '../../../../adapters/reference-store/src/discovery.ts'

export async function runDiscoverCommand(args: string[]) {
  const repoPath = args[0]

  if (!repoPath) {
    throw new Error('discover requires <repoPath>')
  }

  const pointer: HostProjectPointer = { repoPath }
  const provider = new ReferenceStoreDiscoveryProvider()
  const report = await provider.discover(pointer)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

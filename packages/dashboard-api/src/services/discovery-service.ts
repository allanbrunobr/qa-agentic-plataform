import { ReferenceStoreDiscoveryProvider } from '../../../../adapters/reference-store/src/discovery.ts'
import type { HostProjectPointer } from '../../../host-sdk/src/contracts.ts'
import type {
  BootstrapRequest,
  BootstrapResponse,
  DiscoveryRequest,
  DiscoveryResponse,
} from '../types/api.ts'

function resolveProvider(adapterHint?: string) {
  if (!adapterHint || adapterHint === 'reference-store') {
    return new ReferenceStoreDiscoveryProvider()
  }

  throw new Error(`Unknown adapter hint: ${adapterHint}`)
}

export async function runDiscovery(input: DiscoveryRequest): Promise<DiscoveryResponse> {
  if (!input.repoPath) {
    throw new Error('repoPath is required')
  }

  const provider = resolveProvider(input.adapterHint)
  const pointer: HostProjectPointer = { repoPath: input.repoPath }
  const report = await provider.discover(pointer)

  return {
    adapterId: provider.id,
    report,
  }
}

export async function runBootstrap(input: BootstrapRequest): Promise<BootstrapResponse> {
  if (!input.repoPath) {
    throw new Error('repoPath is required')
  }

  const provider = resolveProvider(input.adapterHint)
  const pointer: HostProjectPointer = { repoPath: input.repoPath }
  const report = await provider.discover(pointer)
  const draft = await provider.synthesize(report)

  return {
    adapterId: provider.id,
    report,
    draft,
  }
}

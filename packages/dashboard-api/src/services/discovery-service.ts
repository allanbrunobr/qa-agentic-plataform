import { ReferenceStoreDiscoveryProvider } from '../../../../adapters/reference-store/src/discovery.ts'
import type { HostProjectPointer } from '../../../host-sdk/src/contracts.ts'
import { GenericFrontendDiscoveryProvider } from './generic-discovery-provider.ts'
import type {
  BootstrapRequest,
  BootstrapResponse,
  DiscoveryRequest,
  DiscoveryResponse,
} from '../types/api.ts'

async function pathExists(path: string): Promise<boolean> {
  try {
    const { access } = await import('node:fs/promises')
    await access(path)
    return true
  } catch {
    return false
  }
}

async function isReferenceStoreRepo(repoPath: string): Promise<boolean> {
  return (
    await pathExists(`${repoPath}/apps/webapp/src/modules/customers`)
    && await pathExists(`${repoPath}/apps/webapp/src/modules/schedule`)
  )
}

async function resolveProvider(repoPath: string, adapterHint?: string) {
  if (adapterHint === 'auto') {
    return await isReferenceStoreRepo(repoPath)
      ? new ReferenceStoreDiscoveryProvider()
      : new GenericFrontendDiscoveryProvider()
  }

  if (adapterHint === 'generic' || adapterHint === 'frontend') {
    return new GenericFrontendDiscoveryProvider()
  }

  if (!adapterHint || adapterHint === 'reference-store') {
    return new ReferenceStoreDiscoveryProvider()
  }

  throw new Error(`Unknown adapter hint: ${adapterHint}`)
}

export async function runDiscovery(input: DiscoveryRequest): Promise<DiscoveryResponse> {
  if (!input.repoPath) {
    throw new Error('repoPath is required')
  }

  const provider = await resolveProvider(input.repoPath, input.adapterHint)
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

  const provider = await resolveProvider(input.repoPath, input.adapterHint)
  const pointer: HostProjectPointer = { repoPath: input.repoPath }
  const report = await provider.discover(pointer)
  const draft = await provider.synthesize(report)

  return {
    adapterId: provider.id,
    report,
    draft,
  }
}

import type { InstallLocalRequest, InstallLocalResponse } from '../types/api.ts'
import { installLocalPackage } from '../services/local-package-installer.ts'

export async function handleInstallLocalRequest(body: InstallLocalRequest): Promise<InstallLocalResponse> {
  return installLocalPackage(body)
}

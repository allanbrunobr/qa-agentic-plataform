import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ADAPTERS_ROOT } from '../config/platform-paths.ts'

const generatedManifestPath = path.join(
  ADAPTERS_ROOT,
  'reference-store/src/model/generated/manifest.generated.ts',
)

export async function syncAdapterBundlePromotion(
  adapterId: string,
  targetState: 'generated' | 'reviewed' | 'certified',
): Promise<void> {
  if (adapterId !== 'reference-store-generated') return

  const raw = await fs.readFile(generatedManifestPath, 'utf8')
  const nextStatus = targetState === 'certified' ? 'certified' : 'draft'
  const updated = raw.replace(/"status":\s*"(draft|certified)"/, `"status": "${nextStatus}"`)
  await fs.writeFile(generatedManifestPath, updated, 'utf8')
}

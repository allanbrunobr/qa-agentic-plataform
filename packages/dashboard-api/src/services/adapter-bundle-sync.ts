import { promises as fs } from 'node:fs'
import path from 'node:path'

const generatedManifestPath = path.resolve(
  '/path/to/projects/agentic-platform/adapters/reference-store/src/model/generated/manifest.generated.ts',
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

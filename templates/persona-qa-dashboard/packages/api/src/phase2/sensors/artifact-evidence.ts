export function hasArtifactEvidence(artifacts: Record<string, unknown>, artifact: string): boolean {
  if (artifacts[artifact] !== undefined) return true
  return Object.values(artifacts).some((value) => artifactValueMatches(value, artifact))
}

function artifactValueMatches(value: unknown, artifact: string): boolean {
  if (!value || typeof value !== 'object') return false

  const record = value as Record<string, unknown>
  if (record['type'] === artifact) return true

  const metadata = record['metadata']
  if (metadata && typeof metadata === 'object') {
    const metadataRecord = metadata as Record<string, unknown>
    if (metadataRecord['artifactType'] === artifact) return true
  }

  const payload = record['payload']
  if (payload && typeof payload === 'object' && (payload as Record<string, unknown>)[artifact] !== undefined) {
    return true
  }

  const content = record['content']
  if (typeof content !== 'string') return false

  try {
    const parsed = JSON.parse(content) as unknown
    return Boolean(parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>)[artifact] !== undefined)
  } catch {
    return false
  }
}

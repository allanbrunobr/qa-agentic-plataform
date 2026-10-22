import { Search, Camera, Package, Database } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EvidenceSummaryProps {
  findingsCount: number
  screenshotsCount?: number
  artifactsCount?: number
  contextAvailable?: boolean
  className?: string
}

export function EvidenceSummary({
  findingsCount,
  screenshotsCount = 0,
  artifactsCount = 0,
  contextAvailable = false,
  className,
}: EvidenceSummaryProps) {
  const hasEvidence = findingsCount > 0 || screenshotsCount > 0 || artifactsCount > 0 || contextAvailable

  if (!hasEvidence) return null

  return (
    <div className={cn('flex items-center gap-2 flex-wrap', className)}>
      {findingsCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded bg-[var(--bg-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]" title="Findings">
          <Search className="h-2.5 w-2.5" />
          {findingsCount}
        </span>
      )}
      {screenshotsCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded bg-[var(--bg-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]" title="Screenshots">
          <Camera className="h-2.5 w-2.5" />
          {screenshotsCount}
        </span>
      )}
      {artifactsCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded bg-[var(--bg-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]" title="Artifacts">
          <Package className="h-2.5 w-2.5" />
          {artifactsCount}
        </span>
      )}
      {contextAvailable && (
        <span className="inline-flex items-center gap-1 rounded bg-[var(--bg-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]" title="Context available">
          <Database className="h-2.5 w-2.5" />
        </span>
      )}
    </div>
  )
}

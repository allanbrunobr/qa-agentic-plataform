import { AlertTriangle } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { SeverityBadge } from '@/components/ui/Badge'
import { formatRelativeTime } from '@/lib/utils'
import type { ApiFinding } from '@/lib/mock-data'

interface RecentFindingsProps {
  totalFindings: number
  lastFinding: ApiFinding | null
  className?: string
}

export function RecentFindings({ totalFindings, lastFinding, className }: RecentFindingsProps) {
  return (
    <div className={className}>
      <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
        Recent findings
      </h3>
      <Card>
        <div className="flex items-start gap-4">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: 'rgba(249,115,22,0.15)', color: '#f97316' }}
          >
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-2xl font-bold tabular-nums text-[var(--text-primary)]">
                {totalFindings}
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                recent finding{totalFindings !== 1 ? 's' : ''}
              </span>
            </div>
            {lastFinding ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={lastFinding.severity} />
                  <span className="text-xs text-[var(--text-muted)]">
                    {formatRelativeTime(lastFinding.timestamp)}
                  </span>
                </div>
                <p className="text-xs text-[var(--text-secondary)] truncate">
                  {lastFinding.title}
                </p>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">No findings recorded</p>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}

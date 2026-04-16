import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'
import { formatDuration, formatRelativeTime } from '@/lib/utils'
import type { ApiRun } from '@/lib/mock-data'

interface RecentRunsProps {
  runs: ApiRun[]
  className?: string
}

function mapApiStatus(status: string): 'passed' | 'failed' | 'running' | 'skipped' {
  if (status === 'complete') return 'passed'
  if (status === 'failed') return 'failed'
  if (status === 'running') return 'running'
  return 'skipped'
}

export function RecentRuns({ runs, className }: RecentRunsProps) {
  return (
    <div className={className}>
      <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
        Últimas 5 Execuções
      </h3>
      <Card>
        {runs.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-xs text-[var(--text-muted)]">
            Nenhuma execução registrada
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]/50">
            {runs.map(run => (
              <div
                key={run.id}
                className="flex items-center gap-4 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="text-[10px] font-mono text-[var(--text-muted)] shrink-0">
                  #{run.id.toString().padStart(4, '0')}
                </span>
                <StatusBadge status={mapApiStatus(run.status)} />
                <span className="flex-1 text-xs text-[var(--text-secondary)] truncate">
                  {formatRelativeTime(run.started_at)}
                </span>
                <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
                  {run.duration_ms && (
                    <span className="font-mono">
                      {formatDuration(Math.round(run.duration_ms / 1000))}
                    </span>
                  )}
                  <span className="tabular-nums">
                    <span className="text-green-400">{run.passed}</span>
                    /
                    <span className="text-red-400">{run.failed}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

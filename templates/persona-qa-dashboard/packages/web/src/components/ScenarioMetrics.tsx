import { Activity, Clock, TrendingUp, CheckCircle2 } from 'lucide-react'
import { StatCard } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'
import { formatDuration, formatRelativeTime } from '@/lib/utils'
import type { ApiRun } from '@/lib/mock-data'

interface ScenarioMetricsProps {
  latestRun: ApiRun | null
  successRate: number
  avgDurationMs: number | null
  className?: string
}

function mapApiStatus(status: string): 'passed' | 'failed' | 'running' | 'skipped' {
  if (status === 'complete') return 'passed'
  if (status === 'failed') return 'failed'
  if (status === 'running') return 'running'
  return 'skipped'
}

export function ScenarioMetrics({ latestRun, successRate, avgDurationMs, className }: ScenarioMetricsProps) {
  return (
    <div className={className}>
      <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
        Scenario metrics
      </h3>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Latest run */}
        <StatCard
          label="Last run"
          value={latestRun ? mapApiStatus(latestRun.status).toUpperCase() : '—'}
          sub={latestRun ? formatRelativeTime(latestRun.started_at) : 'No runs'}
          icon={<Activity className="h-5 w-5" />}
          accentColor={
            latestRun
              ? latestRun.status === 'complete'
                ? '#22c55e'
                : latestRun.status === 'failed'
                  ? '#ef4444'
                  : '#2dd4bf'
              : undefined
          }
        >
          {latestRun && (
            <div className="mt-2">
              <StatusBadge status={mapApiStatus(latestRun.status)} />
            </div>
          )}
        </StatCard>

        {/* Success rate */}
        <StatCard
          label="Pass rate"
          value={`${successRate}%`}
          sub="Last 5 runs"
          icon={<TrendingUp className="h-5 w-5" />}
          accentColor={successRate >= 80 ? '#22c55e' : successRate >= 50 ? '#f97316' : '#ef4444'}
        />

        {/* Average duration */}
        <StatCard
          label="Average duration"
          value={avgDurationMs ? formatDuration(Math.round(avgDurationMs / 1000)) : '—'}
          sub="Last 5 runs"
          icon={<Clock className="h-5 w-5" />}
        />

        {/* Latest run duration */}
        <StatCard
          label="Last duration"
          value={latestRun?.duration_ms ? formatDuration(Math.round(latestRun.duration_ms / 1000)) : '—'}
          sub={latestRun?.started_at ? new Date(latestRun.started_at).toLocaleDateString('en-US') : ''}
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
      </div>
    </div>
  )
}

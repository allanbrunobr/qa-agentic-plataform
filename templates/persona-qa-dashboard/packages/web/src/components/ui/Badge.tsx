import { cn } from '@/lib/utils'
import type { Severity, RunStatus } from '@/lib/mock-data'

interface SeverityBadgeProps {
  severity: Severity
  className?: string
}

const severityConfig: Record<Severity, { label: string; className: string }> = {
  critical: {
    label: 'Critical',
    className: 'bg-red-500/20 text-red-400 border border-red-500/30',
  },
  high: {
    label: 'High',
    className: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  },
  medium: {
    label: 'Medium',
    className: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  },
  low: {
    label: 'Low',
    className: 'bg-green-500/20 text-green-400 border border-green-500/30',
  },
  info: {
    label: 'Info',
    className: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  },
}

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  const config = severityConfig[severity]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold',
        config.className,
        className,
      )}
    >
      {config.label}
    </span>
  )
}

interface StatusBadgeProps {
  status: RunStatus
  className?: string
}

const statusConfig: Record<RunStatus, { label: string; className: string; dot?: string }> = {
  passed: {
    label: 'Passed',
    className: 'bg-green-500/20 text-green-400 border border-green-500/30',
    dot: 'bg-green-400',
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-500/20 text-red-400 border border-red-500/30',
    dot: 'bg-red-400',
  },
  running: {
    label: 'Running',
    className: 'bg-teal-500/20 text-teal-400 border border-teal-500/30',
    dot: 'bg-teal-400',
  },
  skipped: {
    label: 'Skipped',
    className: 'bg-zinc-500/20 text-zinc-400 border border-zinc-500/30',
    dot: 'bg-zinc-500',
  },
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold',
        config.className,
        className,
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          config.dot,
          status === 'running' && 'animate-pulse',
        )}
      />
      {config.label}
    </span>
  )
}

import { cn } from '@/lib/utils'

type RunSource = 'dashboard' | 'cli' | 'clean-run' | 'unknown'

const SOURCE_CONFIG: Record<RunSource, { label: string; className: string }> = {
  dashboard: {
    label: 'Dashboard',
    className: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  },
  cli: {
    label: 'CLI',
    className: 'bg-purple-500/20 text-purple-400 border border-purple-500/30',
  },
  'clean-run': {
    label: 'Clean Run',
    className: 'bg-teal-500/20 text-teal-400 border border-teal-500/30',
  },
  unknown: {
    label: 'Unknown',
    className: 'bg-zinc-500/20 text-zinc-400 border border-zinc-500/30',
  },
}

interface SourceBadgeProps {
  source?: string | null
  className?: string
}

export function SourceBadge({ source, className }: SourceBadgeProps) {
  const key = (source && source in SOURCE_CONFIG ? source : 'unknown') as RunSource
  const config = SOURCE_CONFIG[key]

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold',
        config.className,
        className,
      )}
    >
      {config.label}
    </span>
  )
}

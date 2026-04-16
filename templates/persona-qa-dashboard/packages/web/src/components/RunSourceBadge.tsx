import { cn } from '@/lib/utils'

type RunSource = 'dashboard' | 'cli' | 'clean-run' | 'unknown'

interface RunSourceBadgeProps {
  source: RunSource | string | null | undefined
  className?: string
}

const sourceConfig: Record<RunSource, { label: string; className: string }> = {
  dashboard: {
    label: 'Dashboard',
    className: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  },
  cli: {
    label: 'CLI',
    className: 'bg-green-500/20 text-green-400 border border-green-500/30',
  },
  'clean-run': {
    label: 'Clean Run',
    className: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  },
  unknown: {
    label: 'Desconhecido',
    className: 'bg-zinc-500/20 text-zinc-400 border border-zinc-500/30',
  },
}

export function RunSourceBadge({ source, className }: RunSourceBadgeProps) {
  const key = (source && source in sourceConfig ? source : 'unknown') as RunSource
  const config = sourceConfig[key]

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold',
        config.className,
        className,
      )}
    >
      {config.label}
    </span>
  )
}

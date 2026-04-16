import type { ReactNode } from 'react'
import { Inbox } from 'lucide-react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
}

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-hover)]">
        {icon ?? <Inbox className="h-6 w-6" />}
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="text-xs">{description}</p>
      )}
    </div>
  )
}

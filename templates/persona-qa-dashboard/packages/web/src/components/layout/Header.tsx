import { DashboardHealthStrip } from '@/components/DashboardHealthStrip'

interface HeaderProps {
  title: string
}

export function Header({
  title,
}: HeaderProps) {
  return (
    <header
      className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--bg-secondary)] px-6"
      role="banner"
    >
      <div className="flex items-center gap-3">
        <h1 className="text-base font-semibold text-[var(--text-primary)]">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-3">
        <DashboardHealthStrip />
      </div>
    </header>
  )
}

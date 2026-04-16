import { type CSSProperties, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type CardVariant = 'default' | 'stat' | 'status'

interface CardProps {
  children: ReactNode
  className?: string
  variant?: CardVariant
  statusColor?: string
  style?: CSSProperties
  onClick?: () => void
  hoverable?: boolean
}

export function Card({
  children,
  className,
  variant = 'default',
  statusColor,
  style,
  onClick,
  hoverable = false,
}: CardProps) {
  return (
    <div
      onClick={onClick}
      style={style}
      className={cn(
        'relative rounded-xl border p-6 transition-all duration-200',
        'bg-[var(--bg-card)] border-[var(--border)]',
        (hoverable || onClick) && [
          'cursor-pointer',
          'hover:border-[var(--accent)]/30',
          'hover:bg-[var(--bg-hover)]',
          'hover:shadow-lg hover:shadow-[var(--accent)]/5',
        ],
        variant === 'stat' && 'p-5',
        variant === 'status' && statusColor && 'pl-5',
        className,
      )}
    >
      {variant === 'status' && statusColor && (
        <div
          className="absolute left-0 top-4 bottom-4 w-0.5 rounded-r-full"
          style={{ backgroundColor: statusColor }}
        />
      )}
      {children}
    </div>
  )
}

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
  icon?: ReactNode
  accentColor?: string
  children?: ReactNode
}

export function StatCard({
  label,
  value,
  sub,
  trend,
  trendValue,
  icon,
  accentColor,
  children,
}: StatCardProps) {
  return (
    <Card variant="stat" hoverable>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
            {label}
          </p>
          <p
            className="mt-2 text-3xl font-bold text-[var(--text-primary)] tabular-nums"
            style={accentColor ? { color: accentColor } : undefined}
          >
            {value}
          </p>
          {sub && (
            <p className="mt-1 text-xs text-[var(--text-muted)]">{sub}</p>
          )}
          {trend && trendValue && (
            <div
              className={cn(
                'mt-2 flex items-center gap-1 text-xs font-medium',
                trend === 'up' && 'text-[var(--success)]',
                trend === 'down' && 'text-[var(--danger)]',
                trend === 'neutral' && 'text-[var(--text-muted)]',
              )}
            >
              <span>
                {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
              </span>
              {trendValue}
            </div>
          )}
          {children}
        </div>
        {icon && (
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg"
            style={{
              backgroundColor: accentColor
                ? `${accentColor}20`
                : 'var(--bg-hover)',
              color: accentColor ?? 'var(--accent)',
            }}
          >
            {icon}
          </div>
        )}
      </div>
    </Card>
  )
}

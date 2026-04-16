import { type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  iconPosition?: 'left' | 'right'
  loading?: boolean
  children?: ReactNode
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: [
    'bg-[var(--accent)] text-white',
    'hover:bg-[var(--accent-hover)]',
    'shadow-md shadow-[var(--accent)]/20',
    'hover:shadow-lg hover:shadow-[var(--accent)]/30',
  ].join(' '),
  secondary: [
    'bg-[var(--bg-card)] text-[var(--text-primary)]',
    'border border-[var(--border)]',
    'hover:bg-[var(--bg-hover)] hover:border-[var(--accent)]/30',
  ].join(' '),
  danger: [
    'bg-[var(--danger)]/10 text-[var(--danger)]',
    'border border-[var(--danger)]/30',
    'hover:bg-[var(--danger)]/20',
  ].join(' '),
  ghost: [
    'bg-transparent text-[var(--text-secondary)]',
    'hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
  ].join(' '),
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-7 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-6 text-sm gap-2',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconPosition = 'left',
  loading = false,
  children,
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium',
        'transition-all duration-150 focus-visible:outline-none',
        'focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        <>
          {icon && iconPosition === 'left' && (
            <span className="flex items-center">{icon}</span>
          )}
          {children}
          {icon && iconPosition === 'right' && (
            <span className="flex items-center">{icon}</span>
          )}
        </>
      )}
    </button>
  )
}

import { useState } from 'react'
import {
  LayoutDashboard,
  Users,
  Sparkles,
  Settings,
  ChevronLeft,
  ChevronRight,
  Activity,
  BotMessageSquare,
  Network,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type Page = 'overview' | 'scenarios' | 'findings' | 'runs' | 'agentic-runs' | 'personas' | 'pr-tracking' | 'insights' | 'code-graph' | 'settings'

interface NavItem {
  id: Page
  label: string
  icon: typeof LayoutDashboard
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Agentic Overview', icon: LayoutDashboard },
  { id: 'agentic-runs', label: 'Agentic Runs', icon: BotMessageSquare },
  { id: 'personas', label: 'Personas', icon: Users },
  { id: 'insights', label: 'Insights', icon: Sparkles },
  { id: 'code-graph', label: 'Code Graph', icon: Network },
]

interface SidebarProps {
  activePage: Page
  onNavigate: (page: Page) => void
}

export function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={cn(
        'relative flex h-full flex-col border-r border-[var(--border)]',
        'bg-[var(--bg-secondary)] transition-all duration-300',
        collapsed ? 'w-16' : 'w-56',
      )}
    >
      {/* Logo */}
      <div
        className={cn(
          'flex items-center border-b border-[var(--border)] px-4',
          'h-14 shrink-0',
          collapsed && 'justify-center px-2',
        )}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--accent)]/20">
          <Activity className="h-4 w-4 text-[var(--accent)]" />
        </div>
        {!collapsed && (
          <span className="ml-2.5 text-sm font-semibold text-[var(--text-primary)]">
            Persona <span className="text-[var(--accent)]">QA</span>
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3">
        <ul className="space-y-0.5 px-2">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon
            const isActive = activePage === item.id
            return (
              <li key={item.id}>
                <button
                  onClick={() => onNavigate(item.id)}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'group relative flex w-full items-center rounded-lg px-2.5 py-2',
                    'text-sm font-medium transition-all duration-150',
                    'focus-visible:outline-none focus-visible:ring-2',
                    'focus-visible:ring-[var(--accent)]/50',
                    isActive
                      ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
                    collapsed && 'justify-center px-2',
                  )}
                >
                  {/* Active left border indicator */}
                  {isActive && (
                    <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r-full bg-[var(--accent)]" />
                  )}
                  <Icon
                    className={cn(
                      'h-4 w-4 shrink-0',
                      isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]',
                      'group-hover:text-current',
                    )}
                  />
                  {!collapsed && (
                    <span className="ml-2.5 truncate">{item.label}</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Bottom section */}
      <div className="shrink-0 border-t border-[var(--border)] px-2 py-3">
        {!collapsed && (
          <p className="mb-2 px-2.5 text-[10px] text-[var(--text-muted)]">
            v1.0.0-alpha
          </p>
        )}
        <button
          title="Settings"
          onClick={() => onNavigate('settings')}
          className={cn(
            'flex w-full items-center rounded-lg px-2.5 py-2',
            'text-sm font-medium text-[var(--text-secondary)]',
            'hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
            'transition-colors duration-150',
            activePage === 'settings' && 'bg-[var(--accent)]/10 text-[var(--accent)]',
            collapsed && 'justify-center px-2',
          )}
        >
          <Settings className={cn(
            'h-4 w-4 shrink-0',
            activePage === 'settings' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]',
          )} />
          {!collapsed && <span className="ml-2.5">Settings</span>}
        </button>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(prev => !prev)}
        className={cn(
          'absolute -right-3 top-16 z-10',
          'flex h-6 w-6 items-center justify-center',
          'rounded-full border border-[var(--border)] bg-[var(--bg-card)]',
          'text-[var(--text-muted)] shadow-sm',
          'hover:border-[var(--accent)]/40 hover:text-[var(--accent)]',
          'transition-all duration-150',
        )}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronLeft className="h-3 w-3" />
        )}
      </button>
    </aside>
  )
}

export type { Page }

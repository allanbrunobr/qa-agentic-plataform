import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Play,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  User,
  Terminal,
  AlertOctagon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PERSONA_COLORS } from '@/lib/mock-data'

export interface LogEvent {
  type: 'step_start' | 'step_pass' | 'step_fail' | 'finding' | 'persona_action' | 'system' | 'error'
  timestamp: string
  persona?: string
  step?: string
  message: string
  duration?: number
  severity?: string
  raw: string
}

type LogFilter = 'all' | 'system' | 'errors' | 'findings'

const ICON_MAP: Record<LogEvent['type'], { icon: typeof Play; color: string }> = {
  step_start: { icon: Play, color: '#2dd4bf' },
  step_pass: { icon: CheckCircle2, color: '#22c55e' },
  step_fail: { icon: XCircle, color: '#ef4444' },
  finding: { icon: AlertTriangle, color: '#f97316' },
  persona_action: { icon: User, color: '#a1a1aa' },
  system: { icon: Terminal, color: '#71717a' },
  error: { icon: AlertOctagon, color: '#ef4444' },
}

const FILTER_BUTTONS: { id: LogFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'system', label: 'Sistema' },
  { id: 'errors', label: 'Erros' },
  { id: 'findings', label: 'Findings' },
]

const FILTER_STORAGE_KEY = 'livelog-filter'

function loadPersistedFilter(): LogFilter {
  try {
    const stored = localStorage.getItem(FILTER_STORAGE_KEY)
    if (stored && FILTER_BUTTONS.some(b => b.id === stored)) {
      return stored as LogFilter
    }
  } catch { /* ignore */ }
  return 'all'
}

function persistFilter(filter: LogFilter): void {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, filter)
  } catch { /* ignore */ }
}

export function parseLogExcerpt(raw: string): LogEvent[] {
  const lines = raw.split('\n').filter(l => l.trim())
  return lines.map(line => {
    const timestampMatch = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*/)
    const timestamp = timestampMatch?.[1] || ''
    const content = timestampMatch ? line.slice(timestampMatch[0].length) : line

    // Detect persona action: "Agent <name>: ..."
    const agentMatch = content.match(/^Agent\s+(.+?):\s*(.+)/)
    if (agentMatch) {
      return {
        type: 'persona_action' as const,
        timestamp,
        persona: agentMatch[1],
        message: agentMatch[2],
        raw: line,
      }
    }

    // Detect errors
    if (/^ERROR/i.test(content) || content.includes('ERROR:')) {
      return {
        type: 'error' as const,
        timestamp,
        message: content,
        raw: line,
      }
    }

    // Detect failures
    if (/failed|FAILED|aborted/i.test(content)) {
      return {
        type: 'step_fail' as const,
        timestamp,
        message: content,
        raw: line,
      }
    }

    // Detect pass/completed
    if (/PASSED|completed successfully|finished.*PASSED/i.test(content)) {
      const durationMatch = content.match(/\((\d+m?\s*\d*s?)\)/)
      return {
        type: 'step_pass' as const,
        timestamp,
        message: content,
        duration: durationMatch ? parseDurationString(durationMatch[1]) : undefined,
        raw: line,
      }
    }

    // Detect starting
    if (/^Starting/i.test(content)) {
      return {
        type: 'step_start' as const,
        timestamp,
        message: content,
        raw: line,
      }
    }

    // Default: system
    return {
      type: 'system' as const,
      timestamp,
      message: content,
      raw: line,
    }
  })
}

function parseDurationString(s: string): number {
  let total = 0
  const mMatch = s.match(/(\d+)m/)
  const sMatch = s.match(/(\d+)s/)
  if (mMatch) total += parseInt(mMatch[1]) * 60
  if (sMatch) total += parseInt(sMatch[1])
  return total
}

interface LiveLogProps {
  events: LogEvent[]
  className?: string
  totalExpected?: number
  runStatus?: 'running' | 'complete' | 'failed' | null
}

export function LiveLog({ events, className, totalExpected, runStatus }: LiveLogProps) {
  const [filter, setFilter] = useState<LogFilter>(loadPersistedFilter)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isHovering, setIsHovering] = useState(false)

  const handleFilterChange = useCallback((f: LogFilter) => {
    setFilter(f)
    persistFilter(f)
  }, [])

  const filtered = useMemo(() => {
    return events.filter(e => {
      switch (filter) {
        case 'system': return e.type === 'system' || e.type === 'step_start' || e.type === 'persona_action'
        case 'errors': return e.type === 'error' || e.type === 'step_fail'
        case 'findings': return e.type === 'finding'
        default: return true
      }
    })
  }, [events, filter])

  // Auto-scroll with pause-on-hover
  useEffect(() => {
    if (scrollRef.current && !isHovering) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [filtered, isHovering])

  const isTerminal = runStatus === 'complete' || runStatus === 'failed'

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header: filter buttons + event counter */}
      <div className="flex items-center gap-1.5 mb-2">
        {FILTER_BUTTONS.map(btn => (
          <button
            key={btn.id}
            onClick={() => handleFilterChange(btn.id)}
            className={cn(
              'rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors',
              filter === btn.id
                ? 'bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] border border-transparent',
            )}
          >
            {btn.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-[var(--text-muted)] tabular-nums">
          {events.length}{totalExpected ? ` de ${totalExpected}` : ''} evento{events.length !== 1 ? 's' : ''}
          {filter !== 'all' && ` (${filtered.length} visível${filtered.length !== 1 ? 'eis' : ''})`}
        </span>
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        className="overflow-auto rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] max-h-48"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-[10px] text-[var(--text-muted)]">
            Nenhum evento corresponde ao filtro
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]/50">
            {filtered.map((event, idx) => {
              const iconConfig = ICON_MAP[event.type]
              const Icon = iconConfig.icon
              const personaColor = event.persona
                ? PERSONA_COLORS[event.persona] || iconConfig.color
                : iconConfig.color
              const isFailure = event.type === 'error' || event.type === 'step_fail'

              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.03 }}
                  className={cn(
                    'flex items-start gap-2 px-3 py-1.5 text-[10px]',
                    isFailure && 'bg-red-500/10',
                  )}
                >
                  {/* Icon */}
                  <Icon
                    className="mt-0.5 h-3 w-3 shrink-0"
                    style={{ color: event.type === 'persona_action' ? personaColor : iconConfig.color }}
                  />

                  {/* Timestamp */}
                  <span className="shrink-0 font-mono text-[var(--text-muted)]">
                    {event.timestamp}
                  </span>

                  {/* Persona indicator */}
                  {event.persona && (
                    <span className="flex shrink-0 items-center gap-1">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: personaColor }}
                      />
                      <span className="font-medium" style={{ color: personaColor }}>
                        {event.persona}
                      </span>
                    </span>
                  )}

                  {/* Message */}
                  <span className={cn(
                    'flex-1 text-[var(--text-secondary)]',
                    isFailure && 'text-red-400 font-medium',
                  )}>
                    {event.message}
                  </span>

                  {/* Duration badge */}
                  {event.duration && event.duration > 0 && (
                    <span className="shrink-0 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 font-mono text-[var(--text-muted)]">
                      {event.duration >= 60
                        ? `${Math.floor(event.duration / 60)}m ${event.duration % 60}s`
                        : `${event.duration}s`}
                    </span>
                  )}
                </motion.div>
              )
            })}
          </div>
        )}
      </div>

      {/* Final status banner */}
      {isTerminal && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            'mt-2 rounded-lg px-3 py-2 text-xs font-medium text-center',
            runStatus === 'complete'
              ? 'bg-green-500/15 text-green-400 border border-green-500/30'
              : 'bg-red-500/15 text-red-400 border border-red-500/30',
          )}
        >
          {runStatus === 'complete'
            ? 'Execução concluída com sucesso'
            : 'Execução falhou'}
        </motion.div>
      )}
    </div>
  )
}

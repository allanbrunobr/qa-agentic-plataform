import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils'
import type { Phase2MaturityLevel, Phase2MaturitySignal, Phase2MaturityStatus } from '@/lib/api'

interface MaturityStatusPanelProps {
  maturity: Phase2MaturityStatus
}

export function MaturityStatusPanel({ maturity }: MaturityStatusPanelProps) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <MaturityLevelCard level={maturity.levels.l4} />
      <MaturityLevelCard level={maturity.levels.l5} />
    </div>
  )
}

function MaturityLevelCard({ level }: { level: Phase2MaturityLevel }) {
  const attention = level.status === 'attention'
  const controlledBeta = level.status === 'controlled_beta'
  const Icon = attention ? AlertTriangle : controlledBeta ? ShieldCheck : CheckCircle2

  return (
    <Card className={cn(
      'p-5',
      attention && 'border-red-500/30',
      controlledBeta && 'border-amber-500/30',
      !attention && !controlledBeta && 'border-emerald-500/30',
    )}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
              {level.level}
            </span>
            <span className={cn(
              'rounded-md px-2 py-1 text-[10px] font-semibold uppercase',
              attention && 'border border-red-500/20 bg-red-500/10 text-red-300',
              controlledBeta && 'border border-amber-500/20 bg-amber-500/10 text-amber-300',
              !attention && !controlledBeta && 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
            )}>
              {level.status.replace('_', ' ')}
            </span>
          </div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{level.verdict}</h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{level.summary}</p>
        </div>
        <div className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
          attention && 'bg-red-500/10 text-red-300',
          controlledBeta && 'bg-amber-500/10 text-amber-300',
          !attention && !controlledBeta && 'bg-emerald-500/10 text-emerald-300',
        )}>
          <Icon className="h-5 w-5" />
        </div>
      </div>

      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-[var(--text-muted)]">Maturity</span>
          <span className="font-semibold text-[var(--text-primary)]">{level.completion}%</span>
        </div>
        <div className="h-2 rounded-full bg-[var(--bg-primary)]">
          <div
            className={cn(
              'h-2 rounded-full',
              attention && 'bg-red-400',
              controlledBeta && 'bg-amber-400',
              !attention && !controlledBeta && 'bg-emerald-400',
            )}
            style={{ width: `${Math.max(0, Math.min(level.completion, 100))}%` }}
          />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        {level.signals.slice(0, 4).map((signal) => (
          <SignalPill key={signal.label} signal={signal} />
        ))}
      </div>

      <div className="space-y-2">
        {level.capabilities.map((capability) => (
          <div key={capability.id} className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="truncate text-xs font-semibold text-[var(--text-primary)]">{capability.label}</p>
              <span className={cn(
                'shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase',
                capability.state === 'complete' && 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
                capability.state === 'guarded' && 'border border-amber-500/20 bg-amber-500/10 text-amber-300',
                capability.state === 'beta' && 'border border-[var(--border)] bg-[var(--bg-hover)] text-[var(--text-muted)]',
              )}>
                {capability.state}
              </span>
            </div>
            <p className="line-clamp-2 text-xs leading-relaxed text-[var(--text-muted)]">{capability.evidence}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}

function SignalPill({ signal }: { signal: Phase2MaturitySignal }) {
  return (
    <div className={cn(
      'rounded-md border px-3 py-2',
      signal.tone === 'success' && 'border-emerald-500/20 bg-emerald-500/10',
      signal.tone === 'warning' && 'border-amber-500/20 bg-amber-500/10',
      signal.tone === 'danger' && 'border-red-500/20 bg-red-500/10',
      signal.tone === 'neutral' && 'border-[var(--border)] bg-[var(--bg-primary)]',
    )}>
      <p className="truncate text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{signal.label}</p>
      <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{signal.value}</p>
    </div>
  )
}

import { Card } from '@/components/ui/Card'
import type {
  Phase2ClosedLoopLifecycleEvent,
  Phase2ClosedLoopRun,
  Phase2GovernanceDecision,
} from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'

interface L5RunAuditPanelProps {
  run: Phase2ClosedLoopRun | null
  guards?: Array<{
    loop: string
    status: 'open' | 'blocked'
    reason: string
    current: number
    limit: number
  }>
  governanceDecisions?: Phase2GovernanceDecision[]
}

export function L5RunAuditPanel({
  run,
  guards = [],
  governanceDecisions = [],
}: L5RunAuditPanelProps) {
  if (!run) {
    return (
      <Card className="mt-4">
        <PanelHeader />
        <p className="rounded-md border border-dashed border-[var(--border)] p-4 text-xs text-[var(--text-muted)]">
          Nenhuma iteração L5 registrada para auditar.
        </p>
      </Card>
    )
  }

  const lifecycle = run.metadata?.lifecycle ?? []
  const visibleLifecycle = lifecycle.slice(-8).reverse()
  const visibleActions = run.actions.slice(0, 6)
  const comparisons = arrayValue(run.verification['comparisons'])
  const blockedGuards = guards.filter((guard) => guard.status === 'blocked').length
  const pendingReviews = numberValue(run.summary['pendingReviews'])
  const rerunRequired = run.verification['rerunRequired'] === true

  return (
    <Card className="mt-4">
      <PanelHeader />

      <div className="grid gap-3 md:grid-cols-5">
        <Metric label="Status" value={run.status.replace('_', ' ')} tone={run.status === 'failed' || run.status === 'blocked' ? 'danger' : 'success'} />
        <Metric label="Modo" value={run.mode.replace('_', ' ')} />
        <Metric label="Lifecycle" value={lifecycle.length} tone={lifecycle.length > 0 ? 'success' : 'neutral'} />
        <Metric label="Pendências" value={pendingReviews} tone={pendingReviews > 0 ? 'warning' : 'success'} />
        <Metric label="Reexecução" value={rerunRequired ? 'necessária' : 'não'} tone={rerunRequired ? 'warning' : 'success'} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4">
          <SectionHeader title="Lifecycle recente" detail={`${lifecycle.length} evento(s)`} />
          {visibleLifecycle.length === 0 ? (
            <EmptyLine>Nenhum evento de lifecycle registrado.</EmptyLine>
          ) : (
            <div className="space-y-2">
              {visibleLifecycle.map((event, index) => (
                <LifecycleRow key={`${event.timestamp}-${event.type}-${index}`} event={event} />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4">
          <SectionHeader title="Verificação" detail={String(run.verification['recommendation'] ?? 'sem recomendação')} />
          <div className="mt-3 space-y-2">
            <AuditLine label="Comparações" value={comparisons.length} />
            <AuditLine label="Cenários melhores" value={numberValue(run.summary['improvedScenarios'])} />
            <AuditLine label="Cenários regrediram" value={numberValue(run.summary['regressedScenarios'])} />
            <AuditLine label="Circuit breakers bloqueados" value={blockedGuards} tone={blockedGuards > 0 ? 'danger' : 'success'} />
          </div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4">
          <SectionHeader title="Ações da iteração" detail={`${run.actions.length} ação(ões)`} />
          {visibleActions.length === 0 ? (
            <EmptyLine>Nenhuma ação registrada.</EmptyLine>
          ) : (
            <div className="space-y-2">
              {visibleActions.map((action, index) => (
                <ActionRow key={`${String(action['type'] ?? 'action')}-${index}`} action={action} />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4">
          <SectionHeader title="Governança recente" detail={`${governanceDecisions.length} decisão(ões)`} />
          {governanceDecisions.length === 0 ? (
            <EmptyLine>Nenhuma decisão recente carregada.</EmptyLine>
          ) : (
            <div className="space-y-2">
              {governanceDecisions.slice(0, 6).map((decision) => (
                <GovernanceRow key={decision.id} decision={decision} />
              ))}
            </div>
          )}
        </section>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-[var(--text-muted)]">
        {String(run.summary['statusReason'] ?? 'Iteração L5 registrada.')}
      </p>
    </Card>
  )
}

function PanelHeader() {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">L5 Run Audit</h3>
      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
        Trilha operacional da última iteração closed-loop: lifecycle, ações, verificação e governança.
      </p>
    </div>
  )
}

function Metric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string | number
  tone?: 'success' | 'warning' | 'danger' | 'neutral'
}) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${toneClass(tone)}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold">{value}</p>
    </div>
  )
}

function SectionHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{title}</p>
      <p className="max-w-[55%] truncate text-right text-[11px] text-[var(--text-muted)]">{detail}</p>
    </div>
  )
}

function LifecycleRow({ event }: { event: Phase2ClosedLoopLifecycleEvent }) {
  return (
    <div className="rounded-md border border-[var(--border)] px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-[var(--text-secondary)]">{formatLifecycleLabel(event)}</p>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">{event.status ?? 'registrado'}</p>
        </div>
        <time className="shrink-0 text-[11px] text-[var(--text-muted)]">{formatRelativeTime(event.timestamp)}</time>
      </div>
      {event.reason ? <p className="mt-2 text-[11px] text-[var(--text-muted)]">{event.reason}</p> : null}
    </div>
  )
}

function ActionRow({ action }: { action: Record<string, unknown> }) {
  const type = stringValue(action['type'], 'action')
  const status = stringValue(action['status'], stringValue(action['healingType'], 'registrado'))
  const target = stringValue(action['scenarioId'], stringValue(action['proposalId'], stringValue(action['actionId'], 'sem alvo')))

  return (
    <div className="rounded-md border border-[var(--border)] px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-xs font-medium text-[var(--text-secondary)]">{type.replace(/_/g, ' ')}</p>
        <span className="shrink-0 rounded-md border border-[var(--border)] px-2 py-0.5 text-[10px] uppercase text-[var(--text-muted)]">
          {status.replace(/_/g, ' ')}
        </span>
      </div>
      <p className="mt-1 truncate text-[11px] text-[var(--text-muted)]">{target}</p>
    </div>
  )
}

function GovernanceRow({ decision }: { decision: Phase2GovernanceDecision }) {
  return (
    <div className="rounded-md border border-[var(--border)] px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-xs font-medium text-[var(--text-secondary)]">
          {decision.action.replace(/_/g, ' ')} - {decision.subjectType.replace(/_/g, ' ')}
        </p>
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] uppercase ${decision.verdict === 'blocked' ? 'bg-red-500/10 text-red-200' : 'bg-emerald-500/10 text-emerald-200'}`}>
          {decision.verdict}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] text-[var(--text-muted)]">{decision.reason}</p>
    </div>
  )
}

function AuditLine({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string | number
  tone?: 'success' | 'warning' | 'danger' | 'neutral'
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] px-3 py-2">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <span className={`text-xs font-semibold ${textToneClass(tone)}`}>{value}</span>
    </div>
  )
}

function EmptyLine({ children }: { children: string }) {
  return (
    <p className="rounded-md border border-dashed border-[var(--border)] p-3 text-xs text-[var(--text-muted)]">
      {children}
    </p>
  )
}

function formatLifecycleLabel(event: Phase2ClosedLoopLifecycleEvent) {
  const scope = event.scenarioId ?? event.loop
  const label = event.type.replace(/_/g, ' ')
  return scope ? `${label} - ${scope.replace(/_/g, ' ')}` : label
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function toneClass(tone: 'success' | 'warning' | 'danger' | 'neutral') {
  if (tone === 'success') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
  if (tone === 'warning') return 'border-amber-500/20 bg-amber-500/10 text-amber-200'
  if (tone === 'danger') return 'border-red-500/20 bg-red-500/10 text-red-200'
  return 'border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)]'
}

function textToneClass(tone: 'success' | 'warning' | 'danger' | 'neutral') {
  if (tone === 'success') return 'text-emerald-300'
  if (tone === 'warning') return 'text-amber-300'
  if (tone === 'danger') return 'text-red-300'
  return 'text-[var(--text-primary)]'
}

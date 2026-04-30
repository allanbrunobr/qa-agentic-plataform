import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/Card'
import type {
  Phase2ClosedLoopAuditBundle,
  Phase2ClosedLoopLifecycleEvent,
  Phase2ClosedLoopRun,
  Phase2GovernanceDecision,
  Phase2IndependentAuditReview,
  Phase2IndependentAuditReviewQueueItem,
  Phase2KnowledgePromotionEvent,
  Phase2L5LearningSignal,
} from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'

interface L5RunAuditPanelProps {
  run: Phase2ClosedLoopRun | null
  runs?: Phase2ClosedLoopRun[]
  selectedRunId?: string | null
  onSelectRun?: (runId: string) => void
  auditBundleUrl?: string
  replayPreview?: Phase2ClosedLoopAuditBundle['replay'] | null
  promotionPreview?: Phase2ClosedLoopAuditBundle['promotion'] | null
  promotionEvents?: Phase2KnowledgePromotionEvent[]
  promotionActionPendingId?: string | null
  promotionActionError?: string | null
  auditReviews?: Phase2IndependentAuditReview[]
  auditReviewQueue?: Phase2IndependentAuditReviewQueueItem[]
  learningSignals?: Phase2L5LearningSignal[]
  auditReviewPendingRunId?: string | null
  auditReviewError?: string | null
  replayLoading?: boolean
  replayError?: string | null
  onLoadReplayPreview?: () => void
  onRunSafeReplay?: () => void
  onRunPromotionAction?: (candidate: Phase2ClosedLoopAuditBundle['promotion']['candidates'][number]) => void
  onReviewIndependentAudit?: (run: Phase2ClosedLoopRun, reason: string) => void
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
  runs = [],
  selectedRunId,
  onSelectRun,
  auditBundleUrl,
  replayPreview,
  promotionPreview,
  promotionEvents = [],
  promotionActionPendingId,
  promotionActionError,
  auditReviews = [],
  auditReviewQueue = [],
  learningSignals = [],
  auditReviewPendingRunId,
  auditReviewError,
  replayLoading = false,
  replayError,
  onLoadReplayPreview,
  onRunSafeReplay,
  onRunPromotionAction,
  onReviewIndependentAudit,
  guards = [],
  governanceDecisions = [],
}: L5RunAuditPanelProps) {
  const auditRuns = uniqueRuns(run, runs)
  const selectedRun = (selectedRunId ? auditRuns.find((candidate) => candidate.id === selectedRunId) : undefined)
    ?? run
    ?? auditRuns[0]
    ?? null

  if (!selectedRun) {
    return (
      <Card className="mt-4">
        <PanelHeader />
        <p className="rounded-md border border-dashed border-[var(--border)] p-4 text-xs text-[var(--text-muted)]">
          Nenhuma iteração L5 registrada para auditar.
        </p>
      </Card>
    )
  }

  const lifecycle = selectedRun.metadata?.lifecycle ?? []
  const executionContext = recordValue(selectedRun.metadata?.executionContext)
  const visibleLifecycle = lifecycle.slice(-8).reverse()
  const visibleActions = selectedRun.actions.slice(0, 6)
  const comparisons = arrayValue(selectedRun.verification['comparisons'])
  const independentAudit = recordValue(selectedRun.verification['independentAudit'])
  const independentAuditSummary = recordValue(independentAudit['summary'])
  const independentAuditVerdict = stringValue(independentAudit['verdict'], 'not run')
  const independentAuditFindings = numberValue(independentAuditSummary['findings'])
  const independentAuditedSessions = numberValue(independentAuditSummary['auditedSessions'])
  const independentAuditReviewable = independentAuditVerdict === 'failed' || independentAuditVerdict === 'warning'
  const selectedRunReviews = auditReviews.filter((review) => review.runId === selectedRun.id)
  const selectedRunReviewed = selectedRunReviews.some((review) => review.status === 'reviewed')
  const promotionBlockedReason = independentAuditReviewable && !selectedRunReviewed
    ? 'Revise a auditoria independente desta run antes de promover conhecimento.'
    : null
  const blockedGuards = guards.filter((guard) => guard.status === 'blocked').length
  const pendingReviews = numberValue(selectedRun.summary['pendingReviews'])
  const rerunRequired = selectedRun.verification['rerunRequired'] === true

  return (
    <Card className="mt-4">
      <PanelHeader auditBundleUrl={auditBundleUrl} />

      <RunHistory
        runs={auditRuns}
        selectedRunId={selectedRun.id}
        onSelectRun={onSelectRun}
      />

      <IndependentAuditReviewQueue
        queue={auditReviewQueue}
        selectedRunId={selectedRun.id}
        onSelectRun={onSelectRun}
      />

      <LearningSignalLedger signals={learningSignals} selectedRunId={selectedRun.id} />

      <SafeReplayPanel
        preview={replayPreview}
        loading={replayLoading}
        error={replayError}
        onLoadPreview={onLoadReplayPreview}
        onRunSafeReplay={onRunSafeReplay}
      />

      <KnowledgePromotionPanel
        preview={promotionPreview}
        events={promotionEvents}
        actionPendingId={promotionActionPendingId}
        actionError={promotionActionError}
        blockedReason={promotionBlockedReason}
        onRunPromotionAction={onRunPromotionAction}
      />

      <ExecutionContextPanel context={executionContext} />

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Status" value={selectedRun.status.replace('_', ' ')} tone={runStatusTone(selectedRun.status)} />
        <Metric label="Modo" value={selectedRun.mode.replace('_', ' ')} />
        <Metric label="Lifecycle" value={lifecycle.length} tone={lifecycle.length > 0 ? 'success' : 'neutral'} />
        <Metric label="Pendências" value={pendingReviews} tone={pendingReviews > 0 ? 'warning' : 'success'} />
        <Metric label="Reexecução" value={rerunRequired ? 'necessária' : 'não'} tone={rerunRequired ? 'warning' : 'success'} />
        <Metric label="Auditor" value={independentAuditVerdict} tone={auditVerdictTone(independentAuditVerdict)} />
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
          <SectionHeader title="Verificação" detail={String(selectedRun.verification['recommendation'] ?? 'sem recomendação')} />
          <div className="mt-3 space-y-2">
            <AuditLine label="Auditor independente" value={independentAuditVerdict} tone={auditVerdictTone(independentAuditVerdict)} />
            <AuditLine label="Sessões auditadas" value={independentAuditedSessions} tone={independentAuditedSessions > 0 ? 'success' : 'neutral'} />
            <AuditLine label="Findings auditor" value={independentAuditFindings} tone={independentAuditFindings > 0 ? 'warning' : 'success'} />
            <AuditLine label="Comparações" value={comparisons.length} />
            <AuditLine label="Cenários melhores" value={numberValue(selectedRun.summary['improvedScenarios'])} />
            <AuditLine label="Cenários regrediram" value={numberValue(selectedRun.summary['regressedScenarios'])} />
            <AuditLine label="Circuit breakers bloqueados" value={blockedGuards} tone={blockedGuards > 0 ? 'danger' : 'success'} />
          </div>
          {independentAuditReviewable ? (
            <IndependentAuditReviewAction
              run={selectedRun}
              verdict={independentAuditVerdict}
              reviews={selectedRunReviews}
              pending={auditReviewPendingRunId === selectedRun.id}
              error={auditReviewError}
              onReviewIndependentAudit={onReviewIndependentAudit}
            />
          ) : null}
        </section>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4">
          <SectionHeader title="Ações da iteração" detail={`${selectedRun.actions.length} ação(ões)`} />
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
        {String(selectedRun.summary['statusReason'] ?? 'Iteração L5 registrada.')}
      </p>
    </Card>
  )
}

function IndependentAuditReviewAction({
  run,
  verdict,
  reviews,
  pending,
  error,
  onReviewIndependentAudit,
}: {
  run: Phase2ClosedLoopRun
  verdict: string
  reviews: Phase2IndependentAuditReview[]
  pending: boolean
  error?: string | null
  onReviewIndependentAudit?: (run: Phase2ClosedLoopRun, reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const latestReview = reviews[0]

  useEffect(() => {
    setReason('')
  }, [run.id])

  if (latestReview) {
    return (
      <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-emerald-100">
            Auditoria revisada por {latestReview.actor ?? 'operador'}: {latestReview.reason ?? 'sem motivo registrado'}
          </p>
          <time className="text-[11px] text-emerald-200">{formatRelativeTime(latestReview.createdAt)}</time>
        </div>
      </div>
    )
  }

  const reasonReady = reason.trim().length > 0

  return (
    <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
      <div className="grid gap-3">
        <p className="text-xs text-amber-100">
          Auditoria independente {verdict}; registre a revisão para liberar o circuit breaker L5.
        </p>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Motivo da revisão"
          rows={2}
          className="w-full rounded-md border border-amber-400/30 bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-amber-300"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-amber-100/80">Motivo obrigatório para manter rastreabilidade operacional.</p>
          <button
            type="button"
            disabled={!onReviewIndependentAudit || pending || !reasonReady}
            onClick={() => onReviewIndependentAudit?.(run, reason.trim())}
            className="shrink-0 rounded-md border border-amber-400/60 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-100 transition hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? 'Registrando...' : 'Marcar auditoria revisada'}
          </button>
        </div>
      </div>
      {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
    </div>
  )
}

function IndependentAuditReviewQueue({
  queue,
  selectedRunId,
  onSelectRun,
}: {
  queue: Phase2IndependentAuditReviewQueueItem[]
  selectedRunId: string
  onSelectRun?: (runId: string) => void
}) {
  if (queue.length === 0) return null

  return (
    <section className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
      <SectionHeader title="Fila de revisão L5" detail={`${queue.length} auditoria(s)`} />
      <div className="grid gap-2 lg:grid-cols-2">
        {queue.slice(0, 6).map((item) => (
          <button
            key={item.runId}
            type="button"
            onClick={() => onSelectRun?.(item.runId)}
            disabled={!onSelectRun || item.runId === selectedRunId}
            className={`rounded-md border px-3 py-2 text-left transition disabled:cursor-default ${
              item.runId === selectedRunId
                ? 'border-amber-300 bg-amber-400/20'
                : 'border-amber-500/30 bg-[var(--bg-primary)] hover:border-amber-300'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-amber-100">
                  {item.scenarioId?.replace(/_/g, ' ') ?? item.runId.slice(0, 8)}
                </p>
                <p className="mt-1 truncate text-[11px] text-amber-100/70">
                  {item.findingCount} finding(s) / {item.auditedSessions} sessão(ões)
                </p>
              </div>
              <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] uppercase ${auditVerdictClass(item.verdict)}`}>
                {item.verdict}
              </span>
            </div>
            <p className="mt-2 line-clamp-2 text-[11px] text-amber-100/70">
              {item.statusReason ?? `Run ${item.status.replace('_', ' ')}`}
            </p>
          </button>
        ))}
      </div>
    </section>
  )
}

function LearningSignalLedger({
  signals,
  selectedRunId,
}: {
  signals: Phase2L5LearningSignal[]
  selectedRunId: string
}) {
  if (signals.length === 0) return null

  const retained = signals.filter((signal) => signal.status === 'retained').length
  return (
    <section className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
      <SectionHeader title="Memória L5" detail={`${retained} sinal(is) retido(s)`} />
      <div className="grid gap-2 lg:grid-cols-2">
        {signals.slice(0, 6).map((signal) => (
          <article
            key={signal.id}
            className={`rounded-md border px-3 py-2 ${
              signal.sourceRunId === selectedRunId
                ? 'border-emerald-300 bg-emerald-400/20'
                : 'border-emerald-500/30 bg-[var(--bg-primary)]'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-emerald-100">
                  {signal.signalType.replace(/_/g, ' ')}
                </p>
                <p className="mt-1 truncate text-[11px] text-emerald-100/70">
                  {signal.scenarioId?.replace(/_/g, ' ') ?? signal.subjectType?.replace(/_/g, ' ') ?? signal.sourceRunId?.slice(0, 8) ?? 'global'}
                </p>
              </div>
              <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] uppercase ${signalStatusClass(signal.status)}`}>
                {signal.status}
              </span>
            </div>
            <p className="mt-2 line-clamp-2 text-[11px] text-emerald-100/80">{signal.summary}</p>
            <SignalEvidenceChips signal={signal} />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] uppercase text-emerald-100/60">
              <span>{signal.sourceType.replace(/_/g, ' ')}</span>
              <span>conf {Math.round(signal.confidence * 100)}%</span>
              <span>v {signal.version.slice(0, 12)}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function SignalEvidenceChips({ signal }: { signal: Phase2L5LearningSignal }) {
  const chips = signalEvidenceChips(signal)
  if (chips.length === 0) return null

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase text-emerald-100/70"
        >
          {chip}
        </span>
      ))}
    </div>
  )
}

function KnowledgePromotionPanel({
  preview,
  events,
  actionPendingId,
  actionError,
  blockedReason,
  onRunPromotionAction,
}: {
  preview?: Phase2ClosedLoopAuditBundle['promotion'] | null
  events: Phase2KnowledgePromotionEvent[]
  actionPendingId?: string | null
  actionError?: string | null
  blockedReason?: string | null
  onRunPromotionAction?: (candidate: Phase2ClosedLoopAuditBundle['promotion']['candidates'][number]) => void
}) {
  const candidates = preview?.candidates ?? []

  return (
    <section className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4">
      <SectionHeader title="Promoção de conhecimento" detail={preview ? `${candidates.length} candidato(s)` : 'aguardando bundle'} />
      {preview ? (
        candidates.length === 0 ? (
          <EmptyLine>Nenhum candidato de promoção foi derivado desta run.</EmptyLine>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {candidates.slice(0, 6).map((candidate) => (
              <PromotionCandidateRow
                key={candidate.id}
                candidate={candidate}
                pending={actionPendingId === candidate.id}
                disabled={Boolean(actionPendingId) || Boolean(blockedReason)}
                onRunPromotionAction={onRunPromotionAction}
              />
            ))}
          </div>
        )
      ) : (
        <p className="rounded-md border border-dashed border-[var(--border)] p-3 text-xs text-[var(--text-muted)]">
          Carregue o bundle da run para ver quais aprendizados podem virar conhecimento durável.
        </p>
      )}
      {preview?.notes[0] ? (
        <p className="mt-2 text-xs text-[var(--text-muted)]">{preview.notes[0]}</p>
      ) : null}
      {blockedReason ? <p className="mt-2 text-xs text-amber-200">{blockedReason}</p> : null}
      {actionError ? <p className="mt-2 text-xs text-red-300">{actionError}</p> : null}
      <PromotionEventHistory events={events} />
    </section>
  )
}

function PromotionEventHistory({ events }: { events: Phase2KnowledgePromotionEvent[] }) {
  return (
    <div className="mt-4 border-t border-[var(--border)] pt-3">
      <SectionHeader title="Histórico de promoções" detail={`${events.length} evento(s)`} />
      {events.length === 0 ? (
        <EmptyLine>Nenhum evento de promoção registrado.</EmptyLine>
      ) : (
        <div className="space-y-2">
          {events.slice(0, 6).map((event) => (
            <PromotionEventRow key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  )
}

function PromotionEventRow({ event }: { event: Phase2KnowledgePromotionEvent }) {
  const verification = event.result?.postPromotionVerification
  const materialization = recordValue(event.result?.materialization)
  const runnableRegistry = recordValue(event.result?.runnableScenarioRegistry)

  return (
    <div className="rounded-md border border-[var(--border)] px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-[var(--text-secondary)]">
            {event.action} - {event.subjectType.replace(/_/g, ' ')}
          </p>
          <p className="mt-1 truncate text-[11px] text-[var(--text-muted)]">
            {event.actor ?? 'system'} / v {event.candidateVersion.slice(0, 12)}
          </p>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] uppercase ${promotionEventStatusClass(event.status)}`}>
          {event.status}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-[var(--text-muted)]">
        <span className="truncate">{event.target ?? event.subjectId}</span>
        <time className="shrink-0">{formatRelativeTime(event.createdAt)}</time>
      </div>
      {verification ? (
        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-[var(--text-muted)]">
          <span className="truncate">gate: {verification.status}</span>
          <span className="shrink-0">{verification.checks.length} checks</span>
        </div>
      ) : null}
      {(Object.keys(materialization).length > 0 || Object.keys(runnableRegistry).length > 0) ? (
        <div className="mt-2 space-y-1 text-[11px] text-[var(--text-muted)]">
          {Object.keys(materialization).length > 0 ? (
            <p className="truncate">
              materialization: {stringValue(materialization['kind'], 'unknown')} / {stringValue(materialization['id'], 'n/a').slice(0, 12)}
            </p>
          ) : null}
          {Object.keys(runnableRegistry).length > 0 ? (
            <p className="truncate">
              runnable registry: {stringValue(runnableRegistry['kind'], 'unknown')} / {stringValue(runnableRegistry['id'], 'n/a').slice(0, 12)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ExecutionContextPanel({ context }: { context: Record<string, unknown> }) {
  if (Object.keys(context).length === 0) return null

  const previewTargets = Array.isArray(context['previewTargets']) ? context['previewTargets'] : []

  return (
    <section className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4">
      <SectionHeader title="Execution context" detail={stringValue(context['source'], 'custom')} />
      <div className="grid gap-2 lg:grid-cols-2">
        <AuditLine label="Target base URL" value={stringValue(context['targetBaseUrl'], 'default local base URL')} />
        <AuditLine label="Branch" value={stringValue(context['branchName'], 'n/a')} />
        <AuditLine label="PR" value={stringValue(context['prNumber'], 'n/a')} />
        <AuditLine label="Repo path" value={stringValue(context['targetRepoPath'], 'n/a')} />
      </div>
      {previewTargets.length > 0 ? (
        <div className="mt-3 space-y-2">
          {previewTargets.slice(0, 4).map((target, index) => {
            const targetRecord = recordValue(target)
            return (
              <div key={`${stringValue(targetRecord['role'], 'target')}-${index}`} className="rounded-md border border-[var(--border)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-[var(--text-secondary)]">{stringValue(targetRecord['role'], 'target')}</span>
                  <span>{stringValue(targetRecord['ref'], 'ref n/a')}</span>
                </div>
                <p className="mt-1 truncate">{stringValue(targetRecord['repo'], 'repo n/a')}</p>
                {targetRecord['url'] ? <p className="mt-1 truncate">{stringValue(targetRecord['url'], '')}</p> : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

function PromotionCandidateRow({
  candidate,
  pending,
  disabled,
  onRunPromotionAction,
}: {
  candidate: Phase2ClosedLoopAuditBundle['promotion']['candidates'][number]
  pending?: boolean
  disabled?: boolean
  onRunPromotionAction?: (candidate: Phase2ClosedLoopAuditBundle['promotion']['candidates'][number]) => void
}) {
  const actionable = isActionablePromotionCandidate(candidate)

  return (
    <div className="rounded-md border border-[var(--border)] px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-[var(--text-secondary)]">{candidate.title}</p>
          <p className="mt-1 truncate text-[11px] text-[var(--text-muted)]">{candidate.target}</p>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] uppercase ${promotionStatusClass(candidate.status)}`}>
          {candidate.status.replace(/_/g, ' ')}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-[11px] text-[var(--text-muted)]">{candidate.reason}</p>
      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-[var(--text-muted)]">
        <span className="truncate">{candidate.promotionType.replace(/_/g, ' ')}</span>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-md px-2 py-0.5 text-[10px] uppercase ${promotionPriorityClass(candidate.priority)}`}>
            {candidate.priority}
          </span>
          <span>next: {candidate.nextAction}</span>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="truncate text-[10px] text-[var(--text-muted)]">v {candidate.version.slice(0, 12)}</p>
        {actionable ? (
          <button
            type="button"
            disabled={!onRunPromotionAction || disabled}
            onClick={() => onRunPromotionAction?.(candidate)}
            className="shrink-0 rounded-md border border-[var(--accent)] bg-[var(--accent)]/10 px-2 py-1 text-[11px] font-medium text-[var(--text-primary)] transition hover:bg-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? 'Executando...' : promotionActionLabel(candidate.nextAction)}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function SafeReplayPanel({
  preview,
  loading,
  error,
  onLoadPreview,
  onRunSafeReplay,
}: {
  preview?: Phase2ClosedLoopAuditBundle['replay'] | null
  loading: boolean
  error?: string | null
  onLoadPreview?: () => void
  onRunSafeReplay?: () => void
}) {
  return (
    <section className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4">
      <SectionHeader title="Replay seguro" detail={preview ? 'payload carregado' : 'aguardando bundle'} />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          {preview ? (
            <pre className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] p-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
              {JSON.stringify(preview.safeReplayPayload, null, 2)}
            </pre>
          ) : (
            <p className="rounded-md border border-dashed border-[var(--border)] p-3 text-xs text-[var(--text-muted)]">
              Carregue o bundle da run selecionada para executar uma reanálise em observe mode.
            </p>
          )}
          {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
          {preview ? (
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              Replay bloqueia aplicação automática e geração de cenários; apenas reavalia o loop.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={!onLoadPreview || loading}
            onClick={onLoadPreview}
            className="rounded-md border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading && !preview ? 'Carregando...' : 'Preparar replay'}
          </button>
          <button
            type="button"
            disabled={!preview || !onRunSafeReplay || loading}
            onClick={onRunSafeReplay}
            className="rounded-md border border-[var(--accent)] bg-[var(--accent)]/10 px-3 py-2 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading && preview ? 'Executando...' : 'Executar observe'}
          </button>
        </div>
      </div>
    </section>
  )
}

function PanelHeader({ auditBundleUrl }: { auditBundleUrl?: string }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">L5 Run Audit</h3>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          Trilha operacional da iteração closed-loop selecionada: lifecycle, ações, verificação e governança.
        </p>
      </div>
      {auditBundleUrl ? (
        <a
          href={auditBundleUrl}
          download
          className="shrink-0 rounded-md border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
        >
          Exportar bundle
        </a>
      ) : null}
    </div>
  )
}

function RunHistory({
  runs,
  selectedRunId,
  onSelectRun,
}: {
  runs: Phase2ClosedLoopRun[]
  selectedRunId: string
  onSelectRun?: (runId: string) => void
}) {
  return (
    <section className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4">
      <SectionHeader title="Histórico L5" detail={`${runs.length} run(s)`} />
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {runs.slice(0, 8).map((candidate) => (
          <RunHistoryButton
            key={candidate.id}
            run={candidate}
            active={candidate.id === selectedRunId}
            onSelectRun={onSelectRun}
          />
        ))}
      </div>
    </section>
  )
}

function RunHistoryButton({
  run,
  active,
  onSelectRun,
}: {
  run: Phase2ClosedLoopRun
  active: boolean
  onSelectRun?: (runId: string) => void
}) {
  const timestamp = formatRunTimestamp(run)
  const statusTone = runStatusTone(run.status)

  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={!onSelectRun || active}
      onClick={() => onSelectRun?.(run.id)}
      className={`min-w-0 rounded-md border px-3 py-2 text-left transition ${
        active
          ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text-primary)]'
          : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--text-primary)]'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] uppercase ${historyStatusClass(statusTone)}`}>
          {run.status.replace('_', ' ')}
        </span>
        <span className="truncate text-[11px]">{timestamp ? formatRelativeTime(timestamp) : 'sem data'}</span>
      </div>
      <p className="mt-2 truncate text-xs font-medium">{formatRunScope(run)}</p>
      <p className="mt-1 truncate text-[11px]">
        {run.metadata?.lifecycle?.length ?? 0} lifecycle / {run.actions.length} ações
      </p>
    </button>
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

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function uniqueRuns(run: Phase2ClosedLoopRun | null, runs: Phase2ClosedLoopRun[]): Phase2ClosedLoopRun[] {
  const byId = new Map<string, Phase2ClosedLoopRun>()
  for (const candidate of [...runs, run].filter((item): item is Phase2ClosedLoopRun => Boolean(item))) {
    if (!byId.has(candidate.id)) {
      byId.set(candidate.id, candidate)
    }
  }

  return Array.from(byId.values()).sort((left, right) => {
    const leftTime = Date.parse(formatRunTimestamp(left) ?? '')
    const rightTime = Date.parse(formatRunTimestamp(right) ?? '')
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0)
  })
}

function formatRunTimestamp(run: Phase2ClosedLoopRun): string | null {
  return run.completedAt || run.startedAt || null
}

function formatRunScope(run: Phase2ClosedLoopRun): string {
  return run.scenarioId ?? run.queuedScenarios[0] ?? 'todos os cenários'
}

function runStatusTone(status: Phase2ClosedLoopRun['status']): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'completed') return 'success'
  if (status === 'needs_review') return 'warning'
  if (status === 'blocked' || status === 'failed') return 'danger'
  return 'neutral'
}

function auditVerdictTone(verdict: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (verdict === 'passed') return 'success'
  if (verdict === 'warning') return 'warning'
  if (verdict === 'failed') return 'danger'
  return 'neutral'
}

function auditVerdictClass(verdict: string) {
  if (verdict === 'failed') return 'bg-red-500/10 text-red-200'
  if (verdict === 'warning') return 'bg-amber-500/10 text-amber-200'
  if (verdict === 'passed') return 'bg-emerald-500/10 text-emerald-200'
  return 'bg-[var(--bg-secondary)] text-[var(--text-muted)]'
}

function signalStatusClass(status: string) {
  if (status === 'retained') return 'bg-emerald-500/10 text-emerald-200'
  if (status === 'superseded') return 'bg-[var(--bg-secondary)] text-[var(--text-muted)]'
  return 'bg-[var(--bg-secondary)] text-[var(--text-muted)]'
}

function signalEvidenceChips(signal: Phase2L5LearningSignal): string[] {
  const chips: string[] = []
  const evidence = recordValue(signal.evidence)
  const metadata = recordValue(signal.metadata)
  const replayStatus = stringValue(evidence['replayStatus'], '')
  const auditVerdict = stringValue(evidence['auditVerdict'], '')
  const sourceSessionId = stringValue(evidence['sourceSessionId'], '')
  const conflictResolution = recordValue(metadata['conflictResolution'])
  const supersededSignalIds = Array.isArray(conflictResolution['supersededSignalIds'])
    ? conflictResolution['supersededSignalIds']
    : []

  if (replayStatus) chips.push(`replay ${replayStatus}`)
  if (!replayStatus && auditVerdict) chips.push(`audit ${auditVerdict}`)
  if (sourceSessionId) chips.push(`sess ${sourceSessionId.slice(0, 8)}`)
  if (supersededSignalIds.length > 0) chips.push(`superseded ${supersededSignalIds.length}`)

  return chips
}

function historyStatusClass(tone: 'success' | 'warning' | 'danger' | 'neutral') {
  if (tone === 'success') return 'bg-emerald-500/10 text-emerald-200'
  if (tone === 'warning') return 'bg-amber-500/10 text-amber-200'
  if (tone === 'danger') return 'bg-red-500/10 text-red-200'
  return 'bg-[var(--bg-secondary)] text-[var(--text-muted)]'
}

function promotionPriorityClass(priority: Phase2ClosedLoopAuditBundle['promotion']['candidates'][number]['priority']) {
  if (priority === 'critical') return 'border border-red-500/30 bg-red-500/10 text-red-300'
  if (priority === 'high') return 'border border-amber-500/30 bg-amber-500/10 text-amber-300'
  if (priority === 'normal') return 'border border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
  return 'border border-[var(--border)] bg-[var(--bg-hover)] text-[var(--text-muted)]'
}

function promotionStatusClass(status: Phase2ClosedLoopAuditBundle['promotion']['candidates'][number]['status']) {
  if (status === 'materialized') return 'bg-emerald-500/10 text-emerald-200'
  if (status === 'approved') return 'bg-cyan-500/10 text-cyan-200'
  if (status === 'requires_review') return 'bg-amber-500/10 text-amber-200'
  if (status === 'blocked') return 'bg-red-500/10 text-red-200'
  return 'bg-[var(--bg-secondary)] text-[var(--text-muted)]'
}

function promotionEventStatusClass(status: Phase2KnowledgePromotionEvent['status']) {
  if (status === 'completed') return 'bg-emerald-500/10 text-emerald-200'
  if (status === 'blocked') return 'bg-amber-500/10 text-amber-200'
  return 'bg-red-500/10 text-red-200'
}

function isActionablePromotionCandidate(
  candidate: Phase2ClosedLoopAuditBundle['promotion']['candidates'][number],
): boolean {
  return candidate.nextAction === 'approve'
    || candidate.nextAction === 'apply'
    || candidate.nextAction === 'promote'
}

function promotionActionLabel(action: Phase2ClosedLoopAuditBundle['promotion']['candidates'][number]['nextAction']) {
  if (action === 'approve') return 'Aprovar'
  if (action === 'apply') return 'Aplicar'
  if (action === 'promote') return 'Promover'
  return 'Revisar'
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

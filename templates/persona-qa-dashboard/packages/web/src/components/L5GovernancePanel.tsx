import type { ReactNode } from 'react'
import { BookOpenCheck, FileText, ShieldCheck, Wrench } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils'
import type {
  Phase2GovernanceDecision,
  Phase2HealingAction,
  Phase2LearningProposal,
  Phase2ScenarioDraft,
} from '@/lib/api'

interface L5GovernancePanelProps {
  healingActions: Phase2HealingAction[]
  governanceDecisions: Phase2GovernanceDecision[]
  learningProposals: Phase2LearningProposal[]
  scenarioDrafts: Phase2ScenarioDraft[]
  loading?: boolean
  actionPendingId?: string | null
  onApproveProposal?: (proposalId: string) => void
  onApplyProposal?: (proposalId: string) => void
  onRejectProposal?: (proposalId: string) => void
  onApproveDraft?: (draftId: string) => void
  onRejectDraft?: (draftId: string) => void
}

type ActivityKind = 'governance' | 'healing' | 'learning' | 'draft'

interface ActivityItem {
  id: string
  kind: ActivityKind
  title: string
  description: string
  status: string
  timestamp: string
}

const KIND_LABELS: Record<ActivityKind, string> = {
  governance: 'Governance',
  healing: 'Self-healing',
  learning: 'Learning',
  draft: 'Scenario draft',
}

export function L5GovernancePanel({
  healingActions,
  governanceDecisions,
  learningProposals,
  scenarioDrafts,
  loading = false,
  actionPendingId = null,
  onApproveProposal,
  onApplyProposal,
  onRejectProposal,
  onApproveDraft,
  onRejectDraft,
}: L5GovernancePanelProps) {
  const appliedHealing = healingActions.filter((action) => action.status === 'applied').length
  const blockedHealing = healingActions.filter((action) => action.status === 'blocked').length
  const proposedHealing = healingActions.filter((action) => action.status === 'proposed').length
  const pendingReviews = [
    ...learningProposals.filter((proposal) => proposal.status === 'proposed'),
    ...scenarioDrafts.filter((draft) => draft.status === 'pending'),
    ...healingActions.filter((action) => action.status === 'proposed'),
  ].length
  const blockedDecisions = governanceDecisions.filter((decision) => decision.verdict === 'blocked').length
  const boundedActions = governanceDecisions.filter((decision) => (
    decision.subjectType === 'healing_action'
    && decision.action === 'apply'
    && decision.verdict === 'allowed'
    && decision.requirements?.includes('bounded_policy')
  )).length
  const appliedLearning = learningProposals.filter((proposal) => proposal.status === 'applied').length
  const reviewableProposals = learningProposals.filter((proposal) => (
    proposal.status === 'proposed' || proposal.status === 'approved'
  ))
  const reviewableDrafts = scenarioDrafts.filter((draft) => draft.status === 'pending')

  const activity = buildActivity({
    healingActions,
    governanceDecisions,
    learningProposals,
    scenarioDrafts,
  })

  return (
    <Card className="mb-6">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">L5 control plane</h2>
          <p className="text-xs text-[var(--text-muted)]">
            Autonomous changes, review gates, and self-healing decisions.
          </p>
        </div>
        <span className="w-fit rounded-md border border-[var(--border)] bg-[var(--bg-hover)] px-2 py-1 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
          {loading ? 'Syncing' : `${activity.length} recent events`}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <MetricTile
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Review queue"
          value={pendingReviews}
          detail={`${blockedDecisions} blocked decisions`}
          tone={pendingReviews > 0 ? 'warning' : 'neutral'}
        />
        <MetricTile
          icon={<Wrench className="h-4 w-4" />}
          label="Self-healing"
          value={appliedHealing}
          detail={`${proposedHealing} proposed / ${blockedHealing} blocked`}
          tone={blockedHealing > 0 ? 'danger' : 'success'}
        />
        <MetricTile
          icon={<BookOpenCheck className="h-4 w-4" />}
          label="Learning applied"
          value={appliedLearning}
          detail={`${learningProposals.length} proposals tracked`}
          tone="neutral"
        />
        <MetricTile
          icon={<FileText className="h-4 w-4" />}
          label="Bounded actions"
          value={boundedActions}
          detail={`${governanceDecisions.length} decisions recorded`}
          tone="success"
        />
      </div>

      {(reviewableProposals.length > 0 || reviewableDrafts.length > 0) && (
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Review actions</h3>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {reviewableProposals.slice(0, 4).map((proposal) => (
              <ReviewItem
                key={proposal.id}
                label="Learning proposal"
                title={`${proposal.patchKind} for ${proposal.agentId ?? proposal.target ?? proposal.stepId}`}
                description={String(proposal.recommendation['description'] ?? proposal.recommendation['action'] ?? proposal.type)}
                status={proposal.status}
                pending={actionPendingId === `proposal:${proposal.id}`}
                testId={`l5-proposal-${proposal.id}`}
                actions={[
                  proposal.status === 'proposed' && onApproveProposal
                    ? { label: 'Approve', onClick: () => onApproveProposal(proposal.id), tone: 'success' as const }
                    : null,
                  proposal.status === 'approved' && onApplyProposal
                    ? { label: 'Apply', onClick: () => onApplyProposal(proposal.id), tone: 'success' as const }
                    : null,
                  onRejectProposal
                    ? { label: 'Reject', onClick: () => onRejectProposal(proposal.id), tone: 'danger' as const }
                    : null,
                ].filter((action): action is ReviewAction => Boolean(action))}
              />
            ))}

            {reviewableDrafts.slice(0, 4).map((draft) => (
              <ReviewItem
                key={draft.id}
                label="Scenario draft"
                title={draft.name}
                description={draft.description ?? `Coverage gap: ${draft.gapType}`}
                status={draft.status}
                pending={actionPendingId === `draft:${draft.id}`}
                testId={`l5-draft-${draft.id}`}
                actions={[
                  onApproveDraft ? { label: 'Approve', onClick: () => onApproveDraft(draft.id), tone: 'success' as const } : null,
                  onRejectDraft ? { label: 'Reject', onClick: () => onRejectDraft(draft.id), tone: 'danger' as const } : null,
                ].filter((action): action is ReviewAction => Boolean(action))}
              />
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 border-t border-[var(--border)] pt-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Recent L5 activity</h3>
        </div>

        {activity.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--border)] p-4 text-xs text-[var(--text-muted)]">
            No L5 governance activity yet.
          </p>
        ) : (
          <div className="space-y-2">
            {activity.slice(0, 6).map((item) => (
              <div
                key={`${item.kind}:${item.id}`}
                className="flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] p-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="rounded-md border border-[var(--border)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                      {KIND_LABELS[item.kind]}
                    </span>
                    <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase', statusClass(item.status))}>
                      {item.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">{item.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                    {item.description}
                  </p>
                </div>
                <time className="shrink-0 text-xs text-[var(--text-muted)]">{formatTime(item.timestamp)}</time>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

interface ReviewAction {
  label: string
  onClick: () => void
  tone: 'success' | 'danger'
}

function ReviewItem({
  label,
  title,
  description,
  status,
  actions,
  pending,
  testId,
}: {
  label: string
  title: string
  description: string
  status: string
  actions: ReviewAction[]
  pending: boolean
  testId?: string
}) {
  return (
    <div data-testid={testId} className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-[var(--border)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
          {label}
        </span>
        <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase', statusClass(status))}>
          {status.replace(/_/g, ' ')}
        </span>
      </div>
      <p className="truncate text-sm font-medium text-[var(--text-primary)]">{title}</p>
      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--text-secondary)]">{description}</p>
      {actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={pending}
              onClick={action.onClick}
              className={cn(
                'rounded-md border px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50',
                action.tone === 'success' && 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/20',
                action.tone === 'danger' && 'border-red-500/30 bg-red-500/15 text-red-400 hover:bg-red-500/20',
              )}
            >
              {pending ? 'Working...' : action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MetricTile({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode
  label: string
  value: number
  detail: string
  tone: 'success' | 'warning' | 'danger' | 'neutral'
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
        <span className={cn('rounded-md p-1', toneClass(tone))}>{icon}</span>
      </div>
      <p className="text-2xl font-semibold tabular-nums text-[var(--text-primary)]">{value}</p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">{detail}</p>
    </div>
  )
}

function buildActivity(input: {
  healingActions: Phase2HealingAction[]
  governanceDecisions: Phase2GovernanceDecision[]
  learningProposals: Phase2LearningProposal[]
  scenarioDrafts: Phase2ScenarioDraft[]
}): ActivityItem[] {
  const governance = input.governanceDecisions.map((decision): ActivityItem => ({
    id: decision.id,
    kind: 'governance',
    title: `${decision.action} ${decision.subjectType}`,
    description: decision.reason,
    status: decision.verdict,
    timestamp: decision.createdAt,
  }))

  const healing = input.healingActions.map((action): ActivityItem => ({
    id: action.id,
    kind: 'healing',
    title: `${action.type} on ${action.target}`,
    description: action.reason,
    status: action.status,
    timestamp: action.createdAt,
  }))

  const learning = input.learningProposals.map((proposal): ActivityItem => ({
    id: proposal.id,
    kind: 'learning',
    title: `${proposal.patchKind} for ${proposal.agentId ?? proposal.target ?? proposal.stepId}`,
    description: String(proposal.recommendation['description'] ?? proposal.recommendation['action'] ?? proposal.type),
    status: proposal.status,
    timestamp: proposal.appliedAt ?? proposal.approvedAt ?? proposal.rejectedAt ?? proposal.createdAt,
  }))

  const drafts = input.scenarioDrafts.map((draft): ActivityItem => ({
    id: draft.id,
    kind: 'draft',
    title: draft.name,
    description: draft.description ?? `Coverage gap: ${draft.gapType}`,
    status: draft.status,
    timestamp: draft.reviewedAt ?? draft.updatedAt ?? draft.createdAt,
  }))

  return [...governance, ...healing, ...learning, ...drafts]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}

function toneClass(tone: 'success' | 'warning' | 'danger' | 'neutral') {
  switch (tone) {
    case 'success':
      return 'bg-emerald-500/15 text-emerald-400'
    case 'warning':
      return 'bg-amber-500/15 text-amber-400'
    case 'danger':
      return 'bg-red-500/15 text-red-400'
    default:
      return 'bg-[var(--bg-hover)] text-[var(--text-muted)]'
  }
}

function statusClass(status: string) {
  if (status === 'blocked' || status === 'rejected') return 'border border-red-500/30 bg-red-500/15 text-red-400'
  if (status === 'allowed' || status === 'applied' || status === 'approved') return 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
  if (status === 'proposed' || status === 'pending') return 'border border-amber-500/30 bg-amber-500/15 text-amber-400'
  return 'border border-[var(--border)] bg-[var(--bg-hover)] text-[var(--text-muted)]'
}

function formatTime(timestamp: string) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  return date.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

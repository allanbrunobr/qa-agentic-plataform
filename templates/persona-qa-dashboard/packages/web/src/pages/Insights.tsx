import { useState, useMemo, useEffect, useCallback, type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { Monitor, FlaskConical, Server, Lightbulb } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { SeverityBadge } from '@/components/ui/Badge'
import { L5GovernancePanel } from '@/components/L5GovernancePanel'
import type { ApiInsight } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { api, type Phase2GovernanceDecision, type Phase2HealingAction, type Phase2LearningProposal, type Phase2ScenarioDraft } from '@/lib/api'

type SpecialistId = ApiInsight['specialist'] | 'all'

const SPECIALISTS = [
  {
    id: 'frontend' as const,
    name: 'Frontend Specialist',
    icon: Monitor,
    color: '#3b82f6',
  },
  {
    id: 'test' as const,
    name: 'Test Specialist',
    icon: FlaskConical,
    color: '#22c55e',
  },
  {
    id: 'backend' as const,
    name: 'Backend Specialist',
    icon: Server,
    color: '#f97316',
  },
]

const SEVERITY_BORDER_COLORS: Record<ApiInsight['severity'], string> = {
  critical: '#ef4444',
  warning: '#eab308',
  info: '#3b82f6',
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25 } },
}

function LoadingState() {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-[var(--text-muted)]">
      Loading...
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
      <p className="text-sm">{message}</p>
      <p className="text-xs">Run tests to populate data</p>
    </div>
  )
}

export function Insights() {
  const [insights, setInsights] = useState<ApiInsight[]>([])
  const [healingActions, setHealingActions] = useState<Phase2HealingAction[]>([])
  const [governanceDecisions, setGovernanceDecisions] = useState<Phase2GovernanceDecision[]>([])
  const [learningProposals, setLearningProposals] = useState<Phase2LearningProposal[]>([])
  const [scenarioDrafts, setScenarioDrafts] = useState<Phase2ScenarioDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [actionPendingId, setActionPendingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [activeSpecialist, setActiveSpecialist] = useState<SpecialistId>('all')

  const loadL5Data = useCallback(async () => {
    const [
      nextHealingActions,
      nextGovernanceDecisions,
      nextLearningProposals,
      nextScenarioDrafts,
    ] = await Promise.all([
      api.getPhase2HealingLog(20).catch(() => [] as Phase2HealingAction[]),
      api.getPhase2GovernanceDecisions({ limit: 30 }).catch(() => [] as Phase2GovernanceDecision[]),
      api.getPhase2LearningProposals({ limit: 20 }).catch(() => [] as Phase2LearningProposal[]),
      api.getPhase2ScenarioDrafts({ limit: 20 }).catch(() => [] as Phase2ScenarioDraft[]),
    ])
    setHealingActions(nextHealingActions)
    setGovernanceDecisions(nextGovernanceDecisions)
    setLearningProposals(nextLearningProposals)
    setScenarioDrafts(nextScenarioDrafts)
  }, [])

  useEffect(() => {
    Promise.all([
      api.getInsights().catch(() => [] as ApiInsight[]),
      loadL5Data(),
    ])
      .then(([nextInsights]) => {
        setInsights(nextInsights as ApiInsight[])
      })
      .finally(() => setLoading(false))
  }, [loadL5Data])

  const filtered = useMemo(() => {
    if (activeSpecialist === 'all') return insights
    return insights.filter(i => i.specialist === activeSpecialist)
  }, [insights, activeSpecialist])

  const specialistCounts = useMemo(() => {
    const counts: Record<string, number> = { frontend: 0, test: 0, backend: 0 }
    insights.forEach(i => { counts[i.specialist]++ })
    return counts
  }, [insights])

  const hasL5Activity = (
    healingActions.length > 0
    || governanceDecisions.length > 0
    || learningProposals.length > 0
    || scenarioDrafts.length > 0
  )

  if (loading) return <LoadingState />
  if (insights.length === 0 && !hasL5Activity) return <EmptyState message="No insights yet. Run tests to generate insights." />

  const runL5Action = async (pendingId: string, action: () => Promise<unknown>) => {
    setActionPendingId(pendingId)
    setActionError(null)
    try {
      await action()
      await loadL5Data()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setActionPendingId(null)
    }
  }

  return (
    <div className="p-6">
      {actionError && (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          {actionError}
        </div>
      )}

      <L5GovernancePanel
        healingActions={healingActions}
        governanceDecisions={governanceDecisions}
        learningProposals={learningProposals}
        scenarioDrafts={scenarioDrafts}
        actionPendingId={actionPendingId}
        onApproveProposal={(id) => runL5Action(`proposal:${id}`, () => api.approvePhase2LearningProposal(id))}
        onApplyProposal={(id) => runL5Action(`proposal:${id}`, () => api.applyPhase2LearningProposal(id))}
        onRejectProposal={(id) => runL5Action(`proposal:${id}`, () => api.rejectPhase2LearningProposal(id))}
        onApproveDraft={(id) => runL5Action(`draft:${id}`, () => api.updatePhase2ScenarioDraft(id, { status: 'approved', reviewedBy: 'dashboard' }))}
        onRejectDraft={(id) => runL5Action(`draft:${id}`, () => api.updatePhase2ScenarioDraft(id, { status: 'rejected', reviewedBy: 'dashboard' }))}
      />

      {insights.length > 0 && (
        <>
      {/* Specialist cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {SPECIALISTS.map(spec => {
          const Icon = spec.icon
          const isActive = activeSpecialist === spec.id
          return (
            <Card
              key={spec.id}
              hoverable
              onClick={() => setActiveSpecialist(isActive ? 'all' : spec.id)}
              className={cn(
                'flex items-center gap-4 p-4 transition-all',
                isActive && 'ring-1',
              )}
              style={isActive ? ({
                borderColor: `${spec.color}60`,
                boxShadow: `0 0 0 1px ${spec.color}40`,
              } satisfies CSSProperties) : undefined}
            >
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                style={{
                  backgroundColor: `${spec.color}20`,
                  color: spec.color,
                }}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  {spec.name}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {specialistCounts[spec.id]} insight{specialistCounts[spec.id] !== 1 ? 's' : ''}
                </p>
              </div>
              {isActive && (
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: spec.color }}
                />
              )}
            </Card>
          )
        })}
      </div>

      {/* Filter indicator */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[var(--text-muted)]">
          {filtered.length} insight{filtered.length !== 1 ? 's' : ''}
          {activeSpecialist !== 'all' && (
            <button
              onClick={() => setActiveSpecialist('all')}
              className="ml-2 text-xs text-[var(--accent)] hover:underline"
            >
              Clear filter
            </button>
          )}
        </p>
      </div>

      {/* Insight cards */}
      <motion.div
        className="space-y-3"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        key={activeSpecialist}
      >
        {filtered.map(insight => {
          const spec = SPECIALISTS.find(s => s.id === insight.specialist)!
          const SpecIcon = spec.icon
          const borderColor = SEVERITY_BORDER_COLORS[insight.severity]

          return (
            <motion.div key={insight.id} variants={itemVariants}>
              <Card
                variant="status"
                statusColor={borderColor}
                className="pl-5"
              >
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Title row */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                        {insight.title}
                      </h3>
                      <SeverityBadge
                        severity={
                          insight.severity === 'critical' ? 'critical' :
                          insight.severity === 'warning' ? 'medium' :
                          'info'
                        }
                      />
                      <span className="rounded-md bg-[var(--bg-hover)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
                        {insight.category}
                      </span>
                    </div>

                    {/* Description */}
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-3">
                      {insight.description}
                    </p>

                    {/* Recommendation */}
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-3">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Lightbulb className="h-3 w-3 text-[var(--warning)]" />
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--warning)]">
                          Recommendation
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                        {insight.recommendation}
                      </p>
                    </div>
                  </div>

                  {/* Specialist badge */}
                  <div className="flex shrink-0 flex-col items-center gap-1.5">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-lg"
                      style={{
                        backgroundColor: `${spec.color}20`,
                        color: spec.color,
                      }}
                    >
                      <SpecIcon className="h-4 w-4" />
                    </div>
                    <span className="text-[9px] font-medium text-[var(--text-muted)] text-center whitespace-nowrap">
                      {spec.name.split(' ')[0]}
                    </span>
                  </div>
                </div>
              </Card>
            </motion.div>
          )
        })}
      </motion.div>
        </>
      )}
    </div>
  )
}

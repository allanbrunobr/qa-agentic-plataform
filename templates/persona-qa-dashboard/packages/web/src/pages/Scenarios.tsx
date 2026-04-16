import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Users, ChevronRight } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'
import type { ApiScenario } from '@/lib/mock-data'
import { formatRelativeTime } from '@/lib/utils'
import { ScenarioDetail } from '@/pages/ScenarioDetail'
import { api } from '@/lib/api'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
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

function mapApiStatus(status: string | null): 'passed' | 'failed' | 'running' | 'skipped' {
  if (status === 'complete') return 'passed'
  if (status === 'failed') return 'failed'
  if (status === 'running') return 'running'
  if (status === 'pending') return 'running'
  return 'skipped'
}

interface ScenariosProps {
  onNavigateToRun?: (runId: number) => void
}

export function Scenarios({ onNavigateToRun }: ScenariosProps = {}) {
  const [scenarios, setScenarios] = useState<ApiScenario[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null)

  useEffect(() => {
    api.getScenarios()
      .then(d => setScenarios(d as ApiScenario[]))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingState />
  if (scenarios.length === 0) return <EmptyState message="No scenarios configured yet." />

  if (selectedScenarioId) {
    return (
      <ScenarioDetail
        scenarioId={selectedScenarioId}
        onBack={() => setSelectedScenarioId(null)}
        onNavigateToRun={onNavigateToRun}
      />
    )
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {scenarios.length} scenarios configured
          </p>
        </div>
      </div>

      <motion.div
        className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {scenarios.map(scenario => (
          <motion.div key={scenario.scenario_id} variants={itemVariants}>
            <Card
              hoverable
              className="flex h-full flex-col"
              onClick={() => setSelectedScenarioId(scenario.scenario_id)}
            >
              {/* Header */}
              <div className="mb-4 flex items-start justify-between">
                <div className="flex-1 min-w-0 pr-3">
                  <h3 className="font-semibold text-[var(--text-primary)] leading-snug">
                    {scenario.name}
                  </h3>
                  {scenario.description && (
                    <p className="mt-1 text-xs text-[var(--text-muted)] line-clamp-2">
                      {scenario.description}
                    </p>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
              </div>

              {/* Meta */}
              <div className="mb-4 flex items-center gap-4 text-xs text-[var(--text-muted)]">
                <span className="flex items-center gap-1">
                  <span className="text-[var(--text-secondary)] font-medium">
                    {scenario.step_count}
                  </span>{' '}
                  steps
                </span>
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  <span className="text-[var(--text-secondary)] font-medium">
                    {scenario.agent_count}
                  </span>{' '}
                  agents
                </span>
              </div>

              {/* Footer */}
              <div className="mt-auto flex items-center justify-between border-t border-[var(--border)] pt-3">
                {scenario.last_status ? (
                  <StatusBadge status={mapApiStatus(scenario.last_status)} />
                ) : (
                  <span className="text-xs text-[var(--text-muted)]">No runs yet</span>
                )}
                {scenario.last_run_at ? (
                  <span className="text-xs text-[var(--text-muted)]">
                    {formatRelativeTime(scenario.last_run_at)}
                  </span>
                ) : (
                  <span className="text-xs text-[var(--text-muted)]">--</span>
                )}
              </div>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}

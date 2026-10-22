import { motion } from 'framer-motion'
import { GitPullRequest, GitMerge, XCircle, Clock, ExternalLink } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'
import { formatRelativeTime } from '@/lib/utils'

type PRStatus = 'open' | 'merged' | 'closed'

interface PR {
  id: number
  number: number
  title: string
  author: string
  branch: string
  targetBranch: string
  status: PRStatus
  updatedAt: string
  qaRunStatus: 'passed' | 'failed' | 'running' | 'skipped'
  checksTotal: number
  checksPassed: number
  labels: string[]
}

const MOCK_PRS: PR[] = [
  {
    id: 1,
    number: 412,
    title: 'feat: add order export to the orders page',
    author: 'dev-team',
    branch: 'feat/order-export',
    targetBranch: 'main',
    status: 'open',
    updatedAt: '2026-04-08T09:45:00Z',
    qaRunStatus: 'running',
    checksTotal: 3,
    checksPassed: 1,
    labels: ['feature', 'operations'],
  },
  {
    id: 2,
    number: 409,
    title: 'fix: inventory API schema now includes reorder_threshold field',
    author: 'backend-team',
    branch: 'fix/inventory-schema',
    targetBranch: 'main',
    status: 'open',
    updatedAt: '2026-04-08T08:20:00Z',
    qaRunStatus: 'failed',
    checksTotal: 3,
    checksPassed: 2,
    labels: ['bugfix', 'api'],
  },
  {
    id: 3,
    number: 405,
    title: 'feat: real-time WebSocket status updates for payment authorization',
    author: 'frontend-team',
    branch: 'feat/ws-auth-status',
    targetBranch: 'main',
    status: 'open',
    updatedAt: '2026-04-07T16:30:00Z',
    qaRunStatus: 'passed',
    checksTotal: 3,
    checksPassed: 3,
    labels: ['feature', 'billing', 'websocket'],
  },
  {
    id: 4,
    number: 398,
    title: 'fix: delivery calendar respects warehouse schedule availability',
    author: 'dev-team',
    branch: 'fix/calendar-availability',
    targetBranch: 'main',
    status: 'merged',
    updatedAt: '2026-04-07T12:00:00Z',
    qaRunStatus: 'passed',
    checksTotal: 3,
    checksPassed: 3,
    labels: ['bugfix', 'scheduling'],
  },
  {
    id: 5,
    number: 391,
    title: 'chore: upgrade shipping integration SDK to v3',
    author: 'infra-team',
    branch: 'chore/shipping-sdk-v3',
    targetBranch: 'main',
    status: 'closed',
    updatedAt: '2026-04-06T10:00:00Z',
    qaRunStatus: 'skipped',
    checksTotal: 3,
    checksPassed: 3,
    labels: ['chore'],
  },
]

const labelColors: Record<string, string> = {
  feature: 'bg-blue-500/20 text-blue-400',
  bugfix: 'bg-red-500/20 text-red-400',
  operations: 'bg-teal-500/20 text-teal-400',
  api: 'bg-purple-500/20 text-purple-400',
  billing: 'bg-orange-500/20 text-orange-400',
  websocket: 'bg-yellow-500/20 text-yellow-400',
  scheduling: 'bg-green-500/20 text-green-400',
  chore: 'bg-zinc-500/20 text-zinc-400',
  infra: 'bg-gray-500/20 text-gray-400',
}

function PRStatusIcon({ status }: { status: PRStatus }) {
  if (status === 'merged') return <GitMerge className="h-4 w-4 text-purple-400" />
  if (status === 'closed') return <XCircle className="h-4 w-4 text-[var(--text-muted)]" />
  return <GitPullRequest className="h-4 w-4 text-[var(--accent)]" />
}

export function PRTracking() {
  const open = MOCK_PRS.filter(pr => pr.status === 'open')
  const merged = MOCK_PRS.filter(pr => pr.status === 'merged')

  return (
    <div className="p-6">
      {/* Summary stats */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <Card variant="stat">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)]/10">
              <GitPullRequest className="h-4 w-4 text-[var(--accent)]" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--text-primary)]">{open.length}</p>
              <p className="text-xs text-[var(--text-muted)]">Open PRs</p>
            </div>
          </div>
        </Card>
        <Card variant="stat">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-500/10">
              <GitMerge className="h-4 w-4 text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--text-primary)]">{merged.length}</p>
              <p className="text-xs text-[var(--text-muted)]">Merged</p>
            </div>
          </div>
        </Card>
        <Card variant="stat">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--bg-hover)]">
              <Clock className="h-4 w-4 text-[var(--text-muted)]" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--text-primary)]">
                {open.filter(pr => pr.qaRunStatus === 'passed').length}/{open.length}
              </p>
              <p className="text-xs text-[var(--text-muted)]">QA Passing</p>
            </div>
          </div>
        </Card>
      </div>

      {/* PR List */}
      <div className="space-y-3">
        {MOCK_PRS.map((pr, index) => (
          <motion.div
            key={pr.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.06 }}
          >
            <Card hoverable className="py-4 px-5">
              <div className="flex items-start gap-3">
                <PRStatusIcon status={pr.status} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-[var(--text-muted)] font-mono">
                          #{pr.number}
                        </span>
                        <h3 className="text-sm font-medium text-[var(--text-primary)]">
                          {pr.title}
                        </h3>
                        <ExternalLink className="h-3 w-3 text-[var(--text-muted)] shrink-0" />
                      </div>

                      <div className="mt-1.5 flex items-center gap-3 flex-wrap">
                        <span className="text-xs text-[var(--text-muted)]">
                          <span className="font-mono bg-[var(--bg-primary)] px-1.5 py-0.5 rounded text-[10px]">
                            {pr.branch}
                          </span>
                          {' '}→{' '}
                          <span className="font-mono bg-[var(--bg-primary)] px-1.5 py-0.5 rounded text-[10px]">
                            {pr.targetBranch}
                          </span>
                        </span>
                        <span className="text-xs text-[var(--text-muted)]">
                          by {pr.author}
                        </span>
                        <span className="text-xs text-[var(--text-muted)]">
                          {formatRelativeTime(pr.updatedAt)}
                        </span>
                      </div>

                      {/* Labels */}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {pr.labels.map(label => (
                          <span
                            key={label}
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${labelColors[label] ?? 'bg-zinc-500/20 text-zinc-400'}`}
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <StatusBadge status={pr.qaRunStatus} />
                      <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                        <div className="flex gap-0.5">
                          {Array.from({ length: pr.checksTotal }).map((_, i) => (
                            <div
                              key={i}
                              className="h-1.5 w-4 rounded-full"
                              style={{
                                backgroundColor:
                                  i < pr.checksPassed
                                    ? 'var(--success)'
                                    : 'var(--border)',
                              }}
                            />
                          ))}
                        </div>
                        <span>{pr.checksPassed}/{pr.checksTotal} checks</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

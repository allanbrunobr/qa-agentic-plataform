import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, ChevronDown, ChevronUp, Image, X, ZoomIn } from 'lucide-react'
import { SeverityBadge } from '@/components/ui/Badge'
import type { Severity, ApiFinding } from '@/lib/mock-data'
import { formatRelativeTime } from '@/lib/utils'
import { api } from '@/lib/api'
import { EmptyState as ReusableEmptyState } from '@/components/EmptyState'

const SEVERITY_OPTIONS: Array<{ value: Severity | 'all'; label: string }> = [
  { value: 'all', label: 'All severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'info', label: 'Info' },
]

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info']

function LoadingState() {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-[var(--text-muted)]">
      Loading...
    </div>
  )
}

function ScreenshotModal({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="relative max-h-[90vh] max-w-[90vw]"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)] shadow-lg hover:text-[var(--text-primary)] transition-colors"
          aria-label="Close screenshot"
        >
          <X className="h-4 w-4" />
        </button>
        <img
          src={src}
          alt="Finding screenshot"
          className="max-h-[85vh] max-w-full rounded-xl border border-[var(--border)] shadow-2xl"
        />
      </motion.div>
    </motion.div>
  )
}

export function Findings() {
  const [findings, setFindings] = useState<ApiFinding[]>([])
  const [loading, setLoading] = useState(true)
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all')
  const [agentFilter, setAgentFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [screenshotModal, setScreenshotModal] = useState<string | null>(null)

  useEffect(() => {
    api.getFindings()
      .then(d => setFindings(d as ApiFinding[]))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Build agent options dynamically from data
  const agentOptions = useMemo(() => {
    const agents = Array.from(new Set(findings.map(f => f.agent))).sort()
    return [
      { value: 'all', label: 'All agents' },
      ...agents.map(a => ({ value: a, label: a })),
    ]
  }, [findings])

  const filtered = useMemo(() => {
    return findings.filter(f => {
      if (severityFilter !== 'all' && f.severity !== severityFilter) return false
      if (agentFilter !== 'all' && f.agent !== agentFilter) return false
      if (
        search &&
        !f.title.toLowerCase().includes(search.toLowerCase()) &&
        !f.agent.toLowerCase().includes(search.toLowerCase()) &&
        !f.step.toLowerCase().includes(search.toLowerCase())
      )
        return false
      return true
    }).sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    )
  }, [findings, severityFilter, agentFilter, search])

  if (loading) return <LoadingState />
  if (findings.length === 0) return (
    <ReusableEmptyState
      title="No findings found"
      description="Run tests with pnpm test:persona-qa"
    />
  )

  return (
    <div className="p-6">
      {/* Screenshot modal */}
      <AnimatePresence>
        {screenshotModal && (
          <ScreenshotModal src={screenshotModal} onClose={() => setScreenshotModal(null)} />
        )}
      </AnimatePresence>

      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search findings..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-card)] pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]/50 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/30"
          />
        </div>

        {/* Severity filter */}
        <select
          value={severityFilter}
          onChange={e => setSeverityFilter(e.target.value as Severity | 'all')}
          className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 pr-8 text-sm text-[var(--text-primary)] focus:border-[var(--accent)]/50 focus:outline-none cursor-pointer"
        >
          {SEVERITY_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* Agent filter */}
        <select
          value={agentFilter}
          onChange={e => setAgentFilter(e.target.value)}
          className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 pr-8 text-sm text-[var(--text-primary)] focus:border-[var(--accent)]/50 focus:outline-none cursor-pointer"
        >
          {agentOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <span className="text-xs text-[var(--text-muted)]">
          {filtered.length} of {findings.length} findings
        </span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-[var(--border)]">
        {/* Header */}
        <div className="grid grid-cols-[120px_1fr_140px_180px_120px] gap-0 border-b border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2.5">
          {['Severity', 'Title', 'Agent', 'Step', 'When'].map(col => (
            <span key={col} className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              {col}
            </span>
          ))}
        </div>

        {/* Rows */}
        {filtered.length === 0 ? (
          <div className="py-4">
            <ReusableEmptyState
              title="No findings match the selected filters"
              description="Try adjusting the filters"
            />
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {filtered.map(finding => {
              const isExpanded = expandedId === finding.id
              const hasScreenshot = !!finding.screenshot_path
              const screenshotUrl = hasScreenshot ? api.getFindingScreenshotUrl(finding.id) : null

              return (
                <div key={finding.id} className="bg-[var(--bg-card)]">
                  {/* Main row */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : finding.id)}
                    className="grid w-full grid-cols-[120px_1fr_140px_180px_120px] items-center gap-0 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
                  >
                    <SeverityBadge severity={finding.severity} />
                    <div className="flex items-center gap-2 pr-4">
                      <span className="text-sm text-[var(--text-primary)] line-clamp-1">
                        {finding.title}
                      </span>
                    </div>
                    <span className="text-xs text-[var(--text-secondary)]">{finding.agent}</span>
                    <span className="text-xs text-[var(--text-secondary)] truncate">{finding.step}</span>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)]">
                        {formatRelativeTime(finding.timestamp)}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                      )}
                    </div>
                  </button>

                  {/* Expanded detail */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden border-t border-[var(--border)]"
                      >
                        <div className="grid grid-cols-3 gap-4 bg-[var(--bg-primary)] px-4 py-4">
                          {/* Expected */}
                          <div>
                            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--success)]">
                              Expected
                            </p>
                            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                              {finding.expected}
                            </p>
                          </div>

                          {/* Actual */}
                          <div>
                            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--danger)]">
                              Actual
                            </p>
                            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                              {finding.actual}
                            </p>
                          </div>

                          {/* Screenshot */}
                          <div>
                            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                              Screenshot
                            </p>
                            {hasScreenshot && screenshotUrl ? (
                              <button
                                onClick={() => setScreenshotModal(screenshotUrl)}
                                className="group relative w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)] transition-all hover:border-[var(--accent)]/40"
                              >
                                <img
                                  src={screenshotUrl}
                                  alt={`Screenshot for ${finding.title}`}
                                  className="h-24 w-full object-cover object-top"
                                  onError={e => {
                                    const target = e.target as HTMLImageElement
                                    target.style.display = 'none'
                                    target.nextElementSibling?.classList.remove('hidden')
                                  }}
                                />
                                <div className="hidden flex h-24 items-center justify-center">
                                  <div className="flex flex-col items-center gap-1 text-[var(--text-muted)]">
                                    <Image className="h-5 w-5" />
                                    <span className="text-[10px]">Failed to load</span>
                                  </div>
                                </div>
                                <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100">
                                  <div className="flex items-center gap-1.5 rounded-lg bg-[var(--bg-card)]/90 px-3 py-1.5 text-xs font-medium text-[var(--text-primary)]">
                                    <ZoomIn className="h-3.5 w-3.5" />
                                    View
                                  </div>
                                </div>
                              </button>
                            ) : (
                              <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg-card)]">
                                <div className="flex flex-col items-center gap-1.5 text-[var(--text-muted)]">
                                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-hover)]">
                                    <Image className="h-4 w-4" />
                                  </div>
                                  <span className="text-[10px]">No screenshot captured</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

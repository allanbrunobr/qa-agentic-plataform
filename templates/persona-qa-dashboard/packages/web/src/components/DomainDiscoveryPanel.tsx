import type { ReactNode } from 'react'
import { Compass, FileCheck2, ShieldAlert, Users } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils'
import type {
  Phase2DomainDiscoveryBaseCandidate,
  Phase2DomainDiscoveryResponse,
} from '@/lib/api'

interface DomainDiscoveryPanelProps {
  discovery: Phase2DomainDiscoveryResponse | null
}

export function DomainDiscoveryPanel({ discovery }: DomainDiscoveryPanelProps) {
  const available = Boolean(discovery?.available && discovery.bundle && discovery.summary)

  if (!available) {
    return (
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                L5
              </span>
              <span className="rounded-md border border-[var(--border)] bg-[var(--bg-hover)] px-2 py-1 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                aguardando discovery
              </span>
            </div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Domain Discovery</h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
              Rode `discover-local` para gerar domínio, personas candidatas, cenários candidatos e evidências.
            </p>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-hover)] text-[var(--text-muted)]">
            <Compass className="h-5 w-5" />
          </div>
        </div>
      </Card>
    )
  }

  const summary = discovery!.summary!
  const bundle = discovery!.bundle!
  const personas = bundle.personas
  const scenarios = bundle.scenarios
  const capabilities = bundle.capabilities
  const auditFindings = bundle.audit?.findings ?? []

  return (
    <Card className="p-5">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
              L5 domain review
            </span>
            <StatusPill candidate={bundle.domain} />
          </div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            Domain Discovery: {summary.label}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
            {bundle.domain.summary}
          </p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-500/10 text-teal-300">
          <Compass className="h-5 w-5" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile
          icon={<Compass className="h-4 w-4" />}
          label="Confidence"
          value={formatConfidence(summary.confidence)}
          detail={summary.targetId}
        />
        <MetricTile
          icon={<Users className="h-4 w-4" />}
          label="Personas"
          value={summary.personas}
          detail={`${summary.scenarios} scenarios`}
        />
        <MetricTile
          icon={<FileCheck2 className="h-4 w-4" />}
          label="Evidence"
          value={summary.evidenceItems}
          detail={`${summary.capabilities} capabilities`}
        />
        <MetricTile
          icon={<ShieldAlert className="h-4 w-4" />}
          label="Mapping gated"
          value={summary.mappingRequired}
          detail={`${summary.auditFindings} audit findings`}
          tone={summary.mappingRequired > 0 ? 'warning' : 'success'}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CandidateList
          title="Persona candidates"
          empty="Nenhuma persona candidata."
          items={personas.slice(0, 4).map((persona) => ({
            id: persona.id,
            title: persona.title,
            description: persona.rationale,
            candidate: persona,
          }))}
        />
        <CandidateList
          title="Scenario candidates"
          empty="Nenhum cenário candidato."
          items={scenarios.slice(0, 4).map((scenario) => ({
            id: scenario.id,
            title: scenario.title,
            description: scenario.rationale,
            candidate: scenario,
          }))}
        />
        <CandidateList
          title="Capability candidates"
          empty="Nenhuma capability candidata."
          items={capabilities.slice(0, 4).map((capability) => ({
            id: capability.id,
            title: capability.title,
            description: capability.purpose,
            candidate: capability,
          }))}
        />
      </div>

      {auditFindings.length > 0 && (
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Audit findings</h3>
          <div className="space-y-2">
            {auditFindings.slice(0, 3).map((finding) => (
              <div key={finding.id} className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-[var(--border)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                    {finding.severity}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                    {finding.candidateIds.length} candidates
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{finding.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

function MetricTile({
  icon,
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  icon: ReactNode
  label: string
  value: string | number
  detail: string
  tone?: 'neutral' | 'warning' | 'success'
}) {
  return (
    <div className={cn(
      'rounded-lg border px-4 py-3',
      tone === 'neutral' && 'border-[var(--border)] bg-[var(--bg-primary)]',
      tone === 'warning' && 'border-amber-500/20 bg-amber-500/10',
      tone === 'success' && 'border-emerald-500/20 bg-emerald-500/10',
    )}>
      <div className="mb-2 flex items-center gap-2 text-[var(--text-muted)]">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-lg font-semibold text-[var(--text-primary)]">{value}</p>
      <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{detail}</p>
    </div>
  )
}

function CandidateList({
  title,
  empty,
  items,
}: {
  title: string
  empty: string
  items: Array<{
    id: string
    title: string
    description: string
    candidate: Phase2DomainDiscoveryBaseCandidate
  }>
}) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{title}</h3>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--border)] p-4 text-xs text-[var(--text-muted)]">
          {empty}
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium text-[var(--text-primary)]">{item.title}</p>
                <StatusPill candidate={item.candidate} compact />
              </div>
              <p className="line-clamp-2 text-xs leading-relaxed text-[var(--text-secondary)]">{item.description}</p>
              <p className="mt-2 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                {item.candidate.evidenceRefs.length} evidence refs
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusPill({
  candidate,
  compact = false,
}: {
  candidate: Phase2DomainDiscoveryBaseCandidate
  compact?: boolean
}) {
  return (
    <span className={cn(
      'shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold uppercase',
      compact && 'py-0.5',
      candidate.status === 'needs_human_mapping' && 'border border-amber-500/20 bg-amber-500/10 text-amber-300',
      candidate.status === 'restricted' && 'border border-red-500/20 bg-red-500/10 text-red-300',
      candidate.status === 'runnable_candidate' && 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
      candidate.status === 'draft' && 'border border-[var(--border)] bg-[var(--bg-hover)] text-[var(--text-muted)]',
    )}>
      {candidate.status.replace(/_/g, ' ')}
    </span>
  )
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`
}

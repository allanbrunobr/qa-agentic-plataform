import { useState, useEffect } from 'react'
import { Filter, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { FilterChip } from '@/components/FilterChip'
import { api } from '@/lib/api'
import type { ApiScenario } from '@/lib/mock-data'

export interface RunFilterState {
  scenario: string
  status: string
  source: string
  from: string
  to: string
  has_findings: string
}

const EMPTY_FILTERS: RunFilterState = {
  scenario: '',
  status: '',
  source: '',
  from: '',
  to: '',
  has_findings: '',
}

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'pending', label: 'Pendente' },
  { value: 'running', label: 'Em execução' },
  { value: 'complete', label: 'Completo' },
  { value: 'failed', label: 'Falhou' },
]

const FINDINGS_OPTIONS = [
  { value: '', label: 'Findings' },
  { value: 'true', label: 'Com findings' },
]

interface RunFiltersProps {
  filters: RunFilterState
  onChange: (filters: RunFilterState) => void
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

interface SourcesResponse {
  sources: string[]
  available: boolean
}

function normalizeScenariosResponse(raw: unknown): ApiScenario[] {
  return Array.isArray(raw) ? raw as ApiScenario[] : []
}

function normalizeSourcesResponse(raw: unknown): SourcesResponse {
  const value = raw as Partial<SourcesResponse> | null | undefined
  return {
    sources: Array.isArray(value?.sources) ? value.sources : [],
    available: Boolean(value?.available),
  }
}

export function RunFilters({ filters, onChange }: RunFiltersProps) {
  const [scenarios, setScenarios] = useState<ApiScenario[]>([])
  const [sourcesInfo, setSourcesInfo] = useState<SourcesResponse>({ sources: [], available: false })

  useEffect(() => {
    api.getScenarios()
      .then(d => setScenarios(normalizeScenariosResponse(d)))
      .catch(() => {})
    fetch(`${API_BASE}/api/runs/sources`)
      .then(r => r.json())
      .then(d => setSourcesInfo(normalizeSourcesResponse(d)))
      .catch(() => {})
  }, [])

  const updateFilter = (key: keyof RunFilterState, value: string) => {
    onChange({ ...filters, [key]: value })
  }

  const clearFilter = (key: keyof RunFilterState) => {
    onChange({ ...filters, [key]: '' })
  }

  const clearAll = () => {
    onChange({ ...EMPTY_FILTERS })
  }

  const activeFilters = Object.entries(filters).filter(([, v]) => v !== '')

  const getFilterLabel = (key: string, value: string): string => {
    switch (key) {
      case 'scenario': {
        const s = scenarios.find(sc => sc.scenario_id === value)
        return s ? s.name : value
      }
      case 'status':
        return STATUS_OPTIONS.find(o => o.value === value)?.label ?? value
      case 'from':
        return `De: ${value}`
      case 'to':
        return `Até: ${value}`
      case 'has_findings':
        return 'Com findings'
      case 'source':
        return `Fonte: ${value}`
      default:
        return value
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Filter className="h-4 w-4 text-[var(--text-muted)]" />

        {/* Scenario filter */}
        <select
          value={filters.scenario}
          onChange={e => updateFilter('scenario', e.target.value)}
          className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 pr-8 text-sm text-[var(--text-primary)] focus:border-[var(--accent)]/50 focus:outline-none cursor-pointer"
        >
          <option value="">Todos os cenários</option>
          {scenarios.map(s => (
            <option key={s.scenario_id} value={s.scenario_id}>{s.name}</option>
          ))}
        </select>

        {/* Status filter */}
        <select
          value={filters.status}
          onChange={e => updateFilter('status', e.target.value)}
          className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 pr-8 text-sm text-[var(--text-primary)] focus:border-[var(--accent)]/50 focus:outline-none cursor-pointer"
        >
          {STATUS_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {/* Source filter — populated dynamically when run_source column exists */}
        <select
          value={filters.source}
          onChange={e => updateFilter('source', e.target.value)}
          disabled={!sourcesInfo.available}
          title={sourcesInfo.available ? undefined : 'Coluna run_source ainda não disponível'}
          className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 pr-8 text-sm text-[var(--text-primary)] focus:border-[var(--accent)]/50 focus:outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="">
            {sourcesInfo.available ? 'Todas as fontes' : 'Fonte (indisponível)'}
          </option>
          {sourcesInfo.sources.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Findings filter */}
        <select
          value={filters.has_findings}
          onChange={e => updateFilter('has_findings', e.target.value)}
          className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 pr-8 text-sm text-[var(--text-primary)] focus:border-[var(--accent)]/50 focus:outline-none cursor-pointer"
        >
          {FINDINGS_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {/* Period: from */}
        <div className="relative">
          <Calendar className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
          <input
            type="date"
            value={filters.from}
            onChange={e => updateFilter('from', e.target.value)}
            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] pl-8 pr-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)]/50 focus:outline-none"
            placeholder="De"
          />
        </div>

        {/* Period: to */}
        <div className="relative">
          <Calendar className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
          <input
            type="date"
            value={filters.to}
            onChange={e => updateFilter('to', e.target.value)}
            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] pl-8 pr-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)]/50 focus:outline-none"
            placeholder="Até"
          />
        </div>

        {activeFilters.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            Limpar filtros
          </Button>
        )}
      </div>

      {/* Active filter chips */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {activeFilters.map(([key, value]) => (
            <FilterChip
              key={key}
              label={getFilterLabel(key, value)}
              onRemove={() => clearFilter(key as keyof RunFilterState)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export { EMPTY_FILTERS }

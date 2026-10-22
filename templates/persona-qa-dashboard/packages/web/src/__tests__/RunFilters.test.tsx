import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RunFilters, EMPTY_FILTERS, type RunFilterState } from '@/components/RunFilters'

// Mock the api module
vi.mock('@/lib/api', () => ({
  api: {
    getScenarios: vi.fn().mockResolvedValue([
      { id: 1, scenario_id: 'sc-1', name: 'Login Flow', description: null, step_count: 3, agent_count: 2, last_run_at: null, last_status: null },
    ]),
  },
}))

// Mock fetch for /api/runs/sources
const mockFetch = vi.spyOn(globalThis, 'fetch')

describe('RunFilters', () => {
  let onChange: (filters: RunFilterState) => void
  let filters: RunFilterState

  beforeEach(() => {
    onChange = vi.fn() as unknown as (filters: RunFilterState) => void
    filters = { ...EMPTY_FILTERS }
    // Default: source column not available
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ sources: [], available: false })),
    )
  })

  it('renders scenario, status, source, findings, and date filter controls', () => {
    render(<RunFilters filters={filters} onChange={onChange} />)

    // 4 selects: scenario, status, source, findings
    const selects = screen.getAllByRole('combobox')
    expect(selects.length).toBe(4)

    const dateInputs = document.querySelectorAll('input[type="date"]')
    expect(dateInputs.length).toBe(2)
  })

  it('shows source dropdown as disabled when column is not available', async () => {
    render(<RunFilters filters={filters} onChange={onChange} />)

    await waitFor(() => {
      const sourceSelect = screen.getByTitle('run_source column not available yet')
      expect(sourceSelect).toBeDisabled()
    })
  })

  it('shows source dropdown as enabled when column is available', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ sources: ['manual', 'ci'], available: true })),
    )

    render(<RunFilters filters={filters} onChange={onChange} />)

    await waitFor(() => {
      expect(screen.getByText('All sources')).toBeInTheDocument()
    })

    const sourceSelect = screen.getByText('All sources').closest('select')!
    expect(sourceSelect).not.toBeDisabled()
    expect(screen.getByText('manual')).toBeInTheDocument()
    expect(screen.getByText('ci')).toBeInTheDocument()
  })

  it('calls onChange with updated status when status filter changes', async () => {
    render(<RunFilters filters={filters} onChange={onChange} />)

    const selects = screen.getAllByRole('combobox')
    // Second select is status
    const statusSelect = selects[1]
    await userEvent.selectOptions(statusSelect, 'complete')

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'complete' }),
    )
  })

  it('shows filter chips when filters are active', () => {
    const activeFilters: RunFilterState = {
      ...EMPTY_FILTERS,
      status: 'failed',
      has_findings: 'true',
    }
    render(<RunFilters filters={activeFilters} onChange={onChange} />)

    expect(screen.getByRole('button', { name: /remove filter: failed/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remove filter: with findings/i })).toBeInTheDocument()
  })

  it('shows source chip when source filter is active', () => {
    const activeFilters: RunFilterState = {
      ...EMPTY_FILTERS,
      source: 'ci',
    }
    render(<RunFilters filters={activeFilters} onChange={onChange} />)

    expect(screen.getByRole('button', { name: /remove filter: source: ci/i })).toBeInTheDocument()
  })

  it('clears all filters including source when "Clear filters" is clicked', async () => {
    const activeFilters: RunFilterState = {
      ...EMPTY_FILTERS,
      status: 'failed',
      source: 'manual',
    }
    render(<RunFilters filters={activeFilters} onChange={onChange} />)

    await userEvent.click(screen.getByText('Clear filters'))

    expect(onChange).toHaveBeenCalledWith(EMPTY_FILTERS)
  })

  it('removes a single filter when its chip X is clicked', async () => {
    const activeFilters: RunFilterState = {
      ...EMPTY_FILTERS,
      status: 'failed',
      has_findings: 'true',
    }
    render(<RunFilters filters={activeFilters} onChange={onChange} />)

    const removeButtons = screen.getAllByRole('button', { name: /remove filter/i })
    await userEvent.click(removeButtons[0])

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ status: '', has_findings: 'true' }),
    )
  })
})

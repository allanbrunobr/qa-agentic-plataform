import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ScenarioHistoryTable } from '../ScenarioHistoryTable'

const mockResponse = {
  runs: [
    {
      id: 3, scenario_id: 's1', scenario_name: 'Scenario 1', session_id: 'sess-3',
      status: 'complete', started_at: '2026-04-10T10:00:00Z', completed_at: '2026-04-10T10:02:00Z',
      duration_ms: 120000, total_tests: 10, passed: 10, failed: 0, skipped: 0,
      findings_count: 0, critical_count: 0, high_count: 0,
      run_source: 'dashboard',
    },
    {
      id: 2, scenario_id: 's1', scenario_name: 'Scenario 1', session_id: 'sess-2',
      status: 'failed', started_at: '2026-04-09T10:00:00Z', completed_at: '2026-04-09T10:01:00Z',
      duration_ms: 60000, total_tests: 10, passed: 7, failed: 3, skipped: 0,
      findings_count: 2, critical_count: 1, high_count: 1,
      run_source: 'cli',
    },
    {
      id: 1, scenario_id: 's1', scenario_name: 'Scenario 1', session_id: 'sess-1',
      status: 'complete', started_at: '2026-04-08T10:00:00Z', completed_at: '2026-04-08T10:01:30Z',
      duration_ms: 90000, total_tests: 8, passed: 8, failed: 0, skipped: 0,
      findings_count: 0, critical_count: 0, high_count: 0,
      // no run_source → should fall back to Unknown
    },
  ],
  pagination: { page: 1, limit: 10, total: 3, totalPages: 1 },
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('ScenarioHistoryTable', () => {
  it('renders table with runs after fetching', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response)

    render(<ScenarioHistoryTable scenarioId="s1" />)

    await waitFor(() => {
      expect(screen.getByText('#0003')).toBeDefined()
    })
    expect(screen.getByText('#0002')).toBeDefined()
    expect(screen.getByText('#0001')).toBeDefined()
  })

  it('renders sortable column headers', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response)

    render(<ScenarioHistoryTable scenarioId="s1" />)

    await waitFor(() => {
      expect(screen.getByText('Histórico de Execuções')).toBeDefined()
    })

    expect(screen.getByText('Run')).toBeDefined()
    expect(screen.getByText(/Data/)).toBeDefined()
    expect(screen.getByText(/Status/)).toBeDefined()
    expect(screen.getByText(/Duração/)).toBeDefined()
  })

  it('renders status badges (pass/fail)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response)

    render(<ScenarioHistoryTable scenarioId="s1" />)

    await waitFor(() => {
      // 2 passed + 1 failed
      expect(screen.getAllByText('Passed').length).toBe(2)
    })
    expect(screen.getByText('Failed')).toBeDefined()
  })

  it('renders mapped source badges (dashboard, cli, unknown)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response)

    render(<ScenarioHistoryTable scenarioId="s1" />)

    await waitFor(() => {
      // run_source: 'dashboard' → "Dashboard" badge
      expect(screen.getByText('Dashboard')).toBeDefined()
    })
    // run_source: 'cli' → "CLI" badge
    expect(screen.getByText('CLI')).toBeDefined()
    // missing run_source → "Unknown" badge
    expect(screen.getByText('Unknown')).toBeDefined()
  })

  it('calls onNavigateToRun when row clicked', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response)

    const onNavigate = vi.fn()
    render(<ScenarioHistoryTable scenarioId="s1" onNavigateToRun={onNavigate} />)

    await waitFor(() => {
      expect(screen.getByText('#0003')).toBeDefined()
    })

    fireEvent.click(screen.getByText('#0003'))
    expect(onNavigate).toHaveBeenCalledWith(3)
  })

  it('shows empty state when no runs', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ runs: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } }),
    } as Response)

    render(<ScenarioHistoryTable scenarioId="s1" />)

    await waitFor(() => {
      expect(screen.getByText('Nenhuma execução encontrada')).toBeDefined()
    })
  })

  it('sorted by started_at descending by default', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response)

    const { container } = render(<ScenarioHistoryTable scenarioId="s1" />)

    await waitFor(() => {
      expect(screen.getByText('#0003')).toBeDefined()
    })

    // First row should be the most recent run (#0003)
    const rows = container.querySelectorAll('tbody tr')
    expect(rows[0]?.textContent).toContain('#0003')
  })
})

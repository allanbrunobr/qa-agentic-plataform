import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RecentRuns } from '../RecentRuns'
import type { ApiRun } from '@/lib/mock-data'

const mockRuns: ApiRun[] = [
  {
    id: 5, scenario_id: 's1', scenario_name: 'Scenario 1', session_id: 'sess-5',
    status: 'complete', started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
    duration_ms: 60000, total_tests: 10, passed: 10, failed: 0, skipped: 0,
    findings_count: 0, critical_count: 0, high_count: 0,
  },
  {
    id: 4, scenario_id: 's1', scenario_name: 'Scenario 1', session_id: 'sess-4',
    status: 'failed', started_at: new Date(Date.now() - 3600000).toISOString(), completed_at: new Date(Date.now() - 3540000).toISOString(),
    duration_ms: 45000, total_tests: 10, passed: 7, failed: 3, skipped: 0,
    findings_count: 2, critical_count: 1, high_count: 1,
  },
]

describe('RecentRuns', () => {
  it('renders the last 5 runs header', () => {
    render(<RecentRuns runs={mockRuns} />)
    expect(screen.getByText('Last 5 runs')).toBeDefined()
  })

  it('renders run IDs', () => {
    render(<RecentRuns runs={mockRuns} />)
    expect(screen.getByText('#0005')).toBeDefined()
    expect(screen.getByText('#0004')).toBeDefined()
  })

  it('renders passed/failed counts', () => {
    render(<RecentRuns runs={mockRuns} />)
    // Run 5: 10 passed, 0 failed; Run 4: 7 passed, 3 failed
    expect(screen.getByText('10')).toBeDefined()
    expect(screen.getByText('7')).toBeDefined()
  })

  it('shows empty state when no runs', () => {
    render(<RecentRuns runs={[]} />)
    expect(screen.getByText('No runs recorded')).toBeDefined()
  })
})

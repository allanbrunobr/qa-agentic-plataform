import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScenarioMetrics } from '../ScenarioMetrics'
import type { ApiRun } from '@/lib/mock-data'

const mockLatestRun: ApiRun = {
  id: 1,
  scenario_id: 'test-scenario',
  scenario_name: 'Test Scenario',
  session_id: 'sess-1',
  status: 'complete',
  started_at: new Date().toISOString(),
  completed_at: new Date().toISOString(),
  duration_ms: 120000,
  total_tests: 10,
  passed: 8,
  failed: 2,
  skipped: 0,
  findings_count: 3,
  critical_count: 1,
  high_count: 2,
}

describe('ScenarioMetrics', () => {
  it('renders all four stat cards', () => {
    render(
      <ScenarioMetrics
        latestRun={mockLatestRun}
        successRate={80}
        avgDurationMs={95000}
      />
    )

    expect(screen.getByText('Last run')).toBeDefined()
    expect(screen.getByText('Pass rate')).toBeDefined()
    expect(screen.getByText('Average duration')).toBeDefined()
    expect(screen.getByText('Last duration')).toBeDefined()
  })

  it('displays success rate percentage', () => {
    render(
      <ScenarioMetrics
        latestRun={mockLatestRun}
        successRate={80}
        avgDurationMs={95000}
      />
    )

    expect(screen.getByText('80%')).toBeDefined()
  })

  it('shows dash when no latest run', () => {
    render(
      <ScenarioMetrics
        latestRun={null}
        successRate={0}
        avgDurationMs={null}
      />
    )

    // Should show dashes for missing data
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(2)
  })
})

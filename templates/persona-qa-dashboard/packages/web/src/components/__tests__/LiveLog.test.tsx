import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LiveLog, parseLogExcerpt, type LogEvent } from '../LiveLog'

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

const mockEvents: LogEvent[] = [
  { type: 'system', timestamp: '10:00:00', message: 'Initializing...', raw: '[10:00:00] Initializing...' },
  { type: 'error', timestamp: '10:00:05', message: 'ERROR: Connection failed', raw: '[10:00:05] ERROR: Connection failed' },
  { type: 'finding', timestamp: '10:00:10', message: 'Finding F001: High severity', severity: 'high', raw: '[10:00:10] Finding F001' },
  { type: 'step_pass', timestamp: '10:00:15', message: 'Step 1 PASSED', raw: '[10:00:15] Step 1 PASSED' },
  { type: 'step_fail', timestamp: '10:00:20', message: 'Step 2 FAILED', raw: '[10:00:20] Step 2 FAILED' },
]

describe('LiveLog', () => {
  it('renders event counter showing total events', () => {
    render(<LiveLog events={mockEvents} />)
    expect(screen.getByText(/5 events/)).toBeDefined()
  })

  it('renders event counter with totalExpected', () => {
    render(<LiveLog events={mockEvents} totalExpected={10} />)
    expect(screen.getByText(/5 of 10 events/)).toBeDefined()
  })

  it('renders filter toggles for system, errors, findings', () => {
    render(<LiveLog events={mockEvents} />)
    expect(screen.getByText('All')).toBeDefined()
    expect(screen.getByText('System')).toBeDefined()
    expect(screen.getByText('Errors')).toBeDefined()
    expect(screen.getByText('Findings')).toBeDefined()
  })

  it('filters to show only errors when Errors filter clicked', () => {
    render(<LiveLog events={mockEvents} />)
    fireEvent.click(screen.getByText('Errors'))

    // Should show filtered count
    expect(screen.getByText(/2 visible/)).toBeDefined()
  })

  it('filters to show only findings when Findings filter clicked', () => {
    render(<LiveLog events={mockEvents} />)
    fireEvent.click(screen.getByText('Findings'))
    expect(screen.getByText(/1 visible\b/)).toBeDefined()
  })

  it('persists filter state in localStorage', () => {
    render(<LiveLog events={mockEvents} />)
    fireEvent.click(screen.getByText('Errors'))
    expect(localStorage.getItem('livelog-filter')).toBe('errors')
  })

  it('loads persisted filter from localStorage', () => {
    localStorage.setItem('livelog-filter', 'findings')
    render(<LiveLog events={mockEvents} />)
    // Findings filter should be active - only 1 event visible
    expect(screen.getByText(/1 visible\b/)).toBeDefined()
  })

  it('shows red background on failure entries', () => {
    const { container } = render(<LiveLog events={mockEvents} />)
    // Error and step_fail entries should have bg-red-500/10
    const redBgEntries = container.querySelectorAll('.bg-red-500\\/10')
    expect(redBgEntries.length).toBe(2)
  })

  it('shows final status banner when run completes', () => {
    render(<LiveLog events={mockEvents} runStatus="complete" />)
    expect(screen.getByText('Run completed successfully')).toBeDefined()
  })

  it('shows final status banner when run fails', () => {
    render(<LiveLog events={mockEvents} runStatus="failed" />)
    expect(screen.getByText('Run failed')).toBeDefined()
  })

  it('does not show status banner when run is still running', () => {
    render(<LiveLog events={mockEvents} runStatus="running" />)
    expect(screen.queryByText('Run completed successfully')).toBeNull()
    expect(screen.queryByText('Run failed')).toBeNull()
  })
})

describe('parseLogExcerpt', () => {
  it('parses timestamped log lines', () => {
    const events = parseLogExcerpt('[10:00:00] Starting test suite\n[10:00:05] ERROR: Connection failed')
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe('step_start')
    expect(events[0].timestamp).toBe('10:00:00')
    expect(events[1].type).toBe('error')
  })

  it('detects persona actions', () => {
    const events = parseLogExcerpt('[10:00:00] Agent Carlos: Navigating to customers page')
    expect(events[0].type).toBe('persona_action')
    expect(events[0].persona).toBe('Carlos')
  })

  it('detects findings', () => {
    const events = parseLogExcerpt('[10:00:00] Step 1 PASSED (30s)')
    expect(events[0].type).toBe('step_pass')
    expect(events[0].duration).toBe(30)
  })
})

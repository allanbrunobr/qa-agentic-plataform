import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SourceBadge } from '../SourceBadge'

describe('SourceBadge', () => {
  it('renders "Dashboard" for dashboard source', () => {
    render(<SourceBadge source="dashboard" />)
    expect(screen.getByText('Dashboard')).toBeDefined()
  })

  it('renders "CLI" for cli source', () => {
    render(<SourceBadge source="cli" />)
    expect(screen.getByText('CLI')).toBeDefined()
  })

  it('renders "Clean Run" for clean-run source', () => {
    render(<SourceBadge source="clean-run" />)
    expect(screen.getByText('Clean Run')).toBeDefined()
  })

  it('renders "Unknown" for unknown source', () => {
    render(<SourceBadge source="unknown" />)
    expect(screen.getByText('Unknown')).toBeDefined()
  })

  it('renders "Unknown" when source is null', () => {
    render(<SourceBadge source={null} />)
    expect(screen.getByText('Unknown')).toBeDefined()
  })

  it('renders "Unknown" when source is undefined', () => {
    render(<SourceBadge />)
    expect(screen.getByText('Unknown')).toBeDefined()
  })

  it('renders "Unknown" for unrecognized source value', () => {
    render(<SourceBadge source="something-else" />)
    expect(screen.getByText('Unknown')).toBeDefined()
  })

  it('applies distinct styling per source type', () => {
    const { rerender, container } = render(<SourceBadge source="dashboard" />)
    const dashboardSpan = container.querySelector('span')
    expect(dashboardSpan?.className).toContain('blue')

    rerender(<SourceBadge source="cli" />)
    const cliSpan = container.querySelector('span')
    expect(cliSpan?.className).toContain('purple')

    rerender(<SourceBadge source="clean-run" />)
    const cleanSpan = container.querySelector('span')
    expect(cleanSpan?.className).toContain('teal')

    rerender(<SourceBadge source="unknown" />)
    const unknownSpan = container.querySelector('span')
    expect(unknownSpan?.className).toContain('zinc')
  })
})

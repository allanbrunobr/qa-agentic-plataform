import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from '@/components/EmptyState'

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="No runs found" />)
    expect(screen.getByText('No runs found')).toBeInTheDocument()
  })

  it('renders the description when provided', () => {
    render(
      <EmptyState
        title="No findings"
        description="Run tests with pnpm test:persona-qa"
      />,
    )
    expect(screen.getByText('No findings')).toBeInTheDocument()
    expect(screen.getByText('Run tests with pnpm test:persona-qa')).toBeInTheDocument()
  })

  it('does not render description when omitted', () => {
    const { container } = render(<EmptyState title="Empty" />)
    // Only the title paragraph should exist
    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0].textContent).toBe('Empty')
  })

  it('renders a custom icon when provided', () => {
    render(
      <EmptyState
        title="Custom"
        icon={<span data-testid="custom-icon">icon</span>}
      />,
    )
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
  })
})

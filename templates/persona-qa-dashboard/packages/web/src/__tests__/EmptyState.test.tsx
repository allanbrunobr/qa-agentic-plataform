import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from '@/components/EmptyState'

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="Nenhuma execução encontrada" />)
    expect(screen.getByText('Nenhuma execução encontrada')).toBeInTheDocument()
  })

  it('renders the description when provided', () => {
    render(
      <EmptyState
        title="Nenhum finding"
        description="Execute testes com pnpm test:persona-qa"
      />,
    )
    expect(screen.getByText('Nenhum finding')).toBeInTheDocument()
    expect(screen.getByText('Execute testes com pnpm test:persona-qa')).toBeInTheDocument()
  })

  it('does not render description when omitted', () => {
    const { container } = render(<EmptyState title="Vazio" />)
    // Only the title paragraph should exist
    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0].textContent).toBe('Vazio')
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

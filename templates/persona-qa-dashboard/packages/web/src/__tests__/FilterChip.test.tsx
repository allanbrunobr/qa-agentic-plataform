import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilterChip } from '@/components/FilterChip'

describe('FilterChip', () => {
  it('renders the label text', () => {
    render(<FilterChip label="Completo" onRemove={() => {}} />)
    expect(screen.getByText('Completo')).toBeInTheDocument()
  })

  it('calls onRemove when the X button is clicked', async () => {
    const onRemove = vi.fn()
    render(<FilterChip label="Completo" onRemove={onRemove} />)

    const removeButton = screen.getByRole('button', { name: /remover filtro/i })
    await userEvent.click(removeButton)

    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('includes the label in the aria-label for accessibility', () => {
    render(<FilterChip label="Status: Falhou" onRemove={() => {}} />)
    expect(screen.getByRole('button', { name: 'Remover filtro: Status: Falhou' })).toBeInTheDocument()
  })
})

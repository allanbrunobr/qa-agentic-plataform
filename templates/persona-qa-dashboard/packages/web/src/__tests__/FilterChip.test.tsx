import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilterChip } from '@/components/FilterChip'

describe('FilterChip', () => {
  it('renders the label text', () => {
    render(<FilterChip label="Complete" onRemove={() => {}} />)
    expect(screen.getByText('Complete')).toBeInTheDocument()
  })

  it('calls onRemove when the X button is clicked', async () => {
    const onRemove = vi.fn()
    render(<FilterChip label="Complete" onRemove={onRemove} />)

    const removeButton = screen.getByRole('button', { name: /remove filter/i })
    await userEvent.click(removeButton)

    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('includes the label in the aria-label for accessibility', () => {
    render(<FilterChip label="Status: Failed" onRemove={() => {}} />)
    expect(screen.getByRole('button', { name: 'Remove filter: Status: Failed' })).toBeInTheDocument()
  })
})

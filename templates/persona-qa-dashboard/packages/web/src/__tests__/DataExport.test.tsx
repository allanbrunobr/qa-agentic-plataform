import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DataExport } from '@/components/DataExport'

describe('DataExport', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['test-data'], { type: 'text/plain' })),
    } as Response)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders JSON, CSV, and Report buttons', () => {
    render(<DataExport />)

    expect(screen.getByText('JSON')).toBeInTheDocument()
    expect(screen.getByText('CSV')).toBeInTheDocument()
    expect(screen.getByText('Report')).toBeInTheDocument()
  })

  it('fetches /api/runs/export?format=json with filter params on JSON click', async () => {
    render(<DataExport filterParams={{ status: 'complete', scenario: 'sc-1' }} />)

    await userEvent.click(screen.getByText('JSON'))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })

    const calledUrl = fetchSpy.mock.calls[0][0] as string
    expect(calledUrl).toContain('/api/runs/export?')
    expect(calledUrl).toContain('format=json')
    expect(calledUrl).toContain('status=complete')
    expect(calledUrl).toContain('scenario=sc-1')
  })

  it('fetches /api/runs/export?format=csv on CSV click', async () => {
    render(<DataExport />)

    await userEvent.click(screen.getByText('CSV'))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })

    const calledUrl = fetchSpy.mock.calls[0][0] as string
    expect(calledUrl).toContain('format=csv')
  })

  it('fetches /api/runs/export-summary with filter params on Report click', async () => {
    render(<DataExport filterParams={{ status: 'failed' }} />)

    await userEvent.click(screen.getByText('Report'))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })

    const calledUrl = fetchSpy.mock.calls[0][0] as string
    expect(calledUrl).toContain('/api/runs/export-summary?')
    expect(calledUrl).toContain('status=failed')
  })

  it('calls URL.revokeObjectURL after download', async () => {
    render(<DataExport />)

    await userEvent.click(screen.getByText('JSON'))

    await waitFor(() => {
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
    })
  })
})

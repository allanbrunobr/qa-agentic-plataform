import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StaleBanner } from '@/components/StaleBanner'

describe('StaleBanner', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing when the API returns has_data: false', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ has_data: false, is_stale: false, last_activity_at: null, age_ms: null, new_data_available: false })),
    )

    const { container } = render(<StaleBanner />)

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/runs/staleness'))
    })

    expect(container.innerHTML).toBe('')
  })

  it('renders stale warning when is_stale is true', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        has_data: true,
        is_stale: true,
        last_activity_at: '2024-01-01T00:00:00Z',
        age_ms: 7200000, // 2 hours
        new_data_available: false,
      })),
    )

    render(<StaleBanner />)

    await waitFor(() => {
      expect(screen.getByText(/dados podem estar desatualizados/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/2h atrás/)).toBeInTheDocument()
  })

  it('renders new data banner when new_data_available is true', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        has_data: true,
        is_stale: false,
        last_activity_at: '2024-01-01T00:00:00Z',
        age_ms: 1800000,
        new_data_available: true,
      })),
    )

    render(<StaleBanner />)

    await waitFor(() => {
      expect(screen.getByText(/novos dados disponíveis/i)).toBeInTheDocument()
    })
    expect(screen.getByText('Sincronizar')).toBeInTheDocument()
  })

  it('dismisses stale warning when X is clicked', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        has_data: true,
        is_stale: true,
        last_activity_at: '2024-01-01T00:00:00Z',
        age_ms: 7200000,
        new_data_available: false,
      })),
    )

    render(<StaleBanner />)

    await waitFor(() => {
      expect(screen.getByText(/dados podem estar desatualizados/i)).toBeInTheDocument()
    })

    await userEvent.click(screen.getByLabelText('Fechar alerta'))

    expect(screen.queryByText(/dados podem estar desatualizados/i)).not.toBeInTheDocument()
  })

  it('calls /api/runs/staleness endpoint, not /health or /api/sync/status', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        has_data: true,
        is_stale: false,
        last_activity_at: '2024-01-01T00:00:00Z',
        age_ms: 1000,
        new_data_available: false,
      })),
    )

    render(<StaleBanner />)

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    const calledUrl = fetchSpy.mock.calls[0][0] as string
    expect(calledUrl).toContain('/api/runs/staleness')
    expect(calledUrl).not.toContain('/health')
    expect(calledUrl).not.toContain('/api/sync/status')
  })

  it('renders both banners when stale AND new data available', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        has_data: true,
        is_stale: true,
        last_activity_at: '2024-01-01T00:00:00Z',
        age_ms: 7200000,
        new_data_available: true,
      })),
    )

    render(<StaleBanner />)

    await waitFor(() => {
      expect(screen.getByText(/dados podem estar desatualizados/i)).toBeInTheDocument()
      expect(screen.getByText(/novos dados disponíveis/i)).toBeInTheDocument()
    })
  })
})

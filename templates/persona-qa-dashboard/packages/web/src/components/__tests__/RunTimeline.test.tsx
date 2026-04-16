import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { RunTimeline } from '../RunTimeline'

// Full timeline payload including all 5 event types from the AC:
// setup → artifact → finding → scenario_complete → sync
const mockEvents = {
  run_id: 1,
  events: [
    { id: '1-setup', type: 'setup', label: 'Setup iniciado', timestamp: '2026-04-10T10:00:00Z', durationFromPrev: null },
    { id: '1-artifact', type: 'artifact', label: 'Artefatos gerados (10 tests, 3 findings)', timestamp: '2026-04-10T10:00:45Z', durationFromPrev: 45000 },
    { id: '1-findings', type: 'finding', label: '3 findings emitidos', timestamp: '2026-04-10T10:01:30Z', durationFromPrev: 45000 },
    { id: '1-scenario', type: 'scenario_complete', label: 'Cenário concluído com sucesso', timestamp: '2026-04-10T10:02:00Z', durationFromPrev: 30000 },
    { id: '1-sync', type: 'sync', label: 'Sincronização finalizada', timestamp: '2026-04-10T10:02:00Z', durationFromPrev: 0 },
  ],
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('RunTimeline', () => {
  it('renders all 5 timeline event types from the AC', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockEvents),
    } as Response)

    render(<RunTimeline runId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Setup iniciado')).toBeDefined()
    })

    // AC: setup started
    expect(screen.getByText('Setup iniciado')).toBeDefined()
    // AC: artifacts written
    expect(screen.getByText('Artefatos gerados (10 tests, 3 findings)')).toBeDefined()
    // AC: findings emitted (with count)
    expect(screen.getByText('3 findings emitidos')).toBeDefined()
    // AC: scenario completed
    expect(screen.getByText('Cenário concluído com sucesso')).toBeDefined()
    // AC: sync finalized
    expect(screen.getByText('Sincronização finalizada')).toBeDefined()
  })

  it('renders failed scenario variant', async () => {
    const failedEvents = {
      run_id: 2,
      events: [
        { id: '2-setup', type: 'setup', label: 'Setup iniciado', timestamp: '2026-04-10T10:00:00Z', durationFromPrev: null },
        { id: '2-scenario', type: 'scenario_failed', label: 'Cenário falhou: timeout', timestamp: '2026-04-10T10:01:00Z', durationFromPrev: 60000 },
        { id: '2-sync', type: 'sync', label: 'Sincronização finalizada', timestamp: '2026-04-10T10:01:00Z', durationFromPrev: 0 },
      ],
    }

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(failedEvents),
    } as Response)

    render(<RunTimeline runId={2} />)

    await waitFor(() => {
      expect(screen.getByText('Cenário falhou: timeout')).toBeDefined()
    })
  })

  it('shows duration between events', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockEvents),
    } as Response)

    render(<RunTimeline runId={1} />)

    await waitFor(() => {
      // artifact +45s, finding +45s, scenario +30s
      expect(screen.getAllByText('+45s').length).toBe(2)
    })
    expect(screen.getByText('+30s')).toBeDefined()
  })

  it('shows timestamps for each event', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockEvents),
    } as Response)

    render(<RunTimeline runId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Timeline de Execução')).toBeDefined()
    })
  })

  it('shows loading state initially', () => {
    vi.spyOn(global, 'fetch').mockReturnValueOnce(new Promise(() => {}))
    render(<RunTimeline runId={1} />)
    expect(screen.getByText('Carregando timeline...')).toBeDefined()
  })

  it('shows error state on fetch failure', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'))
    render(<RunTimeline runId={1} />)

    await waitFor(() => {
      expect(screen.getByText(/Erro ao carregar timeline/)).toBeDefined()
    })
  })

  it('shows empty state when no events', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ run_id: 1, events: [] }),
    } as Response)

    render(<RunTimeline runId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Nenhum evento de timeline disponível')).toBeDefined()
    })
  })
})

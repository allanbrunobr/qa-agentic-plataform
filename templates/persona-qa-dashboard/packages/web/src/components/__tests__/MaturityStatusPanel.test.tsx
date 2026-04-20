import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MaturityStatusPanel } from '../MaturityStatusPanel'
import type { Phase2MaturityStatus } from '@/lib/api'

describe('MaturityStatusPanel', () => {
  it('renders L4 and L5 maturity status with capability evidence', () => {
    render(<MaturityStatusPanel maturity={maturityStatus()} />)

    expect(screen.getByText('Baseline operacional')).toBeInTheDocument()
    expect(screen.getByText('Operacional governado')).toBeInTheDocument()
    expect(screen.getByText('Workflow contracts')).toBeInTheDocument()
    expect(screen.getByText('Independent audit')).toBeInTheDocument()
    expect(screen.getByText('Runtime learning loads')).toBeInTheDocument()
    expect(screen.getByText('Lifecycle L5 events')).toBeInTheDocument()
    expect(screen.getAllByText('95%')).toHaveLength(2)
  })
})

function maturityStatus(): Phase2MaturityStatus {
  return {
    generatedAt: '2026-04-20T12:00:00.000Z',
    releaseGate: 'ready',
    levels: {
      l4: {
        level: 'L4',
        status: 'stable',
        completion: 95,
        verdict: 'Baseline operacional',
        summary: 'Execução multiagente, contratos, quality gates, evidência e recuperação estão no fluxo principal.',
        capabilities: [
          {
            id: 'workflow_contracts',
            label: 'Workflow contracts',
            state: 'complete',
            evidence: 'Contratos determinísticos avaliados por sessão.',
          },
        ],
        signals: [
          { label: 'Sessões finais', value: 2, tone: 'neutral' },
          { label: 'Contratos compliant', value: 2, tone: 'success' },
        ],
      },
      l5: {
        level: 'L5',
        status: 'operational',
        completion: 95,
        verdict: 'Operacional governado',
        summary: 'Aprendizado, healing, auditoria, materialização verificada e fila meta-orquestrada estão governados.',
        capabilities: [
          {
            id: 'independent_audit',
            label: 'Independent audit',
            state: 'guarded',
            evidence: 'Decisões de governança recebem auditoria independente.',
          },
        ],
        signals: [
          { label: 'Revisões pendentes', value: 0, tone: 'success' },
          { label: 'Decisões bloqueadas', value: 0, tone: 'success' },
          { label: 'Runtime learning loads', value: 1, tone: 'success' },
          { label: 'Lifecycle L5 events', value: 12, tone: 'success' },
        ],
      },
    },
  }
}

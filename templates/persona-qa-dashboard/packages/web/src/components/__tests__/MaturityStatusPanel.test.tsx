import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MaturityStatusPanel } from '../MaturityStatusPanel'
import type { Phase2MaturityStatus } from '@/lib/api'

describe('MaturityStatusPanel', () => {
  it('renders L4 and L5 maturity status with capability evidence', () => {
    render(<MaturityStatusPanel maturity={maturityStatus()} />)

    expect(screen.getByText('Operational baseline')).toBeInTheDocument()
    expect(screen.getByText('Governed operational')).toBeInTheDocument()
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
        verdict: 'Operational baseline',
        summary: 'Multi-agent execution, contracts, quality gates, evidence, and recovery are in the main flow.',
        capabilities: [
          {
            id: 'workflow_contracts',
            label: 'Workflow contracts',
            state: 'complete',
            evidence: 'Deterministic contracts evaluated per session.',
          },
        ],
        signals: [
          { label: 'Final sessions', value: 2, tone: 'neutral' },
          { label: 'Compliant contracts', value: 2, tone: 'success' },
        ],
      },
      l5: {
        level: 'L5',
        status: 'operational',
        completion: 95,
        verdict: 'Governed operational',
        summary: 'Learning, healing, audit, verified materialization, and the meta-orchestrated queue are governed.',
        capabilities: [
          {
            id: 'independent_audit',
            label: 'Independent audit',
            state: 'guarded',
            evidence: 'Governance decisions get an independent audit.',
          },
        ],
        signals: [
          { label: 'Pending reviews', value: 0, tone: 'success' },
          { label: 'Blocked decisions', value: 0, tone: 'success' },
          { label: 'Runtime learning loads', value: 1, tone: 'success' },
          { label: 'Lifecycle L5 events', value: 12, tone: 'success' },
        ],
      },
    },
  }
}

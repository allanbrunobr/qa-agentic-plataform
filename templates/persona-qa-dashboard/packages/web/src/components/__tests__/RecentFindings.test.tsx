import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RecentFindings } from '../RecentFindings'
import type { ApiFinding } from '@/lib/mock-data'

const mockFinding: ApiFinding = {
  id: 1,
  run_id: 1,
  finding_id: 'F001',
  agent: 'Carlos',
  step: 'Navigate to customers',
  severity: 'high',
  title: 'Customer record not accessible',
  expected: 'Customer record visible',
  actual: 'Error 403',
  screenshot_path: null,
  timestamp: new Date().toISOString(),
}

describe('RecentFindings', () => {
  it('renders findings count', () => {
    render(<RecentFindings totalFindings={5} lastFinding={mockFinding} />)
    expect(screen.getByText('5')).toBeDefined()
    expect(screen.getByText(/findings recentes/)).toBeDefined()
  })

  it('renders last finding title and severity', () => {
    render(<RecentFindings totalFindings={5} lastFinding={mockFinding} />)
    expect(screen.getByText('Customer record not accessible')).toBeDefined()
    expect(screen.getByText('High')).toBeDefined()
  })

  it('shows no findings message when null', () => {
    render(<RecentFindings totalFindings={0} lastFinding={null} />)
    expect(screen.getByText('0')).toBeDefined()
    expect(screen.getByText('Nenhum finding registrado')).toBeDefined()
  })
})

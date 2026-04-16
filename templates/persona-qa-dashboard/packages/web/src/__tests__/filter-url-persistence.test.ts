import { describe, it, expect } from 'vitest'
import { EMPTY_FILTERS, type RunFilterState } from '@/components/RunFilters'

describe('RunFilterState URL persistence', () => {
  it('EMPTY_FILTERS contains source key (for wt2 integration)', () => {
    expect(EMPTY_FILTERS).toHaveProperty('source')
    expect(EMPTY_FILTERS.source).toBe('')
  })

  it('EMPTY_FILTERS has all expected filter keys', () => {
    const expectedKeys: (keyof RunFilterState)[] = [
      'scenario',
      'status',
      'source',
      'from',
      'to',
      'has_findings',
    ]
    for (const key of expectedKeys) {
      expect(EMPTY_FILTERS).toHaveProperty(key)
      expect(EMPTY_FILTERS[key]).toBe('')
    }
  })

  it('source filter serializes to URL params when set', () => {
    const filters: RunFilterState = {
      ...EMPTY_FILTERS,
      source: 'ci',
      status: 'complete',
    }

    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value)
    }

    const qs = params.toString()
    expect(qs).toContain('source=ci')
    expect(qs).toContain('status=complete')
  })

  it('empty source does not leak into URL params', () => {
    const filters: RunFilterState = {
      ...EMPTY_FILTERS,
      status: 'complete',
    }

    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value)
    }

    expect(params.toString()).not.toContain('source')
  })

  it('active filters computed correctly including source', () => {
    const filters: RunFilterState = {
      scenario: 'sc-1',
      status: '',
      source: 'manual',
      from: '2024-01-01',
      to: '',
      has_findings: 'true',
    }

    const activeFilters = Object.entries(filters).filter(([, v]) => v !== '')
    expect(activeFilters).toHaveLength(4)
    expect(activeFilters.map(([k]) => k)).toEqual(['scenario', 'source', 'from', 'has_findings'])
  })
})

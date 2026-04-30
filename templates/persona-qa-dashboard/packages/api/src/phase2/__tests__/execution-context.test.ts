import { describe, expect, it } from 'vitest'
import {
  parseExecutionContext,
  resolveExecutionBaseUrl,
  summarizeExecutionContext,
} from '../services/execution-context.js'

describe('execution context helpers', () => {
  it('parses preview-aware execution context and resolves the frontend preview URL', () => {
    const context = parseExecutionContext({
      source: 'pr_preview',
      branchName: 'feature/LABS-1031',
      prNumber: 1031,
      previewTargets: [
        { role: 'backend', repo: 'org/backend', ref: 'feature/API-204', url: 'https://api-preview.example.com' },
        { role: 'frontend', repo: 'org/frontend', ref: 'feature/LABS-1031', url: 'https://frontend-preview.example.com' },
      ],
    })

    expect(context).toEqual(expect.objectContaining({
      source: 'pr_preview',
      branchName: 'feature/LABS-1031',
      prNumber: 1031,
    }))
    expect(resolveExecutionBaseUrl(context)).toBe('https://frontend-preview.example.com')
    expect(summarizeExecutionContext(context)).toEqual(expect.objectContaining({
      source: 'pr_preview',
      previewTargets: expect.arrayContaining([
        expect.objectContaining({ role: 'frontend', url: 'https://frontend-preview.example.com' }),
      ]),
    }))
  })

  it('returns undefined when no meaningful execution context fields are present', () => {
    expect(parseExecutionContext({})).toBeUndefined()
    expect(parseExecutionContext(undefined)).toBeUndefined()
  })
})

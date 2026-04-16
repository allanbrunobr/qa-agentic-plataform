import type { FailureCategory } from '../types/scenario-types.js'
import type { SessionService } from './session-service.js'

export interface FailurePattern {
  category: FailureCategory | 'unknown'
  signature: string
  count: number
  examples: string[]
  mitigation: string
}

export class FailurePatternService {
  constructor(private readonly sessionService: SessionService) {}

  analyzeStep(scenarioId: string, stepId: string, limit = 50): FailurePattern[] {
    const failures = this.sessionService
      .listStepPerformance({ scenarioId, stepId, limit })
      .filter((record) => !record.success)

    const grouped = new Map<string, FailurePattern>()
    for (const failure of failures) {
      const category = failure.errorCategory ?? 'unknown'
      const signature = normalizeSignature(failure.errorMessage ?? category)
      const key = `${category}:${signature}`
      const existing = grouped.get(key) ?? {
        category,
        signature,
        count: 0,
        examples: [],
        mitigation: mitigationFor(category),
      }
      existing.count += 1
      if (failure.errorMessage && existing.examples.length < 3) {
        existing.examples.push(failure.errorMessage)
      }
      grouped.set(key, existing)
    }

    return Array.from(grouped.values()).sort((a, b) => b.count - a.count)
  }
}

function normalizeSignature(message: string): string {
  return message
    .toLowerCase()
    .replace(/\b[0-9a-f]{8,}\b/g, '<id>')
    .replace(/\d+/g, '<n>')
    .slice(0, 160)
}

function mitigationFor(category: FailureCategory | 'unknown'): string {
  switch (category) {
    case 'timeout':
      return 'Check page readiness and consider bounded timeout adaptation.'
    case 'artifact':
      return 'Verify required artifacts are produced before declaring success.'
    case 'auth':
      return 'Validate credentials and API key propagation before retry.'
    case 'capability':
      return 'Check host source snapshot and capability module resolution.'
    case 'model':
      return 'Retry with compact context or model escalation only when justified.'
    case 'tool_policy':
      return 'Review tool risk policy and allowed tool list for this persona.'
    case 'sensor':
      return 'Inspect sensor details before marking the step complete.'
    default:
      return 'Inspect recent examples and add a specific mitigation once classified.'
  }
}

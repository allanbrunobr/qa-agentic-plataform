import type { FailureCategory, StepExecutionStatus } from '../types/scenario-types.js'
import type { Session, SessionEvent } from '../types/session-types.js'

export type FailureRootCause =
  | 'provider_auth'
  | 'application_login'
  | 'backend_unavailable'
  | 'ui_selector'
  | 'workflow_contract'
  | 'agent_timeout'
  | 'tool_policy'
  | 'capability_module'
  | 'model_provider'
  | 'sensor_validation'
  | 'artifact_missing'
  | 'platform_bug'
  | 'interrupted'
  | 'unknown'

export interface FailureDiagnosis {
  rootCause: FailureRootCause
  failureCategory: FailureCategory
  title: string
  detail: string
  retryable: boolean
  confidence: 'high' | 'medium' | 'low'
  recommendedAction: string
  sourceEventType?: string
  sourceStepId?: string
  sourceAgentId?: string
}

interface Rule {
  rootCause: FailureRootCause
  failureCategory: FailureCategory
  title: string
  retryable: boolean
  recommendedAction: string
  confidence: FailureDiagnosis['confidence']
  matches: (message: string, status?: StepExecutionStatus) => boolean
}

const RULES: Rule[] = [
  {
    rootCause: 'provider_auth',
    failureCategory: 'auth',
    title: 'Provider API key rejected',
    retryable: false,
    confidence: 'high',
    recommendedAction: 'Validate the Anthropic key copied into .agentic-qa/.env.local before starting new runs.',
    matches: (message) => (
      message.includes('invalid x-api-key')
      || message.includes('authentication_error')
      || message.includes('anthropic_api_key')
      || message.includes('anthropic api key')
      || (message.includes('401') && message.includes('api key'))
      || message.includes('invalid api key')
    ),
  },
  {
    rootCause: 'application_login',
    failureCategory: 'auth',
    title: 'Application login failed',
    retryable: true,
    confidence: 'high',
    recommendedAction: 'Check the target app credentials, login route, backend availability, and whether the login page changed.',
    matches: (message) => (
      (message.includes('login') || message.includes('entrar')) && (
        message.includes('timeout')
        || message.includes('senha')
        || message.includes('credential')
        || message.includes('redirect')
        || message.includes('dev@')
      )
    ),
  },
  {
    rootCause: 'backend_unavailable',
    failureCategory: 'capability',
    title: 'Backend or target URL unavailable',
    retryable: true,
    confidence: 'high',
    recommendedAction: 'Verify PLAYWRIGHT_BASE_URL, frontend environment variables, and local or remote backend health.',
    matches: (message) => (
      message.includes('econnrefused')
      || message.includes('enotfound')
      || message.includes('net::err_connection_refused')
      || message.includes('failed to fetch')
      || message.includes('backend unavailable')
      || message.includes('503')
      || message.includes('502')
      || message.includes('504')
    ),
  },
  {
    rootCause: 'ui_selector',
    failureCategory: 'capability',
    title: 'UI selector or screen state mismatch',
    retryable: true,
    confidence: 'high',
    recommendedAction: 'Update the Playwright capability selector or add navigation/state recovery before the assertion.',
    matches: (message) => (
      message.includes('locator')
      || message.includes('getbyrole')
      || message.includes('tobevisible')
      || message.includes('element(s) not found')
      || message.includes('selector')
      || message.includes('waiting for')
    ),
  },
  {
    rootCause: 'workflow_contract',
    failureCategory: 'sensor',
    title: 'Workflow contract violation',
    retryable: false,
    confidence: 'high',
    recommendedAction: 'Review required artifacts, handoff expectations, and the scenario workflow contract.',
    matches: (message) => (
      message.includes('contract')
      || message.includes('handoff')
      || message.includes('hard violation')
      || message.includes('drift signal')
    ),
  },
  {
    rootCause: 'agent_timeout',
    failureCategory: 'timeout',
    title: 'Agent or tool timeout',
    retryable: true,
    confidence: 'medium',
    recommendedAction: 'Inspect the step duration, timeout profile, target app latency, and retry policy.',
    matches: (message, status) => status === 'timeout' || message.includes('timeout') || message.includes('timed out'),
  },
  {
    rootCause: 'tool_policy',
    failureCategory: 'tool_policy',
    title: 'Tool policy denied execution',
    retryable: false,
    confidence: 'high',
    recommendedAction: 'Review the agent profile toolPolicy/riskPolicy and allow only the required tool.',
    matches: (message) => message.includes('tool_not_allowed') || message.includes('policy does not allow'),
  },
  {
    rootCause: 'capability_module',
    failureCategory: 'capability',
    title: 'Capability module resolution failed',
    retryable: true,
    confidence: 'high',
    recommendedAction: 'Regenerate discovery so host-source-snapshot includes the required support module.',
    matches: (message) => message.includes('cannot find module') || message.includes('module_not_found'),
  },
  {
    rootCause: 'model_provider',
    failureCategory: 'model',
    title: 'Model provider failed',
    retryable: true,
    confidence: 'medium',
    recommendedAction: 'Check provider rate limits, model name, max tokens, and transient API errors.',
    matches: (message) => (
      message.includes('rate limited')
      || message.includes('max_tokens')
      || message.includes('model')
      || message.includes('provider')
    ),
  },
  {
    rootCause: 'sensor_validation',
    failureCategory: 'sensor',
    title: 'Sensor validation failed',
    retryable: false,
    confidence: 'high',
    recommendedAction: 'Inspect the failing sensor output and adjust the scenario assertion or artifact expectation.',
    matches: (message) => message.includes('sensor'),
  },
  {
    rootCause: 'artifact_missing',
    failureCategory: 'artifact',
    title: 'Required artifact missing',
    retryable: false,
    confidence: 'high',
    recommendedAction: 'Ensure the step produces every required artifact before handoff or completion.',
    matches: (message) => (
      message.includes('artifact')
      || message.includes('required')
      || message.includes('evidence')
      || message.includes('missing')
    ),
  },
  {
    rootCause: 'platform_bug',
    failureCategory: 'unknown',
    title: 'AP runtime bug',
    retryable: false,
    confidence: 'high',
    recommendedAction: 'Fix the AP runtime/dashboard code path before rerunning the same scenario.',
    matches: (message) => (
      message.includes('typeerror')
      || message.includes('referenceerror')
      || message.includes('cannot read properties')
      || message.includes('is not a function')
    ),
  },
  {
    rootCause: 'interrupted',
    failureCategory: 'interruption',
    title: 'Run interrupted',
    retryable: true,
    confidence: 'high',
    recommendedAction: 'Resume from checkpoint or start a new run after confirming no stale browser/process remains.',
    matches: (message, status) => status === 'interrupted' || message.includes('interrupted') || message.includes('interruption'),
  },
]

export function diagnoseFailureMessage(error?: unknown, status?: StepExecutionStatus): FailureDiagnosis {
  const detail = normalizeError(error)
  const normalized = detail.toLowerCase()
  const rule = RULES.find((candidate) => candidate.matches(normalized, status))

  if (rule) {
    return {
      rootCause: rule.rootCause,
      failureCategory: rule.failureCategory,
      title: rule.title,
      detail,
      retryable: rule.retryable,
      confidence: rule.confidence,
      recommendedAction: rule.recommendedAction,
    }
  }

  return {
    rootCause: 'unknown',
    failureCategory: 'unknown',
    title: 'Unknown failure',
    detail,
    retryable: true,
    confidence: 'low',
    recommendedAction: 'Inspect the latest failed event, logs, and artifacts before changing scenario behavior.',
  }
}

export function diagnoseSessionFailure(session: Session): FailureDiagnosis | null {
  const event = [...session.events].reverse().find(isFailureEvent)
  if (!event) return null

  const payload = (event.payload ?? event.data ?? {}) as Record<string, unknown>
  const diagnosis = diagnoseFailureMessage(extractPayloadError(payload), extractPayloadStatus(payload))

  return {
    ...diagnosis,
    sourceEventType: event.type,
    sourceStepId: typeof payload.stepId === 'string' ? payload.stepId : undefined,
    sourceAgentId: typeof payload.agentId === 'string' ? payload.agentId : undefined,
  }
}

function isFailureEvent(event: SessionEvent): boolean {
  if (event.type === 'step_failed' || event.type === 'run_failed' || event.type === 'error') return true
  if (event.type !== 'tool_result') return false

  const payload = (event.payload ?? event.data ?? {}) as Record<string, unknown>
  return payload.ok === false || typeof payload.error === 'string' || typeof payload.error === 'object'
}

function extractPayloadError(payload: Record<string, unknown>): unknown {
  if (payload.error) return payload.error
  if (payload.reason) return payload.reason
  if (payload.message) return payload.message
  if (payload.failedStep) return `Failed at ${String(payload.failedStep)}`
  return payload
}

function extractPayloadStatus(payload: Record<string, unknown>): StepExecutionStatus | undefined {
  const status = payload.status
  return typeof status === 'string' ? status as StepExecutionStatus : undefined
}

function normalizeError(error?: unknown): string {
  if (typeof error === 'string') return compact(error)
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    if (typeof record.message === 'string') return compact(record.message)
    if (typeof record.error === 'string') return compact(record.error)
    try {
      return compact(JSON.stringify(record))
    } catch {
      return String(record)
    }
  }
  if (error == null) return 'No failure details available'
  return compact(String(error))
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500)
}

import type { Session, SessionEvent } from '../types/session-types.js'
import type {
  GovernanceAction,
  GovernanceSubjectType,
  HealingAction,
  LearningProposal,
  ScenarioDraft,
  SessionService,
} from './session-service.js'

export type AuditorVerdict = 'passed' | 'warning' | 'failed'
export type AuditorFindingSeverity = 'error' | 'warning'

export interface AuditorFinding {
  severity: AuditorFindingSeverity
  code: string
  message: string
  evidence: Record<string, unknown>
}

export interface AuditorEvaluation {
  sessionId: string
  verdict: AuditorVerdict
  checkedAt: string
  findings: AuditorFinding[]
  summary: {
    agentStarted: number
    agentStopped: number
    terminalEvents: number
  }
}

export interface GovernanceAuditEvaluation {
  subjectType: GovernanceSubjectType
  subjectId: string
  action: GovernanceAction
  verdict: AuditorVerdict
  checkedAt: string
  findings: AuditorFinding[]
  summary: {
    subjectType: GovernanceSubjectType
    action: GovernanceAction
    requirements: string[]
  }
}

type GovernanceAuditSubject = LearningProposal | ScenarioDraft | HealingAction

export class IndependentAuditorService {
  evaluateSession(session: Session): AuditorEvaluation {
    const findings: AuditorFinding[] = []
    const openAgents = new Map<string, SessionEvent[]>()
    let agentStarted = 0
    let agentStopped = 0

    for (const event of session.events) {
      if (event.type === 'agent_started') {
        agentStarted += 1
        const key = lifecycleKey(event)
        const bucket = openAgents.get(key) ?? []
        bucket.push(event)
        openAgents.set(key, bucket)
        continue
      }

      if (event.type === 'agent_stopped') {
        agentStopped += 1
        const key = lifecycleKey(event)
        const bucket = openAgents.get(key) ?? []
        if (bucket.length === 0) {
          findings.push({
            severity: 'error',
            code: 'agent_stop_without_start',
            message: 'Agent stopped event has no matching agent started event.',
            evidence: { eventId: event.id, key },
          })
          continue
        }

        bucket.shift()
        if (bucket.length === 0) {
          openAgents.delete(key)
        } else {
          openAgents.set(key, bucket)
        }
      }
    }

    for (const [key, events] of openAgents) {
      for (const event of events) {
        findings.push({
          severity: 'error',
          code: 'agent_start_without_stop',
          message: 'Agent started event has no matching agent stopped event.',
          evidence: { eventId: event.id, key },
        })
      }
    }

    const terminalEvents = session.events.filter((event) => (
      event.type === 'session_completed' || event.type === 'session_failed'
    ))

    if (session.status === 'complete' && !terminalEvents.some((event) => event.type === 'session_completed')) {
      findings.push({
        severity: 'warning',
        code: 'missing_session_completed',
        message: 'Completed session is missing a session_completed lifecycle event.',
        evidence: { sessionStatus: session.status },
      })
    }

    if (session.status === 'failed' && !terminalEvents.some((event) => event.type === 'session_failed')) {
      findings.push({
        severity: 'warning',
        code: 'missing_session_failed',
        message: 'Failed session is missing a session_failed lifecycle event.',
        evidence: { sessionStatus: session.status },
      })
    }

    if (
      terminalEvents.some((event) => event.type === 'session_completed')
      && terminalEvents.some((event) => event.type === 'session_failed')
    ) {
      findings.push({
        severity: 'error',
        code: 'conflicting_terminal_events',
        message: 'Session has both completed and failed lifecycle events.',
        evidence: { terminalEvents: terminalEvents.map((event) => event.type) },
      })
    }

    return {
      sessionId: session.id,
      verdict: findings.some((finding) => finding.severity === 'error')
        ? 'failed'
        : findings.length > 0
          ? 'warning'
          : 'passed',
      checkedAt: new Date().toISOString(),
      findings,
      summary: {
        agentStarted,
        agentStopped,
        terminalEvents: terminalEvents.length,
      },
    }
  }

  evaluateGovernanceAction(input: {
    subjectType: GovernanceSubjectType
    subject: GovernanceAuditSubject
    action: GovernanceAction
    actor?: string
    sessionService?: SessionService
  }): GovernanceAuditEvaluation {
    const findings: AuditorFinding[] = []

    if (input.subjectType === 'learning_proposal') {
      auditLearningProposal(input.subject as LearningProposal, input.action, input.sessionService, findings)
    } else if (input.subjectType === 'scenario_draft') {
      auditScenarioDraft(input.subject as ScenarioDraft, input.action, input.actor, findings)
    } else if (input.subjectType === 'healing_action') {
      auditHealingAction(input.subject as HealingAction, findings)
    }

    return {
      subjectType: input.subjectType,
      subjectId: input.subject.id,
      action: input.action,
      verdict: findings.some((finding) => finding.severity === 'error')
        ? 'failed'
        : findings.length > 0
          ? 'warning'
          : 'passed',
      checkedAt: new Date().toISOString(),
      findings,
      summary: {
        subjectType: input.subjectType,
        action: input.action,
        requirements: ['independent_audit'],
      },
    }
  }
}

function auditLearningProposal(
  proposal: LearningProposal,
  action: GovernanceAction,
  sessionService: SessionService | undefined,
  findings: AuditorFinding[],
): void {
  if (!proposal.scenarioId || !proposal.stepId) {
    findings.push(errorFinding('learning_scope_missing', 'Learning proposal must target a scenario and step.', {
      proposalId: proposal.id,
      scenarioId: proposal.scenarioId,
      stepId: proposal.stepId,
    }))
  }

  if (!proposal.recommendation || Object.keys(proposal.recommendation).length === 0) {
    findings.push(errorFinding('learning_recommendation_missing', 'Learning proposal must include recommendation evidence.', {
      proposalId: proposal.id,
    }))
  }

  if (action === 'apply') {
    const approvals = sessionService?.listGovernanceDecisions({
      subjectType: 'learning_proposal',
      subjectId: proposal.id,
      limit: 100,
    }).filter((decision) => decision.action === 'approve' && decision.verdict === 'allowed') ?? []

    if (proposal.status !== 'approved' && proposal.status !== 'applied') {
      findings.push(errorFinding('learning_apply_without_approved_status', 'Learning proposal must be approved before apply.', {
        proposalId: proposal.id,
        status: proposal.status,
      }))
    }

    if (approvals.length === 0) {
      findings.push(errorFinding('learning_apply_without_approval_decision', 'Learning proposal apply requires a prior allowed approval decision.', {
        proposalId: proposal.id,
      }))
    }

    if (proposal.patchKind !== 'none' && proposal.patchKind !== 'prompt_overlay') {
      findings.push(errorFinding('learning_apply_unsafe_patch_kind', 'Only no-op and prompt overlay proposals can be applied automatically.', {
        proposalId: proposal.id,
        patchKind: proposal.patchKind,
      }))
    }
  }
}

function auditScenarioDraft(
  draft: ScenarioDraft,
  action: GovernanceAction,
  actor: string | undefined,
  findings: AuditorFinding[],
): void {
  if (action === 'approve' || action === 'reject') {
    if (!actor || actor === 'system' || actor === 'human_reviewer') {
      findings.push(errorFinding('scenario_draft_explicit_reviewer_required', 'Scenario draft review requires an explicit human reviewer.', {
        draftId: draft.id,
        actor,
      }))
    }
  }

  if (action === 'approve') {
    if (!draft.scenarioId || !draft.name) {
      findings.push(errorFinding('scenario_draft_identity_missing', 'Scenario draft must include scenario identity before approval.', {
        draftId: draft.id,
        scenarioId: draft.scenarioId,
        name: draft.name,
      }))
    }

    if (!draft.contract || Object.keys(draft.contract).length === 0) {
      findings.push(errorFinding('scenario_draft_contract_missing', 'Scenario draft must include a non-empty contract before approval.', {
        draftId: draft.id,
      }))
    }
  }
}

function auditHealingAction(action: HealingAction, findings: AuditorFinding[]): void {
  if (!action.type || !action.target || !action.reason) {
    findings.push(errorFinding('healing_action_identity_missing', 'Healing action must include type, target, and reason.', {
      actionId: action.id,
      type: action.type,
      target: action.target,
    }))
  }

  if (action.automatic && action.status === 'applied') {
    if (action.type !== 'increase_timeout_pool') {
      findings.push(errorFinding('healing_auto_action_not_allowlisted', 'Automatic healing action is not in the allowlist.', {
        actionId: action.id,
        type: action.type,
      }))
    }

    const maxTimeoutIncreasePercent = (action.metadata ?? {})['maxTimeoutIncreasePercent']
    if (typeof maxTimeoutIncreasePercent !== 'number' || maxTimeoutIncreasePercent > 50) {
      findings.push(errorFinding('healing_auto_action_unbounded', 'Automatic timeout healing must carry bounded timeout metadata.', {
        actionId: action.id,
        maxTimeoutIncreasePercent,
      }))
    }
  }
}

function errorFinding(code: string, message: string, evidence: Record<string, unknown>): AuditorFinding {
  return { severity: 'error', code, message, evidence }
}

function lifecycleKey(event: SessionEvent): string {
  const payload = (event.payload ?? event.data ?? {}) as Record<string, unknown>
  const agentId = typeof payload['agentId'] === 'string' ? payload['agentId'] : 'unknown_agent'
  const stepId = typeof payload['stepId'] === 'string' ? payload['stepId'] : 'unknown_step'
  const attempt = typeof payload['attempt'] === 'number' || typeof payload['attempt'] === 'string'
    ? String(payload['attempt'])
    : 'unknown_attempt'
  return `${agentId}:${stepId}:${attempt}`
}

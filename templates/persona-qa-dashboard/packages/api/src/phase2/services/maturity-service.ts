import { buildContractEvaluation } from './contract-evaluation.js'
import { filterSessionsForAvailableScenarios } from './available-scenarios.js'
import { L5ClosedLoopService } from './l5-closed-loop-service.js'
import { L5LoopGuardService } from './l5-loop-guard-service.js'
import { MetaOrchestrator } from './meta-orchestrator.js'
import { buildScenarioQualityGateMap } from './scenario-quality-gates.js'
import type { SessionService } from './session-service.js'

export type MaturityCapabilityState = 'complete' | 'guarded' | 'beta'
export type L4MaturityStatus = 'ready' | 'stable' | 'attention'
export type L5MaturityStatus = 'operational' | 'controlled_beta' | 'attention'

export interface MaturityCapability {
  id: string
  label: string
  state: MaturityCapabilityState
  evidence: string
}

export interface MaturitySignal {
  label: string
  value: number | string
  tone: 'success' | 'warning' | 'danger' | 'neutral'
}

export interface L4MaturityLevel {
  level: 'L4'
  status: L4MaturityStatus
  completion: number
  verdict: string
  summary: string
  capabilities: MaturityCapability[]
  signals: MaturitySignal[]
}

export interface L5MaturityLevel {
  level: 'L5'
  status: L5MaturityStatus
  completion: number
  verdict: string
  summary: string
  capabilities: MaturityCapability[]
  signals: MaturitySignal[]
}

export interface MaturityStatus {
  generatedAt: string
  releaseGate: 'ready' | 'attention'
  levels: {
    l4: L4MaturityLevel
    l5: L5MaturityLevel
  }
}

export function buildMaturityStatus(sessionService: SessionService): MaturityStatus {
  const sessions = filterSessionsForAvailableScenarios(sessionService.getAllSessions())
  const finalSessions = sessions.filter((session) => (
    session.status === 'complete' || session.status === 'failed'
  ))
  const evaluations = finalSessions
    .map((session) => buildContractEvaluation(session).contractEvaluation)
    .filter((evaluation): evaluation is NonNullable<typeof evaluation> => evaluation !== null)

  const contractViolations = evaluations.filter((evaluation) => evaluation.verdict === 'contract_violated').length
  const contractDrift = evaluations.filter((evaluation) => evaluation.verdict === 'contract_drift').length
  const compliantContracts = evaluations.filter((evaluation) => evaluation.verdict === 'contract_compliant').length
  const qualityGates = Object.values(buildScenarioQualityGateMap(sessionService))
  const restrictedGates = qualityGates.filter((gate) => gate.status === 'restricted').length
  const reviewGates = qualityGates.filter((gate) => gate.status === 'review_required').length

  const learningProposals = sessionService.listLearningProposals({ limit: 500 })
  const scenarioDrafts = sessionService.listScenarioDrafts({ limit: 500 })
  const healingActions = sessionService.listHealingActions({ limit: 500 })
  const governanceDecisions = sessionService.listGovernanceDecisions({ limit: 500 })
  const materializations = sessionService.listL5Materializations({ limit: 500 })
  const loopGuards = new L5LoopGuardService(sessionService).summarize()
  const queueItems = new MetaOrchestrator(sessionService).buildGovernedRunQueue(10)
  const closedLoopRuns = sessionService.listL5ClosedLoopRuns({ limit: 100 })
  const latestClosedLoop = new L5ClosedLoopService(sessionService).getStatus(1).latestRun

  const pendingReviews = learningProposals.filter((proposal) => proposal.status === 'proposed').length
    + scenarioDrafts.filter((draft) => draft.status === 'pending').length
    + healingActions.filter((action) => action.status === 'proposed').length
  const blockedDecisions = governanceDecisions.filter((decision) => decision.verdict === 'blocked').length
  const independentAudits = governanceDecisions.filter((decision) => (
    decision.requirements?.includes('independent_audit')
  )).length
  const boundedAutomaticActions = governanceDecisions.filter((decision) => (
    decision.subjectType === 'healing_action'
    && decision.verdict === 'allowed'
    && decision.requirements?.includes('bounded_policy')
  )).length
  const activeMaterializations = materializations.filter((materialization) => materialization.status === 'active').length
  const verifiedMaterializations = materializations.filter((materialization) => {
    const metadata = materialization.metadata ?? {}
    const audit = metadata['independentAudit'] as Record<string, unknown> | undefined
    const verification = metadata['postWriteVerification'] as Record<string, unknown> | undefined
    return audit?.['verdict'] === 'passed' && verification?.['checksumMatches'] === true
  }).length
  const blockedLoops = loopGuards.filter((guard) => guard.status === 'blocked').length
  const queuedMetaRuns = queueItems.filter((item) => item.status === 'queued').length
  const completedClosedLoops = closedLoopRuns.filter((run) => run.status === 'completed').length
  const closedLoopsNeedingReview = closedLoopRuns.filter((run) => run.status === 'needs_review').length
  const closedLoopLifecycle = summarizeClosedLoopLifecycle(closedLoopRuns)
  const closedLoopIndependentAudits = summarizeClosedLoopIndependentAudits(closedLoopRuns)
  const runtimeLearningUsage = summarizeRuntimeLearningUsage(sessions)
  const terminalSessionAudits = summarizeTerminalSessionAudits(sessions)
  const learningSignals = sessionService.summarizeL5LearningSignals({ limit: 500 })

  const l4Status: L4MaturityStatus = restrictedGates > 0 || contractViolations > 0
    ? 'attention'
    : finalSessions.length > 0
      ? 'stable'
      : 'ready'
  const l5Status: L5MaturityStatus = blockedDecisions > 0 || blockedLoops > 0
    ? 'attention'
    : verifiedMaterializations > 0 && independentAudits > 0 && pendingReviews === 0 && queuedMetaRuns > 0
      ? 'operational'
      : 'controlled_beta'

  return {
    generatedAt: new Date().toISOString(),
    releaseGate: l4Status === 'attention' || l5Status === 'attention' ? 'attention' : 'ready',
    levels: {
      l4: {
        level: 'L4',
        status: l4Status,
        completion: l4Status === 'attention' ? 90 : 95,
        verdict: l4Status === 'attention' ? 'Operational attention' : 'Operational baseline',
        summary: 'Multi-agent execution, contracts, quality gates, evidence, and recovery are in the main flow.',
        capabilities: [
          {
            id: 'workflow_contracts',
            label: 'Workflow contracts',
            state: 'complete',
            evidence: 'Deterministic contracts evaluated per session.',
          },
          {
            id: 'tool_governance',
            label: 'Tool governance',
            state: 'complete',
            evidence: 'Tools go through the registry, policies, and ledger.',
          },
          {
            id: 'instruction_governance',
            label: 'Instruction governance',
            state: 'complete',
            evidence: 'Instruction layers have precedence, validation, and budget.',
          },
          {
            id: 'quality_gates',
            label: 'Quality gates',
            state: 'complete',
            evidence: 'Scenarios can move to review or restricted based on history.',
          },
          {
            id: 'runtime_evidence',
            label: 'Runtime evidence',
            state: 'complete',
            evidence: 'Blank screenshots are rejected and required artifacts close the step.',
          },
        ],
        signals: [
          { label: 'Final sessions', value: finalSessions.length, tone: 'neutral' },
          { label: 'Compliant contracts', value: compliantContracts, tone: 'success' },
          { label: 'Violated contracts', value: contractViolations, tone: contractViolations > 0 ? 'danger' : 'success' },
          { label: 'Drift signals', value: contractDrift, tone: contractDrift > 0 ? 'warning' : 'success' },
          { label: 'Quality gates restricted', value: restrictedGates, tone: restrictedGates > 0 ? 'danger' : 'success' },
          { label: 'Quality gates in review', value: reviewGates, tone: reviewGates > 0 ? 'warning' : 'neutral' },
        ],
      },
      l5: {
        level: 'L5',
        status: l5Status,
        completion: l5Status === 'operational' ? 95 : activeMaterializations > 0 && independentAudits > 0 ? 80 : 70,
        verdict: l5Status === 'attention'
          ? 'Governance needs review'
          : l5Status === 'operational'
            ? 'Governed operational'
            : 'Controlled beta',
        summary: l5Status === 'operational'
          ? 'Learning, healing, audit, verified materialization, and the meta-orchestrated queue are governed.'
          : 'Learning, healing, independent audit, and materialization exist, but changes remain governed.',
        capabilities: [
          {
            id: 'learning_control',
            label: 'Learning control',
            state: 'guarded',
            evidence: 'Proposals require approval before they are applied.',
          },
          {
            id: 'independent_audit',
            label: 'Independent audit',
            state: terminalSessionAudits.failed > 0 || closedLoopIndependentAudits.failed > 0
              ? 'guarded'
              : terminalSessionAudits.total > 0 || closedLoopIndependentAudits.total > 0
                ? 'complete'
                : 'guarded',
            evidence: terminalSessionAudits.total > 0 || closedLoopIndependentAudits.total > 0
              ? `${terminalSessionAudits.total} session(s) and ${closedLoopIndependentAudits.total} closed loop(s) received independent verification; ${terminalSessionAudits.failed + closedLoopIndependentAudits.failed} failed.`
              : 'Governance decisions get an independent audit; a terminal audit is recorded at the end of each run.',
          },
          {
            id: 'self_healing',
            label: 'Self-healing',
            state: 'guarded',
            evidence: 'Automatic actions are limited by a bounded policy.',
          },
          {
            id: 'materialization',
            label: 'Materialization',
            state: verifiedMaterializations > 0 ? 'complete' : 'guarded',
            evidence: verifiedMaterializations > 0
              ? 'Applied changes produce durable artifacts with verified audit and checksum.'
              : 'Applied changes produce durable, traceable artifacts.',
          },
          {
            id: 'runtime_learning',
            label: 'Runtime learning',
            state: runtimeLearningUsage.loads > 0 ? 'complete' : verifiedMaterializations > 0 ? 'guarded' : 'beta',
            evidence: runtimeLearningUsage.loads > 0
              ? `${runtimeLearningUsage.loads} run(s) loaded ${runtimeLearningUsage.overlayLoads} L5 overlay(s) from ${runtimeLearningUsage.materializations} materialization(s).`
              : verifiedMaterializations > 0
                ? 'Verified L5 overlays are materialized and wait for the next run to enter the prompt.'
                : 'Runtime only accepts applied, materialized, and verified L5 overlays.',
          },
          {
            id: 'learning_memory',
            label: 'Learning memory',
            state: learningSignals.retained > 0 ? 'complete' : 'beta',
            evidence: learningSignals.retained > 0
              ? `${learningSignals.retained} L5 signal(s) retained with version and auditable source.`
              : 'Governed reviews and promotions will be retained as versioned signals for future runs.',
          },
          {
            id: 'meta_orchestration',
            label: 'Meta-orchestration',
            state: queuedMetaRuns > 0 ? 'guarded' : 'beta',
            evidence: queuedMetaRuns > 0
              ? 'The governed run queue orders scenarios by risk and respects circuit breakers.'
              : 'Prioritization exists as a recommendation, awaiting a governed queue.',
          },
          {
            id: 'circuit_breakers',
            label: 'Circuit breakers',
            state: blockedLoops === 0 ? 'complete' : 'guarded',
            evidence: 'Learning, scenario generation, healing, materialization, and meta-orchestration have formal limits.',
          },
          {
            id: 'closed_loop',
            label: 'Closed loop',
            state: closedLoopLifecycle.runsWithLifecycle > 0 ? 'complete' : latestClosedLoop ? 'guarded' : 'beta',
            evidence: latestClosedLoop
              ? `Latest L5 iteration recorded as ${latestClosedLoop.status}; auditable lifecycle in ${closedLoopLifecycle.runsWithLifecycle} run(s).`
              : 'L5 iterations can run on demand with governance and before/after verification.',
          },
        ],
        signals: [
          { label: 'Pending reviews', value: pendingReviews, tone: pendingReviews > 0 ? 'warning' : 'success' },
          { label: 'Blocked decisions', value: blockedDecisions, tone: blockedDecisions > 0 ? 'danger' : 'success' },
          { label: 'Blocked loops', value: blockedLoops, tone: blockedLoops > 0 ? 'danger' : 'success' },
          {
            label: 'Runtime learning loads',
            value: runtimeLearningUsage.loads,
            tone: runtimeLearningUsage.loads > 0 ? 'success' : verifiedMaterializations > 0 ? 'warning' : 'neutral',
          },
          { label: 'Independent audits', value: independentAudits, tone: independentAudits > 0 ? 'success' : 'neutral' },
          {
            label: 'Session audits',
            value: terminalSessionAudits.total,
            tone: terminalSessionAudits.failed > 0 ? 'danger' : terminalSessionAudits.total > 0 ? 'success' : 'neutral',
          },
          {
            label: 'Closed-loop audits',
            value: closedLoopIndependentAudits.total,
            tone: closedLoopIndependentAudits.failed > 0 ? 'danger' : closedLoopIndependentAudits.total > 0 ? 'success' : 'neutral',
          },
          { label: 'Bounded actions', value: boundedAutomaticActions, tone: boundedAutomaticActions > 0 ? 'success' : 'neutral' },
          { label: 'Active materializations', value: activeMaterializations, tone: activeMaterializations > 0 ? 'success' : 'neutral' },
          { label: 'Verified materializations', value: verifiedMaterializations, tone: verifiedMaterializations > 0 ? 'success' : 'neutral' },
          {
            label: 'Runtime overlays used',
            value: runtimeLearningUsage.overlayLoads,
            tone: runtimeLearningUsage.overlayLoads > 0 ? 'success' : 'neutral',
          },
          {
            label: 'Retained L5 signals',
            value: learningSignals.retained,
            tone: learningSignals.retained > 0 ? 'success' : 'neutral',
          },
          { label: 'Meta-orchestrated queue', value: queuedMetaRuns, tone: queuedMetaRuns > 0 ? 'success' : 'neutral' },
          { label: 'Completed closed loops', value: completedClosedLoops, tone: completedClosedLoops > 0 ? 'success' : 'neutral' },
          { label: 'Closed loops in review', value: closedLoopsNeedingReview, tone: closedLoopsNeedingReview > 0 ? 'warning' : 'success' },
          {
            label: 'Lifecycle L5 events',
            value: closedLoopLifecycle.events,
            tone: closedLoopLifecycle.events > 0 ? 'success' : 'neutral',
          },
        ],
      },
    },
  }
}

function summarizeClosedLoopLifecycle(closedLoopRuns: ReturnType<SessionService['listL5ClosedLoopRuns']>): {
  events: number
  runsWithLifecycle: number
} {
  let events = 0
  let runsWithLifecycle = 0

  for (const run of closedLoopRuns) {
    const lifecycle = run.metadata?.['lifecycle']
    if (!Array.isArray(lifecycle)) continue

    const count = lifecycle.filter((event) => (
      event
      && typeof event === 'object'
      && typeof (event as Record<string, unknown>)['type'] === 'string'
      && typeof (event as Record<string, unknown>)['timestamp'] === 'string'
    )).length

    if (count === 0) continue
    events += count
    runsWithLifecycle += 1
  }

  return { events, runsWithLifecycle }
}

function summarizeClosedLoopIndependentAudits(closedLoopRuns: ReturnType<SessionService['listL5ClosedLoopRuns']>): {
  total: number
  failed: number
} {
  let total = 0
  let failed = 0

  for (const run of closedLoopRuns) {
    const independentAudit = run.verification['independentAudit']
    if (!independentAudit || typeof independentAudit !== 'object' || Array.isArray(independentAudit)) continue

    const verdict = (independentAudit as Record<string, unknown>)['verdict']
    if (verdict !== 'passed' && verdict !== 'warning' && verdict !== 'failed') continue

    total += 1
    if (verdict === 'failed') {
      failed += 1
    }
  }

  return { total, failed }
}

function summarizeRuntimeLearningUsage(sessions: ReturnType<SessionService['getAllSessions']>): {
  loads: number
  overlayLoads: number
  materializations: number
} {
  const materializationIds = new Set<string>()
  let loads = 0
  let overlayLoads = 0

  for (const session of sessions) {
    for (const event of session.events) {
      const payload = event.payload ?? event.data
      if (payload?.['event'] !== 'l5_runtime_learning_loaded') continue

      loads += 1
      const overlayCount = payload['overlayCount']
      if (typeof overlayCount === 'number' && Number.isFinite(overlayCount)) {
        overlayLoads += overlayCount
      }

      const overlays = payload['overlays']
      if (!Array.isArray(overlays)) continue

      for (const overlay of overlays) {
        if (!overlay || typeof overlay !== 'object') continue
        const materializationId = (overlay as Record<string, unknown>)['materializationId']
        if (typeof materializationId === 'string' && materializationId.length > 0) {
          materializationIds.add(materializationId)
        }
      }
    }
  }

  return {
    loads,
    overlayLoads,
    materializations: materializationIds.size,
  }
}

function summarizeTerminalSessionAudits(sessions: ReturnType<SessionService['getAllSessions']>): {
  total: number
  failed: number
} {
  let total = 0
  let failed = 0

  for (const session of sessions) {
    for (const event of session.events) {
      if (event.type !== 'auditor_evaluation') continue
      const payload = event.payload ?? event.data
      if (payload?.['source'] !== 'terminal_session_audit') continue

      total += 1
      if (payload['verdict'] === 'failed') {
        failed += 1
      }
    }
  }

  return { total, failed }
}

import { buildContractEvaluation } from './contract-evaluation.js'
import { CoverageAnalysisService } from './coverage-analysis-service.js'
import { L5LoopGuardService, type L5LoopGuard, type L5LoopId } from './l5-loop-guard-service.js'
import { L5MaterializationService } from './l5-materialization-service.js'
import { LearningControlService } from './learning-control-service.js'
import { MetaOrchestrator, type MetaOrchestrationQueueItem } from './meta-orchestrator.js'
import { buildScenarioQualityGateForSessions } from './scenario-quality-gates.js'
import { SelfHealingService } from './self-healing-service.js'
import type {
  L5ClosedLoopRun,
  LearningProposal,
  SessionService,
  StepPerformanceRecord,
} from './session-service.js'
import type { Session } from '../types/session-types.js'

export interface L5ClosedLoopRunOptions {
  scenarioId?: string
  maxScenarios?: number
  applyApprovedChanges?: boolean
  generateScenarioDrafts?: boolean
  actor?: string
  maxApprovedApplies?: number
}

export interface L5ClosedLoopStatus {
  generatedAt: string
  guards: L5LoopGuard[]
  queue: MetaOrchestrationQueueItem[]
  latestRun: L5ClosedLoopRun | null
  recentRuns: L5ClosedLoopRun[]
}

interface ScenarioSnapshot {
  scenarioId: string
  finalSessions: number
  completeSessions: number
  failedSessions: number
  stepExecutions: number
  failedStepExecutions: number
  activeMaterializations: number
  pendingLearningProposals: number
  approvedLearningProposals: number
  qualityGateStatus: string
}

interface SessionComparison {
  scenarioId: string
  verdict: 'improved' | 'regressed' | 'unchanged' | 'insufficient_history'
  previousSessionId?: string
  latestSessionId?: string
  previousScore?: number
  latestScore?: number
  scoreDelta?: number
  reason: string
}

type L5LifecycleLoopId = L5LoopId | 'verification'

type L5LifecycleEventType =
  | 'closed_loop_started'
  | 'closed_loop_completed'
  | 'loop_started'
  | 'loop_completed'
  | 'loop_blocked'
  | 'scenario_started'
  | 'scenario_completed'

type L5LifecycleEvent = {
  type: L5LifecycleEventType
  timestamp: string
  loop?: L5LifecycleLoopId
  scenarioId?: string
  status?: string
  reason?: string
  details?: Record<string, unknown>
}

export class L5ClosedLoopService {
  constructor(private readonly sessionService: SessionService) {}

  getStatus(limit = 10): L5ClosedLoopStatus {
    const recentRuns = this.sessionService.listL5ClosedLoopRuns({ limit })
    return {
      generatedAt: new Date().toISOString(),
      guards: new L5LoopGuardService(this.sessionService).summarize(),
      queue: new MetaOrchestrator(this.sessionService).buildGovernedRunQueue(10),
      latestRun: recentRuns[0] ?? null,
      recentRuns,
    }
  }

  async runOnce(options: L5ClosedLoopRunOptions = {}): Promise<L5ClosedLoopRun> {
    const startedAt = new Date().toISOString()
    const actor = options.actor ?? 'l5_closed_loop'
    const lifecycle: L5LifecycleEvent[] = []
    appendLifecycle(lifecycle, 'closed_loop_started', {
      details: {
        actor,
        scenarioId: options.scenarioId,
        applyApprovedChanges: options.applyApprovedChanges === true,
        generateScenarioDrafts: options.generateScenarioDrafts === true,
      },
    })
    const maxScenarios = clamp(options.maxScenarios ?? 3, 1, 10)
    const maxApprovedApplies = clamp(options.maxApprovedApplies ?? 3, 0, 10)
    const guards = new L5LoopGuardService(this.sessionService).summarize()
    const blockedGuard = guards.find((guard) => (
      guard.status === 'blocked'
      && (guard.loop === 'meta_orchestration' || guard.loop === 'learning' || guard.loop === 'materialization')
    ))

    if (blockedGuard) {
      appendLifecycle(lifecycle, 'loop_blocked', {
        loop: blockedGuard.loop,
        status: 'blocked',
        reason: blockedGuard.reason,
        details: {
          current: blockedGuard.current,
          limit: blockedGuard.limit,
        },
      })
      appendLifecycle(lifecycle, 'closed_loop_completed', {
        status: 'blocked',
        reason: blockedGuard.reason,
      })

      return this.record({
        status: 'blocked',
        mode: options.applyApprovedChanges ? 'apply_approved' : 'observe',
        scenarioId: options.scenarioId,
        queuedScenarios: [],
        actions: [{
          type: 'loop_blocked',
          loop: blockedGuard.loop,
          reason: blockedGuard.reason,
        }],
        verification: { comparisons: [], rerunRequired: false },
        summary: {
          statusReason: 'Closed loop blocked by L5 circuit breaker.',
          blockedLoop: blockedGuard.loop,
          generatedProposals: 0,
          appliedMaterializations: 0,
          pendingReviews: 0,
        },
        metadata: { guards, lifecycle },
        startedAt,
      })
    }

    appendLifecycle(lifecycle, 'loop_started', { loop: 'meta_orchestration' })
    const queue = this.selectQueue(options.scenarioId, maxScenarios)
    const scenarios = queue.map((item) => item.scenarioId)
    appendLifecycle(lifecycle, 'loop_completed', {
      loop: 'meta_orchestration',
      status: scenarios.length > 0 ? 'queued' : 'empty',
      details: {
        queuedScenarios: scenarios.length,
        consideredScenarios: queue.length,
      },
    })

    const actions: Record<string, unknown>[] = []
    const before = Object.fromEntries(
      scenarios.map((scenarioId) => [scenarioId, this.buildScenarioSnapshot(scenarioId)]),
    )
    let generatedProposals = 0
    let pendingReviews = 0
    let appliedMaterializations = 0
    let automaticHealingActions = 0
    let scenarioDrafts = 0

    for (const scenarioId of scenarios) {
      appendLifecycle(lifecycle, 'scenario_started', { scenarioId })
      appendLifecycle(lifecycle, 'loop_started', { loop: 'learning', scenarioId })
      const generated = new LearningControlService(this.sessionService).generateProposals({
        scenarioId,
        limit: 50,
      })
      generatedProposals += generated.length
      pendingReviews += generated.filter((proposal) => proposal.status === 'proposed').length
      appendLifecycle(lifecycle, 'loop_completed', {
        loop: 'learning',
        scenarioId,
        status: generated.length > 0 ? 'generated' : 'unchanged',
        details: {
          generatedProposals: generated.length,
          pendingReviews: generated.filter((proposal) => proposal.status === 'proposed').length,
        },
      })
      actions.push(...generated.map((proposal) => ({
        type: 'learning_proposal_generated',
        scenarioId,
        proposalId: proposal.id,
        status: proposal.status,
        patchKind: proposal.patchKind,
        severity: proposal.severity,
      })))

      if (options.applyApprovedChanges && maxApprovedApplies > 0) {
        appendLifecycle(lifecycle, 'loop_started', { loop: 'materialization', scenarioId })
        const approved = this.sessionService.listLearningProposals({
          scenarioId,
          status: 'approved',
          limit: maxApprovedApplies,
        }).filter(isAutoMaterializableProposal)

        let materializationFailures = 0
        for (const proposal of approved) {
          try {
            const applied = new LearningControlService(this.sessionService).applyProposal(proposal.id)
            const materialization = await new L5MaterializationService(this.sessionService)
              .materializeLearningProposal(applied)
            appliedMaterializations += 1
            actions.push({
              type: 'approved_learning_materialized',
              scenarioId,
              proposalId: proposal.id,
              materializationId: materialization.id,
              kind: materialization.kind,
              actor,
            })
          } catch (error) {
            pendingReviews += 1
            actions.push({
              type: 'approved_learning_materialization_failed',
              scenarioId,
              proposalId: proposal.id,
              error: error instanceof Error ? error.message : String(error),
              actor,
            })
            materializationFailures += 1
          }
        }
        appendLifecycle(lifecycle, 'loop_completed', {
          loop: 'materialization',
          scenarioId,
          status: materializationFailures > 0 ? 'needs_review' : 'completed',
          details: {
            consideredApprovedProposals: approved.length,
            appliedMaterializations,
            materializationFailures,
          },
        })
      }
      appendLifecycle(lifecycle, 'scenario_completed', { scenarioId })
    }

    appendLifecycle(lifecycle, 'loop_started', { loop: 'self_healing' })
    const healingActions = new SelfHealingService(this.sessionService).evaluateRecentFailures()
      .filter((action) => scenarios.length === 0 || scenarios.some((scenarioId) => action.target.startsWith(`${scenarioId}:`)))
    automaticHealingActions = healingActions.filter((action) => action.automatic && action.status === 'applied').length
    pendingReviews += healingActions.filter((action) => action.status === 'proposed' || action.status === 'blocked').length
    appendLifecycle(lifecycle, 'loop_completed', {
      loop: 'self_healing',
      status: healingActions.length > 0 ? 'evaluated' : 'unchanged',
      details: {
        evaluatedActions: healingActions.length,
        automaticHealingActions,
        pendingHealingReviews: healingActions.filter((action) => action.status === 'proposed' || action.status === 'blocked').length,
      },
    })
    actions.push(...healingActions.map((action) => ({
      type: 'self_healing_evaluated',
      actionId: action.id,
      healingType: action.type,
      target: action.target,
      status: action.status,
      automatic: action.automatic,
    })))

    if (options.generateScenarioDrafts) {
      appendLifecycle(lifecycle, 'loop_started', { loop: 'scenario_generation' })
      const coverage = new CoverageAnalysisService(this.sessionService)
      const gap = coverage.analyzeGaps()[0]
      if (gap) {
        const draft = coverage.createDraftFromGap(gap)
        scenarioDrafts += 1
        pendingReviews += draft.status === 'pending' ? 1 : 0
        actions.push({
          type: 'scenario_draft_generated',
          draftId: draft.id,
          scenarioId: draft.scenarioId,
          status: draft.status,
          gapType: draft.gapType,
        })
      }
      appendLifecycle(lifecycle, 'loop_completed', {
        loop: 'scenario_generation',
        status: scenarioDrafts > 0 ? 'generated' : 'unchanged',
        details: {
          generatedDrafts: scenarioDrafts,
        },
      })
    }

    appendLifecycle(lifecycle, 'loop_started', { loop: 'verification' })
    const after = Object.fromEntries(
      scenarios.map((scenarioId) => [scenarioId, this.buildScenarioSnapshot(scenarioId)]),
    )
    const comparisons = scenarios.map((scenarioId) => this.compareLatestSessions(scenarioId))
    const rerunRequired = appliedMaterializations > 0 || automaticHealingActions > 0
    const status = pendingReviews > 0 ? 'needs_review' : 'completed'
    appendLifecycle(lifecycle, 'loop_completed', {
      loop: 'verification',
      status,
      details: {
        comparisons: comparisons.length,
        rerunRequired,
        improvedScenarios: comparisons.filter((comparison) => comparison.verdict === 'improved').length,
        regressedScenarios: comparisons.filter((comparison) => comparison.verdict === 'regressed').length,
      },
    })
    appendLifecycle(lifecycle, 'closed_loop_completed', {
      status,
      details: {
        actionCount: actions.length,
        pendingReviews,
        rerunRequired,
      },
    })

    return this.record({
      status,
      mode: options.applyApprovedChanges ? 'apply_approved' : 'observe',
      scenarioId: options.scenarioId,
      queuedScenarios: scenarios,
      actions,
      verification: {
        comparisons,
        rerunRequired,
        recommendation: rerunRequired
          ? 'Reexecute affected scenarios to verify the materialized change.'
          : 'No materialized change requires rerun in this iteration.',
      },
      summary: {
        statusReason: status === 'needs_review'
          ? 'Closed loop produced items that require review before further automatic change.'
          : 'Closed loop completed without pending review items.',
        generatedProposals,
        appliedMaterializations,
        automaticHealingActions,
        scenarioDrafts,
        pendingReviews,
        improvedScenarios: comparisons.filter((comparison) => comparison.verdict === 'improved').length,
        regressedScenarios: comparisons.filter((comparison) => comparison.verdict === 'regressed').length,
      },
      metadata: {
        actor,
        guards,
        queue,
        before,
        after,
        lifecycle,
      },
      startedAt,
    })
  }

  private selectQueue(scenarioId: string | undefined, maxScenarios: number): MetaOrchestrationQueueItem[] {
    const queue = new MetaOrchestrator(this.sessionService).buildGovernedRunQueue(scenarioId ? 50 : maxScenarios)
    if (!scenarioId) return queue.filter((item) => item.status === 'queued')
    return queue.filter((item) => item.status === 'queued' && item.scenarioId === scenarioId)
  }

  private buildScenarioSnapshot(scenarioId: string): ScenarioSnapshot {
    const sessions = this.sessionService.getAllSessions().filter((session) => session.scenarioId === scenarioId)
    const finalSessions = sessions.filter((session) => session.status === 'complete' || session.status === 'failed')
    const stepRecords = this.sessionService.listStepPerformance({ scenarioId, limit: 500 })
    const qualityGate = buildScenarioQualityGateForSessions(scenarioId, this.sessionService.getAllSessions())

    return {
      scenarioId,
      finalSessions: finalSessions.length,
      completeSessions: finalSessions.filter((session) => session.status === 'complete').length,
      failedSessions: finalSessions.filter((session) => session.status === 'failed').length,
      stepExecutions: stepRecords.length,
      failedStepExecutions: stepRecords.filter((record) => !record.success).length,
      activeMaterializations: this.sessionService.listL5Materializations({ status: 'active', limit: 500 })
        .filter((materialization) => materialization.metadata?.['scenarioId'] === scenarioId)
        .length,
      pendingLearningProposals: this.sessionService.listLearningProposals({ scenarioId, status: 'proposed', limit: 500 }).length,
      approvedLearningProposals: this.sessionService.listLearningProposals({ scenarioId, status: 'approved', limit: 500 }).length,
      qualityGateStatus: qualityGate.status,
    }
  }

  private compareLatestSessions(scenarioId: string): SessionComparison {
    const finalSessions = this.sessionService.getAllSessions()
      .filter((session) => session.scenarioId === scenarioId && (session.status === 'complete' || session.status === 'failed'))
      .sort((a, b) => new Date(b.completedAt ?? b.startedAt).getTime() - new Date(a.completedAt ?? a.startedAt).getTime())

    const [latest, previous] = finalSessions
    if (!latest || !previous) {
      return {
        scenarioId,
        verdict: 'insufficient_history',
        latestSessionId: latest?.id,
        reason: 'At least two final sessions are required to compare improvement.',
      }
    }

    const latestScore = scoreSession(latest)
    const previousScore = scoreSession(previous)
    const scoreDelta = latestScore - previousScore
    const verdict = scoreDelta > 0 ? 'improved' : scoreDelta < 0 ? 'regressed' : 'unchanged'

    return {
      scenarioId,
      verdict,
      previousSessionId: previous.id,
      latestSessionId: latest.id,
      previousScore,
      latestScore,
      scoreDelta,
      reason: buildComparisonReason(verdict, scoreDelta),
    }
  }

  private record(input: Parameters<SessionService['recordL5ClosedLoopRun']>[0]): L5ClosedLoopRun {
    return this.sessionService.recordL5ClosedLoopRun({
      ...input,
      completedAt: new Date().toISOString(),
    })
  }
}

function isAutoMaterializableProposal(proposal: LearningProposal): boolean {
  return proposal.patchKind === 'prompt_overlay' || proposal.patchKind === 'none'
}

function scoreSession(session: Session): number {
  const evaluation = safeContractEvaluation(session)
  const contractPenalty = evaluation
    ? (evaluation.hardViolations * 10) + (evaluation.driftSignals * 5)
    : 0
  const statusScore = session.status === 'complete' ? 100 : 0
  return statusScore - contractPenalty - session.findings.length * 2
}

function safeContractEvaluation(session: Session): ReturnType<typeof buildContractEvaluation>['contractEvaluation'] {
  try {
    return buildContractEvaluation(session).contractEvaluation
  } catch {
    return null
  }
}

function buildComparisonReason(verdict: SessionComparison['verdict'], scoreDelta: number): string {
  if (verdict === 'improved') return `Latest run improved by ${scoreDelta} point(s).`
  if (verdict === 'regressed') return `Latest run regressed by ${Math.abs(scoreDelta)} point(s).`
  return 'Latest run score is unchanged.'
}

function appendLifecycle(
  lifecycle: L5LifecycleEvent[],
  type: L5LifecycleEventType,
  event: Omit<L5LifecycleEvent, 'type' | 'timestamp'> = {},
): void {
  lifecycle.push({
    type,
    timestamp: new Date().toISOString(),
    ...event,
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

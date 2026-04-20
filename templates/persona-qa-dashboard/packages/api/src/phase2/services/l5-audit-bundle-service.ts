import { createHash } from 'node:crypto'
import { L5LoopGuardService } from './l5-loop-guard-service.js'
import type {
  GovernanceDecision,
  GovernanceSubjectType,
  HealingAction,
  L5ClosedLoopRun,
  L5Materialization,
  LearningProposal,
  ScenarioDraft,
  SessionService,
} from './session-service.js'

export interface L5AuditBundleReplayPlan {
  endpoint: '/api/p2/closed-loop/run'
  method: 'POST'
  safeReplayPayload: {
    scenarioId?: string
    maxScenarios: number
    applyApprovedChanges: false
    generateScenarioDrafts: false
  }
  originalIntent: {
    mode: L5ClosedLoopRun['mode']
    scenarioId?: string
    maxScenarios: number
    applyApprovedChanges: boolean
    generateScenarioDrafts: boolean
  }
  notes: string[]
}

export interface L5AuditBundle {
  schemaVersion: 'persona-qa.l5.audit-bundle.v1'
  generatedAt: string
  run: L5ClosedLoopRun
  lifecycle: unknown[]
  guards: ReturnType<L5LoopGuardService['summarize']>
  snapshots: {
    before: Record<string, unknown>
    after: Record<string, unknown>
  }
  related: {
    learningProposals: LearningProposal[]
    healingActions: HealingAction[]
    scenarioDrafts: ScenarioDraft[]
    materializations: L5Materialization[]
    governanceDecisions: GovernanceDecision[]
  }
  replay: L5AuditBundleReplayPlan
  integrity: {
    checksum: string
    counts: {
      lifecycleEvents: number
      actions: number
      learningProposals: number
      healingActions: number
      scenarioDrafts: number
      materializations: number
      governanceDecisions: number
    }
  }
}

type SubjectRef = {
  subjectType: GovernanceSubjectType
  subjectId: string
}

export class L5AuditBundleService {
  constructor(private readonly sessionService: SessionService) {}

  build(runId: string): L5AuditBundle | undefined {
    const run = this.sessionService.getL5ClosedLoopRun(runId)
    if (!run) return undefined

    const refs = collectSubjectRefs(run.actions)
    const materializationIds = collectStringValues(run.actions, 'materializationId')
    const lifecycle = arrayValue(run.metadata?.['lifecycle'])
    const before = recordValue(run.metadata?.['before'])
    const after = recordValue(run.metadata?.['after'])
    const learningProposals = this.collectLearningProposals(refs)
    const healingActions = this.collectHealingActions(refs)
    const scenarioDrafts = this.collectScenarioDrafts(refs)
    const materializations = this.collectMaterializations(refs, materializationIds)
    const governanceDecisions = this.collectGovernanceDecisions(refs, run)

    const bundleWithoutChecksum = {
      schemaVersion: 'persona-qa.l5.audit-bundle.v1' as const,
      generatedAt: new Date().toISOString(),
      run,
      lifecycle,
      guards: new L5LoopGuardService(this.sessionService).summarize(),
      snapshots: {
        before,
        after,
      },
      related: {
        learningProposals,
        healingActions,
        scenarioDrafts,
        materializations,
        governanceDecisions,
      },
      replay: buildReplayPlan(run),
    }

    return {
      ...bundleWithoutChecksum,
      integrity: {
        checksum: checksum(bundleWithoutChecksum),
        counts: {
          lifecycleEvents: lifecycle.length,
          actions: run.actions.length,
          learningProposals: learningProposals.length,
          healingActions: healingActions.length,
          scenarioDrafts: scenarioDrafts.length,
          materializations: materializations.length,
          governanceDecisions: governanceDecisions.length,
        },
      },
    }
  }

  private collectLearningProposals(refs: SubjectRef[]): LearningProposal[] {
    return refs
      .filter((ref) => ref.subjectType === 'learning_proposal')
      .map((ref) => this.sessionService.getLearningProposal(ref.subjectId))
      .filter((proposal): proposal is LearningProposal => Boolean(proposal))
  }

  private collectHealingActions(refs: SubjectRef[]): HealingAction[] {
    return refs
      .filter((ref) => ref.subjectType === 'healing_action')
      .map((ref) => this.sessionService.getHealingAction(ref.subjectId))
      .filter((action): action is HealingAction => Boolean(action))
  }

  private collectScenarioDrafts(refs: SubjectRef[]): ScenarioDraft[] {
    return refs
      .filter((ref) => ref.subjectType === 'scenario_draft')
      .map((ref) => this.sessionService.getScenarioDraft(ref.subjectId))
      .filter((draft): draft is ScenarioDraft => Boolean(draft))
  }

  private collectMaterializations(refs: SubjectRef[], materializationIds: Set<string>): L5Materialization[] {
    const materializations = this.sessionService.listL5Materializations({ limit: 500 })
    return materializations.filter((materialization) => {
      if (materializationIds.has(materialization.id)) return true
      return refs.some((ref) => (
        ref.subjectType === materialization.subjectType
        && ref.subjectId === materialization.subjectId
      ))
    })
  }

  private collectGovernanceDecisions(refs: SubjectRef[], run: L5ClosedLoopRun): GovernanceDecision[] {
    const byId = new Map<string, GovernanceDecision>()

    for (const ref of refs) {
      for (const decision of this.sessionService.listGovernanceDecisions({
        subjectType: ref.subjectType,
        subjectId: ref.subjectId,
        limit: 100,
      })) {
        byId.set(decision.id, decision)
      }
    }

    for (const decision of this.sessionService.listGovernanceDecisions({ limit: 500 })) {
      if (isWithinRunWindow(decision.createdAt, run)) {
        byId.set(decision.id, decision)
      }
    }

    return Array.from(byId.values()).sort((left, right) => (
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    ))
  }
}

function collectSubjectRefs(actions: Record<string, unknown>[]): SubjectRef[] {
  const refs = new Map<string, SubjectRef>()

  for (const action of actions) {
    addRef(refs, 'learning_proposal', action['proposalId'])
    addRef(refs, 'healing_action', action['actionId'])
    addRef(refs, 'scenario_draft', action['draftId'])
  }

  return Array.from(refs.values())
}

function addRef(refs: Map<string, SubjectRef>, subjectType: GovernanceSubjectType, value: unknown): void {
  if (typeof value !== 'string' || value.length === 0) return
  refs.set(`${subjectType}:${value}`, { subjectType, subjectId: value })
}

function collectStringValues(actions: Record<string, unknown>[], key: string): Set<string> {
  const values = new Set<string>()
  for (const action of actions) {
    const value = action[key]
    if (typeof value === 'string' && value.length > 0) values.add(value)
  }
  return values
}

function buildReplayPlan(run: L5ClosedLoopRun): L5AuditBundleReplayPlan {
  const maxScenarios = Math.max(1, run.queuedScenarios.length || (run.scenarioId ? 1 : 3))
  const generatedDrafts = run.actions.some((action) => action['type'] === 'scenario_draft_generated')
  const scenario = run.scenarioId ? { scenarioId: run.scenarioId } : {}

  return {
    endpoint: '/api/p2/closed-loop/run',
    method: 'POST',
    safeReplayPayload: {
      ...scenario,
      maxScenarios,
      applyApprovedChanges: false,
      generateScenarioDrafts: false,
    },
    originalIntent: {
      mode: run.mode,
      ...scenario,
      maxScenarios,
      applyApprovedChanges: run.mode === 'apply_approved',
      generateScenarioDrafts: generatedDrafts,
    },
    notes: [
      'safeReplayPayload intentionally runs in observe mode and does not apply approved changes.',
      'originalIntent records the source run mode for a human-controlled replay decision.',
    ],
  }
}

function isWithinRunWindow(timestamp: string, run: L5ClosedLoopRun): boolean {
  const value = Date.parse(timestamp)
  const startedAt = Date.parse(run.startedAt)
  const completedAt = Date.parse(run.completedAt)
  if (!Number.isFinite(value) || !Number.isFinite(startedAt) || !Number.isFinite(completedAt)) return false
  return value >= startedAt && value <= completedAt
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function checksum(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

import { listScenarios, loadScenario } from '../scenarios/index.js'
import type { L5LearningSignal, SessionService } from './session-service.js'
import { L5LoopGuardService, type L5LoopGuard } from './l5-loop-guard-service.js'

export interface L5SignalPolicyImpact {
  retainedSignals: number
  decayedSignals: number
  averageEffectiveConfidence: number
  riskModifier: number
  requiresReplay: boolean
  requiresIndependentAudit: boolean
  signalIds: string[]
  signalImpacts: L5SignalPolicySignalImpact[]
  reasons: string[]
}

export interface L5SignalPolicySignalImpact {
  signalId: string
  signalType: L5LearningSignal['signalType']
  ageDays: number
  decayFactor: number
  confidence: number
  effectiveConfidence: number
  riskContribution: number
}

export interface ScheduleRecommendation {
  scenarioId: string
  priority: 'critical' | 'high' | 'normal' | 'low'
  reason: string
  suggestedFrequency: 'every_commit' | 'daily' | 'weekly' | 'on_demand'
  lastRunAt: string | null
  riskScore: number
  baseRiskScore: number
  l5SignalPolicy: L5SignalPolicyImpact
}

export interface MetaOrchestrationQueueItem extends ScheduleRecommendation {
  queueId: string
  position: number
  status: 'queued' | 'blocked'
  guard: L5LoopGuard
}

export class MetaOrchestrator {
  constructor(private readonly sessionService: SessionService) {}

  recommendSchedule(): ScheduleRecommendation[] {
    return listScenarios()
      .map((scenarioId) => this.buildRecommendation(scenarioId))
      .sort((a, b) => b.riskScore - a.riskScore || a.scenarioId.localeCompare(b.scenarioId))
  }

  optimizeRunOrder(scenarioIds: string[]): string[] {
    const riskByScenario = new Map(this.recommendSchedule().map((item) => [item.scenarioId, item.riskScore]))
    return [...scenarioIds].sort((a, b) => (riskByScenario.get(b) ?? 0) - (riskByScenario.get(a) ?? 0))
  }

  buildGovernedRunQueue(limit = 10): MetaOrchestrationQueueItem[] {
    const guard = new L5LoopGuardService(this.sessionService)
      .summarize()
      .find((candidate) => candidate.loop === 'meta_orchestration')
    const metaGuard = guard ?? {
      loop: 'meta_orchestration' as const,
      status: 'open' as const,
      reason: 'Meta-orchestration guard unavailable; defaulting to recommendation-only mode.',
      current: 0,
      limit: 0,
    }

    return this.recommendSchedule()
      .slice(0, Math.max(1, Math.min(limit, 50)))
      .map((recommendation, index) => ({
        ...recommendation,
        queueId: `${recommendation.scenarioId}:${index + 1}`,
        position: index + 1,
        status: metaGuard.status === 'open' ? 'queued' : 'blocked',
        guard: metaGuard,
      }))
  }

  private buildRecommendation(scenarioId: string): ScheduleRecommendation {
    const sessions = this.sessionService.getAllSessions()
      .filter((session) => session.scenarioId === scenarioId)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    const lastRunAt = sessions[0]?.startedAt ?? null
    const daysSinceLastRun = lastRunAt
      ? Math.floor((Date.now() - new Date(lastRunAt).getTime()) / 86_400_000)
      : 999
    const recent = this.sessionService.listStepPerformance({ scenarioId, limit: 50 })
    const failureRate = recent.length ? recent.filter((record) => !record.success).length / recent.length : 0
    const timeoutRate = recent.length ? recent.filter((record) => record.errorCategory === 'timeout').length / recent.length : 0
    const scenario = loadScenario(scenarioId)
    const criticalStepRatio = scenario.steps.filter((step) => step.handoff || step.requiredArtifacts.length > 0).length
      / Math.max(1, scenario.steps.length)
    const l5SignalPolicy = evaluateL5SignalPolicy(this.sessionService.listL5LearningSignals({
      scenarioId,
      status: 'retained',
      limit: 100,
    }))
    const baseRiskScore = calculateRiskScore({
      daysSinceLastRun,
      failureRate,
      timeoutRate,
      criticalStepRatio,
      hasNeverRun: sessions.length === 0,
    })
    const riskScore = applyRiskModifier(baseRiskScore, l5SignalPolicy.riskModifier)

    return {
      scenarioId,
      priority: riskScore >= 0.75 ? 'critical' : riskScore >= 0.5 ? 'high' : riskScore >= 0.2 ? 'normal' : 'low',
      reason: buildReason({
        daysSinceLastRun,
        failureRate,
        timeoutRate,
        hasNeverRun: sessions.length === 0,
        l5SignalPolicy,
      }),
      suggestedFrequency: riskScore >= 0.75 ? 'every_commit' : riskScore >= 0.5 ? 'daily' : riskScore >= 0.2 ? 'weekly' : 'on_demand',
      lastRunAt,
      riskScore,
      baseRiskScore,
      l5SignalPolicy,
    }
  }
}

export function calculateRiskScore(input: {
  daysSinceLastRun: number
  failureRate: number
  timeoutRate: number
  criticalStepRatio: number
  hasNeverRun?: boolean
}): number {
  let score = input.hasNeverRun ? 0.35 : 0
  if (input.daysSinceLastRun > 7) score += 0.1
  if (input.daysSinceLastRun > 30) score += 0.2
  score += Math.min(input.failureRate, 1) * 0.3
  score += Math.min(input.timeoutRate, 1) * 0.15
  score += Math.min(input.criticalStepRatio, 1) * 0.1
  return Math.min(1, Number(score.toFixed(2)))
}

export function evaluateL5SignalPolicy(
  signals: L5LearningSignal[],
  options: { now?: Date } = {},
): L5SignalPolicyImpact {
  const now = options.now ?? new Date()
  let riskModifier = 0
  let requiresReplay = false
  let requiresIndependentAudit = false
  const reasons: string[] = []
  const signalImpacts: L5SignalPolicySignalImpact[] = []

  for (const signal of signals) {
    const decay = calculateL5SignalDecay(signal.createdAt, now)
    const confidence = clamp(signal.confidence, 0, 1)
    const effectiveConfidence = round2(confidence * decay.factor)
    let rawContribution = 0
    let reason: string | undefined

    if (signal.signalType === 'audit_reviewed') {
      const verdict = stringValue(signal.evidence?.['auditVerdict'], 'unknown')
      const findingCount = numberValue(signal.evidence?.['findingCount'])
      const modifier = verdict === 'failed' ? 0.18 : verdict === 'warning' ? 0.12 : 0.06
      rawContribution = modifier
      const actionable = effectiveConfidence >= 0.35
      requiresReplay ||= actionable && (verdict === 'failed' || verdict === 'warning')
      requiresIndependentAudit ||= actionable && (verdict === 'failed' || verdict === 'warning' || findingCount > 0)
      reason = `reviewed audit ${verdict}${findingCount > 0 ? ` with ${findingCount} finding(s)` : ''}`
    } else if (signal.signalType === 'promotion_verified') {
      const verificationStatus = stringValue(signal.evidence?.['verificationStatus'], 'unknown')
      const modifier = verificationStatus === 'warning' ? 0.06 : 0.03
      rawContribution = modifier
      const actionable = effectiveConfidence >= 0.35
      requiresReplay ||= actionable && verificationStatus === 'warning'
      requiresIndependentAudit ||= actionable && verificationStatus === 'warning'
      reason = `verified promotion ${verificationStatus}`
    }

    const riskContribution = round2(rawContribution * effectiveConfidence)
    riskModifier += riskContribution
    signalImpacts.push({
      signalId: signal.id,
      signalType: signal.signalType,
      ageDays: decay.ageDays,
      decayFactor: decay.factor,
      confidence,
      effectiveConfidence,
      riskContribution,
    })
    if (reason) {
      reasons.push(decay.factor < 1 ? `${reason}; decayed ${decay.factor.toFixed(2)}` : reason)
    }
  }

  const cappedModifier = Math.min(0.3, round2(riskModifier))
  const effectiveConfidenceTotal = signalImpacts.reduce((sum, impact) => sum + impact.effectiveConfidence, 0)
  return {
    retainedSignals: signals.length,
    decayedSignals: signalImpacts.filter((impact) => impact.decayFactor < 1).length,
    averageEffectiveConfidence: signals.length > 0 ? round2(effectiveConfidenceTotal / signals.length) : 0,
    riskModifier: cappedModifier,
    requiresReplay,
    requiresIndependentAudit,
    signalIds: signals.map((signal) => signal.id),
    signalImpacts,
    reasons: reasons.slice(0, 5),
  }
}

export function calculateL5SignalDecay(createdAt: string, now = new Date()): { ageDays: number; factor: number } {
  const created = new Date(createdAt).getTime()
  const current = now.getTime()
  if (!Number.isFinite(created) || !Number.isFinite(current)) {
    return { ageDays: 0, factor: 1 }
  }

  const ageDays = Math.max(0, Math.floor((current - created) / 86_400_000))
  if (ageDays <= 14) return { ageDays, factor: 1 }
  if (ageDays <= 45) return { ageDays, factor: 0.75 }
  if (ageDays <= 90) return { ageDays, factor: 0.45 }
  if (ageDays <= 180) return { ageDays, factor: 0.2 }
  return { ageDays, factor: 0.1 }
}

function applyRiskModifier(baseRiskScore: number, modifier: number): number {
  return Math.min(1, Number((baseRiskScore + Math.max(0, modifier)).toFixed(2)))
}

function buildReason(input: {
  daysSinceLastRun: number
  failureRate: number
  timeoutRate: number
  hasNeverRun: boolean
  l5SignalPolicy?: L5SignalPolicyImpact
}): string {
  const parts = input.hasNeverRun
    ? ['Scenario has no completed execution history']
    : [`last run ${input.daysSinceLastRun} day(s) ago`]
  if (input.failureRate > 0) parts.push(`failure rate ${(input.failureRate * 100).toFixed(0)}%`)
  if (input.timeoutRate > 0) parts.push(`timeout rate ${(input.timeoutRate * 100).toFixed(0)}%`)
  if (input.l5SignalPolicy && input.l5SignalPolicy.retainedSignals > 0) {
    parts.push(
      `L5 retained signals ${input.l5SignalPolicy.retainedSignals} (+${input.l5SignalPolicy.riskModifier.toFixed(2)}, ${input.l5SignalPolicy.decayedSignals} decayed)`,
    )
  }
  return parts.join('; ')
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round2(value: number): number {
  return Number(value.toFixed(2))
}

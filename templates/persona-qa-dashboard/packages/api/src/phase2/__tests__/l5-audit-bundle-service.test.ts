import { describe, expect, it } from 'vitest'
import { classifyScenarioDraftPromotionPriority, comparePromotionCandidates, type L5KnowledgePromotionCandidate } from '../services/l5-audit-bundle-service.js'

describe('l5 audit bundle promotion prioritization', () => {
  it('classifies structurally ready approved drafts as critical priority', () => {
    expect(classifyScenarioDraftPromotionPriority({
      draftStatus: 'approved',
      candidateStatus: 'approved',
      graphReadinessStatus: 'fully_mapped',
      structuralReady: true,
      mappingReady: true,
    })).toBe('critical')
  })

  it('classifies partially mapped drafts as normal priority', () => {
    expect(classifyScenarioDraftPromotionPriority({
      draftStatus: 'pending',
      candidateStatus: 'requires_review',
      graphReadinessStatus: 'partially_mapped',
      structuralReady: true,
      mappingReady: false,
    })).toBe('normal')
  })

  it('sorts candidates by status first and structural priority second', () => {
    const pendingStructural: L5KnowledgePromotionCandidate = {
      id: 'scenario_draft:strong',
      sourceRunId: 'run-1',
      subjectType: 'scenario_draft',
      subjectId: 'strong',
      promotionType: 'scenario_contract',
      status: 'requires_review',
      version: 'v1',
      title: 'Structurally ready draft',
      target: 'scenario:strong',
      reason: 'Ready for governed approval.',
      priority: 'high',
      approvalRequired: true,
      materializationReady: false,
      nextAction: 'approve',
      evidence: {},
    }
    const pendingWeak: L5KnowledgePromotionCandidate = {
      ...pendingStructural,
      id: 'scenario_draft:weak',
      subjectId: 'weak',
      title: 'Shallow draft',
      target: 'scenario:weak',
      priority: 'normal',
    }
    const approvedCandidate: L5KnowledgePromotionCandidate = {
      ...pendingStructural,
      id: 'scenario_draft:approved',
      subjectId: 'approved',
      title: 'Approved draft',
      target: 'scenario:approved',
      status: 'approved',
      priority: 'critical',
      nextAction: 'promote',
      materializationReady: true,
    }

    const ordered = [pendingWeak, approvedCandidate, pendingStructural].sort(comparePromotionCandidates)
    expect(ordered.map((candidate) => candidate.subjectId)).toEqual(['strong', 'weak', 'approved'])
  })
})

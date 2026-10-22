import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CoverageAnalysisService } from '../services/coverage-analysis-service.js'
import { GovernancePolicyService } from '../services/governance-policy-service.js'
import { L5AuditBundleService } from '../services/l5-audit-bundle-service.js'
import { L5ClosedLoopScheduler } from '../services/l5-closed-loop-scheduler.js'
import { L5ClosedLoopService } from '../services/l5-closed-loop-service.js'
import { L5LoopGuardService } from '../services/l5-loop-guard-service.js'
import { L5MaterializationService } from '../services/l5-materialization-service.js'
import { LearningControlService } from '../services/learning-control-service.js'
import { calculateL5SignalDecay, calculateRiskScore, evaluateL5SignalPolicy, MetaOrchestrator } from '../services/meta-orchestrator.js'
import { ProfileTuningService } from '../services/profile-tuning-service.js'
import { SelfHealingService } from '../services/self-healing-service.js'
import { type L5LearningSignal, SessionService } from '../services/session-service.js'
import { ToolRegistry } from '../services/tool-registry.js'
import { registerWorkflowTools } from '../tools/workflow-tools.js'

describe('L5 controlled feedback services', () => {
  let previousReferenceScenarios: string | undefined

  beforeAll(() => {
    previousReferenceScenarios = process.env.PERSONA_QA_USE_REFERENCE_SCENARIOS
    process.env.PERSONA_QA_USE_REFERENCE_SCENARIOS = '1'
  })

  afterAll(() => {
    if (previousReferenceScenarios === undefined) {
      delete process.env.PERSONA_QA_USE_REFERENCE_SCENARIOS
    } else {
      process.env.PERSONA_QA_USE_REFERENCE_SCENARIOS = previousReferenceScenarios
    }
  })

  it('detects uncovered scenario capabilities and stores human-reviewed drafts', () => {
    const service = new SessionService(':memory:')
    const coverage = new CoverageAnalysisService(service)

    const gaps = coverage.analyzeGaps()
    const capabilityGap = gaps.find((gap) => gap.type === 'capability_uncovered')
    expect(capabilityGap).toBeTruthy()

    const draft = coverage.createDraftFromGap(capabilityGap!)
    expect(draft.status).toBe('pending')
    expect(draft.gapType).toBe('capability_uncovered')
    expect(service.listScenarioDrafts()).toHaveLength(1)
  })

  it('materializes promoted scenario drafts as durable L5 artifacts', async () => {
    const service = new SessionService(':memory:')
    const artifactRoot = await mkdtemp(path.join(tmpdir(), 'l5-scenario-artifacts-'))
    const draft = service.createScenarioDraft({
      scenarioId: 'generated_checkout_flow',
      name: 'Generated Checkout Flow',
      description: 'Covers an uncovered flow',
      contract: { scenario_id: 'generated_checkout_flow', quality_gate: 'restricted' },
      gapType: 'capability_uncovered',
      gapEvidence: [{ route: '/checkout' }],
    })
    const governance = new GovernancePolicyService(service)
    const approved = service.updateScenarioDraftStatus(draft.id, 'approved', 'qa_lead')
    governance.recordScenarioDraftDecision(approved!, 'approve', 'qa_lead')
    const promoted = service.updateScenarioDraftStatus(draft.id, 'promoted', 'qa_lead')
    governance.recordScenarioDraftDecision(promoted!, 'promote', 'qa_lead')

    const materialization = await new L5MaterializationService(service, { artifactRoot })
      .materializeScenarioDraft(promoted!)

    expect(materialization).toEqual(expect.objectContaining({
      subjectType: 'scenario_draft',
      subjectId: draft.id,
      kind: 'scenario_draft_manifest',
      status: 'active',
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    const content = JSON.parse(await readFile(materialization.filePath, 'utf8'))
    expect(content).toEqual(expect.objectContaining({
      kind: 'scenario_draft',
      source: expect.objectContaining({
        draftId: draft.id,
        scenarioId: 'generated_checkout_flow',
      }),
    }))
    expect(service.listL5Materializations({
      subjectType: 'scenario_draft',
      subjectId: draft.id,
    })).toContainEqual(expect.objectContaining({
      kind: 'scenario_draft_manifest',
      checksum: materialization.checksum,
      metadata: expect.objectContaining({
        independentAudit: expect.objectContaining({
          verdict: 'passed',
          checksumVerified: true,
          governanceEvidence: 1,
        }),
        postWriteVerification: expect.objectContaining({
          checksumMatches: true,
          verifier: 'independent_auditor',
        }),
      }),
    }))
  })

  it('materializes applied prompt overlays as durable L5 artifacts', async () => {
    const service = new SessionService(':memory:')
    const artifactRoot = await mkdtemp(path.join(tmpdir(), 'l5-learning-artifacts-'))
    const proposal = service.createLearningProposal({
      recommendationId: 'overlay-materialization',
      scenarioId: 'first_visit',
      stepId: 'register_customer',
      agentId: 'front_desk',
      type: 'prompt_patch',
      severity: 'medium',
      recommendation: { reason: 'tool needs stricter success criteria' },
      patchKind: 'prompt_overlay',
      target: 'agent:front_desk',
      patchContent: 'Never report customer creation unless the persisted customer id is present.',
    })
    const learning = new LearningControlService(service)
    learning.approveProposal(proposal.id)
    const applied = learning.applyProposal(proposal.id)

    const materialization = await new L5MaterializationService(service, { artifactRoot })
      .materializeLearningProposal(applied)

    expect(materialization).toEqual(expect.objectContaining({
      subjectType: 'learning_proposal',
      subjectId: proposal.id,
      kind: 'learning_prompt_overlay',
      status: 'active',
      metadata: expect.objectContaining({
        independentAudit: expect.objectContaining({
          verdict: 'passed',
          checksumVerified: true,
          governanceEvidence: 1,
        }),
      }),
    }))
    const content = await readFile(materialization.filePath, 'utf8')
    expect(content).toContain('# L5 Learning Overlay')
    expect(content).toContain('Never report customer creation unless the persisted customer id is present.')
  })

  it('blocks L5 materialization without prior governance evidence', async () => {
    const service = new SessionService(':memory:')
    const artifactRoot = await mkdtemp(path.join(tmpdir(), 'l5-blocked-artifacts-'))
    const proposal = service.createLearningProposal({
      recommendationId: 'ungoverned-materialization',
      scenarioId: 'first_visit',
      stepId: 'register_customer',
      agentId: 'front_desk',
      type: 'prompt_patch',
      severity: 'medium',
      recommendation: { reason: 'missing governance' },
      patchKind: 'prompt_overlay',
      target: 'agent:front_desk',
      patchContent: 'Ungoverned overlay.',
    })

    await expect(new L5MaterializationService(service, { artifactRoot })
      .materializeLearningProposal(proposal))
      .rejects.toThrow('materialization_governance_evidence_missing')
  })

  it('recommends timeout tuning when p95 duration approaches profile timeout', () => {
    const service = new SessionService(':memory:')
    const session = service.createSession('first_order')

    service.recordStepPerformance({
      sessionId: session.id,
      scenarioId: 'first_order',
      stepId: 'register_customer',
      agentId: 'sales_associate',
      status: 'completed',
      success: true,
      attempt: 1,
      durationMs: 89_000,
    })

    const recommendations = new ProfileTuningService(service).generateRecommendations()
    expect(recommendations).toContainEqual(expect.objectContaining({
      agentId: 'sales_associate',
      field: 'timeoutMs',
    }))
  })

  it('prioritizes stale and failing scenarios in schedule recommendations', () => {
    const riskScore = calculateRiskScore({
      daysSinceLastRun: 10,
      failureRate: 0.8,
      timeoutRate: 0.5,
      criticalStepRatio: 1,
    })
    expect(riskScore).toBeGreaterThan(0.5)

    const service = new SessionService(':memory:')
    const session = service.createSession('first_order')
    service.recordStepPerformance({
      sessionId: session.id,
      scenarioId: 'first_order',
      stepId: 'register_customer',
      agentId: 'sales_associate',
      status: 'failed',
      success: false,
      attempt: 1,
      durationMs: 1_000,
      errorMessage: 'timeout',
    })
    const signal = service.recordL5LearningSignal({
      sourceType: 'independent_audit_review',
      sourceId: 'review-schedule-risk',
      signalType: 'audit_reviewed',
      sourceRunId: 'loop-schedule-risk',
      scenarioId: 'first_order',
      version: 'review:review-schedule-risk',
      confidence: 0.8,
      summary: 'Reviewed warning should increase schedule priority.',
      evidence: {
        auditVerdict: 'warning',
        findingCount: 1,
      },
    })

    const recommendations = new MetaOrchestrator(service).recommendSchedule()
    expect(recommendations[0]?.scenarioId).toBeTruthy()
    expect(recommendations[0]?.riskScore).toBeGreaterThan(0)
    const scenarioRecommendation = recommendations.find((item) => item.scenarioId === 'first_order')
    expect(scenarioRecommendation).toEqual(expect.objectContaining({
      baseRiskScore: expect.any(Number),
      l5SignalPolicy: expect.objectContaining({
        retainedSignals: 1,
        decayedSignals: 0,
        averageEffectiveConfidence: 0.8,
        riskModifier: 0.1,
        requiresReplay: true,
        requiresIndependentAudit: true,
        signalIds: [signal.id],
      }),
    }))
    expect(scenarioRecommendation!.riskScore).toBeGreaterThan(scenarioRecommendation!.baseRiskScore)
    expect(scenarioRecommendation!.reason).toContain('L5 retained signals 1')

    const queue = new MetaOrchestrator(service).buildGovernedRunQueue(50)
    expect(queue[0]).toEqual(expect.objectContaining({
      position: 1,
      status: 'queued',
      guard: expect.objectContaining({
        loop: 'meta_orchestration',
        status: 'open',
      }),
    }))
    expect(queue.find((item) => item.scenarioId === 'first_order')?.l5SignalPolicy).toEqual(expect.objectContaining({
      requiresReplay: true,
      riskModifier: 0.1,
    }))
  })


  it('prioritizes structurally ready scenario drafts in promotion candidates', () => {
    const service = new SessionService(':memory:')
    const run = service.recordL5ClosedLoopRun({
      status: 'needs_review',
      mode: 'observe',
      queuedScenarios: ['generated_place_order'],
      actions: [
        { type: 'scenario_draft_generated', draftId: 'draft-strong' },
        { type: 'scenario_draft_generated', draftId: 'draft-weak' },
      ],
      verification: {},
      summary: {},
      metadata: {},
    })

    service.createScenarioDraft({
      id: 'draft-strong',
      scenarioId: 'generated_place_order',
      name: 'Structurally ready draft',
      description: 'Ready for governed approval.',
      contract: {
        domainDiscovery: {
          mappingRequired: true,
          mappingReview: {
            selectorsMapped: true,
            authMapped: true,
            testDataMapped: true,
            assertionsMapped: true,
            reviewedBy: 'qa_lead',
          },
          graphReadiness: {
            status: 'fully_mapped',
            confidence: 0.91,
            requiredCapabilityCount: 2,
            mappedCapabilityCount: 2,
            mappedCapabilityIds: ['click_submit_order', 'assert_visible_state'],
            missingCapabilityIds: [],
            supportSourceTypes: ['service', 'http_call', 'endpoint'],
            supportEndpointCount: 1,
            supportHandlerCount: 1,
            supportHttpCallCount: 1,
            supportDataAccessCount: 0,
          },
        },
      },
      gapType: 'coverage_gap',
      gapEvidence: [],
    })

    service.createScenarioDraft({
      id: 'draft-weak',
      scenarioId: 'generated_place_order_alt',
      name: 'Shallow draft',
      description: 'Needs more mapping depth.',
      contract: {
        domainDiscovery: {
          mappingRequired: true,
          mappingReview: {
            selectorsMapped: true,
            authMapped: false,
            testDataMapped: false,
            assertionsMapped: false,
            reviewedBy: null,
          },
          graphReadiness: {
            status: 'partially_mapped',
            confidence: 0.52,
            requiredCapabilityCount: 2,
            mappedCapabilityCount: 1,
            mappedCapabilityIds: ['click_submit_order'],
            missingCapabilityIds: ['assert_visible_state'],
            supportSourceTypes: ['http_call'],
            supportEndpointCount: 0,
            supportHandlerCount: 0,
            supportHttpCallCount: 1,
            supportDataAccessCount: 0,
          },
        },
      },
      gapType: 'coverage_gap',
      gapEvidence: [],
    })

    const bundle = new L5AuditBundleService(service).build(run.id)
    expect(bundle).toBeTruthy()
    const scenarioCandidates = bundle!.promotion.candidates.filter((candidate) => candidate.subjectType === 'scenario_draft')
    expect(scenarioCandidates).toHaveLength(2)
    expect(scenarioCandidates[0]).toEqual(expect.objectContaining({
      subjectId: 'draft-strong',
      priority: 'high',
      nextAction: 'approve',
      evidence: expect.objectContaining({
        graphReadinessStatus: 'fully_mapped',
        graphStructuralReady: true,
        mappingReady: true,
        structurallyPromotable: true,
      }),
    }))
    expect(scenarioCandidates[1]).toEqual(expect.objectContaining({
      subjectId: 'draft-weak',
      priority: 'normal',
      evidence: expect.objectContaining({
        graphReadinessStatus: 'partially_mapped',
        graphStructuralReady: true,
        mappingReady: false,
        structurallyPromotable: false,
      }),
    }))
  })

  it('weights retained L5 learning signals by confidence and ignores superseded signals', () => {
    const service = new SessionService(':memory:')
    service.recordL5LearningSignal({
      sourceType: 'independent_audit_review',
      sourceId: 'review-old',
      signalType: 'audit_reviewed',
      sourceRunId: 'loop-policy-cap',
      scenarioId: 'first_order',
      version: 'review:old',
      confidence: 0.5,
      summary: 'Old superseded signal.',
      evidence: { auditVerdict: 'failed', findingCount: 10 },
    })
    service.recordL5LearningSignal({
      sourceType: 'independent_audit_review',
      sourceId: 'review-new',
      signalType: 'audit_reviewed',
      sourceRunId: 'loop-policy-cap',
      scenarioId: 'first_order',
      version: 'review:new',
      confidence: 0.9,
      summary: 'New retained signal.',
      evidence: { auditVerdict: 'failed', findingCount: 3 },
    })
    service.recordL5LearningSignal({
      sourceType: 'knowledge_promotion',
      sourceId: 'promotion-warning',
      signalType: 'promotion_verified',
      sourceRunId: 'loop-policy-promotion',
      scenarioId: 'first_order',
      stepId: 'register_customer',
      agentId: 'sales_associate',
      version: 'promotion:warning',
      confidence: 0.75,
      summary: 'Verified with warning.',
      evidence: { verificationStatus: 'warning' },
    })
    service.recordL5LearningSignal({
      sourceType: 'knowledge_promotion',
      sourceId: 'promotion-passed',
      signalType: 'promotion_verified',
      sourceRunId: 'loop-policy-passed',
      scenarioId: 'first_order',
      stepId: 'create_order',
      agentId: 'sales_associate',
      version: 'promotion:passed',
      confidence: 1,
      summary: 'Verified as passed.',
      evidence: { verificationStatus: 'passed' },
    })

    const retained = service.listL5LearningSignals({
      scenarioId: 'first_order',
      status: 'retained',
      limit: 10,
    })
    const policy = evaluateL5SignalPolicy(retained)

    expect(retained).toHaveLength(3)
    expect(policy).toEqual(expect.objectContaining({
      retainedSignals: 3,
      decayedSignals: 0,
      averageEffectiveConfidence: 0.88,
      riskModifier: 0.23,
      requiresReplay: true,
      requiresIndependentAudit: true,
    }))
    expect(policy.signalImpacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        signalType: 'audit_reviewed',
        effectiveConfidence: 0.9,
        riskContribution: 0.16,
      }),
      expect.objectContaining({
        signalType: 'promotion_verified',
        effectiveConfidence: 0.75,
        riskContribution: 0.04,
      }),
      expect.objectContaining({
        signalType: 'promotion_verified',
        effectiveConfidence: 1,
        riskContribution: 0.03,
      }),
    ]))
    expect(policy.reasons).toEqual(expect.arrayContaining([
      'reviewed audit failed with 3 finding(s)',
      'verified promotion warning',
      'verified promotion passed',
    ]))
  })

  it('decays old retained L5 learning signals without deleting ledger memory', () => {
    const now = new Date('2026-04-22T00:00:00.000Z')
    expect(calculateL5SignalDecay('2026-04-15T00:00:00.000Z', now)).toEqual({ ageDays: 7, factor: 1 })
    expect(calculateL5SignalDecay('2026-01-01T00:00:00.000Z', now)).toEqual({ ageDays: 111, factor: 0.2 })

    const freshPolicy = evaluateL5SignalPolicy([
      makeLearningSignal({
        id: 'fresh-failed-audit',
        createdAt: '2026-04-15T00:00:00.000Z',
        confidence: 1,
        evidence: { auditVerdict: 'failed', findingCount: 2 },
      }),
    ], { now })
    expect(freshPolicy).toEqual(expect.objectContaining({
      retainedSignals: 1,
      decayedSignals: 0,
      averageEffectiveConfidence: 1,
      riskModifier: 0.18,
      requiresReplay: true,
      requiresIndependentAudit: true,
    }))

    const oldPolicy = evaluateL5SignalPolicy([
      makeLearningSignal({
        id: 'old-failed-audit',
        createdAt: '2026-01-01T00:00:00.000Z',
        confidence: 1,
        evidence: { auditVerdict: 'failed', findingCount: 2 },
      }),
    ], { now })
    expect(oldPolicy).toEqual(expect.objectContaining({
      retainedSignals: 1,
      decayedSignals: 1,
      averageEffectiveConfidence: 0.2,
      riskModifier: 0.04,
      requiresReplay: false,
      requiresIndependentAudit: false,
    }))
    expect(oldPolicy.signalIds).toEqual(['old-failed-audit'])
    expect(oldPolicy.signalImpacts).toEqual([
      expect.objectContaining({
        signalId: 'old-failed-audit',
        ageDays: 111,
        decayFactor: 0.2,
        effectiveConfidence: 0.2,
        riskContribution: 0.04,
      }),
    ])
    expect(oldPolicy.reasons[0]).toContain('decayed 0.20')
  })

  it('reports formal circuit breaker status for every L5 loop', () => {
    const service = new SessionService(':memory:')
    const guards = new L5LoopGuardService(service).summarize()

    expect(guards.map((guard) => guard.loop).sort()).toEqual([
      'learning',
      'materialization',
      'meta_orchestration',
      'scenario_generation',
      'self_healing',
    ])
    expect(guards.every((guard) => guard.status === 'open')).toBe(true)
  })

  it('runs a governed closed-loop iteration and leaves new learning proposals for review', async () => {
    const service = new SessionService(':memory:')
    const session = service.createSession('first_order')

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      service.recordStepPerformance({
        sessionId: session.id,
        scenarioId: 'first_order',
        stepId: 'register_customer',
        agentId: 'sales_associate',
        status: 'failed',
        success: false,
        attempt,
        durationMs: 1_000,
        errorMessage: 'form validation failed',
      })
    }
    service.recordL5LearningSignal({
      sourceType: 'independent_audit_review',
      sourceId: 'review-loop-policy',
      signalType: 'audit_reviewed',
      sourceRunId: 'loop-loop-policy',
      scenarioId: 'first_order',
      version: 'review:loop-policy',
      confidence: 0.8,
      summary: 'Reviewed warning should require replay in closed-loop policy.',
      evidence: {
        auditVerdict: 'warning',
        findingCount: 1,
      },
    })

    const loop = await new L5ClosedLoopService(service).runOnce({
      scenarioId: 'first_order',
      maxScenarios: 1,
    })

    expect(loop).toEqual(expect.objectContaining({
      status: 'needs_review',
      mode: 'observe',
      queuedScenarios: ['first_order'],
      verification: expect.objectContaining({
        independentAudit: expect.objectContaining({
          agentRole: 'auditor',
          verdict: 'warning',
        }),
      }),
      summary: expect.objectContaining({
        generatedProposals: expect.any(Number),
        pendingReviews: expect.any(Number),
        retainedLearningSignals: 1,
        l5PolicyReplayRequired: true,
        l5PolicyIndependentAuditRequired: true,
        l5PolicyMaxRiskModifier: 0.1,
        independentAuditVerdict: 'warning',
      }),
    }))
    expect(loop.metadata?.queue).toEqual([
      expect.objectContaining({
        scenarioId: 'first_order',
        l5SignalPolicy: expect.objectContaining({
          retainedSignals: 1,
          requiresReplay: true,
        }),
      }),
    ])
    expect(loop.metadata?.lifecycle).toContainEqual(expect.objectContaining({
      type: 'loop_completed',
      loop: 'meta_orchestration',
      details: expect.objectContaining({
        l5SignalPolicies: [
          expect.objectContaining({
            scenarioId: 'first_order',
            retainedSignals: 1,
            requiresReplay: true,
          }),
        ],
      }),
    }))
    expect(Number(loop.summary.generatedProposals)).toBeGreaterThan(0)
    expect(service.listLearningProposals({
      scenarioId: 'first_order',
      status: 'proposed',
    }).length).toBeGreaterThan(0)
    expect(service.listL5ClosedLoopRuns()).toContainEqual(expect.objectContaining({
      id: loop.id,
      status: 'needs_review',
    }))
  })

  it('records autonomous replay evidence and supersedes conflicting retained risk signals', async () => {
    const service = new SessionService(':memory:')
    const terminalSession = recordCompliantFirstOrderSession(service)
    const riskSignal = service.recordL5LearningSignal({
      sourceType: 'independent_audit_review',
      sourceId: 'review-replay-risk',
      signalType: 'audit_reviewed',
      sourceRunId: 'loop-replay-risk',
      scenarioId: 'first_order',
      version: 'review:replay-risk',
      confidence: 0.8,
      summary: 'Reviewed warning requires replay before relying on this scenario.',
      evidence: {
        auditVerdict: 'warning',
        findingCount: 1,
      },
    })

    const before = new MetaOrchestrator(service).recommendSchedule()
      .find((item) => item.scenarioId === 'first_order')
    expect(before?.l5SignalPolicy).toEqual(expect.objectContaining({
      requiresReplay: true,
      signalIds: [riskSignal.id],
    }))

    const loop = await new L5ClosedLoopService(service).runOnce({
      scenarioId: 'first_order',
      maxScenarios: 1,
    })

    expect(loop).toEqual(expect.objectContaining({
      status: 'completed',
      summary: expect.objectContaining({
        l5PolicyReplayRequired: true,
        l5PolicyReplayVerifications: 1,
        l5PolicyReplayPassed: 1,
        l5PolicyReplayNeedsReview: 0,
      }),
      verification: expect.objectContaining({
        replayVerifications: [
          expect.objectContaining({
            scenarioId: 'first_order',
            status: 'passed',
            sourceSessionId: terminalSession.id,
            policySignalIds: [riskSignal.id],
            signalId: expect.any(String),
          }),
        ],
      }),
    }))

    const retainedSignals = service.listL5LearningSignals({
      scenarioId: 'first_order',
      status: 'retained',
      limit: 10,
    })
    const replaySignal = retainedSignals.find((signal) => signal.signalType === 'replay_verified')
    expect(replaySignal).toEqual(expect.objectContaining({
      sourceType: 'closed_loop_replay',
      evidence: expect.objectContaining({
        replayStatus: 'passed',
        sourceSessionId: terminalSession.id,
      }),
      metadata: expect.objectContaining({
        conflictResolution: expect.objectContaining({
          supersededSignalIds: [riskSignal.id],
        }),
      }),
    }))
    expect(service.listL5LearningSignals({
      scenarioId: 'first_order',
      status: 'superseded',
      limit: 10,
    })).toContainEqual(expect.objectContaining({
      id: riskSignal.id,
      signalType: 'audit_reviewed',
    }))

    const after = new MetaOrchestrator(service).recommendSchedule()
      .find((item) => item.scenarioId === 'first_order')
    expect(after?.l5SignalPolicy).toEqual(expect.objectContaining({
      retainedSignals: 1,
      riskModifier: 0,
      requiresReplay: false,
      requiresIndependentAudit: false,
      reasons: ['verified replay passed'],
    }))
  })

  it('keeps a failed autonomous replay under L5 review', async () => {
    const service = new SessionService(':memory:')
    const terminalSession = recordFailedReplaySession(service)
    const riskSignal = service.recordL5LearningSignal({
      sourceType: 'independent_audit_review',
      sourceId: 'review-failed-replay-risk',
      signalType: 'audit_reviewed',
      sourceRunId: 'loop-failed-replay-risk',
      scenarioId: 'first_order',
      version: 'review:failed-replay-risk',
      confidence: 0.8,
      summary: 'Reviewed warning requires replay before relying on this scenario.',
      evidence: {
        auditVerdict: 'warning',
        findingCount: 1,
      },
    })

    const loop = await new L5ClosedLoopService(service).runOnce({
      scenarioId: 'first_order',
      maxScenarios: 1,
    })

    expect(loop).toEqual(expect.objectContaining({
      status: 'needs_review',
      summary: expect.objectContaining({
        l5PolicyReplayRequired: true,
        l5PolicyReplayVerifications: 1,
        l5PolicyReplayPassed: 0,
        l5PolicyReplayNeedsReview: 1,
        independentAuditVerdict: 'failed',
      }),
      verification: expect.objectContaining({
        replayVerifications: [
          expect.objectContaining({
            scenarioId: 'first_order',
            status: 'failed',
            sourceSessionId: terminalSession.id,
            policySignalIds: [riskSignal.id],
            auditVerdict: 'failed',
            signalId: expect.any(String),
          }),
        ],
      }),
    }))

    const retainedSignals = service.listL5LearningSignals({
      scenarioId: 'first_order',
      status: 'retained',
      limit: 10,
    })
    expect(retainedSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: riskSignal.id, signalType: 'audit_reviewed' }),
      expect.objectContaining({
        sourceType: 'closed_loop_replay',
        signalType: 'replay_verified',
        evidence: expect.objectContaining({
          replayStatus: 'failed',
          sourceSessionId: terminalSession.id,
        }),
      }),
    ]))

    const after = new MetaOrchestrator(service).recommendSchedule()
      .find((item) => item.scenarioId === 'first_order')
    expect(after?.l5SignalPolicy).toEqual(expect.objectContaining({
      retainedSignals: 2,
      requiresReplay: true,
      requiresIndependentAudit: true,
    }))
    expect(after?.l5SignalPolicy.reasons).toEqual(expect.arrayContaining([
      'verified replay failed',
    ]))
  })

  it('keeps a warning autonomous replay under independent audit', async () => {
    const service = new SessionService(':memory:')
    const terminalSession = recordWarningReplaySession(service)
    const riskSignal = service.recordL5LearningSignal({
      sourceType: 'independent_audit_review',
      sourceId: 'review-warning-replay-risk',
      signalType: 'audit_reviewed',
      sourceRunId: 'loop-warning-replay-risk',
      scenarioId: 'first_order',
      version: 'review:warning-replay-risk',
      confidence: 0.8,
      summary: 'Reviewed warning requires replay before relying on this scenario.',
      evidence: {
        auditVerdict: 'warning',
        findingCount: 1,
      },
    })

    const loop = await new L5ClosedLoopService(service).runOnce({
      scenarioId: 'first_order',
      maxScenarios: 1,
    })

    expect(loop).toEqual(expect.objectContaining({
      status: 'needs_review',
      summary: expect.objectContaining({
        l5PolicyReplayRequired: true,
        l5PolicyReplayVerifications: 1,
        l5PolicyReplayPassed: 0,
        l5PolicyReplayNeedsReview: 1,
        independentAuditVerdict: 'warning',
      }),
      verification: expect.objectContaining({
        replayVerifications: [
          expect.objectContaining({
            scenarioId: 'first_order',
            status: 'warning',
            sourceSessionId: terminalSession.id,
            policySignalIds: [riskSignal.id],
            auditVerdict: 'warning',
            hardViolations: 0,
            driftSignals: 0,
            signalId: expect.any(String),
          }),
        ],
      }),
    }))

    const after = new MetaOrchestrator(service).recommendSchedule()
      .find((item) => item.scenarioId === 'first_order')
    expect(after?.l5SignalPolicy).toEqual(expect.objectContaining({
      retainedSignals: 2,
      requiresReplay: true,
      requiresIndependentAudit: true,
    }))
    expect(after?.l5SignalPolicy.reasons).toEqual(expect.arrayContaining([
      'verified replay warning',
    ]))
  })

  it('does not let low-confidence stability signals override retained L5 risk', () => {
    const service = new SessionService(':memory:')
    const riskSignal = service.recordL5LearningSignal({
      sourceType: 'independent_audit_review',
      sourceId: 'review-low-confidence-risk',
      signalType: 'audit_reviewed',
      sourceRunId: 'loop-low-confidence-risk',
      scenarioId: 'first_order',
      version: 'review:low-confidence-risk',
      confidence: 0.8,
      summary: 'Reviewed warning still needs replay.',
      evidence: {
        auditVerdict: 'warning',
        findingCount: 1,
      },
    })
    const replaySignal = service.recordL5LearningSignal({
      sourceType: 'closed_loop_replay',
      sourceId: 'replay-low-confidence',
      signalType: 'replay_verified',
      scenarioId: 'first_order',
      version: 'replay:low-confidence:passed',
      confidence: 0.65,
      summary: 'Low-confidence replay should not erase retained risk.',
      evidence: {
        replayStatus: 'passed',
        sourceSessionId: 'session-low-confidence',
      },
    })

    expect(service.listL5LearningSignals({
      scenarioId: 'first_order',
      status: 'retained',
      limit: 10,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: riskSignal.id }),
      expect.objectContaining({ id: replaySignal.id }),
    ]))
    expect(service.listL5LearningSignals({
      scenarioId: 'first_order',
      status: 'superseded',
      limit: 10,
    })).toEqual([])

    const policy = new MetaOrchestrator(service).recommendSchedule()
      .find((item) => item.scenarioId === 'first_order')?.l5SignalPolicy
    expect(policy).toEqual(expect.objectContaining({
      retainedSignals: 2,
      requiresReplay: true,
      requiresIndependentAudit: true,
    }))
  })

  it('materializes pre-approved learning changes during the closed-loop apply phase', async () => {
    const previousArtifactDir = process.env.PHASE2_ARTIFACT_DIR
    process.env.PHASE2_ARTIFACT_DIR = await mkdtemp(path.join(tmpdir(), 'l5-closed-loop-artifacts-'))

    try {
      const service = new SessionService(':memory:')
      const session = service.createSession('first_order')

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        service.recordStepPerformance({
          sessionId: session.id,
          scenarioId: 'first_order',
          stepId: 'register_customer',
          agentId: 'sales_associate',
          status: 'failed',
          success: false,
          attempt,
          durationMs: 1_000,
          errorMessage: 'form validation failed',
        })
      }

      const proposal = new LearningControlService(service).generateProposals({
        scenarioId: 'first_order',
      }).find((candidate) => candidate.patchKind === 'prompt_overlay')
      expect(proposal).toBeTruthy()
      new LearningControlService(service).approveProposal(proposal!.id)

      const loop = await new L5ClosedLoopService(service).runOnce({
        scenarioId: 'first_order',
        maxScenarios: 1,
        applyApprovedChanges: true,
      })

      expect(loop).toEqual(expect.objectContaining({
        status: 'completed',
        mode: 'apply_approved',
        summary: expect.objectContaining({
          appliedMaterializations: 1,
          independentAuditVerdict: 'warning',
        }),
        verification: expect.objectContaining({
          rerunRequired: true,
          independentAudit: expect.objectContaining({
            agentRole: 'auditor',
            verdict: 'warning',
          }),
        }),
      }))
      expect(service.listL5Materializations({
        subjectType: 'learning_proposal',
        subjectId: proposal!.id,
      })).toContainEqual(expect.objectContaining({
        kind: 'learning_prompt_overlay',
        status: 'active',
      }))
    } finally {
      if (previousArtifactDir === undefined) {
        delete process.env.PHASE2_ARTIFACT_DIR
      } else {
        process.env.PHASE2_ARTIFACT_DIR = previousArtifactDir
      }
    }
  })

  it('runs closed-loop automation ticks with interval guardrails and a single-flight lock', async () => {
    const service = new SessionService(':memory:')
    const session = service.createSession('first_order')

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      service.recordStepPerformance({
        sessionId: session.id,
        scenarioId: 'first_order',
        stepId: 'register_customer',
        agentId: 'sales_associate',
        status: 'failed',
        success: false,
        attempt,
        durationMs: 1_000,
        errorMessage: 'form validation failed',
      })
    }

    const scheduler = new L5ClosedLoopScheduler(service, { minIntervalMs: 1_000 })
    const started = scheduler.start({
      intervalMs: 25,
      scenarioId: 'first_order',
      maxScenarios: 1,
    })
    expect(started).toEqual(expect.objectContaining({
      enabled: true,
      intervalMs: 1_000,
      running: false,
      nextTickAt: expect.any(String),
    }))

    const tick = await scheduler.tick()
    expect(tick).toEqual(expect.objectContaining({
      status: 'executed',
      run: expect.objectContaining({
        status: 'needs_review',
        queuedScenarios: ['first_order'],
        metadata: expect.objectContaining({
          lifecycle: expect.arrayContaining([
            expect.objectContaining({ type: 'closed_loop_started' }),
            expect.objectContaining({ type: 'loop_started', loop: 'meta_orchestration' }),
            expect.objectContaining({ type: 'scenario_started', scenarioId: 'first_order' }),
            expect.objectContaining({ type: 'loop_completed', loop: 'self_healing' }),
            expect.objectContaining({ type: 'closed_loop_completed', status: 'needs_review' }),
          ]),
        }),
      }),
      scheduler: expect.objectContaining({
        tickCount: 1,
        consecutiveFailures: 0,
        running: false,
      }),
    }))
    expect(service.listL5ClosedLoopRuns()).toContainEqual(expect.objectContaining({
      id: tick.run!.id,
    }))
    expect(tick.run!.metadata?.['lifecycle']).toHaveLength(14)

    const stopped = scheduler.stop('test_complete')
    expect(stopped).toEqual(expect.objectContaining({
      enabled: false,
      nextTickAt: null,
    }))
  })

  it('routes failed independent terminal audits into closed-loop review', async () => {
    const service = new SessionService(':memory:')
    const session = service.createSession('first_order')
    service.appendEvent(session.id, {
      type: 'agent_started',
      agentRole: 'sales_associate',
      payload: {
        agentId: 'sales_associate',
        stepId: 'register_customer',
        attempt: 1,
      },
    })
    service.updateStatus(session.id, 'complete')

    const loop = await new L5ClosedLoopService(service).runOnce({
      scenarioId: 'first_order',
      maxScenarios: 1,
    })
    const independentAudit = loop.verification['independentAudit'] as Record<string, unknown>

    expect(loop.status).toBe('needs_review')
    expect(independentAudit).toEqual(expect.objectContaining({
      agentRole: 'auditor',
      verdict: 'failed',
    }))
    expect(independentAudit['findings']).toContainEqual(expect.objectContaining({
      code: 'agent_start_without_stop',
      severity: 'error',
    }))
    expect(loop.summary).toEqual(expect.objectContaining({
      independentAuditVerdict: 'failed',
      independentAuditedSessions: 1,
    }))
  })

  it('blocks subsequent meta-orchestration until failed independent audits are reviewed', async () => {
    const service = new SessionService(':memory:')
    const failedRun = service.recordL5ClosedLoopRun({
      status: 'needs_review',
      mode: 'observe',
      queuedScenarios: ['first_order'],
      actions: [],
      verification: {
        independentAudit: {
          agentRole: 'auditor',
          verdict: 'failed',
          checkedAt: new Date().toISOString(),
          sessionAudits: [],
          findings: [{ severity: 'error', code: 'agent_start_without_stop' }],
          summary: { findings: 1 },
        },
      },
      summary: {
        independentAuditVerdict: 'failed',
      },
    })

    const guards = new L5LoopGuardService(service).summarize()
    expect(guards).toContainEqual(expect.objectContaining({
      loop: 'meta_orchestration',
      status: 'blocked',
      current: 1,
      limit: 1,
      reason: 'Meta-orchestration is blocked until failed independent audits are reviewed.',
    }))

    const loop = await new L5ClosedLoopService(service).runOnce({ maxScenarios: 1 })
    expect(loop).toEqual(expect.objectContaining({
      status: 'blocked',
      summary: expect.objectContaining({
        blockedLoop: 'meta_orchestration',
      }),
    }))

    const review = service.recordL5IndependentAuditReview({
      runId: failedRun.id,
      status: 'reviewed',
      actor: 'qa_lead',
      reason: 'Independent audit finding was triaged and accepted.',
    })
    expect(review).toEqual(expect.objectContaining({
      runId: failedRun.id,
      status: 'reviewed',
      actor: 'qa_lead',
    }))

    const reviewedGuards = new L5LoopGuardService(service).summarize()
    expect(reviewedGuards).toContainEqual(expect.objectContaining({
      loop: 'meta_orchestration',
      status: 'open',
      current: 0,
    }))
  })

  it('records bounded self-healing actions for repeated timeout failures', () => {
    const service = new SessionService(':memory:')
    const session = service.createSession('first_order')

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      service.recordStepPerformance({
        sessionId: session.id,
        scenarioId: 'first_order',
        stepId: 'register_customer',
        agentId: 'sales_associate',
        status: 'timeout',
        success: false,
        attempt,
        durationMs: 90_000,
        errorMessage: 'timeout',
      })
    }

    const healing = new SelfHealingService(service)
    const actions = healing.evaluateRecentFailures()
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'increase_timeout_pool',
      status: 'applied',
      automatic: true,
    }))
    expect(healing.listLog()).toHaveLength(1)
    expect(service.listGovernanceDecisions({
      subjectType: 'healing_action',
      subjectId: actions[0]?.id,
    })).toContainEqual(expect.objectContaining({
      action: 'apply',
      verdict: 'allowed',
      requirements: expect.arrayContaining(['independent_audit', 'bounded_policy']),
    }))
  })

  it('enables deterministic fake workflow tools only through explicit verifier mode', async () => {
    const previous = process.env.AGENTIC_QA_FAKE_WORKFLOW_TOOLS
    process.env.AGENTIC_QA_FAKE_WORKFLOW_TOOLS = '1'

    try {
      const registry = new ToolRegistry()
      registerWorkflowTools(registry)

      const result = await registry.execute(
        'registerCustomer',
        { name: 'Alex Fake' },
        { browserAccess: true },
        {},
      )

      expect(result).toEqual({
        ok: true,
        output: expect.objectContaining({
          customerId: expect.stringMatching(/^customer-/),
          customerName: 'Alex Fake',
          fakeWorkflowTool: true,
        }),
      })
    } finally {
      if (previous === undefined) {
        delete process.env.AGENTIC_QA_FAKE_WORKFLOW_TOOLS
      } else {
        process.env.AGENTIC_QA_FAKE_WORKFLOW_TOOLS = previous
      }
    }
  })

  it('applies and rolls back governed human self-healing actions', () => {
    const service = new SessionService(':memory:')
    const action = service.recordHealingAction({
      type: 'quarantine_step',
      target: 'first_order:register_customer',
      reason: 'Manual quarantine validation',
      automatic: false,
      status: 'proposed',
      metadata: { quarantineRequiresHuman: true },
    })

    const healing = new SelfHealingService(service)
    const applied = healing.applyAction(action.id, 'qa_lead')
    const rolledBack = healing.rollbackAction(action.id, 'qa_lead')

    expect(applied).toEqual(expect.objectContaining({
      status: 'applied',
      metadata: expect.objectContaining({
        rollbackAvailable: true,
        appliedBy: 'qa_lead',
      }),
    }))
    expect(rolledBack).toEqual(expect.objectContaining({
      status: 'rolled_back',
      metadata: expect.objectContaining({
        rolledBackBy: 'qa_lead',
      }),
    }))
    expect(service.listGovernanceDecisions({
      subjectType: 'healing_action',
      subjectId: action.id,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'apply', verdict: 'allowed' }),
      expect.objectContaining({ action: 'rollback', verdict: 'allowed' }),
    ]))
  })

  it('blocks automatic self-healing when hourly bounds are exceeded', () => {
    const service = new SessionService(':memory:')
    const session = service.createSession('first_order')

    for (let index = 0; index < 10; index += 1) {
      service.recordHealingAction({
        type: 'increase_timeout_pool',
        target: `scenario:step:${index}`,
        reason: 'seed',
        automatic: true,
        status: 'applied',
      })
    }

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      service.recordStepPerformance({
        sessionId: session.id,
        scenarioId: 'first_order',
        stepId: 'register_customer',
        agentId: 'sales_associate',
        status: 'timeout',
        success: false,
        attempt,
        durationMs: 90_000,
        errorMessage: 'timeout',
      })
    }

    const actions = new SelfHealingService(service).evaluateRecentFailures()
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'increase_timeout_pool',
      status: 'blocked',
      automatic: false,
    }))
    expect(service.listGovernanceDecisions({
      subjectType: 'healing_action',
      subjectId: actions[0]?.id,
    })).toContainEqual(expect.objectContaining({
      action: 'apply',
      verdict: 'blocked',
      requirements: expect.arrayContaining(['independent_audit', 'bounded_policy']),
    }))
  })

  it('records human-review governance decisions for proposed quarantine actions', () => {
    const service = new SessionService(':memory:')
    const session = service.createSession('first_order')

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      service.recordStepPerformance({
        sessionId: session.id,
        scenarioId: 'first_order',
        stepId: 'create_order',
        agentId: 'sales_associate',
        status: attempt <= 4 ? 'failed' : 'completed',
        success: attempt > 4,
        attempt,
        durationMs: 1_000,
        errorMessage: attempt <= 4 ? 'sensor validation failed' : undefined,
      })
    }

    const actions = new SelfHealingService(service).evaluateRecentFailures()

    expect(actions).toContainEqual(expect.objectContaining({
      type: 'quarantine_step',
      status: 'proposed',
      automatic: false,
    }))
    expect(service.listGovernanceDecisions({
      subjectType: 'healing_action',
      subjectId: actions[0]?.id,
    })).toContainEqual(expect.objectContaining({
      action: 'evaluate',
      verdict: 'allowed',
      requirements: expect.arrayContaining(['independent_audit', 'human_review']),
    }))
  })

  it('does not duplicate self-healing actions for unchanged failure evidence', () => {
    const service = new SessionService(':memory:')
    const session = service.createSession('first_order')

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      service.recordStepPerformance({
        sessionId: session.id,
        scenarioId: 'first_order',
        stepId: 'register_customer',
        agentId: 'sales_associate',
        status: 'timeout',
        success: false,
        attempt,
        durationMs: 90_000,
        errorMessage: 'timeout',
      })
    }

    const healing = new SelfHealingService(service)
    const first = healing.evaluateRecentFailures()
    const second = healing.evaluateRecentFailures()

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(second[0]?.id).toBe(first[0]?.id)
    expect(healing.listLog()).toHaveLength(1)
    expect(service.listGovernanceDecisions({
      subjectType: 'healing_action',
      subjectId: first[0]?.id,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'apply', verdict: 'allowed' }),
      expect.objectContaining({ action: 'evaluate', verdict: 'allowed' }),
    ]))
  })
})

function makeLearningSignal(overrides: Partial<L5LearningSignal> = {}): L5LearningSignal {
  return {
    id: 'signal-id',
    sourceType: 'independent_audit_review',
    sourceId: 'review-id',
    signalType: 'audit_reviewed',
    sourceRunId: 'loop-id',
    scenarioId: 'first_order',
    version: 'review:review-id',
    confidence: 1,
    status: 'retained',
    summary: 'Reviewed signal.',
    createdAt: '2026-04-22T00:00:00.000Z',
    ...overrides,
  }
}

function recordCompliantFirstOrderSession(service: SessionService) {
  const session = service.createSession('first_order')
  const steps = [
    { stepId: 'register_customer', artifact: 'customerId', value: 'customer-123' },
    { stepId: 'create_order', artifact: 'orderId', value: 'order-456' },
  ]

  for (const step of steps) {
    service.appendEvent(session.id, {
      type: 'step_started',
      payload: { stepId: step.stepId, agentId: 'sales_associate', attempt: 1 },
    })
    service.appendEvent(session.id, {
      type: 'agent_started',
      agentRole: 'sales_associate',
      payload: { agentId: 'sales_associate', stepId: step.stepId, attempt: 1 },
    })
    service.appendEvent(session.id, {
      type: 'agent_stopped',
      agentRole: 'sales_associate',
      payload: { agentId: 'sales_associate', stepId: step.stepId, attempt: 1 },
    })
    service.setArtifact(session.id, step.artifact, step.value)
    service.appendEvent(session.id, {
      type: 'step_completed',
      payload: { stepId: step.stepId, agentId: 'sales_associate', durationMs: 1000 },
    })
  }

  service.appendEvent(session.id, {
    type: 'session_completed',
    payload: { scenarioId: 'first_order', stepsCompleted: steps.length },
  })
  service.updateStatus(session.id, 'complete')
  return service.getSession(session.id)!
}

function recordWarningReplaySession(service: SessionService) {
  const session = service.createSession('first_order')
  const steps = [
    { stepId: 'register_customer', artifact: 'customerId', value: 'customer-warning' },
    { stepId: 'create_order', artifact: 'orderId', value: 'order-warning' },
  ]

  for (const step of steps) {
    service.appendEvent(session.id, {
      type: 'step_started',
      payload: { stepId: step.stepId, agentId: 'sales_associate', attempt: 1 },
    })
    service.appendEvent(session.id, {
      type: 'agent_started',
      agentRole: 'sales_associate',
      payload: { agentId: 'sales_associate', stepId: step.stepId, attempt: 1 },
    })
    service.appendEvent(session.id, {
      type: 'agent_stopped',
      agentRole: 'sales_associate',
      payload: { agentId: 'sales_associate', stepId: step.stepId, attempt: 1 },
    })
    service.setArtifact(session.id, step.artifact, step.value)
    service.appendEvent(session.id, {
      type: 'step_completed',
      payload: { stepId: step.stepId, agentId: 'sales_associate', durationMs: 1000 },
    })
  }

  service.updateStatus(session.id, 'complete')
  return service.getSession(session.id)!
}

function recordFailedReplaySession(service: SessionService) {
  const session = service.createSession('first_order')
  service.appendEvent(session.id, {
    type: 'step_started',
    payload: { stepId: 'register_customer', agentId: 'sales_associate', attempt: 1 },
  })
  service.appendEvent(session.id, {
    type: 'agent_started',
    agentRole: 'sales_associate',
    payload: { agentId: 'sales_associate', stepId: 'register_customer', attempt: 1 },
  })
  service.appendEvent(session.id, {
    type: 'session_completed',
    payload: { scenarioId: 'first_order', stepsCompleted: 0 },
  })
  service.updateStatus(session.id, 'complete')
  return service.getSession(session.id)!
}

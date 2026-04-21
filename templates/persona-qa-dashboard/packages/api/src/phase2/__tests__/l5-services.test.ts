import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CoverageAnalysisService } from '../services/coverage-analysis-service.js'
import { GovernancePolicyService } from '../services/governance-policy-service.js'
import { L5ClosedLoopScheduler } from '../services/l5-closed-loop-scheduler.js'
import { L5ClosedLoopService } from '../services/l5-closed-loop-service.js'
import { L5LoopGuardService } from '../services/l5-loop-guard-service.js'
import { L5MaterializationService } from '../services/l5-materialization-service.js'
import { LearningControlService } from '../services/learning-control-service.js'
import { calculateRiskScore, MetaOrchestrator } from '../services/meta-orchestrator.js'
import { ProfileTuningService } from '../services/profile-tuning-service.js'
import { SelfHealingService } from '../services/self-healing-service.js'
import { SessionService } from '../services/session-service.js'
import { ToolRegistry } from '../services/tool-registry.js'
import { registerWorkflowTools } from '../tools/workflow-tools.js'

describe('L5 controlled feedback services', () => {
  let previousLegacyScenarios: string | undefined

  beforeAll(() => {
    previousLegacyScenarios = process.env.PERSONA_QA_USE_LEGACY_STATIC_SCENARIOS
    process.env.PERSONA_QA_USE_LEGACY_STATIC_SCENARIOS = '1'
  })

  afterAll(() => {
    if (previousLegacyScenarios === undefined) {
      delete process.env.PERSONA_QA_USE_LEGACY_STATIC_SCENARIOS
    } else {
      process.env.PERSONA_QA_USE_LEGACY_STATIC_SCENARIOS = previousLegacyScenarios
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
      stepId: 'create_customer',
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
      stepId: 'create_customer',
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
      stepId: 'create_customer',
      agentId: 'sales-associate',
      status: 'completed',
      success: true,
      attempt: 1,
      durationMs: 89_000,
    })

    const recommendations = new ProfileTuningService(service).generateRecommendations()
    expect(recommendations).toContainEqual(expect.objectContaining({
      agentId: 'sales-associate',
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
      stepId: 'create_customer',
      agentId: 'sales-associate',
      status: 'failed',
      success: false,
      attempt: 1,
      durationMs: 1_000,
      errorMessage: 'timeout',
    })

    const recommendations = new MetaOrchestrator(service).recommendSchedule()
    expect(recommendations[0]?.scenarioId).toBeTruthy()
    expect(recommendations[0]?.riskScore).toBeGreaterThan(0)

    const queue = new MetaOrchestrator(service).buildGovernedRunQueue(3)
    expect(queue[0]).toEqual(expect.objectContaining({
      position: 1,
      status: 'queued',
      guard: expect.objectContaining({
        loop: 'meta_orchestration',
        status: 'open',
      }),
    }))
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
        stepId: 'create_customer',
        agentId: 'sales-associate',
        status: 'failed',
        success: false,
        attempt,
        durationMs: 1_000,
        errorMessage: 'form validation failed',
      })
    }

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
        independentAuditVerdict: 'warning',
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
          stepId: 'create_customer',
          agentId: 'sales-associate',
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
        stepId: 'create_customer',
        agentId: 'sales-associate',
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
      agentRole: 'sales-associate',
      payload: {
        agentId: 'sales-associate',
        stepId: 'create_customer',
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

  it('blocks subsequent meta-orchestration after failed independent audits', async () => {
    const service = new SessionService(':memory:')
    service.recordL5ClosedLoopRun({
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
  })

  it('records bounded self-healing actions for repeated timeout failures', () => {
    const service = new SessionService(':memory:')
    const session = service.createSession('first_order')

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      service.recordStepPerformance({
        sessionId: session.id,
        scenarioId: 'first_order',
        stepId: 'create_customer',
        agentId: 'sales-associate',
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
        'createCustomer',
        { name: 'Maria Fake' },
        { browserAccess: true },
        {},
      )

      expect(result).toEqual({
        ok: true,
        output: expect.objectContaining({
          customerId: expect.stringMatching(/^customer-/),
          customerName: 'Maria Fake',
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
      target: 'first_order:create_customer',
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
        stepId: 'create_customer',
        agentId: 'sales-associate',
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
        stepId: 'schedule_order',
        agentId: 'sales-associate',
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
        stepId: 'create_customer',
        agentId: 'sales-associate',
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

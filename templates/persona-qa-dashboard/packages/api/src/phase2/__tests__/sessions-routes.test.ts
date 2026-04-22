import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { phase2SessionRoutes, setSessionService } from '../routes/sessions.js';
import { SessionService } from '../services/session-service.js';

describe('Phase 2 Session Routes', () => {
  const app = Fastify();
  let sessionService: SessionService;
  let previousArtifactDir: string | undefined;
  let previousLegacyScenarios: string | undefined;

  beforeAll(async () => {
    previousArtifactDir = process.env.PHASE2_ARTIFACT_DIR;
    previousLegacyScenarios = process.env.PERSONA_QA_USE_LEGACY_STATIC_SCENARIOS;
    process.env.PERSONA_QA_USE_LEGACY_STATIC_SCENARIOS = '1';
    await app.register(phase2SessionRoutes);
    await app.ready();
  });

  afterAll(async () => {
    if (previousArtifactDir === undefined) {
      delete process.env.PHASE2_ARTIFACT_DIR;
    } else {
      process.env.PHASE2_ARTIFACT_DIR = previousArtifactDir;
    }
    if (previousLegacyScenarios === undefined) {
      delete process.env.PERSONA_QA_USE_LEGACY_STATIC_SCENARIOS;
    } else {
      process.env.PERSONA_QA_USE_LEGACY_STATIC_SCENARIOS = previousLegacyScenarios;
    }
    await app.close();
  });

  beforeEach(() => {
    process.env.PHASE2_ARTIFACT_DIR = mkdtempSync(path.join(tmpdir(), 'p2-route-artifacts-'));
    sessionService = new SessionService();
    setSessionService(sessionService);
  });

  describe('GET /api/p2/maturity', () => {
    it('should expose L4 and L5 maturity status', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/p2/maturity' });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.releaseGate).toBe('ready');
      expect(body.levels.l4).toEqual(expect.objectContaining({
        level: 'L4',
        status: 'ready',
        completion: 95,
      }));
      expect(body.levels.l5).toEqual(expect.objectContaining({
        level: 'L5',
        status: 'controlled_beta',
        completion: 70,
      }));
      expect(body.levels.l4.capabilities).toContainEqual(expect.objectContaining({
        id: 'workflow_contracts',
        state: 'complete',
      }));
      expect(body.levels.l5.capabilities).toContainEqual(expect.objectContaining({
        id: 'independent_audit',
        state: 'guarded',
      }));
      expect(body.levels.l5.capabilities).toContainEqual(expect.objectContaining({
        id: 'runtime_learning',
        state: 'beta',
      }));
      expect(body.levels.l5.signals).toContainEqual(expect.objectContaining({
        label: 'Runtime learning loads',
        value: 0,
      }));
    });

    it('should expose L5 runtime learning usage from session events', async () => {
      const session = sessionService.createSession('first_order');
      sessionService.appendEvent(session.id, {
        type: 'info',
        agentRole: 'sales-associate',
        payload: {
          event: 'l5_runtime_learning_loaded',
          scenarioId: 'first_order',
          stepId: 'create_customer',
          overlayCount: 2,
          overlays: [
            { proposalId: 'proposal-1', materializationId: 'materialization-1', checksum: 'checksum-1' },
            { proposalId: 'proposal-2', materializationId: 'materialization-2', checksum: 'checksum-2' },
          ],
        },
      });

      const res = await app.inject({ method: 'GET', url: '/api/p2/maturity' });
      expect(res.statusCode).toBe(200);

      const l5 = res.json().levels.l5;
      expect(l5.capabilities).toContainEqual(expect.objectContaining({
        id: 'runtime_learning',
        state: 'complete',
        evidence: expect.stringContaining('2 overlay(s) L5'),
      }));
      expect(l5.signals).toContainEqual(expect.objectContaining({
        label: 'Runtime learning loads',
        value: 1,
        tone: 'success',
      }));
      expect(l5.signals).toContainEqual(expect.objectContaining({
        label: 'Runtime overlays usados',
        value: 2,
        tone: 'success',
      }));
    });
  });

  describe('L5 closed-loop routes', () => {
    it('should expose closed-loop status', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/p2/closed-loop/status' });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body).toEqual(expect.objectContaining({
        generatedAt: expect.any(String),
        guards: expect.any(Array),
        queue: expect.any(Array),
        latestRun: null,
        recentRuns: [],
      }));
    });

    it('should run one governed closed-loop iteration', async () => {
      const session = sessionService.createSession('first_order');
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        sessionService.recordStepPerformance({
          sessionId: session.id,
          scenarioId: 'first_order',
          stepId: 'create_customer',
          agentId: 'sales-associate',
          status: 'failed',
          success: false,
          attempt,
          durationMs: 1_000,
          errorMessage: 'form validation failed',
        });
      }

      const res = await app.inject({
        method: 'POST',
        url: '/api/p2/closed-loop/run',
        payload: {
          scenarioId: 'first_order',
          maxScenarios: 1,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual(expect.objectContaining({
        status: 'needs_review',
        mode: 'observe',
        queuedScenarios: ['first_order'],
      }));

      const list = await app.inject({ method: 'GET', url: '/api/p2/closed-loop/runs?limit=5' });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toContainEqual(expect.objectContaining({
        status: 'needs_review',
      }));

      const run = res.json();
      const proposalId = run.actions.find((action: Record<string, unknown>) => (
        action.type === 'learning_proposal_generated'
      ))?.proposalId as string | undefined;
      expect(proposalId).toEqual(expect.any(String));
      if (!proposalId) throw new Error('Expected generated learning proposal action');

      sessionService.recordGovernanceDecision({
        subjectType: 'learning_proposal',
        subjectId: proposalId,
        action: 'approve',
        verdict: 'allowed',
        reason: 'Reviewed as part of the audit bundle route test.',
      });

      const bundle = await app.inject({
        method: 'GET',
        url: `/api/p2/closed-loop/runs/${run.id}/audit-bundle`,
      });
      expect(bundle.statusCode).toBe(200);
      expect(bundle.headers['content-disposition']).toContain(`l5-audit-bundle-${run.id}.json`);
      expect(bundle.json()).toEqual(expect.objectContaining({
        schemaVersion: 'persona-qa.l5.audit-bundle.v1',
        run: expect.objectContaining({ id: run.id }),
        lifecycle: expect.any(Array),
        replay: expect.objectContaining({
          endpoint: '/api/p2/closed-loop/run',
          safeReplayPayload: expect.objectContaining({
            applyApprovedChanges: false,
            generateScenarioDrafts: false,
          }),
        }),
        promotion: expect.objectContaining({
          candidates: expect.arrayContaining([
            expect.objectContaining({
              sourceRunId: run.id,
              subjectType: 'learning_proposal',
              subjectId: proposalId,
              promotionType: 'learning_overlay',
              status: 'requires_review',
              approvalRequired: true,
              nextAction: 'approve',
              version: expect.stringMatching(/^[a-f0-9]{64}$/),
              evidence: expect.objectContaining({
                governanceEvidence: 1,
              }),
            }),
          ]),
        }),
        integrity: expect.objectContaining({
          checksum: expect.any(String),
          counts: expect.objectContaining({
            governanceDecisions: 1,
            promotionCandidates: 1,
          }),
        }),
      }));
      expect(bundle.json().related.learningProposals).toContainEqual(expect.objectContaining({
        id: proposalId,
      }));
      expect(bundle.json().related.governanceDecisions).toContainEqual(expect.objectContaining({
        subjectId: proposalId,
      }));
    });

    it('should return 404 for missing closed-loop audit bundles', async () => {
      const bundle = await app.inject({
        method: 'GET',
        url: '/api/p2/closed-loop/runs/missing-run/audit-bundle',
      });
      expect(bundle.statusCode).toBe(404);
    });

    it('should record independent audit reviews and release the L5 audit guard', async () => {
      const run = sessionService.recordL5ClosedLoopRun({
        status: 'needs_review',
        mode: 'observe',
        queuedScenarios: ['first_order'],
        actions: [],
        verification: {
          independentAudit: {
            agentRole: 'auditor',
            verdict: 'failed',
            checkedAt: '2026-04-20T18:00:00.000Z',
            sessionAudits: [],
            findings: [{ severity: 'error', code: 'agent_start_without_stop' }],
            summary: { findings: 1 },
          },
        },
        summary: {
          independentAuditVerdict: 'failed',
        },
      });

      const blockedStatus = await app.inject({ method: 'GET', url: '/api/p2/closed-loop/status' });
      expect(blockedStatus.json().guards).toContainEqual(expect.objectContaining({
        loop: 'meta_orchestration',
        status: 'blocked',
        current: 1,
      }));

      const queue = await app.inject({ method: 'GET', url: '/api/p2/closed-loop/audit-review-queue' });
      expect(queue.statusCode).toBe(200);
      expect(queue.json()).toContainEqual(expect.objectContaining({
        runId: run.id,
        verdict: 'failed',
        findingCount: 1,
      }));

      const missingReason = await app.inject({
        method: 'POST',
        url: `/api/p2/closed-loop/runs/${run.id}/independent-audit/review`,
        payload: {
          actor: 'qa_lead',
        },
      });
      expect(missingReason.statusCode).toBe(400);
      expect(missingReason.json()).toEqual(expect.objectContaining({
        error: 'Independent audit review reason is required',
      }));

      const review = await app.inject({
        method: 'POST',
        url: `/api/p2/closed-loop/runs/${run.id}/independent-audit/review`,
        payload: {
          actor: 'qa_lead',
          reason: 'Reviewed during route test.',
        },
      });

      expect(review.statusCode).toBe(201);
      expect(review.json()).toEqual(expect.objectContaining({
        review: expect.objectContaining({
          runId: run.id,
          status: 'reviewed',
          actor: 'qa_lead',
          reason: 'Reviewed during route test.',
        }),
        guards: expect.arrayContaining([
          expect.objectContaining({
            loop: 'meta_orchestration',
            status: 'open',
            current: 0,
          }),
        ]),
      }));

      const reviews = await app.inject({
        method: 'GET',
        url: `/api/p2/closed-loop/audit-reviews?runId=${run.id}`,
      });
      expect(reviews.statusCode).toBe(200);
      expect(reviews.json()).toContainEqual(expect.objectContaining({
        runId: run.id,
        status: 'reviewed',
      }));

      const releasedQueue = await app.inject({ method: 'GET', url: '/api/p2/closed-loop/audit-review-queue' });
      expect(releasedQueue.statusCode).toBe(200);
      expect(releasedQueue.json()).not.toContainEqual(expect.objectContaining({
        runId: run.id,
      }));
    });

    it('should block knowledge promotion until source independent audit is reviewed', async () => {
      const proposal = sessionService.createLearningProposal({
        recommendationId: 'promotion-audit-gate',
        scenarioId: 'test_scenario',
        stepId: 'step_1',
        agentId: 'sales-associate',
        type: 'prompt_patch',
        severity: 'medium',
        recommendation: { reason: 'audit gate test' },
        patchKind: 'prompt_overlay',
        target: 'agent:sales-associate',
        patchContent: '[LEARNING OVERLAY]',
      });
      const run = sessionService.recordL5ClosedLoopRun({
        status: 'needs_review',
        mode: 'observe',
        scenarioId: 'test_scenario',
        queuedScenarios: ['test_scenario'],
        actions: [{ type: 'learning_proposal_generated', proposalId: proposal.id }],
        verification: {
          independentAudit: {
            agentRole: 'auditor',
            verdict: 'warning',
            checkedAt: '2026-04-20T18:00:00.000Z',
            sessionAudits: [],
            findings: [{ severity: 'warning', code: 'manual_review_required' }],
            summary: { findings: 1, auditedSessions: 0 },
          },
        },
        summary: {
          pendingReviews: 1,
          independentAuditVerdict: 'warning',
        },
      });
      const candidate = {
        id: `learning_proposal:${proposal.id}:abc123def456`,
        sourceRunId: run.id,
        subjectType: 'learning_proposal',
        subjectId: proposal.id,
        promotionType: 'learning_overlay',
        status: 'requires_review',
        version: 'abc123def4567890abc123def4567890abc123def4567890abc123def4567890',
        title: 'Prompt patch for step_1',
        target: 'agent:sales-associate',
        reason: 'Promotion audit gate test.',
        approvalRequired: true,
        materializationReady: false,
        nextAction: 'approve',
        evidence: {
          scenarioId: 'test_scenario',
          stepId: 'step_1',
        },
      };

      const blocked = await app.inject({
        method: 'POST',
        url: '/api/p2/knowledge/promotions/actions',
        payload: {
          candidate,
          actor: 'qa_lead',
        },
      });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json()).toEqual(expect.objectContaining({
        error: expect.stringContaining('must be reviewed before promotion'),
        promotionEvent: expect.objectContaining({
          status: 'blocked',
          result: expect.objectContaining({
            gate: expect.objectContaining({
              allowed: false,
              verdict: 'warning',
            }),
          }),
        }),
      }));

      sessionService.recordL5IndependentAuditReview({
        runId: run.id,
        status: 'reviewed',
        actor: 'qa_lead',
        reason: 'Warning accepted for promotion gate route test.',
      });

      const allowed = await app.inject({
        method: 'POST',
        url: '/api/p2/knowledge/promotions/actions',
        payload: {
          candidate,
          actor: 'qa_lead',
        },
      });
      expect(allowed.statusCode).toBe(201);
      expect(allowed.json()).toEqual(expect.objectContaining({
        event: expect.objectContaining({
          status: 'completed',
          action: 'approve',
        }),
        result: expect.objectContaining({
          postPromotionVerification: expect.objectContaining({
            checks: expect.arrayContaining([
              expect.objectContaining({ id: 'source_run_audit_review_gate', status: 'passed' }),
            ]),
          }),
        }),
      }));
    });

    it('should execute knowledge promotion actions and expose promotion event history', async () => {
      const proposal = sessionService.createLearningProposal({
        recommendationId: 'promotion-event-route',
        scenarioId: 'test_scenario',
        stepId: 'step_1',
        agentId: 'sales-associate',
        type: 'prompt_patch',
        severity: 'medium',
        recommendation: { reason: 'promotion event route test' },
        patchKind: 'prompt_overlay',
        target: 'agent:sales-associate',
        patchContent: '[LEARNING OVERLAY]',
      });
      const run = sessionService.recordL5ClosedLoopRun({
        status: 'needs_review',
        mode: 'observe',
        scenarioId: 'test_scenario',
        queuedScenarios: ['test_scenario'],
        actions: [{ type: 'learning_proposal_generated', proposalId: proposal.id }],
        verification: { rerunRequired: true },
        summary: { pendingReviews: 1 },
      });
      const candidateVersion = 'abc123def4567890abc123def4567890abc123def4567890abc123def4567890';
      const candidate = {
        id: `learning_proposal:${proposal.id}:abc123def456`,
        sourceRunId: run.id,
        subjectType: 'learning_proposal',
        subjectId: proposal.id,
        promotionType: 'learning_overlay',
        status: 'requires_review',
        version: candidateVersion,
        title: 'Prompt patch for step_1',
        target: 'agent:sales-associate',
        reason: 'Promotion event route test.',
        approvalRequired: true,
        materializationReady: false,
        nextAction: 'approve',
        evidence: {
          scenarioId: 'test_scenario',
          stepId: 'step_1',
        },
      };

      const action = await app.inject({
        method: 'POST',
        url: '/api/p2/knowledge/promotions/actions',
        payload: {
          candidate,
          actor: 'qa_lead',
        },
      });

      expect(action.statusCode).toBe(201);
      expect(action.json()).toEqual(expect.objectContaining({
        event: expect.objectContaining({
          sourceRunId: run.id,
          candidateId: candidate.id,
          candidateVersion,
          subjectType: 'learning_proposal',
          subjectId: proposal.id,
          action: 'approve',
          status: 'completed',
          actor: 'qa_lead',
        }),
        result: expect.objectContaining({
          proposalId: proposal.id,
          proposalStatus: 'approved',
          postPromotionVerification: expect.objectContaining({
            status: 'passed',
            checks: expect.arrayContaining([
              expect.objectContaining({ id: 'source_run_audit_review_gate', status: 'passed' }),
              expect.objectContaining({ id: 'allowed_governance_decision', status: 'passed' }),
              expect.objectContaining({ id: 'learning_proposal_approved', status: 'passed' }),
            ]),
          }),
        }),
      }));
      expect(sessionService.getLearningProposal(proposal.id)?.status).toBe('approved');

      const applyCandidate = {
        ...candidate,
        status: 'approved',
        materializationReady: true,
        nextAction: 'apply',
      };
      const applyAction = await app.inject({
        method: 'POST',
        url: '/api/p2/knowledge/promotions/actions',
        payload: {
          candidate: applyCandidate,
          actor: 'qa_lead',
        },
      });

      expect(applyAction.statusCode).toBe(201);
      expect(applyAction.json()).toEqual(expect.objectContaining({
        event: expect.objectContaining({
          candidateId: applyCandidate.id,
          action: 'apply',
          status: 'completed',
          actor: 'qa_lead',
        }),
        result: expect.objectContaining({
          proposalId: proposal.id,
          proposalStatus: 'applied',
          materialization: expect.objectContaining({
            subjectType: 'learning_proposal',
            subjectId: proposal.id,
          }),
          postPromotionVerification: expect.objectContaining({
            status: 'passed',
            checks: expect.arrayContaining([
              expect.objectContaining({ id: 'learning_proposal_applied', status: 'passed' }),
              expect.objectContaining({ id: 'active_materialization_exists', status: 'passed' }),
              expect.objectContaining({ id: 'runtime_overlay_loadable', status: 'passed' }),
            ]),
          }),
        }),
      }));
      expect(sessionService.getLearningProposal(proposal.id)?.status).toBe('applied');

      const events = await app.inject({
        method: 'GET',
        url: `/api/p2/knowledge/promotions/events?sourceRunId=${run.id}`,
      });
      expect(events.statusCode).toBe(200);
      expect(events.json()).toContainEqual(expect.objectContaining({
        sourceRunId: run.id,
        candidateId: candidate.id,
        candidateVersion,
        subjectType: 'learning_proposal',
        subjectId: proposal.id,
        action: 'approve',
        status: 'completed',
        actor: 'qa_lead',
        target: 'agent:sales-associate',
        result: expect.objectContaining({
          postPromotionVerification: expect.objectContaining({
            status: 'passed',
          }),
        }),
      }));
      expect(events.json()).toContainEqual(expect.objectContaining({
        sourceRunId: run.id,
        candidateId: applyCandidate.id,
        candidateVersion,
        subjectType: 'learning_proposal',
        subjectId: proposal.id,
        action: 'apply',
        status: 'completed',
        actor: 'qa_lead',
        target: 'agent:sales-associate',
        result: expect.objectContaining({
          postPromotionVerification: expect.objectContaining({
            status: 'passed',
          }),
        }),
      }));
    });

    it('should expose and control closed-loop scheduler automation', async () => {
      const status = await app.inject({ method: 'GET', url: '/api/p2/closed-loop/scheduler' });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toEqual(expect.objectContaining({
        enabled: false,
        running: false,
      }));

      const started = await app.inject({
        method: 'POST',
        url: '/api/p2/closed-loop/scheduler/start',
        payload: {
          intervalMs: 100,
          scenarioId: 'first_order',
          maxScenarios: 1,
        },
      });
      expect(started.statusCode).toBe(200);
      expect(started.json()).toEqual(expect.objectContaining({
        enabled: true,
        intervalMs: 60000,
        nextTickAt: expect.any(String),
      }));

      const tick = await app.inject({
        method: 'POST',
        url: '/api/p2/closed-loop/scheduler/tick',
        payload: {
          scenarioId: 'first_order',
          maxScenarios: 1,
        },
      });
      expect(tick.statusCode).toBe(201);
      expect(tick.json()).toEqual(expect.objectContaining({
        status: 'executed',
        scheduler: expect.objectContaining({
          tickCount: 1,
        }),
      }));

      const stopped = await app.inject({ method: 'POST', url: '/api/p2/closed-loop/scheduler/stop' });
      expect(stopped.statusCode).toBe(200);
      expect(stopped.json()).toEqual(expect.objectContaining({
        enabled: false,
        nextTickAt: null,
      }));
    });
  });

  describe('GET /api/p2/sessions', () => {
    it('should return empty list when no sessions', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/p2/sessions' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('should return session summaries', async () => {
      sessionService.createSession('test_scenario', 1);
      sessionService.createSession('another_scenario', 2);

      const res = await app.inject({ method: 'GET', url: '/api/p2/sessions' });
      expect(res.statusCode).toBe(200);
      const sessions = res.json();
      expect(sessions).toHaveLength(2);
      expect(sessions[0]).toHaveProperty('id');
      expect(sessions[0]).toHaveProperty('scenarioId', 'test_scenario');
      expect(sessions[0]).toHaveProperty('status', 'pending');
      expect(sessions[0]).toHaveProperty('eventCount', 0);
    });
  });

  describe('GET /api/p2/sessions/:id', () => {
    it('should return full session detail', async () => {
      const session = sessionService.createSession('test_scenario', 1);
      sessionService.addEvent(session.id, 'session_started', { scenarioId: 'test_scenario' });

      const res = await app.inject({ method: 'GET', url: `/api/p2/sessions/${session.id}` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(session.id);
      expect(body.events).toHaveLength(1);
      expect(body.artifacts).toEqual({});
    });

    it('should return 404 for unknown session', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/p2/sessions/nonexistent' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/p2/sessions/:id/events', () => {
    it('should return events in chronological order', async () => {
      const session = sessionService.createSession('test_scenario');
      sessionService.addEvent(session.id, 'session_started', {});
      sessionService.addEvent(session.id, 'step_started', { stepId: 'step_1' });
      sessionService.addEvent(session.id, 'step_completed', { stepId: 'step_1' });

      const res = await app.inject({ method: 'GET', url: `/api/p2/sessions/${session.id}/events` });
      expect(res.statusCode).toBe(200);
      const events = res.json();
      expect(events).toHaveLength(3);
      expect(events[0].type).toBe('session_started');
      expect(events[2].type).toBe('step_completed');
    });

    it('should return 404 for unknown session', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/p2/sessions/nonexistent/events' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/p2/sessions/:id/findings', () => {
    it('should return findings from finding_recorded events', async () => {
      const session = sessionService.createSession('test_scenario');
      sessionService.addEvent(session.id, 'finding_recorded', {
        severity: 'high',
        title: 'Campo obrigatório ausente',
        evidence: ['screenshot.png'],
        agentId: 'sales-associate',
        stepId: 'step_1',
      });

      const res = await app.inject({ method: 'GET', url: `/api/p2/sessions/${session.id}/findings` });
      expect(res.statusCode).toBe(200);
      const findings = res.json();
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('high');
      expect(findings[0].title).toBe('Campo obrigatório ausente');
      expect(findings[0].agentId).toBe('sales-associate');
    });

    it('should return empty array when no findings', async () => {
      const session = sessionService.createSession('test_scenario');
      sessionService.addEvent(session.id, 'session_started', {});

      const res = await app.inject({ method: 'GET', url: `/api/p2/sessions/${session.id}/findings` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('should return 404 for unknown session', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/p2/sessions/nonexistent/findings' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/p2/governance/decisions', () => {
    it('should return learning governance decisions', async () => {
      const proposal = sessionService.createLearningProposal({
        recommendationId: 'route-governance',
        scenarioId: 'test_scenario',
        stepId: 'step_1',
        agentId: 'sales-associate',
        type: 'prompt_patch',
        severity: 'medium',
        recommendation: { reason: 'test' },
        patchKind: 'prompt_overlay',
        target: 'agent:sales-associate',
        patchContent: '[LEARNING OVERLAY]',
      });

      const approve = await app.inject({
        method: 'POST',
        url: `/api/p2/learning/proposals/${proposal.id}/approve`,
      });
      expect(approve.statusCode).toBe(200);

      const res = await app.inject({
        method: 'GET',
        url: `/api/p2/governance/decisions?subjectType=learning_proposal&subjectId=${proposal.id}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toContainEqual(expect.objectContaining({
        subjectType: 'learning_proposal',
        subjectId: proposal.id,
        action: 'approve',
        verdict: 'allowed',
      }));
    });

    it('should record scenario draft governance decisions on review', async () => {
      const draft = sessionService.createScenarioDraft({
        scenarioId: 'draft_scenario',
        name: 'Draft Scenario',
        description: 'Covers a missing workflow path',
        contract: { scenario_id: 'draft_scenario' },
        gapType: 'missing_path',
      });

      const review = await app.inject({
        method: 'PATCH',
        url: `/api/p2/scenarios/drafts/${draft.id}`,
        payload: {
          status: 'approved',
          reviewedBy: 'qa_lead',
        },
      });
      expect(review.statusCode).toBe(200);

      const res = await app.inject({
        method: 'GET',
        url: `/api/p2/governance/decisions?subjectType=scenario_draft&subjectId=${draft.id}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toContainEqual(expect.objectContaining({
        subjectType: 'scenario_draft',
        subjectId: draft.id,
        action: 'approve',
        verdict: 'allowed',
        actor: 'qa_lead',
        requirements: expect.arrayContaining(['independent_audit', 'human_review']),
      }));
    });

    it('should promote approved scenario drafts with prior approval evidence', async () => {
      const draft = sessionService.createScenarioDraft({
        scenarioId: 'promotable_draft',
        name: 'Promotable Draft',
        description: 'Ready for active scenario review',
        contract: { scenario_id: 'promotable_draft' },
        gapType: 'missing_path',
      });

      const review = await app.inject({
        method: 'PATCH',
        url: `/api/p2/scenarios/drafts/${draft.id}`,
        payload: {
          status: 'approved',
          reviewedBy: 'qa_lead',
        },
      });
      expect(review.statusCode).toBe(200);

      const promote = await app.inject({
        method: 'POST',
        url: `/api/p2/scenarios/drafts/${draft.id}/promote`,
        payload: { reviewedBy: 'qa_lead' },
      });

      expect(promote.statusCode).toBe(200);
      expect(promote.json()).toEqual(expect.objectContaining({
        status: 'promoted',
        materialization: expect.objectContaining({
          subjectType: 'scenario_draft',
          subjectId: draft.id,
          kind: 'scenario_draft_manifest',
          status: 'active',
        }),
      }));
      const materializations = await app.inject({
        method: 'GET',
        url: `/api/p2/materializations?subjectType=scenario_draft&subjectId=${draft.id}`,
      });
      expect(materializations.statusCode).toBe(200);
      expect(materializations.json()).toContainEqual(expect.objectContaining({
        subjectType: 'scenario_draft',
        subjectId: draft.id,
        kind: 'scenario_draft_manifest',
      }));
      expect(sessionService.listGovernanceDecisions({
        subjectType: 'scenario_draft',
        subjectId: draft.id,
      })).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'approve', verdict: 'allowed' }),
        expect.objectContaining({ action: 'promote', verdict: 'allowed' }),
      ]));
    });

    it('should block scenario draft promotion without approval governance evidence', async () => {
      const draft = sessionService.createScenarioDraft({
        scenarioId: 'promote_without_approval',
        name: 'Promote Without Approval',
        description: 'Status alone should not be enough',
        contract: { scenario_id: 'promote_without_approval' },
        gapType: 'missing_path',
      });
      sessionService.updateScenarioDraftStatus(draft.id, 'approved', 'qa_lead');

      const promote = await app.inject({
        method: 'POST',
        url: `/api/p2/scenarios/drafts/${draft.id}/promote`,
        payload: { reviewedBy: 'qa_lead' },
      });

      expect(promote.statusCode).toBe(409);
      expect(promote.json()).toEqual(expect.objectContaining({
        error: expect.stringContaining('Independent audit failed'),
      }));
      expect(sessionService.getScenarioDraft(draft.id)?.status).toBe('approved');
    });

    it('should block scenario draft approval without an explicit reviewer', async () => {
      const draft = sessionService.createScenarioDraft({
        scenarioId: 'draft_without_reviewer',
        name: 'Draft Without Reviewer',
        description: 'Should not be approved anonymously',
        contract: { scenario_id: 'draft_without_reviewer' },
        gapType: 'missing_path',
      });

      const review = await app.inject({
        method: 'PATCH',
        url: `/api/p2/scenarios/drafts/${draft.id}`,
        payload: { status: 'approved' },
      });

      expect(review.statusCode).toBe(409);
      expect(review.json()).toEqual(expect.objectContaining({
        error: expect.stringContaining('Independent audit failed'),
      }));
      expect(sessionService.getScenarioDraft(draft.id)?.status).toBe('pending');
      expect(sessionService.listGovernanceDecisions({
        subjectType: 'scenario_draft',
        subjectId: draft.id,
      })).toContainEqual(expect.objectContaining({
        action: 'approve',
        verdict: 'blocked',
        requirements: expect.arrayContaining(['independent_audit', 'human_review']),
      }));
    });

    it('should materialize applied learning proposals', async () => {
      const proposal = sessionService.createLearningProposal({
        recommendationId: 'route-learning-apply',
        scenarioId: 'test_scenario',
        stepId: 'step_1',
        agentId: 'sales-associate',
        type: 'prompt_patch',
        severity: 'medium',
        recommendation: { reason: 'test' },
        patchKind: 'prompt_overlay',
        target: 'agent:sales-associate',
        patchContent: '[LEARNING OVERLAY]',
      });

      const approve = await app.inject({
        method: 'POST',
        url: `/api/p2/learning/proposals/${proposal.id}/approve`,
      });
      expect(approve.statusCode).toBe(200);

      const apply = await app.inject({
        method: 'POST',
        url: `/api/p2/learning/proposals/${proposal.id}/apply`,
      });

      expect(apply.statusCode).toBe(200);
      expect(apply.json()).toEqual(expect.objectContaining({
        status: 'applied',
        materialization: expect.objectContaining({
          subjectType: 'learning_proposal',
          subjectId: proposal.id,
          kind: 'learning_prompt_overlay',
          status: 'active',
        }),
      }));
      expect(sessionService.listL5Materializations({
        subjectType: 'learning_proposal',
        subjectId: proposal.id,
      })).toContainEqual(expect.objectContaining({
        kind: 'learning_prompt_overlay',
        metadata: expect.objectContaining({
          independentAudit: expect.objectContaining({
            verdict: 'passed',
            checksumVerified: true,
          }),
          postWriteVerification: expect.objectContaining({
            checksumMatches: true,
          }),
        }),
      }));

      const maturity = await app.inject({ method: 'GET', url: '/api/p2/maturity' });
      expect(maturity.statusCode).toBe(200);
      expect(maturity.json().levels.l5).toEqual(expect.objectContaining({
        status: 'operational',
        completion: 95,
      }));
    });

    it('should expose a governed meta-orchestration queue', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/p2/schedule/queue?limit=2' });

      expect(res.statusCode).toBe(200);
      expect(res.json()[0]).toEqual(expect.objectContaining({
        position: 1,
        status: 'queued',
        guard: expect.objectContaining({
          loop: 'meta_orchestration',
          status: 'open',
        }),
      }));
    });
  });
});

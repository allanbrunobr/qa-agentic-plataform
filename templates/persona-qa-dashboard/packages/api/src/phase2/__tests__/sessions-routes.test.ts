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
        integrity: expect.objectContaining({
          checksum: expect.any(String),
          counts: expect.objectContaining({
            governanceDecisions: 1,
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

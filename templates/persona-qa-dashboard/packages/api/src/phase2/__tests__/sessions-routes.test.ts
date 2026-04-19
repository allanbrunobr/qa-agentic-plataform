import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { phase2SessionRoutes, setSessionService } from '../routes/sessions.js';
import { SessionService } from '../services/session-service.js';

describe('Phase 2 Session Routes', () => {
  const app = Fastify();
  let sessionService: SessionService;

  beforeAll(async () => {
    await app.register(phase2SessionRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    sessionService = new SessionService();
    setSessionService(sessionService);
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
      expect(promote.json()).toEqual(expect.objectContaining({ status: 'promoted' }));
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
  });
});

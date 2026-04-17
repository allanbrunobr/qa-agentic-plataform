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
  });
});

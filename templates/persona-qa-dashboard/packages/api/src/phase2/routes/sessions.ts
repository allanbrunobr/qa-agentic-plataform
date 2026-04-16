import fs from 'node:fs'
import type { FastifyInstance } from 'fastify';
import { buildContractEvaluation } from '../services/contract-evaluation.js';
import { CoverageAnalysisService } from '../services/coverage-analysis-service.js';
import { FailurePatternService } from '../services/failure-pattern-service.js';
import { LearningControlService } from '../services/learning-control-service.js';
import { LearningPlaybookService } from '../services/learning-playbook-service.js';
import { MetaOrchestrator } from '../services/meta-orchestrator.js';
import { ProfileTuningService } from '../services/profile-tuning-service.js';
import { SelfHealingService } from '../services/self-healing-service.js';
import { resolvePhase2ArtifactPath, SessionService } from '../services/session-service.js';

// Singleton session service instance for Phase 2 routes
let _sessionService: SessionService | null = null;

function extractLastError(session: ReturnType<SessionService['getSession']>): string | null {
  if (!session) return null

  const candidate = [...session.events].reverse().find((event) => {
    if (event.type === 'step_failed' || event.type === 'run_failed' || event.type === 'error') {
      return true
    }

    if (event.type === 'tool_result') {
      const payload = (event.payload ?? event.data ?? {}) as Record<string, unknown>
      return payload.ok === false || typeof payload.error === 'string' || typeof payload.error === 'object'
    }

    return false
  })

  if (!candidate) return null

  const payload = (candidate.payload ?? candidate.data ?? {}) as Record<string, unknown>
  const rawError = payload.error

  let message: string | null = null
  if (typeof rawError === 'string') {
    message = rawError
  } else if (rawError && typeof rawError === 'object') {
    const maybeMessage = (rawError as Record<string, unknown>).message
    if (typeof maybeMessage === 'string') message = maybeMessage
  }

  if (!message && typeof payload.reason === 'string') {
    message = payload.reason
  }

  if (!message && typeof payload.message === 'string') {
    message = payload.message
  }

  if (!message && typeof payload.failedStep === 'string') {
    message = `Failed at ${payload.failedStep}`
  }

  if (!message) return candidate.type.replace(/_/g, ' ')

  return message.replace(/\s+/g, ' ').trim().slice(0, 180)
}

export function getSessionService(): SessionService {
  if (!_sessionService) {
    _sessionService = new SessionService();
  }
  return _sessionService;
}

export function setSessionService(service: SessionService): void {
  _sessionService = service;
}

export async function phase2SessionRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/p2/sessions — list all sessions
  app.get('/api/p2/sessions', async (_request, reply) => {
    const service = getSessionService();
    const sessions = service.getAllSessions();

    const summaries = sessions.map((s) => {
      const evaluation = buildContractEvaluation(s).contractEvaluation;
      return {
        id: s.id,
        runId: s.runId ?? null,
        scenarioId: s.scenarioId,
        status: s.status,
        startedAt: s.startedAt,
        completedAt: s.completedAt ?? null,
        eventCount: s.events.length,
        artifactCount: Object.keys(s.artifacts).length,
        findingCount: s.findings.length,
        lastError: extractLastError(s),
        contractVerdict: evaluation?.verdict ?? null,
        contractHardViolations: evaluation?.hardViolations ?? 0,
        contractDriftSignals: evaluation?.driftSignals ?? 0,
      };
    });

    return reply.send(summaries);
  });

  // GET /api/p2/sessions/:id — full session detail
  app.get<{ Params: { id: string } }>('/api/p2/sessions/:id', async (request, reply) => {
    const service = getSessionService();
    const session = service.getSession(request.params.id);

    if (!session) {
      return reply.status(404).send({ error: 'Sessão não encontrada' });
    }

    return reply.send({
      ...session,
      ...buildContractEvaluation(session),
    });
  });

  // GET /api/p2/sessions/:id/events — all events in chronological order
  app.get<{ Params: { id: string } }>('/api/p2/sessions/:id/events', async (request, reply) => {
    const service = getSessionService();
    const session = service.getSession(request.params.id);

    if (!session) {
      return reply.status(404).send({ error: 'Sessão não encontrada' });
    }

    const sorted = [...session.events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    return reply.send(sorted);
  });

  // GET /api/p2/sessions/:id/findings — all findings with details
  app.get<{ Params: { id: string } }>('/api/p2/sessions/:id/findings', async (request, reply) => {
    const service = getSessionService();
    const session = service.getSession(request.params.id);

    if (!session) {
      return reply.status(404).send({ error: 'Sessão não encontrada' });
    }

    const findings = session.findings.map((finding) => ({
      id: finding.id,
      timestamp: finding.createdAt,
      severity: finding.severity,
      title: finding.title,
      evidence: finding.evidence,
      agentId: finding.agentId ?? null,
      stepId: finding.stepId ?? null,
    }));

    return reply.send(findings);
  });

  app.get<{
    Params: { scenarioId: string; stepId: string }
    Querystring: { limit?: string }
  }>('/api/p2/scenarios/:scenarioId/steps/:stepId/history', async (request, reply) => {
    const service = getSessionService();
    const limit = request.query.limit ? Number(request.query.limit) : 50;
    const stats = service.getStepHistoryStats(request.params.scenarioId, request.params.stepId, limit);
    const patterns = new FailurePatternService(service).analyzeStep(
      request.params.scenarioId,
      request.params.stepId,
      limit,
    );
    const adaptations = service.listAdaptationEvents({
      scenarioId: request.params.scenarioId,
      stepId: request.params.stepId,
      limit,
    });

    return reply.send({ ...stats, patterns, adaptations });
  });

  app.get<{ Querystring: { scenarioId?: string; stepId?: string; limit?: string } }>(
    '/api/p2/adaptations',
    async (request, reply) => {
      const service = getSessionService();
      return reply.send(service.listAdaptationEvents({
        scenarioId: request.query.scenarioId,
        stepId: request.query.stepId,
        limit: request.query.limit ? Number(request.query.limit) : 50,
      }));
    },
  );

  app.get<{ Querystring: { scenarioId?: string; limit?: string } }>(
    '/api/p2/learning/playbooks',
    async (request, reply) => {
      const service = getSessionService();
      return reply.send(new LearningPlaybookService(service).buildPlaybook({
        scenarioId: request.query.scenarioId,
        limit: request.query.limit ? Number(request.query.limit) : 50,
      }));
    },
  );

  app.get('/api/p2/coverage/gaps', async (_request, reply) => {
    const service = getSessionService();
    return reply.send(new CoverageAnalysisService(service).analyzeGaps());
  });

  app.get<{ Querystring: { status?: string; limit?: string } }>(
    '/api/p2/scenarios/drafts',
    async (request, reply) => {
      const service = getSessionService();
      return reply.send(service.listScenarioDrafts({
        status: isScenarioDraftStatus(request.query.status) ? request.query.status : undefined,
        limit: request.query.limit ? Number(request.query.limit) : 100,
      }));
    },
  );

  app.post<{ Body: { gapId?: string } }>(
    '/api/p2/scenarios/drafts',
    async (request, reply) => {
      const service = getSessionService();
      const coverage = new CoverageAnalysisService(service);
      const gaps = coverage.analyzeGaps();
      const gap = request.body?.gapId
        ? gaps.find((candidate) => candidate.id === request.body?.gapId)
        : gaps[0];

      if (!gap) {
        return reply.status(404).send({ error: 'No coverage gap available for draft generation' });
      }

      return reply.status(201).send(coverage.createDraftFromGap(gap));
    },
  );

  app.patch<{ Params: { id: string }; Body: { status?: string; reviewedBy?: string } }>(
    '/api/p2/scenarios/drafts/:id',
    async (request, reply) => {
      if (!isScenarioDraftStatus(request.body?.status)) {
        return reply.status(400).send({ error: 'Invalid draft status' });
      }

      const service = getSessionService();
      const draft = service.updateScenarioDraftStatus(
        request.params.id,
        request.body.status,
        request.body.reviewedBy,
      );
      if (!draft) return reply.status(404).send({ error: 'Scenario draft not found' });
      return reply.send(draft);
    },
  );

  app.get('/api/p2/agents/tuning-recommendations', async (_request, reply) => {
    const service = getSessionService();
    return reply.send(new ProfileTuningService(service).generateRecommendations());
  });

  app.get('/api/p2/schedule/recommendations', async (_request, reply) => {
    const service = getSessionService();
    return reply.send(new MetaOrchestrator(service).recommendSchedule());
  });

  app.get<{ Querystring: { limit?: string } }>(
    '/api/p2/healing/log',
    async (request, reply) => {
      const service = getSessionService();
      return reply.send(new SelfHealingService(service).listLog(
        request.query.limit ? Number(request.query.limit) : 100,
      ));
    },
  );

  app.post('/api/p2/healing/evaluate', async (_request, reply) => {
    const service = getSessionService();
    return reply.status(201).send(new SelfHealingService(service).evaluateRecentFailures());
  });

  app.get<{ Querystring: { scenarioId?: string; status?: string; limit?: string } }>(
    '/api/p2/learning/proposals',
    async (request, reply) => {
      const service = getSessionService();
      return reply.send(service.listLearningProposals({
        scenarioId: request.query.scenarioId,
        status: isLearningStatus(request.query.status) ? request.query.status : undefined,
        limit: request.query.limit ? Number(request.query.limit) : 100,
      }));
    },
  );

  app.post<{ Body: { scenarioId?: string; limit?: number } }>(
    '/api/p2/learning/proposals/generate',
    async (request, reply) => {
      const service = getSessionService();
      const proposals = new LearningControlService(service).generateProposals({
        scenarioId: request.body?.scenarioId,
        limit: request.body?.limit,
      });

      return reply.status(201).send({ proposals });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/p2/learning/proposals/:id/approve',
    async (request, reply) => {
      try {
        const service = getSessionService();
        const proposal = new LearningControlService(service).approveProposal(request.params.id);
        return reply.send(proposal);
      } catch (error) {
        return reply.status(409).send({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/p2/learning/proposals/:id/apply',
    async (request, reply) => {
      try {
        const service = getSessionService();
        const proposal = new LearningControlService(service).applyProposal(request.params.id);
        return reply.send(proposal);
      } catch (error) {
        return reply.status(409).send({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/p2/learning/proposals/:id/reject',
    async (request, reply) => {
      try {
        const service = getSessionService();
        const proposal = new LearningControlService(service).rejectProposal(request.params.id);
        return reply.send(proposal);
      } catch (error) {
        return reply.status(409).send({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  app.get<{ Params: { scenarioId: string }; Querystring: { limit?: string } }>(
    '/api/p2/scenarios/:scenarioId/learning',
    async (request, reply) => {
      const service = getSessionService();
      return reply.send(new LearningPlaybookService(service).buildPlaybook({
        scenarioId: request.params.scenarioId,
        limit: request.query.limit ? Number(request.query.limit) : 50,
      }));
    },
  );

  app.get<{ Params: { id: string } }>('/api/p2/sessions/:id/recovery', async (request, reply) => {
    const service = getSessionService();
    const session = service.getSession(request.params.id);

    if (!session) {
      return reply.status(404).send({ error: 'Sessão não encontrada' });
    }

    return reply.send({
      sessionId: session.id,
      status: session.status,
      checkpoint: session.checkpoint,
      interruptions: session.events.filter((event) => event.type === 'interruption_recorded'),
      recoveryDecisions: session.events.filter((event) => event.type === 'recovery_decision'),
      terminalFailures: session.events.filter((event) => event.type === 'run_failed'),
    });
  });

  app.get<{ Params: { id: string } }>('/api/p2/sessions/:id/artifacts', async (request, reply) => {
    const service = getSessionService();
    const session = service.getSession(request.params.id);

    if (!session) {
      return reply.status(404).send({ error: 'Sessão não encontrada' });
    }

    return reply.send(service.listArtifacts(request.params.id));
  });

  app.get<{ Params: { artifactId: string } }>('/api/p2/artifacts/:artifactId/content', async (request, reply) => {
    const service = getSessionService();
    const artifact = service.getArtifactById(request.params.artifactId);

    if (!artifact) {
      return reply.status(404).send({ error: 'Artifact not found' });
    }

    if (artifact.filePath) {
      const absolutePath = resolvePhase2ArtifactPath(artifact.filePath);
      if (!fs.existsSync(absolutePath)) {
        return reply.status(404).send({ error: 'Artifact file not found' });
      }

      if (absolutePath.endsWith('.png')) {
        reply.type('image/png');
      }

      return reply.send(fs.readFileSync(absolutePath));
    }

    if (artifact.content) {
      reply.type('application/json');
      return reply.send(artifact.content);
    }

    return reply.status(404).send({ error: 'Artifact has no retrievable content' });
  });
}

function isLearningStatus(value: unknown): value is 'proposed' | 'approved' | 'applied' | 'rejected' {
  return value === 'proposed' || value === 'approved' || value === 'applied' || value === 'rejected';
}

function isScenarioDraftStatus(value: unknown): value is 'pending' | 'approved' | 'rejected' | 'revised' {
  return value === 'pending' || value === 'approved' || value === 'rejected' || value === 'revised';
}

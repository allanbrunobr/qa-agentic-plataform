import fs from 'node:fs'
import type { FastifyInstance } from 'fastify';
import { buildContractEvaluation } from '../services/contract-evaluation.js';
import { CoverageAnalysisService } from '../services/coverage-analysis-service.js';
import { diagnoseSessionFailure } from '../services/failure-diagnosis-service.js';
import { FailurePatternService } from '../services/failure-pattern-service.js';
import { GovernancePolicyService } from '../services/governance-policy-service.js';
import { IndependentAuditorService } from '../services/independent-auditor-service.js';
import {
  L5ClosedLoopScheduler,
  type L5ClosedLoopSchedulerOptions,
} from '../services/l5-closed-loop-scheduler.js';
import { L5AuditBundleService, type L5KnowledgePromotionCandidate } from '../services/l5-audit-bundle-service.js';
import { L5ClosedLoopService } from '../services/l5-closed-loop-service.js';
import { L5KnowledgePromotionService } from '../services/l5-knowledge-promotion-service.js';
import { L5LoopGuardService } from '../services/l5-loop-guard-service.js';
import { L5MaterializationService } from '../services/l5-materialization-service.js';
import { LearningControlService } from '../services/learning-control-service.js';
import { LearningPlaybookService } from '../services/learning-playbook-service.js';
import { buildMaturityStatus } from '../services/maturity-service.js';
import { MetaOrchestrator } from '../services/meta-orchestrator.js';
import { ProfileTuningService } from '../services/profile-tuning-service.js';
import { SelfHealingService } from '../services/self-healing-service.js';
import {
  resolvePhase2ArtifactPath,
  SessionService,
  type GovernanceSubjectType,
  type L5ClosedLoopStatus,
  type L5MaterializationStatus,
  type L5MaterializationSubjectType,
} from '../services/session-service.js';
import type { Session } from '../types/session-types.js';

// Singleton session service instance for Phase 2 routes
let _sessionService: SessionService | null = null;
let _closedLoopScheduler: L5ClosedLoopScheduler | null = null;

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

function safeBuildContractEvaluation(session: Session) {
  try {
    return buildContractEvaluation(session);
  } catch (error) {
    return {
      workflowContract: null,
      workflowContractYaml: null,
      contractEvaluation: null,
      contractEvaluationError: error instanceof Error ? error.message : String(error),
    };
  }
}

export function getSessionService(): SessionService {
  if (!_sessionService) {
    _sessionService = new SessionService();
  }
  return _sessionService;
}

export function setSessionService(service: SessionService): void {
  _closedLoopScheduler?.stop('session_service_replaced');
  _closedLoopScheduler = null;
  _sessionService = service;
}

function getClosedLoopScheduler(): L5ClosedLoopScheduler {
  if (!_closedLoopScheduler) {
    _closedLoopScheduler = new L5ClosedLoopScheduler(getSessionService());
  }
  return _closedLoopScheduler;
}

export async function phase2SessionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onClose', async () => {
    _closedLoopScheduler?.stop('app_closed');
    _closedLoopScheduler = null;
  });

  if (process.env['PERSONA_QA_L5_CLOSED_LOOP_AUTOSTART'] === '1') {
    app.addHook('onReady', async () => {
      getClosedLoopScheduler().start(readSchedulerEnvOptions());
    });
  }

  app.get('/api/p2/maturity', async (_request, reply) => {
    const service = getSessionService();
    return reply.send(buildMaturityStatus(service));
  });

  app.get<{ Querystring: { limit?: string } }>(
    '/api/p2/closed-loop/status',
    async (request, reply) => {
      const service = getSessionService();
      return reply.send(new L5ClosedLoopService(service).getStatus(
        request.query.limit ? Number(request.query.limit) : 10,
      ));
    },
  );

  app.get<{ Querystring: { scenarioId?: string; status?: string; limit?: string } }>(
    '/api/p2/closed-loop/runs',
    async (request, reply) => {
      const service = getSessionService();
      return reply.send(service.listL5ClosedLoopRuns({
        scenarioId: request.query.scenarioId,
        status: isL5ClosedLoopStatus(request.query.status) ? request.query.status : undefined,
        limit: request.query.limit ? Number(request.query.limit) : 25,
      }));
    },
  );

  app.get<{ Querystring: { runId?: string; limit?: string } }>(
    '/api/p2/closed-loop/audit-reviews',
    async (request, reply) => {
      const service = getSessionService();
      return reply.send(service.listL5IndependentAuditReviews({
        runId: request.query.runId,
        limit: request.query.limit ? Number(request.query.limit) : 100,
      }));
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/p2/closed-loop/runs/:id/audit-bundle',
    async (request, reply) => {
      const service = getSessionService();
      const bundle = new L5AuditBundleService(service).build(request.params.id);
      if (!bundle) return reply.status(404).send({ error: 'Closed-loop run not found' });

      reply.header('Content-Disposition', `attachment; filename="l5-audit-bundle-${request.params.id}.json"`);
      return reply.send(bundle);
    },
  );

  app.post<{
    Params: { id: string }
    Body: {
      actor?: string
      reason?: string
    }
  }>(
    '/api/p2/closed-loop/runs/:id/independent-audit/review',
    async (request, reply) => {
      const service = getSessionService();
      const run = service.getL5ClosedLoopRun(request.params.id);
      if (!run) return reply.status(404).send({ error: 'Closed-loop run not found' });

      const independentAudit = asRecord(run.verification['independentAudit']);
      const verdict = independentAudit?.['verdict'];
      if (!independentAudit || (verdict !== 'failed' && verdict !== 'warning')) {
        return reply.status(409).send({ error: 'Closed-loop run has no failed or warning independent audit to review' });
      }

      const review = service.recordL5IndependentAuditReview({
        runId: run.id,
        status: 'reviewed',
        actor: request.body?.actor ?? 'dashboard',
        reason: request.body?.reason ?? `Independent audit ${String(verdict)} reviewed.`,
        metadata: {
          auditVerdict: verdict,
          auditCheckedAt: typeof independentAudit['checkedAt'] === 'string' ? independentAudit['checkedAt'] : undefined,
          findingCount: Array.isArray(independentAudit['findings']) ? independentAudit['findings'].length : 0,
          runStatus: run.status,
        },
      });

      return reply.status(201).send({
        review,
        run,
        guards: new L5LoopGuardService(service).summarize(),
      });
    },
  );

  app.post<{
    Body: {
      scenarioId?: string
      maxScenarios?: number
      applyApprovedChanges?: boolean
      generateScenarioDrafts?: boolean
      actor?: string
      maxApprovedApplies?: number
    }
  }>(
    '/api/p2/closed-loop/run',
    async (request, reply) => {
      try {
        const service = getSessionService();
        const run = await new L5ClosedLoopService(service).runOnce({
          scenarioId: request.body?.scenarioId,
          maxScenarios: request.body?.maxScenarios,
          applyApprovedChanges: request.body?.applyApprovedChanges,
          generateScenarioDrafts: request.body?.generateScenarioDrafts,
          actor: request.body?.actor,
          maxApprovedApplies: request.body?.maxApprovedApplies,
        });
        return reply.status(201).send(run);
      } catch (error) {
        return reply.status(409).send({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  app.get('/api/p2/closed-loop/scheduler', async (_request, reply) => {
    return reply.send(getClosedLoopScheduler().status());
  });

  app.post<{ Body: L5ClosedLoopSchedulerOptions }>(
    '/api/p2/closed-loop/scheduler/start',
    async (request, reply) => {
      const scheduler = getClosedLoopScheduler();
      return reply.send(scheduler.start(normalizeSchedulerOptions(request.body)));
    },
  );

  app.post('/api/p2/closed-loop/scheduler/stop', async (_request, reply) => {
    return reply.send(getClosedLoopScheduler().stop('manual_stop'));
  });

  app.post<{ Body: L5ClosedLoopSchedulerOptions }>(
    '/api/p2/closed-loop/scheduler/tick',
    async (request, reply) => {
      const result = await getClosedLoopScheduler().tick(normalizeSchedulerOptions(request.body));
      if (result.status === 'executed') return reply.status(201).send(result);
      if (result.status === 'failed') return reply.status(500).send(result);
      return reply.send(result);
    },
  );

  // GET /api/p2/sessions — list all sessions
  app.get('/api/p2/sessions', async (_request, reply) => {
    const service = getSessionService();
    const sessions = service.getAllSessions();

    const summaries = sessions.map((s) => {
      const evaluation = safeBuildContractEvaluation(s).contractEvaluation;
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
        failureDiagnosis: diagnoseSessionFailure(s),
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
      failureDiagnosis: diagnoseSessionFailure(session),
      ...safeBuildContractEvaluation(session),
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

  app.get<{ Params: { id: string } }>('/api/p2/sessions/:id/audit', async (request, reply) => {
    const service = getSessionService();
    const session = service.getSession(request.params.id);

    if (!session) {
      return reply.status(404).send({ error: 'Sessão não encontrada' });
    }

    return reply.send(new IndependentAuditorService().evaluateSession(session));
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
      const currentDraft = service.getScenarioDraft(request.params.id);
      if (!currentDraft) return reply.status(404).send({ error: 'Scenario draft not found' });

      const governanceDecision = new GovernancePolicyService(service).recordScenarioDraftTransitionDecision(
        currentDraft,
        request.body.status,
        request.body.reviewedBy ?? 'human_reviewer',
      );
      if (governanceDecision.verdict === 'blocked') {
        return reply.status(409).send({ error: governanceDecision.reason });
      }

      const draft = service.updateScenarioDraftStatus(
        request.params.id,
        request.body.status,
        request.body.reviewedBy,
      );
      if (!draft) return reply.status(404).send({ error: 'Scenario draft not found' });
      return reply.send(draft);
    },
  );

  app.post<{ Params: { id: string }; Body: { reviewedBy?: string } }>(
    '/api/p2/scenarios/drafts/:id/promote',
    async (request, reply) => {
      const service = getSessionService();
      const currentDraft = service.getScenarioDraft(request.params.id);
      if (!currentDraft) return reply.status(404).send({ error: 'Scenario draft not found' });
      if (currentDraft.status !== 'approved') {
        return reply.status(409).send({ error: 'Scenario draft must be approved before promotion' });
      }

      const governanceDecision = new GovernancePolicyService(service).recordScenarioDraftTransitionDecision(
        currentDraft,
        'promoted',
        request.body?.reviewedBy ?? 'human_reviewer',
      );
      if (governanceDecision.verdict === 'blocked') {
        return reply.status(409).send({ error: governanceDecision.reason });
      }

      const draft = service.updateScenarioDraftStatus(
        request.params.id,
        'promoted',
        request.body?.reviewedBy,
      );
      if (!draft) return reply.status(404).send({ error: 'Scenario draft not found' });
      const materialization = await new L5MaterializationService(service).materializeScenarioDraft(draft);
      return reply.send({ ...draft, materialization });
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
    '/api/p2/schedule/queue',
    async (request, reply) => {
      const service = getSessionService();
      return reply.send(new MetaOrchestrator(service).buildGovernedRunQueue(
        request.query.limit ? Number(request.query.limit) : 10,
      ));
    },
  );

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

  app.post<{ Params: { id: string }; Body: { actor?: string } }>(
    '/api/p2/healing/actions/:id/apply',
    async (request, reply) => {
      try {
        const service = getSessionService();
        const action = new SelfHealingService(service).applyAction(request.params.id, request.body?.actor);
        return reply.send(action);
      } catch (error) {
        return reply.status(409).send({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { actor?: string } }>(
    '/api/p2/healing/actions/:id/rollback',
    async (request, reply) => {
      try {
        const service = getSessionService();
        const action = new SelfHealingService(service).rollbackAction(request.params.id, request.body?.actor);
        return reply.send(action);
      } catch (error) {
        return reply.status(409).send({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );

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

  app.get<{ Querystring: { subjectType?: string; subjectId?: string; limit?: string } }>(
    '/api/p2/governance/decisions',
    async (request, reply) => {
      const service = getSessionService();
      return reply.send(service.listGovernanceDecisions({
        subjectType: isGovernanceSubjectType(request.query.subjectType) ? request.query.subjectType : undefined,
        subjectId: request.query.subjectId,
        limit: request.query.limit ? Number(request.query.limit) : 100,
      }));
    },
  );

  app.get<{ Querystring: { sourceRunId?: string; subjectType?: string; subjectId?: string; limit?: string } }>(
    '/api/p2/knowledge/promotions/events',
    async (request, reply) => {
      const service = getSessionService();
      return reply.send(service.listKnowledgePromotionEvents({
        sourceRunId: request.query.sourceRunId,
        subjectType: isGovernanceSubjectType(request.query.subjectType) ? request.query.subjectType : undefined,
        subjectId: request.query.subjectId,
        limit: request.query.limit ? Number(request.query.limit) : 100,
      }));
    },
  );

  app.post<{ Body: { candidate?: unknown; actor?: unknown } }>(
    '/api/p2/knowledge/promotions/actions',
    async (request, reply) => {
      if (!isKnowledgePromotionCandidate(request.body?.candidate)) {
        return reply.status(400).send({ error: 'Invalid knowledge promotion candidate' });
      }

      try {
        const service = getSessionService();
        const actor = typeof request.body?.actor === 'string' && request.body.actor.trim()
          ? request.body.actor
          : 'dashboard';
        const result = await new L5KnowledgePromotionService(service).runCandidateAction(
          request.body.candidate,
          actor,
        );
        return reply.status(201).send(result);
      } catch (error) {
        const promotionEvent = getPromotionEventFromError(error);
        return reply.status(409).send({
          error: error instanceof Error ? error.message : String(error),
          promotionEvent,
        });
      }
    },
  );

  app.get<{ Querystring: { subjectType?: string; subjectId?: string; status?: string; limit?: string } }>(
    '/api/p2/materializations',
    async (request, reply) => {
      const service = getSessionService();
      return reply.send(service.listL5Materializations({
        subjectType: isL5MaterializationSubjectType(request.query.subjectType) ? request.query.subjectType : undefined,
        subjectId: request.query.subjectId,
        status: isL5MaterializationStatus(request.query.status) ? request.query.status : undefined,
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
        const materialization = await new L5MaterializationService(service).materializeLearningProposal(proposal);
        return reply.send({ ...proposal, materialization });
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

function isScenarioDraftStatus(value: unknown): value is 'pending' | 'approved' | 'rejected' | 'revised' | 'promoted' {
  return value === 'pending' || value === 'approved' || value === 'rejected' || value === 'revised' || value === 'promoted';
}

function isGovernanceSubjectType(value: unknown): value is GovernanceSubjectType {
  return value === 'learning_proposal' || value === 'scenario_draft' || value === 'healing_action';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isKnowledgePromotionCandidate(value: unknown): value is L5KnowledgePromotionCandidate {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.sourceRunId === 'string'
    && isGovernanceSubjectType(record.subjectType)
    && typeof record.subjectId === 'string'
    && isKnowledgePromotionType(record.promotionType)
    && isKnowledgePromotionStatus(record.status)
    && typeof record.version === 'string'
    && typeof record.title === 'string'
    && typeof record.target === 'string'
    && typeof record.reason === 'string'
    && typeof record.approvalRequired === 'boolean'
    && typeof record.materializationReady === 'boolean'
    && isKnowledgePromotionNextAction(record.nextAction)
    && Boolean(record.evidence)
    && typeof record.evidence === 'object'
    && !Array.isArray(record.evidence);
}

function isKnowledgePromotionType(value: unknown): value is L5KnowledgePromotionCandidate['promotionType'] {
  return value === 'learning_overlay' || value === 'scenario_contract' || value === 'healing_policy';
}

function isKnowledgePromotionStatus(value: unknown): value is L5KnowledgePromotionCandidate['status'] {
  return value === 'requires_review'
    || value === 'approved'
    || value === 'materialized'
    || value === 'blocked'
    || value === 'rejected';
}

function isKnowledgePromotionNextAction(value: unknown): value is L5KnowledgePromotionCandidate['nextAction'] {
  return value === 'approve' || value === 'apply' || value === 'promote' || value === 'review' || value === 'none';
}

function getPromotionEventFromError(error: unknown): unknown {
  return error && typeof error === 'object' && 'promotionEvent' in error
    ? (error as { promotionEvent?: unknown }).promotionEvent
    : undefined;
}

function isL5MaterializationSubjectType(value: unknown): value is L5MaterializationSubjectType {
  return value === 'learning_proposal' || value === 'scenario_draft' || value === 'healing_action';
}

function isL5MaterializationStatus(value: unknown): value is L5MaterializationStatus {
  return value === 'active' || value === 'rolled_back';
}

function isL5ClosedLoopStatus(value: unknown): value is L5ClosedLoopStatus {
  return value === 'completed' || value === 'needs_review' || value === 'blocked' || value === 'failed';
}

function normalizeSchedulerOptions(input: Partial<L5ClosedLoopSchedulerOptions> | undefined): L5ClosedLoopSchedulerOptions {
  if (!input) return {};

  return {
    scenarioId: typeof input.scenarioId === 'string' && input.scenarioId.trim() ? input.scenarioId : undefined,
    maxScenarios: typeof input.maxScenarios === 'number' ? input.maxScenarios : undefined,
    applyApprovedChanges: typeof input.applyApprovedChanges === 'boolean' ? input.applyApprovedChanges : undefined,
    generateScenarioDrafts: typeof input.generateScenarioDrafts === 'boolean' ? input.generateScenarioDrafts : undefined,
    actor: typeof input.actor === 'string' && input.actor.trim() ? input.actor : undefined,
    maxApprovedApplies: typeof input.maxApprovedApplies === 'number' ? input.maxApprovedApplies : undefined,
    intervalMs: typeof input.intervalMs === 'number' ? input.intervalMs : undefined,
    runImmediately: typeof input.runImmediately === 'boolean' ? input.runImmediately : undefined,
  };
}

function readSchedulerEnvOptions(): L5ClosedLoopSchedulerOptions {
  return {
    intervalMs: readNumberEnv('PERSONA_QA_L5_CLOSED_LOOP_INTERVAL_MS'),
    maxScenarios: readNumberEnv('PERSONA_QA_L5_CLOSED_LOOP_MAX_SCENARIOS'),
    maxApprovedApplies: readNumberEnv('PERSONA_QA_L5_CLOSED_LOOP_MAX_APPROVED_APPLIES'),
    applyApprovedChanges: process.env['PERSONA_QA_L5_CLOSED_LOOP_APPLY_APPROVED'] === '1',
    generateScenarioDrafts: process.env['PERSONA_QA_L5_CLOSED_LOOP_GENERATE_DRAFTS'] === '1',
    runImmediately: process.env['PERSONA_QA_L5_CLOSED_LOOP_RUN_IMMEDIATELY'] === '1',
    actor: process.env['PERSONA_QA_L5_CLOSED_LOOP_ACTOR'] || 'l5_closed_loop_scheduler',
  };
}

function readNumberEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { getSessionService } from '../phase2/routes/sessions.js';
import { L5LoopGuardService } from '../phase2/services/l5-loop-guard-service.js';

const EvidenceRefSchema = z.object({
  evidenceId: z.string().min(1),
  kind: z.string().optional(),
});

const CandidateBaseSchema = z.object({
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(EvidenceRefSchema).default([]),
  risks: z.array(z.unknown()).default([]),
  status: z.enum(['draft', 'runnable_candidate', 'restricted', 'needs_human_mapping']),
});

const DomainDiscoveryStepSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  intent: z.string().optional(),
  capabilityId: z.string().optional(),
  evidenceRefs: z.array(EvidenceRefSchema).default([]),
}).passthrough();

const ScenarioCandidateSchema = CandidateBaseSchema.extend({
  id: z.string().min(1),
  title: z.string().min(1),
  rationale: z.string().default(''),
  participatingPersonaIds: z.array(z.string()).default([]),
  requiredCapabilityIds: z.array(z.string()).default([]),
  steps: z.array(DomainDiscoveryStepSchema).default([]),
});

const DomainDiscoveryBundleSchema = z.object({
  surfaceMap: z.object({
    targetId: z.string().min(1),
    routes: z.array(z.unknown()).default([]),
    components: z.array(z.unknown()).default([]),
    forms: z.array(z.unknown()).default([]),
    buttons: z.array(z.unknown()).default([]),
    texts: z.array(z.unknown()).default([]),
    navigation: z.array(z.unknown()).default([]),
    packages: z.array(z.unknown()).default([]),
    frameworks: z.array(z.unknown()).default([]),
    tests: z.array(z.unknown()).default([]),
  }).passthrough(),
  domain: CandidateBaseSchema.extend({
    domain: z.string().min(1),
    label: z.string().optional(),
    summary: z.string().default(''),
    entities: z.array(z.unknown()).default([]),
  }),
  personas: z.array(CandidateBaseSchema.extend({
    id: z.string().min(1),
    title: z.string().min(1),
    rationale: z.string().default(''),
    goals: z.array(z.string()).default([]),
    allowedCapabilityIds: z.array(z.string()).default([]),
  })).default([]),
  scenarios: z.array(ScenarioCandidateSchema).default([]),
  capabilities: z.array(CandidateBaseSchema.extend({
    id: z.string().min(1),
    title: z.string().min(1),
    purpose: z.string().default(''),
    kind: z.string().default('unknown'),
    mappedSurfaceIds: z.array(z.string()).default([]),
    selectorHints: z.array(z.string()).default([]),
  })).default([]),
  audit: CandidateBaseSchema.extend({
    id: z.string().min(1),
    summary: z.string().default(''),
    findings: z.array(z.object({
      id: z.string().min(1),
      severity: z.string().default('info'),
      message: z.string().default(''),
      candidateIds: z.array(z.string()).default([]),
      evidenceRefs: z.array(EvidenceRefSchema).default([]),
    }).passthrough()).default([]),
    downgradedCandidateIds: z.array(z.string()).default([]),
  }).optional(),
}).passthrough();

type DomainDiscoveryBundle = z.infer<typeof DomainDiscoveryBundleSchema>;
type DomainDiscoveryScenarioCandidate = z.infer<typeof ScenarioCandidateSchema>;
type ValidatedDomainDiscoveryBundle =
  | { status: 'missing' }
  | { status: 'invalid'; filePath: string; details: unknown }
  | { status: 'available'; filePath: string; bundle: DomainDiscoveryBundle };

interface ScenarioGraphReadinessSnapshot {
  status: string;
  confidence: number;
  requiredCapabilityCount: number;
  mappedCapabilityCount: number;
  mappedCapabilityIds: string[];
  missingCapabilityIds: string[];
  supportSourceTypes: string[];
}

function getDomainDiscoveryCandidates(): string[] {
  return [
    process.env['PERSONA_QA_DOMAIN_DISCOVERY_FILE'],
    path.resolve(process.cwd(), 'adapter', 'config', 'domain-discovery-bundle.generated.json'),
    path.resolve(process.cwd(), '..', '..', 'adapter', 'config', 'domain-discovery-bundle.generated.json'),
  ].filter((candidate): candidate is string => Boolean(candidate));
}

function getCodeGraphCandidates(): string[] {
  return [
    process.env['PERSONA_QA_CODE_GRAPH_FILE'],
    path.resolve(process.cwd(), 'adapter', 'config', 'code-graph.generated.json'),
    path.resolve(process.cwd(), '..', '..', 'adapter', 'config', 'code-graph.generated.json'),
  ].filter((candidate): candidate is string => Boolean(candidate));
}

async function firstExistingFile(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function countEvidence(bundle: DomainDiscoveryBundle): number {
  const surfaceMap = bundle.surfaceMap;
  return [
    surfaceMap.routes,
    surfaceMap.components,
    surfaceMap.forms,
    surfaceMap.buttons,
    surfaceMap.texts,
    surfaceMap.navigation,
    surfaceMap.packages,
    surfaceMap.frameworks,
    surfaceMap.tests,
  ].reduce((sum, items) => sum + items.length, 0);
}

function summarizeBundle(bundle: DomainDiscoveryBundle) {
  return {
    domain: bundle.domain.domain,
    label: bundle.domain.label ?? bundle.domain.domain,
    confidence: bundle.domain.confidence,
    status: bundle.domain.status,
    targetId: bundle.surfaceMap.targetId,
    personas: bundle.personas.length,
    scenarios: bundle.scenarios.length,
    capabilities: bundle.capabilities.length,
    evidenceItems: countEvidence(bundle),
    auditStatus: bundle.audit?.status ?? null,
    auditFindings: bundle.audit?.findings.length ?? 0,
    mappingRequired: bundle.scenarios.filter((scenario) => scenario.status === 'needs_human_mapping').length,
  };
}

async function loadDomainDiscoveryBundle(): Promise<ValidatedDomainDiscoveryBundle> {
  const filePath = await firstExistingFile(getDomainDiscoveryCandidates());
  if (!filePath) return { status: 'missing' };

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsedJson = JSON.parse(content);
    const parsed = DomainDiscoveryBundleSchema.safeParse(parsedJson);

    if (!parsed.success) {
      return {
        status: 'invalid',
        filePath,
        details: parsed.error.issues,
      };
    }

    return {
      status: 'available',
      filePath,
      bundle: parsed.data,
    };
  } catch (error) {
    return {
      status: 'invalid',
      filePath,
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

async function loadScenarioGraphReadiness(scenarioId: string): Promise<ScenarioGraphReadinessSnapshot | null> {
  const filePath = await firstExistingFile(getCodeGraphCandidates());
  if (!filePath) return null;

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const graph = JSON.parse(content);
    const nodes = Array.isArray(graph?.nodes) ? graph.nodes as Array<Record<string, unknown>> : [];
    const scenarioNode = nodes.find((node) => {
      if (node['type'] !== 'scenario_candidate') return false;
      const metadata = node['metadata'];
      return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)['scenarioId'] === scenarioId
        : false;
    });
    const metadata = scenarioNode?.['metadata'];
    const graphReadiness = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)['graphReadiness']
      : null;
    const readiness = graphReadiness && typeof graphReadiness === 'object' && !Array.isArray(graphReadiness)
      ? graphReadiness as Record<string, unknown>
      : null;
    if (!readiness) return null;

    return {
      status: typeof readiness['status'] === 'string' ? readiness['status'] : 'unmapped',
      confidence: typeof readiness['confidence'] === 'number' ? readiness['confidence'] : 0,
      requiredCapabilityCount: typeof readiness['requiredCapabilityCount'] === 'number' ? readiness['requiredCapabilityCount'] : 0,
      mappedCapabilityCount: typeof readiness['mappedCapabilityCount'] === 'number' ? readiness['mappedCapabilityCount'] : 0,
      mappedCapabilityIds: readStringList(readiness['mappedCapabilityIds']),
      missingCapabilityIds: readStringList(readiness['missingCapabilityIds']),
      supportSourceTypes: readStringList(readiness['supportSourceTypes']),
    };
  } catch {
    return null;
  }
}

function buildScenarioDraftInput(
  bundle: DomainDiscoveryBundle,
  scenario: DomainDiscoveryScenarioCandidate,
  graphReadiness: ScenarioGraphReadinessSnapshot | null = null,
) {
  const scenarioId = safeId(`domain_${bundle.domain.domain}_${scenario.id}`);
  const fallbackAgentId = scenario.participatingPersonaIds[0] ?? 'domain_reviewer';
  const sourceSteps = scenario.steps.length > 0
    ? scenario.steps
    : scenario.requiredCapabilityIds.map((capabilityId, index) => ({
      id: `step_${index + 1}_${capabilityId}`,
      title: capabilityId,
      intent: `Map and execute capability ${capabilityId}.`,
      capabilityId,
      evidenceRefs: scenario.evidenceRefs,
    }));

  const steps = sourceSteps.map((step, index) => {
    const capabilityId = step.capabilityId
      ?? scenario.requiredCapabilityIds[index]
      ?? `manual_mapping_required_${index + 1}`;
    const stepId = safeId(step.id ?? `step_${index + 1}_${capabilityId}`);

    return {
      id: stepId,
      name: step.title ?? step.intent ?? stepId,
      description: step.intent ?? 'Map this domain-discovery step before execution.',
      agentId: fallbackAgentId,
      capabilityId,
      order: index + 1,
      requiredArtifacts: [],
      producedArtifacts: [],
    };
  });

  const evidence = [
    `domain=${bundle.domain.domain}`,
    `target=${bundle.surfaceMap.targetId}`,
    `candidate=${scenario.id}`,
    `status=${scenario.status}`,
    `confidence=${scenario.confidence}`,
    ...scenario.evidenceRefs.map((ref) => `evidence=${ref.kind ?? 'unknown'}:${ref.evidenceId}`),
  ];

  return {
    scenarioId,
    name: `Domain draft: ${scenario.title}`,
    description: [
      scenario.rationale,
      'Generated from domain discovery and held for human mapping before execution.',
    ].filter(Boolean).join(' '),
    contract: {
      id: scenarioId,
      name: scenario.title,
      description: scenario.rationale,
      roles: scenario.participatingPersonaIds,
      requiredArtifacts: [],
      allowedTools: scenario.requiredCapabilityIds,
      steps,
      workflowContract: {
        version: '1.0',
        deterministic: true,
        steps: steps.map((step) => ({
          id: step.id,
          order: step.order,
          agentId: step.agentId,
          capabilityId: step.capabilityId,
          requiredArtifacts: step.requiredArtifacts,
          producedArtifacts: step.producedArtifacts,
        })),
      },
      domainDiscovery: {
        sourceDomain: bundle.domain.domain,
        sourceLabel: bundle.domain.label ?? bundle.domain.domain,
        sourceTargetId: bundle.surfaceMap.targetId,
        sourceScenarioId: scenario.id,
        confidence: scenario.confidence,
        status: scenario.status,
        evidenceRefs: scenario.evidenceRefs,
        risks: scenario.risks,
        graphReadiness,
        mappingRequired: scenario.status !== 'runnable_candidate',
        mappingReview: {
          selectorsMapped: false,
          authMapped: false,
          testDataMapped: false,
          assertionsMapped: false,
          reviewedBy: null,
          reviewedAt: null,
          notes: null,
        },
      },
    },
    gapType: 'domain_discovery_mapping',
    gapEvidence: evidence,
  };
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function safeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'domain_discovery_candidate';
}

export async function domainDiscoveryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/p2/domain-discovery', async (_request, reply) => {
    const discovery = await loadDomainDiscoveryBundle();
    if (discovery.status === 'missing') {
      return reply.send({
        available: false,
        filePath: null,
        summary: null,
        bundle: null,
      });
    }

    if (discovery.status === 'invalid') {
      return reply.status(422).send({
        available: false,
        filePath: discovery.filePath,
        error: 'Invalid domain discovery bundle',
        details: discovery.details,
      });
    }

    return reply.send({
      available: true,
      filePath: discovery.filePath,
      summary: summarizeBundle(discovery.bundle),
      bundle: discovery.bundle,
    });
  });

  app.post<{ Params: { scenarioId: string } }>(
    '/api/p2/domain-discovery/scenarios/:scenarioId/drafts',
    async (request, reply) => {
      const discovery = await loadDomainDiscoveryBundle();
      if (discovery.status === 'missing') {
        return reply.status(404).send({ error: 'Domain discovery bundle not found' });
      }

      if (discovery.status === 'invalid') {
        return reply.status(422).send({
          error: 'Invalid domain discovery bundle',
          filePath: discovery.filePath,
          details: discovery.details,
        });
      }

      const scenario = discovery.bundle.scenarios.find((candidate) => candidate.id === request.params.scenarioId);
      if (!scenario) {
        return reply.status(404).send({ error: 'Domain discovery scenario candidate not found' });
      }

      if (scenario.status === 'restricted') {
        return reply.status(409).send({
          error: 'Restricted domain discovery candidates cannot be promoted to scenario drafts',
        });
      }

      const service = getSessionService();
      try {
        new L5LoopGuardService(service).assertLoopOpen('scenario_generation');
      } catch (error) {
        return reply.status(409).send({
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const graphReadiness = await loadScenarioGraphReadiness(scenario.id);
      const draft = service.createScenarioDraft(buildScenarioDraftInput(discovery.bundle, scenario, graphReadiness));

      return reply.status(201).send({
        draft,
        source: {
          domain: discovery.bundle.domain.domain,
          targetId: discovery.bundle.surfaceMap.targetId,
          scenarioId: scenario.id,
          status: scenario.status,
          confidence: scenario.confidence,
          graphReadiness,
          mappingRequired: scenario.status !== 'runnable_candidate',
        },
        warnings: [
          'Draft created from domain discovery evidence. Review selectors, auth, seed data, and assertions before approval.',
        ],
      });
    },
  );
}

import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

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
  scenarios: z.array(CandidateBaseSchema.extend({
    id: z.string().min(1),
    title: z.string().min(1),
    rationale: z.string().default(''),
    participatingPersonaIds: z.array(z.string()).default([]),
    requiredCapabilityIds: z.array(z.string()).default([]),
    steps: z.array(z.unknown()).default([]),
  })).default([]),
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

function getDomainDiscoveryCandidates(): string[] {
  return [
    process.env['PERSONA_QA_DOMAIN_DISCOVERY_FILE'],
    path.resolve(process.cwd(), 'adapter', 'config', 'domain-discovery-bundle.generated.json'),
    path.resolve(process.cwd(), '..', '..', 'adapter', 'config', 'domain-discovery-bundle.generated.json'),
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

export async function domainDiscoveryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/p2/domain-discovery', async (_request, reply) => {
    const filePath = await firstExistingFile(getDomainDiscoveryCandidates());
    if (!filePath) {
      return reply.send({
        available: false,
        filePath: null,
        summary: null,
        bundle: null,
      });
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const parsedJson = JSON.parse(content);
    const parsed = DomainDiscoveryBundleSchema.safeParse(parsedJson);

    if (!parsed.success) {
      return reply.status(422).send({
        available: false,
        filePath,
        error: 'Invalid domain discovery bundle',
        details: parsed.error.issues,
      });
    }

    return reply.send({
      available: true,
      filePath,
      summary: summarizeBundle(parsed.data),
      bundle: parsed.data,
    });
  });
}

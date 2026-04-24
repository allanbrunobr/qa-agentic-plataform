import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const CodeGraphNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  label: z.string().min(1),
  status: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  source: z.object({
    filePath: z.string().min(1),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
  }).optional(),
  metadata: z.record(z.unknown()).default({}),
}).passthrough();

const CodeGraphEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.string().min(1),
  label: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.unknown()).default({}),
}).passthrough();

const CodeGraphSchema = z.object({
  schemaVersion: z.literal('code-graph/v1'),
  targetId: z.string().min(1),
  repositoryKind: z.string().min(1),
  generatedAt: z.string().min(1),
  nodes: z.array(CodeGraphNodeSchema).default([]),
  edges: z.array(CodeGraphEdgeSchema).default([]),
  stats: z.object({
    nodeCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    evidenceNodeCount: z.number().int().nonnegative(),
    candidateNodeCount: z.number().int().nonnegative(),
  }).passthrough(),
}).passthrough();

type CodeGraph = z.infer<typeof CodeGraphSchema>;

type ValidatedCodeGraph =
  | { status: 'missing' }
  | { status: 'invalid'; filePath: string; details: unknown }
  | { status: 'available'; filePath: string; graph: CodeGraph };

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

async function loadCodeGraph(): Promise<ValidatedCodeGraph> {
  const filePath = await firstExistingFile(getCodeGraphCandidates());
  if (!filePath) return { status: 'missing' };

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsedJson = JSON.parse(content);
    const parsed = CodeGraphSchema.safeParse(parsedJson);

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
      graph: parsed.data,
    };
  } catch (error) {
    return {
      status: 'invalid',
      filePath,
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarizeCodeGraph(graph: CodeGraph) {
  const nodeTypes = countBy(graph.nodes.map((node) => node.type));
  const edgeTypes = countBy(graph.edges.map((edge) => edge.type));
  const endpoints = graph.nodes
    .filter((node) => node.type === 'endpoint')
    .slice(0, 12)
    .map((node) => ({
      id: node.id,
      label: node.label,
      source: node.source ?? null,
      method: typeof node.metadata['method'] === 'string' ? node.metadata['method'] : null,
      path: typeof node.metadata['path'] === 'string' ? node.metadata['path'] : null,
    }));
  const httpCalls = graph.nodes
    .filter((node) => node.type === 'http_call')
    .slice(0, 12)
    .map((node) => ({
      id: node.id,
      label: node.label,
      source: node.source ?? null,
      method: typeof node.metadata['method'] === 'string' ? node.metadata['method'] : null,
      url: typeof node.metadata['url'] === 'string' ? node.metadata['url'] : null,
      normalizedPath: typeof node.metadata['normalizedPath'] === 'string' ? node.metadata['normalizedPath'] : null,
    }));

  return {
    targetId: graph.targetId,
    repositoryKind: graph.repositoryKind,
    generatedAt: graph.generatedAt,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    evidenceNodeCount: graph.stats.evidenceNodeCount,
    candidateNodeCount: graph.stats.candidateNodeCount,
    endpointCount: nodeTypes['endpoint'] ?? 0,
    httpCallCount: nodeTypes['http_call'] ?? 0,
    linkedHttpCallCount: graph.edges.filter((edge) => edge.type === 'calls').length,
    nodeTypes,
    edgeTypes,
    endpoints,
    httpCalls,
  };
}

function countBy(items: string[]) {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[item] = (counts[item] ?? 0) + 1;
    return counts;
  }, {});
}

export async function codeGraphRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/p2/code-graph', async (_request, reply) => {
    const loaded = await loadCodeGraph();
    if (loaded.status === 'missing') {
      return reply.send({
        available: false,
        filePath: null,
        summary: null,
        graph: null,
      });
    }

    if (loaded.status === 'invalid') {
      return reply.status(422).send({
        available: false,
        filePath: loaded.filePath,
        error: 'Invalid code graph',
        details: loaded.details,
      });
    }

    return reply.send({
      available: true,
      filePath: loaded.filePath,
      summary: summarizeCodeGraph(loaded.graph),
      graph: loaded.graph,
    });
  });
}

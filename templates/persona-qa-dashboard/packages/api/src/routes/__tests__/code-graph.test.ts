import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { codeGraphRoutes } from '../code-graph.js';

let tempDir = '';
let graphFile = '';

async function createApp() {
  const app = Fastify();
  await app.register(codeGraphRoutes);
  await app.ready();
  return app;
}

describe('/api/p2/code-graph', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-graph-route-'));
    graphFile = path.join(tempDir, 'adapter', 'config', 'code-graph.generated.json');
    process.env['PERSONA_QA_CODE_GRAPH_FILE'] = graphFile;
  });

  afterEach(async () => {
    delete process.env['PERSONA_QA_CODE_GRAPH_FILE'];
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns unavailable when code graph has not been generated', async () => {
    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/p2/code-graph' });
    await app.close();

    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), {
      available: false,
      filePath: null,
      summary: null,
      graph: null,
    });
  });

  it('returns summarized graph nodes and endpoint links', async () => {
    await fs.mkdir(path.dirname(graphFile), { recursive: true });
    await fs.writeFile(graphFile, JSON.stringify(codeGraph()), 'utf-8');

    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/p2/code-graph' });
    await app.close();

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.available, true);
    assert.equal(body.filePath, graphFile);
    assert.equal(body.summary.targetId, 'fixture');
    assert.equal(body.summary.endpointCount, 1);
    assert.equal(body.summary.httpCallCount, 1);
    assert.equal(body.summary.linkedHttpCallCount, 1);
    assert.equal(body.summary.capabilitySupportEdgeCount, 1);
    assert.equal(body.summary.mappedCapabilityCount, 1);
    assert.equal(body.summary.unmappedCapabilityCount, 0);
    assert.equal(body.summary.nodeTypes.endpoint, 1);
    assert.equal(body.summary.edgeTypes.calls, 1);
    assert.equal(body.summary.edgeTypes.supports_capability, 1);
    assert.equal(body.summary.endpoints[0].path, '/api/orders');
    assert.equal(body.summary.capabilityMappings[0].capabilityId, 'submitOrder');
    assert.equal(body.summary.capabilityMappings[0].mappingStatus, 'mapped');
    assert.equal(body.graph.schemaVersion, 'code-graph/v1');
  });

  it('rejects malformed generated graphs', async () => {
    await fs.mkdir(path.dirname(graphFile), { recursive: true });
    await fs.writeFile(graphFile, JSON.stringify({ schemaVersion: 'wrong' }), 'utf-8');

    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/p2/code-graph' });
    await app.close();

    assert.equal(res.statusCode, 422);
    assert.equal(JSON.parse(res.body).error, 'Invalid code graph');
  });
});

function codeGraph() {
  return {
    schemaVersion: 'code-graph/v1',
    targetId: 'fixture',
    repositoryKind: 'frontend',
    generatedAt: '2026-01-01T00:00:00.000Z',
    nodes: [
      { id: 'repository:fixture', type: 'repository', label: 'fixture', metadata: {} },
      {
        id: 'endpoint:get_api_orders',
        type: 'endpoint',
        label: 'GET /api/orders',
        source: { filePath: 'src/server.ts', line: 4 },
        metadata: { method: 'GET', path: '/api/orders' },
      },
      {
        id: 'http_call:get_api_orders',
        type: 'http_call',
        label: 'GET /api/orders',
        source: { filePath: 'src/App.tsx', line: 9 },
        metadata: { method: 'GET', url: '/api/orders', normalizedPath: '/api/orders' },
      },
      {
        id: 'capability_candidate:submit_order',
        type: 'capability_candidate',
        label: 'submitOrder',
        status: 'draft',
        metadata: {
          capabilityId: 'submitOrder',
          graphMapping: { status: 'mapped', confidence: 0.8, endpointIds: ['endpoint:get_api_orders'], httpCallIds: [] },
        },
      },
    ],
    edges: [
      { id: 'edge:contains', from: 'repository:fixture', to: 'endpoint:get_api_orders', type: 'contains', metadata: {} },
      { id: 'edge:calls', from: 'http_call:get_api_orders', to: 'endpoint:get_api_orders', type: 'calls', metadata: {} },
      { id: 'edge:supports', from: 'endpoint:get_api_orders', to: 'capability_candidate:submit_order', type: 'supports_capability', confidence: 0.8, metadata: {} },
    ],
    stats: {
      nodeCount: 4,
      edgeCount: 3,
      evidenceNodeCount: 2,
      candidateNodeCount: 1,
    },
  };
}

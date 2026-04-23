import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { domainDiscoveryRoutes } from '../domain-discovery.js';

let tempDir = '';
let bundleFile = '';

async function createApp() {
  const app = Fastify();
  await app.register(domainDiscoveryRoutes);
  await app.ready();
  return app;
}

describe('/api/p2/domain-discovery', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'domain-discovery-route-'));
    bundleFile = path.join(tempDir, 'adapter', 'config', 'domain-discovery-bundle.generated.json');
    process.env['PERSONA_QA_DOMAIN_DISCOVERY_FILE'] = bundleFile;
  });

  afterEach(async () => {
    delete process.env['PERSONA_QA_DOMAIN_DISCOVERY_FILE'];
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns unavailable when domain discovery has not been generated', async () => {
    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/p2/domain-discovery' });
    await app.close();

    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), {
      available: false,
      filePath: null,
      summary: null,
      bundle: null,
    });
  });

  it('returns summarized domain candidates with evidence counts', async () => {
    await fs.mkdir(path.dirname(bundleFile), { recursive: true });
    await fs.writeFile(bundleFile, JSON.stringify(domainBundle()), 'utf-8');

    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/p2/domain-discovery' });
    await app.close();

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.available, true);
    assert.equal(body.filePath, bundleFile);
    assert.equal(body.summary.domain, 'commerce');
    assert.equal(body.summary.personas, 1);
    assert.equal(body.summary.scenarios, 1);
    assert.equal(body.summary.capabilities, 1);
    assert.equal(body.summary.evidenceItems, 3);
    assert.equal(body.summary.mappingRequired, 1);
    assert.equal(body.bundle.personas[0].id, 'shopper');
  });

  it('rejects malformed generated bundles', async () => {
    await fs.mkdir(path.dirname(bundleFile), { recursive: true });
    await fs.writeFile(bundleFile, JSON.stringify({ domain: { domain: 'broken' } }), 'utf-8');

    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/p2/domain-discovery' });
    await app.close();

    assert.equal(res.statusCode, 422);
    assert.equal(JSON.parse(res.body).error, 'Invalid domain discovery bundle');
  });
});

function domainBundle() {
  const evidenceRef = { evidenceId: 'button_submit_order', kind: 'button' };

  return {
    surfaceMap: {
      targetId: 'commerce_fixture',
      routes: [{ id: 'route_root' }],
      components: [],
      forms: [],
      buttons: [{ id: 'button_submit_order' }],
      texts: [{ id: 'text_checkout' }],
      navigation: [],
      packages: [],
      frameworks: [],
      tests: [],
    },
    domain: {
      domain: 'commerce',
      label: 'Commerce',
      summary: 'Checkout workflow.',
      confidence: 0.82,
      status: 'draft',
      evidenceRefs: [evidenceRef],
      risks: [],
      entities: [],
    },
    personas: [{
      id: 'shopper',
      title: 'Shopper',
      rationale: 'Checkout evidence exists.',
      goals: ['Place order'],
      allowedCapabilityIds: ['submit_order'],
      confidence: 0.8,
      status: 'draft',
      evidenceRefs: [evidenceRef],
      risks: [],
    }],
    scenarios: [{
      id: 'place_order',
      title: 'Place order',
      rationale: 'Order button exists.',
      participatingPersonaIds: ['shopper'],
      requiredCapabilityIds: ['submit_order'],
      steps: [{ id: 'submit_order', title: 'Submit order', intent: 'Submit order', evidenceRefs: [evidenceRef] }],
      confidence: 0.74,
      status: 'needs_human_mapping',
      evidenceRefs: [evidenceRef],
      risks: [],
    }],
    capabilities: [{
      id: 'submit_order',
      title: 'Submit order',
      purpose: 'Click the visible order submission action.',
      kind: 'button_click',
      mappedSurfaceIds: ['button_submit_order'],
      selectorHints: ['Submit order'],
      confidence: 0.7,
      status: 'needs_human_mapping',
      evidenceRefs: [evidenceRef],
      risks: [],
    }],
    audit: {
      id: 'audit_commerce',
      summary: 'Human mapping required.',
      findings: [{
        id: 'human_mapping_required',
        severity: 'info',
        message: 'Selectors and auth still require mapping.',
        candidateIds: ['place_order'],
        evidenceRefs: [evidenceRef],
      }],
      downgradedCandidateIds: ['place_order'],
      confidence: 0.82,
      status: 'needs_human_mapping',
      evidenceRefs: [evidenceRef],
      risks: [],
    },
  };
}

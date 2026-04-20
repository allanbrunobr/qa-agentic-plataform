import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { personasRoutes } from '../personas.js';

let tempDir = '';
let personasFile = '';

async function createApp() {
  const app = Fastify();
  await app.register(personasRoutes);
  await app.ready();
  return app;
}

describe('/api/personas', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'persona-route-'));
    personasFile = path.join(tempDir, 'adapter', 'personas', 'personas.generated.json');
    process.env['PERSONA_QA_PERSONAS_FILE'] = personasFile;
  });

  afterEach(async () => {
    delete process.env['PERSONA_QA_PERSONAS_FILE'];
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns no personas when discovery has not generated an adapter file', async () => {
    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/personas' });
    await app.close();

    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), []);
  });

  it('lists personas from adapter/personas/personas.generated.json', async () => {
    await fs.mkdir(path.dirname(personasFile), { recursive: true });
    await fs.writeFile(
      personasFile,
      JSON.stringify([
        {
          id: 'qa_operator',
          title: 'QA Operator',
          goal: 'Validate the generated workflow.',
          allowedCapabilities: ['openDashboard'],
        },
      ]),
      'utf-8',
    );

    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/personas' });
    await app.close();

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.length, 1);
    assert.equal(body[0].slug, 'qa_operator');
    assert.equal(body[0].name, 'QA Operator');
    assert.equal(body[0].source, 'adapter');
    assert.deepEqual(body[0].modules, ['openDashboard']);
  });

  it('creates personas by appending to the generated adapter file', async () => {
    const app = await createApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/personas',
      payload: {
        name: 'Support Analyst',
        role: 'support_analyst',
        description: 'Validate support workflows.',
        modules: ['searchTicket'],
        color: '#00ffaa',
      },
    });
    await app.close();

    assert.equal(res.statusCode, 201);
    const written = JSON.parse(await fs.readFile(personasFile, 'utf-8'));
    assert.deepEqual(written, [
      {
        id: 'support_analyst',
        title: 'Support Analyst',
        goal: 'Validate support workflows.',
        allowedCapabilities: ['searchTicket'],
      },
    ]);
  });
});

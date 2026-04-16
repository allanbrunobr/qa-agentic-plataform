import type { FastifyInstance } from 'fastify';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

function getProjectDir(): string {
  return (
    process.env['PERSONA_QA_PROJECT_DIR'] ??
    path.resolve(process.cwd(), '../../..')
  );
}

function getPersonasDir(): string {
  const candidates = [
    process.env['PERSONA_QA_PERSONAS_DIR'],
    path.resolve(process.cwd(), 'agents'),
    path.resolve(process.cwd(), '..', '..', 'agents'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => fsSync.existsSync(candidate))
    ?? path.resolve(process.cwd(), 'agents');
}

interface PersonaData {
  slug: string;
  name: string;
  role: string;
  description: string;
  modules: string[];
  color: string | null;
  filePath: string;
}

/**
 * Parse a persona agent .md file extracting YAML frontmatter fields and content.
 */
function parsePersonaMd(content: string, filePath: string): PersonaData | null {
  const basename = path.basename(filePath, '.md');
  // Skip non-agent files
  if (basename === 'DOMAIN-RULES') return null;

  const fmMatch = /^---\n([\s\S]*?)\n---/.exec(content);

  let name = '';
  let role = '';
  let description = '';
  let modules: string[] = [];
  let color: string | null = null;

  if (fmMatch?.[1]) {
    const frontmatter = fmMatch[1];

    const nameMatch = /^name:\s*["']?(.+?)["']?\s*$/m.exec(frontmatter);
    if (nameMatch?.[1]) name = nameMatch[1];

    const roleMatch = /^role:\s*["']?(.+?)["']?\s*$/m.exec(frontmatter);
    if (roleMatch?.[1]) role = roleMatch[1];

    const colorMatch = /^color:\s*["']?(#[0-9a-fA-F]{6})["']?\s*$/m.exec(frontmatter);
    if (colorMatch?.[1]) color = colorMatch[1];

    // Handle multi-line description (YAML >)
    const descMatch = /^description:\s*["']?(.+?)["']?\s*$/m.exec(frontmatter);
    if (descMatch?.[1] && descMatch[1] !== '>') {
      description = descMatch[1];
    }
    if (!description) {
      // Parse YAML block scalar (description: >\n  lines...)
      const blockMatch = /^description:\s*>\s*\n((?:\s{2,}.+\n?)*)/m.exec(frontmatter);
      if (blockMatch?.[1]) {
        description = blockMatch[1]
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .join(' ');
      }
    }

    // Parse modules as YAML list
    const modulesMatch = /^modules:\s*\n((?:\s+-\s+.+\n?)*)/m.exec(frontmatter);
    if (modulesMatch?.[1]) {
      modules = modulesMatch[1]
        .split('\n')
        .map((l) => l.replace(/^\s*-\s*/, '').trim())
        .filter(Boolean);
    }
  }

  // Extract role from description if not explicit (e.g. "Persona do Dr. Carlos (fulfillment-agent cardiologista)")
  if (!role && description) {
    const roleFromDesc = description.match(/Persona d[oae]\s+(.+)\s+\(/);
    const roleInParens = description.match(/\(([^)]+)\)/);
    if (roleFromDesc?.[1]) {
      // Extract full name including "Dr." prefix
      name = name || roleFromDesc[1].trim();
    }
    if (roleInParens?.[1]) {
      role = roleInParens[1];
    }
  }

  // Friendly name from the description pattern "Persona do Dr. Carlos"
  if (name.startsWith('agent-')) {
    const nameFromDesc = description.match(/Persona d[oae]\s+(.+)\s+\(/);
    if (nameFromDesc?.[1]) {
      name = nameFromDesc[1];
    } else {
      const slugPart = basename.replace(/^agent-/, '');
      name = slugPart
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }
  }

  const slug = basename.replace(/^agent-/, '');

  return { slug, name, role, description, modules, color, filePath };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const CreatePersonaBody = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  description: z.string().min(1),
  modules: z.array(z.string()).min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  context: z.string().optional().default(''),
});

export async function personasRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/personas - list all personas from agent .md files
  app.get('/api/personas', async (_request, reply) => {
    const personasDir = getPersonasDir();

    let files: string[];
    try {
      const entries = await fs.readdir(personasDir);
      files = entries.filter((f) => f.endsWith('.md'));
    } catch {
      // Directory doesn't exist yet — return empty list
      return reply.send([]);
    }

    const personas: PersonaData[] = [];

    for (const file of files) {
      const filePath = path.join(personasDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = parsePersonaMd(content, filePath);
      if (parsed) {
        personas.push(parsed);
      }
    }

    return reply.send(personas);
  });

  // POST /api/personas - create a new persona
  app.post('/api/personas', async (request, reply) => {
    const parseResult = CreatePersonaBody.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid request body',
        details: parseResult.error.issues,
      });
    }

    const { name, role, description, modules, color, context } = parseResult.data;
    const slug = slugify(name);
    const personasDir = getPersonasDir();

    // Ensure directory exists
    await fs.mkdir(personasDir, { recursive: true });

    const fileName = `agent-${slug}.md`;
    const filePath = path.join(personasDir, fileName);

    // Check if file already exists
    try {
      await fs.access(filePath);
      return reply.status(409).send({ error: `Persona "${name}" already exists` });
    } catch {
      // File does not exist — proceed
    }

    const modulesYaml = modules.map((m) => `  - ${m}`).join('\n');
    const contextSection = context
      ? `\n## Context\n\n${context}\n`
      : '';

    const mdContent = `---
name: "${name}"
role: "${role}"
description: "${description}"
color: "${color}"
modules:
${modulesYaml}
---

# ${name}

**Role:** ${role}

${description}

## Modules

${modules.map((m) => `- ${m}`).join('\n')}
${contextSection}`;

    await fs.writeFile(filePath, mdContent, 'utf-8');

    const persona: PersonaData = {
      slug,
      name,
      role,
      description,
      modules,
      color,
      filePath,
    };

    return reply.status(201).send(persona);
  });
}

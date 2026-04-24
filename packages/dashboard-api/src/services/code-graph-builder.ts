import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  BootstrapDraft,
  DiscoveryReport,
  DiscoveredSurface,
  GeneratedPersonaDraft,
  GeneratedScenarioDraft,
} from '../../../host-sdk/src/contracts.ts'
import {
  CODE_GRAPH_SCHEMA_VERSION,
  CodeGraphSchema,
  type CodeGraph,
  type CodeGraphEdge,
  type CodeGraphEdgeType,
  type CodeGraphNode,
  type CodeGraphNodeType,
} from '../../../host-sdk/src/code-graph-contracts.ts'
import type {
  CapabilityCandidate,
  DomainDiscoveryBundle,
  EvidenceRef,
  FrontendEvidenceKind,
  FrontendSurfaceMap,
  SourceLocation,
} from '../../../host-sdk/src/domain-discovery-contracts.ts'

interface BuildCodeGraphInput {
  targetId: string
  report: DiscoveryReport
  draft: BootstrapDraft
  repoPath?: string
}

type MutableGraphNode = Omit<CodeGraphNode, 'metadata'> & {
  metadata?: Record<string, unknown>
}

type MutableGraphEdge = Omit<CodeGraphEdge, 'metadata'> & {
  metadata?: Record<string, unknown>
}

interface SourceGraphFile {
  relativePath: string
  content: string
}

interface EndpointEvidence {
  id: string
  method: string
  routePath: string
  source: SourceLocation
  label: string
  framework: string
}

interface HttpCallEvidence {
  id: string
  method: string
  url: string
  normalizedPath: string | null
  source: SourceLocation
  label: string
  client: string
}

interface SourceGraphEvidence {
  files: SourceGraphFile[]
  endpoints: EndpointEvidence[]
  httpCalls: HttpCallEvidence[]
}

const EVIDENCE_KIND_TO_NODE_TYPE: Record<FrontendEvidenceKind, CodeGraphNodeType> = {
  route: 'route',
  component: 'component',
  form: 'form',
  button: 'button',
  text: 'text',
  navigation: 'navigation',
  package: 'package',
  framework: 'framework',
  test: 'test',
}

function normalizeId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown'
}

function normalizePath(value: string) {
  return value.split(path.sep).join('/')
}

function lineForIndex(content: string, index: number) {
  return content.slice(0, index).split('\n').length
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    unique.push(item)
  }
  return unique
}

function graphId(...segments: string[]) {
  return segments.map((segment) => normalizeId(segment).slice(0, 70)).join(':').slice(0, 200)
}

function edgeId(type: CodeGraphEdgeType, from: string, to: string) {
  return graphId('edge', type, from, to).slice(0, 240)
}

function truncate(value: string, max: number) {
  return value.length > max ? value.slice(0, max - 1) + '...' : value
}

function toCamelCase(value: string) {
  return normalizeId(value).replace(/_+([a-z0-9])/g, (_, char: string) => char.toUpperCase())
}

function addNode(nodes: Map<string, CodeGraphNode>, node: MutableGraphNode) {
  const existing = nodes.get(node.id)
  if (!existing) {
    nodes.set(node.id, {
      ...node,
      label: truncate(node.label, 300),
      metadata: node.metadata ?? {},
    })
    return node.id
  }

  const confidence = existing.confidence === undefined
    ? node.confidence
    : node.confidence === undefined
      ? existing.confidence
      : Math.max(existing.confidence, node.confidence)

  nodes.set(node.id, {
    ...existing,
    confidence,
    source: existing.source ?? node.source,
    metadata: {
      ...existing.metadata,
      ...(node.metadata ?? {}),
    },
  })
  return node.id
}

function addEdge(edges: Map<string, CodeGraphEdge>, edge: MutableGraphEdge) {
  if (edge.from === edge.to) return
  const id = edge.id || edgeId(edge.type, edge.from, edge.to)
  if (edges.has(id)) return
  edges.set(id, {
    ...edge,
    id,
    label: edge.label ? truncate(edge.label, 240) : undefined,
    metadata: edge.metadata ?? {},
  })
}

function surfaceNodeType(surface: DiscoveredSurface): CodeGraphNodeType {
  if (surface.kind === 'route') return 'route'
  return 'surface'
}

function evidenceLabel(kind: FrontendEvidenceKind, item: Record<string, unknown>) {
  if (kind === 'route') return String(item.path ?? item.label ?? item.id)
  if (kind === 'component') return String(item.componentName ?? item.label ?? item.id)
  if (kind === 'form') return String(item.actionName ?? item.label ?? item.id)
  if (kind === 'button') return String(item.buttonText ?? item.label ?? item.id)
  if (kind === 'text') return String(item.label ?? item.extractedText ?? item.id)
  if (kind === 'navigation') return String(item.targetPath ?? item.label ?? item.id)
  if (kind === 'package') return String(item.packageName ?? item.label ?? item.id)
  if (kind === 'framework') return String(item.frameworkName ?? item.label ?? item.id)
  return String(item.testName ?? item.label ?? item.id)
}

function evidenceSource(item: Record<string, unknown>): SourceLocation | undefined {
  const source = item.source
  if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined
  return source as SourceLocation
}

async function scanSourceGraph(repoPath: string | undefined): Promise<SourceGraphEvidence> {
  if (!repoPath) return { files: [], endpoints: [], httpCalls: [] }
  const files = await listSourceGraphFiles(repoPath)
  const endpoints: EndpointEvidence[] = []
  const httpCalls: HttpCallEvidence[] = []

  for (const file of files) {
    endpoints.push(...collectEndpointEvidence(file))
    httpCalls.push(...collectHttpCallEvidence(file))
  }

  return {
    files,
    endpoints: uniqueById(endpoints).slice(0, 80),
    httpCalls: uniqueById(httpCalls).slice(0, 80),
  }
}

async function listSourceGraphFiles(repoPath: string): Promise<SourceGraphFile[]> {
  const results: SourceGraphFile[] = []
  const ignoredDirs = new Set([
    '.agentic-qa',
    '.git',
    '.next',
    'coverage',
    'dist',
    'build',
    'node_modules',
    'playwright-report',
  ])
  const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'])

  async function walk(currentDir: string): Promise<void> {
    if (results.length >= 350) return
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true })
    } catch {
      return
    }

    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (results.length >= 350) return
      if (entry.name.startsWith('.env')) continue
      const absolutePath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) await walk(absolutePath)
        continue
      }
      if (!entry.isFile() || !extensions.has(path.extname(entry.name))) continue
      let stat
      try {
        stat = await fs.stat(absolutePath)
      } catch {
        continue
      }
      if (stat.size > 160_000) continue
      try {
        const content = await fs.readFile(absolutePath, 'utf8')
        results.push({
          relativePath: normalizePath(path.relative(repoPath, absolutePath)),
          content,
        })
      } catch {
        // Skip unreadable files.
      }
    }
  }

  await walk(repoPath)
  return results
}

function collectEndpointEvidence(file: SourceGraphFile): EndpointEvidence[] {
  const endpoints: EndpointEvidence[] = []
  const expressLike = /\b(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi
  const fastifyLike = /\b(?:fastify|app)\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi
  const routeExport = /\bexport\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g

  for (const match of file.content.matchAll(expressLike)) {
    endpoints.push(endpointFromMatch(file, match, match[1] ?? 'get', match[2] ?? '/', 'express'))
  }
  for (const match of file.content.matchAll(fastifyLike)) {
    endpoints.push(endpointFromMatch(file, match, match[1] ?? 'get', match[2] ?? '/', 'fastify'))
  }
  for (const match of file.content.matchAll(routeExport)) {
    const routePath = inferApiRouteFromFile(file.relativePath)
    if (!routePath) continue
    endpoints.push(endpointFromMatch(file, match, match[1] ?? 'GET', routePath, 'next_api_route'))
  }

  return endpoints
}

function endpointFromMatch(
  file: SourceGraphFile,
  match: RegExpMatchArray,
  method: string,
  routePath: string,
  framework: string,
): EndpointEvidence {
  const normalizedMethod = method.toUpperCase()
  const normalizedPath = normalizeEndpointPath(routePath)
  const line = lineForIndex(file.content, match.index ?? 0)
  return {
    id: graphId('endpoint', normalizedMethod, normalizedPath, file.relativePath, String(line)),
    method: normalizedMethod,
    routePath: normalizedPath,
    source: { filePath: file.relativePath, line },
    label: `${normalizedMethod} ${normalizedPath}`,
    framework,
  }
}

function collectHttpCallEvidence(file: SourceGraphFile): HttpCallEvidence[] {
  const calls: HttpCallEvidence[] = []
  const fetchCall = /\bfetch\s*\(\s*["'`]([^"'`]+)["'`]\s*(?:,\s*\{([\s\S]{0,300}?)\})?/g
  const axiosCall = /\baxios\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi

  for (const match of file.content.matchAll(fetchCall)) {
    const url = match[1] ?? ''
    if (!url) continue
    const methodMatch = (match[2] ?? '').match(/\bmethod\s*:\s*["'`]([A-Z]+)["'`]/i)
    const method = (methodMatch?.[1] ?? 'GET').toUpperCase()
    calls.push(httpCallFromMatch(file, match, method, url, 'fetch'))
  }
  for (const match of file.content.matchAll(axiosCall)) {
    const method = (match[1] ?? 'get').toUpperCase()
    const url = match[2] ?? ''
    if (!url) continue
    calls.push(httpCallFromMatch(file, match, method, url, 'axios'))
  }

  return calls
}

function httpCallFromMatch(
  file: SourceGraphFile,
  match: RegExpMatchArray,
  method: string,
  url: string,
  client: string,
): HttpCallEvidence {
  const line = lineForIndex(file.content, match.index ?? 0)
  const normalizedPath = normalizeHttpCallPath(url)
  return {
    id: graphId('http_call', method, normalizedPath ?? url, file.relativePath, String(line)),
    method,
    url: sanitizeGraphText(url, 240),
    normalizedPath,
    source: { filePath: file.relativePath, line },
    label: `${method} ${normalizedPath ?? url}`,
    client,
  }
}

function inferApiRouteFromFile(relativePath: string): string | null {
  const normalized = normalizePath(relativePath)
  const appRouteMatch = normalized.match(/^(?:src\/)?app\/api\/(.+)\/route\.(?:t|j)s$/)
  if (appRouteMatch?.[1]) return normalizeEndpointPath('/api/' + appRouteMatch[1])
  const pagesRouteMatch = normalized.match(/^(?:src\/)?pages\/api\/(.+)\.(?:t|j)s$/)
  if (pagesRouteMatch?.[1]) return normalizeEndpointPath('/api/' + pagesRouteMatch[1].replace(/\/index$/, ''))
  return null
}

function normalizeEndpointPath(value: string) {
  const cleaned = value.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  const withSlash = cleaned.startsWith('/') ? cleaned : '/' + cleaned
  return withSlash.replace(/\[([^\]]+)\]/g, ':$1').replace(/\/$/, '') || '/'
}

function normalizeHttpCallPath(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes('${')) return null
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed)
      return normalizeEndpointPath(parsed.pathname)
    } catch {
      return null
    }
  }
  if (trimmed.startsWith('/')) return normalizeEndpointPath(trimmed)
  return null
}

function sanitizeGraphText(value: string, max: number) {
  return value
    .replace(/\b(api[_-]?key|token|secret|password)\b\s*[:=]\s*["']?[^"'\s]+/gi, '$1=[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_KEY]')
    .slice(0, max)
}

function flattenSurfaceEvidence(surfaceMap: FrontendSurfaceMap): Array<{
  kind: FrontendEvidenceKind
  item: Record<string, unknown> & { id: string }
}> {
  return [
    ...surfaceMap.routes.map((item) => ({ kind: 'route' as const, item })),
    ...surfaceMap.components.map((item) => ({ kind: 'component' as const, item })),
    ...surfaceMap.forms.map((item) => ({ kind: 'form' as const, item })),
    ...surfaceMap.buttons.map((item) => ({ kind: 'button' as const, item })),
    ...surfaceMap.texts.map((item) => ({ kind: 'text' as const, item })),
    ...surfaceMap.navigation.map((item) => ({ kind: 'navigation' as const, item })),
    ...surfaceMap.packages.map((item) => ({ kind: 'package' as const, item })),
    ...surfaceMap.frameworks.map((item) => ({ kind: 'framework' as const, item })),
    ...surfaceMap.tests.map((item) => ({ kind: 'test' as const, item })),
  ]
}

function addEvidenceEdges(input: {
  edges: Map<string, CodeGraphEdge>
  from: string
  refs: EvidenceRef[]
  evidenceNodeById: Map<string, string>
}) {
  for (const ref of input.refs) {
    const evidenceNodeId = input.evidenceNodeById.get(ref.evidenceId)
    if (!evidenceNodeId) continue
    addEdge(input.edges, {
      id: edgeId('has_evidence', input.from, evidenceNodeId),
      from: input.from,
      to: evidenceNodeId,
      type: 'has_evidence',
      metadata: { evidenceId: ref.evidenceId, kind: ref.kind },
    })
  }
}

function addCapabilityCandidate(input: {
  nodes: Map<string, CodeGraphNode>
  edges: Map<string, CodeGraphEdge>
  repositoryNodeId: string
  capability: CapabilityCandidate
  evidenceNodeById: Map<string, string>
}) {
  const capabilityNodeId = addNode(input.nodes, {
    id: graphId('capability_candidate', input.capability.id),
    type: 'capability_candidate',
    label: input.capability.title,
    status: input.capability.status,
    confidence: input.capability.confidence,
    metadata: {
      capabilityId: input.capability.id,
      kind: input.capability.kind,
      purpose: input.capability.purpose,
      selectorHints: input.capability.selectorHints,
    },
  })
  addEdge(input.edges, {
    id: edgeId('contains', input.repositoryNodeId, capabilityNodeId),
    from: input.repositoryNodeId,
    to: capabilityNodeId,
    type: 'contains',
  })
  addEvidenceEdges({
    edges: input.edges,
    from: capabilityNodeId,
    refs: input.capability.evidenceRefs,
    evidenceNodeById: input.evidenceNodeById,
  })
  for (const surfaceId of input.capability.mappedSurfaceIds) {
    const surfaceNodeId = input.evidenceNodeById.get(surfaceId)
    if (!surfaceNodeId) continue
    addEdge(input.edges, {
      id: edgeId('maps_surface', capabilityNodeId, surfaceNodeId),
      from: capabilityNodeId,
      to: surfaceNodeId,
      type: 'maps_surface',
      metadata: { surfaceId },
    })
  }
  return capabilityNodeId
}

function addDomainDiscoveryGraph(input: {
  nodes: Map<string, CodeGraphNode>
  edges: Map<string, CodeGraphEdge>
  repositoryNodeId: string
  bundle: DomainDiscoveryBundle
}) {
  const evidenceNodeById = new Map<string, string>()

  const domainNodeId = addNode(input.nodes, {
    id: graphId('domain', input.bundle.domain.domain),
    type: 'domain',
    label: input.bundle.domain.label ?? input.bundle.domain.domain,
    status: input.bundle.domain.status,
    confidence: input.bundle.domain.confidence,
    metadata: {
      summary: input.bundle.domain.summary,
      entities: input.bundle.domain.entities,
    },
  })
  addEdge(input.edges, {
    id: edgeId('infers_domain', input.repositoryNodeId, domainNodeId),
    from: input.repositoryNodeId,
    to: domainNodeId,
    type: 'infers_domain',
  })

  for (const { kind, item } of flattenSurfaceEvidence(input.bundle.surfaceMap)) {
    const evidenceNodeId = addNode(input.nodes, {
      id: graphId(kind, item.id),
      type: EVIDENCE_KIND_TO_NODE_TYPE[kind],
      label: evidenceLabel(kind, item),
      source: evidenceSource(item),
      metadata: {
        evidenceId: item.id,
        kind,
        extractedText: item.extractedText,
        ...(item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata) ? item.metadata : {}),
      },
    })
    evidenceNodeById.set(item.id, evidenceNodeId)
    addEdge(input.edges, {
      id: edgeId('contains', input.repositoryNodeId, evidenceNodeId),
      from: input.repositoryNodeId,
      to: evidenceNodeId,
      type: 'contains',
    })
  }

  addEvidenceEdges({
    edges: input.edges,
    from: domainNodeId,
    refs: input.bundle.domain.evidenceRefs,
    evidenceNodeById,
  })

  const capabilityNodeById = new Map<string, string>()
  for (const capability of input.bundle.capabilities) {
    const capabilityNodeId = addCapabilityCandidate({
      nodes: input.nodes,
      edges: input.edges,
      repositoryNodeId: input.repositoryNodeId,
      capability,
      evidenceNodeById,
    })
    capabilityNodeById.set(capability.id, capabilityNodeId)
  }

  const personaNodeById = new Map<string, string>()
  for (const persona of input.bundle.personas) {
    const personaNodeId = addNode(input.nodes, {
      id: graphId('persona_candidate', persona.id),
      type: 'persona_candidate',
      label: persona.title,
      status: persona.status,
      confidence: persona.confidence,
      metadata: {
        personaId: persona.id,
        goals: persona.goals,
        rationale: persona.rationale,
      },
    })
    personaNodeById.set(persona.id, personaNodeId)
    addEdge(input.edges, {
      id: edgeId('contains', input.repositoryNodeId, personaNodeId),
      from: input.repositoryNodeId,
      to: personaNodeId,
      type: 'contains',
    })
    addEvidenceEdges({
      edges: input.edges,
      from: personaNodeId,
      refs: persona.evidenceRefs,
      evidenceNodeById,
    })
    for (const capabilityId of persona.allowedCapabilityIds) {
      const capabilityNodeId = capabilityNodeById.get(capabilityId)
      if (!capabilityNodeId) continue
      addEdge(input.edges, {
        id: edgeId('allows_capability', personaNodeId, capabilityNodeId),
        from: personaNodeId,
        to: capabilityNodeId,
        type: 'allows_capability',
        metadata: { capabilityId },
      })
    }
  }

  for (const scenario of input.bundle.scenarios) {
    const scenarioNodeId = addNode(input.nodes, {
      id: graphId('scenario_candidate', scenario.id),
      type: 'scenario_candidate',
      label: scenario.title,
      status: scenario.status,
      confidence: scenario.confidence,
      metadata: {
        scenarioId: scenario.id,
        rationale: scenario.rationale,
      },
    })
    addEdge(input.edges, {
      id: edgeId('contains', input.repositoryNodeId, scenarioNodeId),
      from: input.repositoryNodeId,
      to: scenarioNodeId,
      type: 'contains',
    })
    addEvidenceEdges({
      edges: input.edges,
      from: scenarioNodeId,
      refs: scenario.evidenceRefs,
      evidenceNodeById,
    })
    for (const personaId of scenario.participatingPersonaIds) {
      const personaNodeId = personaNodeById.get(personaId)
      if (!personaNodeId) continue
      addEdge(input.edges, {
        id: edgeId('uses_persona', scenarioNodeId, personaNodeId),
        from: scenarioNodeId,
        to: personaNodeId,
        type: 'uses_persona',
        metadata: { personaId },
      })
    }
    for (const capabilityId of scenario.requiredCapabilityIds) {
      const capabilityNodeId = capabilityNodeById.get(capabilityId)
      if (!capabilityNodeId) continue
      addEdge(input.edges, {
        id: edgeId('requires_capability', scenarioNodeId, capabilityNodeId),
        from: scenarioNodeId,
        to: capabilityNodeId,
        type: 'requires_capability',
        metadata: { capabilityId },
      })
    }
    for (const step of scenario.steps) {
      const stepNodeId = addNode(input.nodes, {
        id: graphId('scenario_step_candidate', scenario.id, step.id),
        type: 'scenario_step_candidate',
        label: step.title,
        metadata: {
          stepId: step.id,
          intent: step.intent,
          capabilityId: step.capabilityId,
        },
      })
      addEdge(input.edges, {
        id: edgeId('contains_step', scenarioNodeId, stepNodeId),
        from: scenarioNodeId,
        to: stepNodeId,
        type: 'contains_step',
      })
      addEvidenceEdges({
        edges: input.edges,
        from: stepNodeId,
        refs: step.evidenceRefs,
        evidenceNodeById,
      })
      if (step.capabilityId) {
        const capabilityNodeId = capabilityNodeById.get(step.capabilityId)
        if (capabilityNodeId) {
          addEdge(input.edges, {
            id: edgeId('requires_capability', stepNodeId, capabilityNodeId),
            from: stepNodeId,
            to: capabilityNodeId,
            type: 'requires_capability',
            metadata: { capabilityId: step.capabilityId },
          })
        }
      }
    }
  }

  if (input.bundle.audit) {
    const auditNodeId = addNode(input.nodes, {
      id: graphId('audit', input.bundle.audit.id),
      type: 'audit',
      label: input.bundle.audit.summary,
      status: input.bundle.audit.status,
      confidence: input.bundle.audit.confidence,
      metadata: {
        auditId: input.bundle.audit.id,
        findings: input.bundle.audit.findings,
      },
    })
    addEdge(input.edges, {
      id: edgeId('contains', input.repositoryNodeId, auditNodeId),
      from: input.repositoryNodeId,
      to: auditNodeId,
      type: 'contains',
    })
    for (const candidateId of input.bundle.audit.downgradedCandidateIds) {
      const candidateNodeId = capabilityNodeById.get(candidateId)
        ?? personaNodeById.get(candidateId)
        ?? graphId('scenario_candidate', candidateId)
      if (!input.nodes.has(candidateNodeId)) continue
      addEdge(input.edges, {
        id: edgeId('downgraded_candidate', auditNodeId, candidateNodeId),
        from: auditNodeId,
        to: candidateNodeId,
        type: 'downgraded_candidate',
        metadata: { candidateId },
      })
    }
  }
}

function addSourceGraph(input: {
  nodes: Map<string, CodeGraphNode>
  edges: Map<string, CodeGraphEdge>
  repositoryNodeId: string
  sourceGraph: SourceGraphEvidence
}) {
  const fileNodeByPath = new Map<string, string>()
  const endpointNodeByPath = new Map<string, string>()
  const sourceFiles = new Set<string>()

  for (const endpoint of input.sourceGraph.endpoints) sourceFiles.add(endpoint.source.filePath)
  for (const call of input.sourceGraph.httpCalls) sourceFiles.add(call.source.filePath)

  for (const file of input.sourceGraph.files) {
    if (!sourceFiles.has(file.relativePath)) continue
    const fileNodeId = addNode(input.nodes, {
      id: graphId('source_file', file.relativePath),
      type: 'source_file',
      label: file.relativePath,
      source: { filePath: file.relativePath },
      metadata: { filePath: file.relativePath },
    })
    fileNodeByPath.set(file.relativePath, fileNodeId)
    addEdge(input.edges, {
      id: edgeId('contains', input.repositoryNodeId, fileNodeId),
      from: input.repositoryNodeId,
      to: fileNodeId,
      type: 'contains',
    })
  }

  for (const endpoint of input.sourceGraph.endpoints) {
    const endpointNodeId = addNode(input.nodes, {
      id: endpoint.id,
      type: 'endpoint',
      label: endpoint.label,
      source: endpoint.source,
      metadata: {
        method: endpoint.method,
        path: endpoint.routePath,
        framework: endpoint.framework,
      },
    })
    endpointNodeByPath.set(`${endpoint.method} ${endpoint.routePath}`, endpointNodeId)
    endpointNodeByPath.set(`ANY ${endpoint.routePath}`, endpointNodeId)
    addEdge(input.edges, {
      id: edgeId('contains', input.repositoryNodeId, endpointNodeId),
      from: input.repositoryNodeId,
      to: endpointNodeId,
      type: 'contains',
    })
    const fileNodeId = fileNodeByPath.get(endpoint.source.filePath)
    if (fileNodeId) {
      addEdge(input.edges, {
        id: edgeId('handles', fileNodeId, endpointNodeId),
        from: fileNodeId,
        to: endpointNodeId,
        type: 'handles',
      })
    }
  }

  for (const call of input.sourceGraph.httpCalls) {
    const callNodeId = addNode(input.nodes, {
      id: call.id,
      type: 'http_call',
      label: call.label,
      source: call.source,
      metadata: {
        method: call.method,
        url: call.url,
        normalizedPath: call.normalizedPath,
        client: call.client,
      },
    })
    addEdge(input.edges, {
      id: edgeId('contains', input.repositoryNodeId, callNodeId),
      from: input.repositoryNodeId,
      to: callNodeId,
      type: 'contains',
    })
    const fileNodeId = fileNodeByPath.get(call.source.filePath)
    if (fileNodeId) {
      addEdge(input.edges, {
        id: edgeId('makes_http_request', fileNodeId, callNodeId),
        from: fileNodeId,
        to: callNodeId,
        type: 'makes_http_request',
      })
    }
    if (call.normalizedPath) {
      const endpointNodeId = endpointNodeByPath.get(`${call.method} ${call.normalizedPath}`)
        ?? endpointNodeByPath.get(`ANY ${call.normalizedPath}`)
      if (endpointNodeId) {
        addEdge(input.edges, {
          id: edgeId('calls', callNodeId, endpointNodeId),
          from: callNodeId,
          to: endpointNodeId,
          type: 'calls',
          confidence: 0.9,
          metadata: { matchedBy: 'method_path' },
        })
      }
    }
  }
}

function addDraftGraph(input: {
  nodes: Map<string, CodeGraphNode>
  edges: Map<string, CodeGraphEdge>
  repositoryNodeId: string
  draft: BootstrapDraft
}) {
  const capabilityNodeById = new Map<string, string>()
  for (const capabilityId of input.draft.capabilityCandidates) {
    const capabilityNodeId = addNode(input.nodes, {
      id: graphId('capability_candidate', capabilityId),
      type: 'capability_candidate',
      label: capabilityId,
      status: 'draft',
      metadata: { capabilityId, source: 'bootstrap_draft' },
    })
    capabilityNodeById.set(capabilityId, capabilityNodeId)
    addEdge(input.edges, {
      id: edgeId('contains', input.repositoryNodeId, capabilityNodeId),
      from: input.repositoryNodeId,
      to: capabilityNodeId,
      type: 'contains',
    })
  }

  const personaNodeById = new Map<string, string>()
  for (const persona of input.draft.personas) {
    const personaNodeId = addDraftPersona(input.nodes, input.edges, input.repositoryNodeId, persona)
    personaNodeById.set(persona.id, personaNodeId)
    for (const capabilityId of persona.allowedTools) {
      const capabilityNodeId = capabilityNodeById.get(capabilityId)
      if (!capabilityNodeId) continue
      addEdge(input.edges, {
        id: edgeId('allows_capability', personaNodeId, capabilityNodeId),
        from: personaNodeId,
        to: capabilityNodeId,
        type: 'allows_capability',
        metadata: { capabilityId },
      })
    }
  }

  for (const scenario of input.draft.scenarios) {
    addDraftScenario(input.nodes, input.edges, input.repositoryNodeId, scenario, personaNodeById, capabilityNodeById)
  }
}

function addDraftPersona(
  nodes: Map<string, CodeGraphNode>,
  edges: Map<string, CodeGraphEdge>,
  repositoryNodeId: string,
  persona: GeneratedPersonaDraft,
) {
  const personaNodeId = addNode(nodes, {
    id: graphId('persona_candidate', persona.id),
    type: 'persona_candidate',
    label: persona.title,
    status: 'draft',
    metadata: {
      personaId: persona.id,
      rationale: persona.rationale,
      allowedTools: persona.allowedTools,
      source: 'bootstrap_draft',
    },
  })
  addEdge(edges, {
    id: edgeId('contains', repositoryNodeId, personaNodeId),
    from: repositoryNodeId,
    to: personaNodeId,
    type: 'contains',
  })
  return personaNodeId
}

function addDraftScenario(
  nodes: Map<string, CodeGraphNode>,
  edges: Map<string, CodeGraphEdge>,
  repositoryNodeId: string,
  scenario: GeneratedScenarioDraft,
  personaNodeById: Map<string, string>,
  capabilityNodeById: Map<string, string>,
) {
  const scenarioNodeId = addNode(nodes, {
    id: graphId('scenario_candidate', scenario.id),
    type: 'scenario_candidate',
    label: scenario.title,
    status: 'draft',
    metadata: {
      scenarioId: scenario.id,
      rationale: scenario.rationale,
      source: 'bootstrap_draft',
    },
  })
  addEdge(edges, {
    id: edgeId('contains', repositoryNodeId, scenarioNodeId),
    from: repositoryNodeId,
    to: scenarioNodeId,
    type: 'contains',
  })
  for (const roleId of scenario.participatingRoles) {
    const personaNodeId = personaNodeById.get(roleId)
    if (!personaNodeId) continue
    addEdge(edges, {
      id: edgeId('uses_persona', scenarioNodeId, personaNodeId),
      from: scenarioNodeId,
      to: personaNodeId,
      type: 'uses_persona',
      metadata: { personaId: roleId },
    })
  }
  for (const step of scenario.candidateSteps) {
    const stepNodeId = addNode(nodes, {
      id: graphId('scenario_step_candidate', scenario.id, step),
      type: 'scenario_step_candidate',
      label: step,
      status: 'draft',
      metadata: {
        stepId: step,
        source: 'bootstrap_draft',
      },
    })
    addEdge(edges, {
      id: edgeId('contains_step', scenarioNodeId, stepNodeId),
      from: scenarioNodeId,
      to: stepNodeId,
      type: 'contains_step',
    })
    const capabilityId = toCamelCase(step)
    const capabilityNodeId = capabilityNodeById.get(capabilityId)
    if (!capabilityNodeId) continue
    addEdge(edges, {
      id: edgeId('requires_capability', scenarioNodeId, capabilityNodeId),
      from: scenarioNodeId,
      to: capabilityNodeId,
      type: 'requires_capability',
      metadata: { capabilityId },
    })
  }
}

export async function buildCodeGraph(input: BuildCodeGraphInput): Promise<CodeGraph> {
  const nodes = new Map<string, CodeGraphNode>()
  const edges = new Map<string, CodeGraphEdge>()
  const repositoryNodeId = graphId('repository', input.targetId)
  const repositoryKind = input.report.repository?.kind ?? 'unknown'
  const sourceGraph = await scanSourceGraph(input.repoPath)

  addNode(nodes, {
    id: repositoryNodeId,
    type: 'repository',
    label: input.targetId,
    confidence: input.report.repository?.confidence,
    metadata: {
      targetId: input.targetId,
      framework: input.report.framework,
      repository: input.report.repository,
      risks: input.report.risks,
    },
  })

  for (const surface of input.report.surfaces) {
    const surfaceNodeId = addNode(nodes, {
      id: graphId('surface', surface.id),
      type: surfaceNodeType(surface),
      label: surface.label,
      metadata: {
        surfaceId: surface.id,
        kind: surface.kind,
        evidence: surface.evidence,
      },
    })
    addEdge(edges, {
      id: edgeId('contains', repositoryNodeId, surfaceNodeId),
      from: repositoryNodeId,
      to: surfaceNodeId,
      type: 'contains',
    })
  }

  for (const role of input.report.roles) {
    const roleNodeId = addNode(nodes, {
      id: graphId('role', role.id),
      type: 'role',
      label: role.id,
      confidence: role.confidence,
      metadata: {
        roleId: role.id,
        evidence: role.evidence,
      },
    })
    addEdge(edges, {
      id: edgeId('contains', repositoryNodeId, roleNodeId),
      from: repositoryNodeId,
      to: roleNodeId,
      type: 'contains',
    })
  }

  if (input.report.domainDiscovery) {
    addDomainDiscoveryGraph({
      nodes,
      edges,
      repositoryNodeId,
      bundle: input.report.domainDiscovery,
    })
  }

  addSourceGraph({
    nodes,
    edges,
    repositoryNodeId,
    sourceGraph,
  })

  addDraftGraph({
    nodes,
    edges,
    repositoryNodeId,
    draft: input.draft,
  })

  const graphNodes = [...nodes.values()]
  const graphEdges = [...edges.values()].filter((edge) => nodes.has(edge.from) && nodes.has(edge.to))
  return CodeGraphSchema.parse({
    schemaVersion: CODE_GRAPH_SCHEMA_VERSION,
    targetId: input.targetId,
    repositoryKind,
    generatedAt: new Date().toISOString(),
    nodes: graphNodes,
    edges: graphEdges,
    stats: {
      nodeCount: graphNodes.length,
      edgeCount: graphEdges.length,
      evidenceNodeCount: graphNodes.filter((node) => [
        'surface',
        'source_file',
        'route',
        'component',
        'form',
        'button',
        'text',
        'navigation',
        'package',
        'framework',
        'test',
      ].includes(node.type)).length,
      candidateNodeCount: graphNodes.filter((node) => [
        'persona_candidate',
        'scenario_candidate',
        'scenario_step_candidate',
        'capability_candidate',
      ].includes(node.type)).length,
    },
  })
}

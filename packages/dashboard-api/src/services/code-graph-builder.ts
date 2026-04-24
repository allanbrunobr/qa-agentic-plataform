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
}

type MutableGraphNode = Omit<CodeGraphNode, 'metadata'> & {
  metadata?: Record<string, unknown>
}

type MutableGraphEdge = Omit<CodeGraphEdge, 'metadata'> & {
  metadata?: Record<string, unknown>
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

export function buildCodeGraph(input: BuildCodeGraphInput): CodeGraph {
  const nodes = new Map<string, CodeGraphNode>()
  const edges = new Map<string, CodeGraphEdge>()
  const repositoryNodeId = graphId('repository', input.targetId)
  const repositoryKind = input.report.repository?.kind ?? 'unknown'

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

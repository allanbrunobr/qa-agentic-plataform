import { useEffect, useMemo, useState } from 'react'
import { GitBranch, Network, RadioTower, Route, Workflow } from 'lucide-react'
import { Card, StatCard } from '@/components/ui/Card'
import { api, type Phase2CodeGraphEdge, type Phase2CodeGraphNode, type Phase2CodeGraphResponse } from '@/lib/api'

const NODE_LABELS: Record<string, string> = {
  repository: 'Repository',
  domain: 'Domain',
  source_file: 'Source files',
  route: 'Routes',
  component: 'Components',
  form: 'Forms',
  button: 'Buttons',
  text: 'Texts',
  navigation: 'Navigation',
  package: 'Packages',
  framework: 'Frameworks',
  test: 'Tests',
  role: 'Roles',
  persona_candidate: 'Personas',
  scenario_candidate: 'Scenarios',
  scenario_step_candidate: 'Steps',
  capability_candidate: 'Capabilities',
  endpoint: 'Endpoints',
  http_call: 'HTTP calls',
}

function LoadingState() {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-[var(--text-muted)]">
      Loading code graph...
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
      <Network className="h-8 w-8" />
      <p className="text-sm">Code graph ainda não foi gerado.</p>
      <p className="text-xs">Execute `discover-local` para materializar `adapter/config/code-graph.generated.json`.</p>
    </div>
  )
}

export function CodeGraph() {
  const [response, setResponse] = useState<Phase2CodeGraphResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    api.getPhase2CodeGraph()
      .then((nextResponse) => {
        if (mounted) setResponse(nextResponse)
      })
      .catch((loadError) => {
        if (mounted) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar code graph')
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [])

  const summary = response?.summary ?? null
  const graph = response?.graph ?? null

  const topNodeTypes = useMemo(() => {
    if (!summary) return []
    return Object.entries(summary.nodeTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
  }, [summary])

  const candidateNodes = useMemo(() => (
    graph?.nodes.filter((node) => node.type.endsWith('_candidate')).slice(0, 10) ?? []
  ), [graph])

  const endpointLinks = useMemo(() => {
    if (!graph) return []
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
    return graph.edges
      .filter((edge) => edge.type === 'calls')
      .map((edge) => ({
        edge,
        from: nodeById.get(edge.from),
        to: nodeById.get(edge.to),
      }))
      .filter((item): item is { edge: Phase2CodeGraphEdge; from: Phase2CodeGraphNode; to: Phase2CodeGraphNode } => (
        Boolean(item.from && item.to)
      ))
      .slice(0, 12)
  }, [graph])

  if (loading) return <LoadingState />
  if (error) {
    return (
      <div className="p-6">
        <Card className="border-red-500/30 bg-red-500/10">
          <p className="text-sm text-red-300">{error}</p>
        </Card>
      </div>
    )
  }
  if (!response?.available || !summary || !graph) return <EmptyState />

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">Code Graph</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Evidências, candidates, endpoints e chamadas inferidas do repositório target.
          </p>
        </div>
        <div className="text-xs text-[var(--text-muted)]">
          {summary.targetId} · {summary.repositoryKind} · {new Date(summary.generatedAt).toLocaleString()}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Nodes"
          value={summary.nodeCount}
          sub={`${summary.evidenceNodeCount} evidence`}
          trend="neutral"
          trendValue={`${summary.candidateNodeCount} candidates`}
          icon={<Network className="h-4 w-4" />}
          accentColor="var(--accent)"
        />
        <StatCard
          label="Edges"
          value={summary.edgeCount}
          sub="relações persistidas"
          trend="neutral"
          trendValue={`${Object.keys(summary.edgeTypes).length} tipos`}
          icon={<GitBranch className="h-4 w-4" />}
          accentColor="var(--info)"
        />
        <StatCard
          label="Endpoints"
          value={summary.endpointCount}
          sub={`${summary.linkedHttpCallCount} calls vinculadas`}
          trend={summary.endpointCount > 0 ? 'up' : 'neutral'}
          trendValue={`${summary.httpCallCount} HTTP calls`}
          icon={<Route className="h-4 w-4" />}
          accentColor="var(--success)"
        />
        <StatCard
          label="Candidates"
          value={summary.candidateNodeCount}
          sub={`${summary.mappedCapabilityCount} capabilities mapeadas`}
          trend={summary.unmappedCapabilityCount === 0 ? 'up' : 'neutral'}
          trendValue={`${summary.unmappedCapabilityCount} precisam revisão`}
          icon={<Workflow className="h-4 w-4" />}
          accentColor="var(--warning)"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card className="p-5">
          <SectionHeader title="Graph Composition" description={response.filePath ?? 'code-graph.generated.json'} />
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3">
            {topNodeTypes.map(([type, count]) => (
              <div key={type} className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  {NODE_LABELS[type] ?? type}
                </p>
                <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{count}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader title="Endpoint Links" description="HTTP calls ligadas a handlers por método e path." />
          <div className="mt-4 space-y-2">
            {endpointLinks.length === 0 ? (
              <p className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-muted)]">
                Nenhuma chamada HTTP foi vinculada a um endpoint interno.
              </p>
            ) : endpointLinks.map(({ edge, from, to }) => (
              <div key={edge.id} className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] p-3">
                <div className="flex items-center gap-2 text-xs">
                  <RadioTower className="h-3.5 w-3.5 text-[var(--accent)]" />
                  <span className="font-semibold text-[var(--text-primary)]">{from.label}</span>
                  <span className="text-[var(--text-muted)]">calls</span>
                  <span className="font-semibold text-[var(--text-primary)]">{to.label}</span>
                </div>
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                  {sourceLabel(from)} → {sourceLabel(to)}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ListCard title="Endpoints" items={summary.endpoints.map((endpoint) => ({
          id: endpoint.id,
          title: endpoint.label,
          detail: endpoint.source ? sourceLabel({ source: endpoint.source }) : endpoint.path ?? 'sem source',
        }))} />
        <ListCard title="HTTP Calls" items={summary.httpCalls.map((call) => ({
          id: call.id,
          title: call.label,
          detail: call.source ? sourceLabel({ source: call.source }) : call.url ?? 'sem source',
        }))} />
        <ListCard title="Capability Mapping" items={summary.capabilityMappings.slice(0, 12).map((mapping) => ({
          id: mapping.id,
          title: mapping.label,
          detail: `${mapping.mappingStatus} · ${mapping.sourceCount} source(s) · ${Math.round(mapping.confidence * 100)}%`,
        }))} />
      </div>

      <Card className="p-5">
        <SectionHeader title="Candidate Nodes" description="Personas, cenários e steps detectados para revisão." />
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {candidateNodes.map((node) => (
            <div key={node.id} className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] p-3">
              <p className="truncate text-xs font-semibold text-[var(--text-primary)]">{node.label}</p>
              <p className="mt-1 truncate text-[10px] text-[var(--text-muted)]">
                {NODE_LABELS[node.type] ?? node.type}{node.status ? ` · ${node.status}` : ''}
              </p>
            </div>
          ))}
          {candidateNodes.length === 0 && (
            <p className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-muted)]">
              Nenhum candidate detectado.
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
      <p className="mt-1 break-all text-xs text-[var(--text-muted)]">{description}</p>
    </div>
  )
}

function ListCard({ title, items }: { title: string; items: Array<{ id: string; title: string; detail: string }> }) {
  return (
    <Card className="p-5">
      <SectionHeader title={title} description={`${items.length} itens principais`} />
      <div className="mt-4 space-y-2">
        {items.length === 0 ? (
          <p className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-muted)]">
            Nenhum item detectado.
          </p>
        ) : items.map((item) => (
          <div key={item.id} className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] p-3">
            <p className="truncate text-xs font-semibold text-[var(--text-primary)]">{item.title}</p>
            <p className="mt-1 truncate text-[10px] text-[var(--text-muted)]">{item.detail}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}

function sourceLabel(item: { source?: Phase2CodeGraphNode['source'] }) {
  if (!item.source) return 'sem source'
  return item.source.line ? `${item.source.filePath}:${item.source.line}` : item.source.filePath
}

import type {
  BootstrapDraft,
  DiscoveryReport,
  DiscoveredRole,
  DiscoveredSurface,
  GeneratedPersonaDraft,
  GeneratedScenarioDraft,
} from '../../../host-sdk/src/contracts.ts'

export interface BootstrapReviewPageProps {
  report: DiscoveryReport
  draft: BootstrapDraft
}

export interface BootstrapReviewViewModel {
  type: 'bootstrap-review-page'
  summary: {
    framework: string
    rolesDetected: number
    surfacesDetected: number
    personasGenerated: number
    scenariosGenerated: number
  }
  roles: DiscoveredRole[]
  surfaces: DiscoveredSurface[]
  personas: GeneratedPersonaDraft[]
  scenarios: GeneratedScenarioDraft[]
  capabilityCandidates: string[]
  risks: string[]
  hostNotes: string[]
}

export function BootstrapReviewPage({ report, draft }: BootstrapReviewPageProps): BootstrapReviewViewModel {
  return {
    type: 'bootstrap-review-page',
    summary: {
      framework: report.framework ?? 'unknown',
      rolesDetected: report.roles.length,
      surfacesDetected: report.surfaces.length,
      personasGenerated: draft.personas.length,
      scenariosGenerated: draft.scenarios.length,
    },
    roles: report.roles,
    surfaces: report.surfaces,
    personas: draft.personas,
    scenarios: draft.scenarios,
    capabilityCandidates: draft.capabilityCandidates,
    risks: report.risks,
    hostNotes: draft.hostNotes,
  }
}

function renderList(items: string[]) {
  if (items.length === 0) return '<li>none</li>'
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function renderBootstrapReviewHtml(viewModel: BootstrapReviewViewModel) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Bootstrap Review</title>
    <style>
      body { font-family: Arial, sans-serif; background: #101217; color: #f5f7fa; margin: 0; padding: 24px; }
      h1, h2 { margin: 0 0 12px; }
      .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
      .card { background: #181c24; border: 1px solid #2a3040; border-radius: 8px; padding: 16px; }
      .section { margin-bottom: 16px; }
      .muted { color: #98a2b3; }
      ul { margin: 8px 0 0; padding-left: 20px; }
      code { color: #7dd3fc; }
    </style>
  </head>
  <body>
    <h1>Bootstrap Review</h1>
    <p class="muted">Framework: <code>${escapeHtml(viewModel.summary.framework)}</code></p>
    <div class="grid">
      <div class="card"><strong>Roles</strong><div>${viewModel.summary.rolesDetected}</div></div>
      <div class="card"><strong>Surfaces</strong><div>${viewModel.summary.surfacesDetected}</div></div>
      <div class="card"><strong>Personas</strong><div>${viewModel.summary.personasGenerated}</div></div>
      <div class="card"><strong>Scenarios</strong><div>${viewModel.summary.scenariosGenerated}</div></div>
    </div>
    <div class="section card">
      <h2>Roles</h2>
      <ul>${renderList(viewModel.roles.map((role) => `${role.id} — confidence ${role.confidence}`))}</ul>
    </div>
    <div class="section card">
      <h2>Surfaces</h2>
      <ul>${renderList(viewModel.surfaces.map((surface) => `${surface.id} — ${surface.kind} — evidence: ${surface.evidence.join(', ')}`))}</ul>
    </div>
    <div class="section card">
      <h2>Personas</h2>
      <ul>${renderList(viewModel.personas.map((persona) => `${persona.id} — ${persona.title} — tools: ${persona.allowedTools.join(', ')}`))}</ul>
    </div>
    <div class="section card">
      <h2>Scenarios</h2>
      <ul>${renderList(viewModel.scenarios.map((scenario) => `${scenario.id} — roles: ${scenario.participatingRoles.join(', ')} — steps: ${scenario.candidateSteps.join(', ')}`))}</ul>
    </div>
    <div class="section card">
      <h2>Capability Candidates</h2>
      <ul>${renderList(viewModel.capabilityCandidates)}</ul>
    </div>
    <div class="section card">
      <h2>Risks</h2>
      <ul>${renderList(viewModel.risks)}</ul>
    </div>
    <div class="section card">
      <h2>Host Notes</h2>
      <ul>${renderList(viewModel.hostNotes)}</ul>
    </div>
  </body>
</html>`
}

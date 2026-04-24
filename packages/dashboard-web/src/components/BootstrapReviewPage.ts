import type {
  BootstrapDraft,
  DiscoveryReport,
  DiscoveredRole,
  DiscoveredSurface,
  GeneratedPersonaDraft,
  GeneratedScenarioDraft,
} from '../../../host-sdk/src/contracts.ts'
import type {
  CapabilityCandidate,
  DiscoveryAuditFinding,
  DiscoveryCandidateStatus,
  DomainDiscoveryBundle,
  PersonaCandidate,
  ScenarioCandidate,
} from '../../../host-sdk/src/domain-discovery-contracts.ts'

export interface BootstrapReviewPageProps {
  report: DiscoveryReport
  draft: BootstrapDraft
}

export interface BootstrapReviewViewModel {
  type: 'bootstrap-review-page'
  summary: {
    framework: string
    repositoryKind: string
    domain: string
    rolesDetected: number
    surfacesDetected: number
    personasGenerated: number
    scenariosGenerated: number
    evidenceItems: number
    runnableCandidates: number
    mappingRequired: number
    restrictedCandidates: number
  }
  domainReview: {
    domain: string
    label: string
    status: DiscoveryCandidateStatus | 'unavailable'
    confidence: number
    summary: string
    auditStatus: DiscoveryCandidateStatus | 'unavailable'
    auditFindings: DiscoveryAuditFinding[]
  }
  reviewGates: Array<{
    id: string
    severity: 'info' | 'warning' | 'blocker' | 'success'
    title: string
    message: string
  }>
  statusCounts: Record<DiscoveryCandidateStatus, number>
  roles: DiscoveredRole[]
  surfaces: DiscoveredSurface[]
  personas: GeneratedPersonaDraft[]
  scenarios: GeneratedScenarioDraft[]
  capabilityCandidates: string[]
  candidatePersonas: CandidateReviewItem[]
  candidateScenarios: CandidateReviewItem[]
  candidateCapabilities: CandidateReviewItem[]
  risks: string[]
  hostNotes: string[]
}

export interface CandidateReviewItem {
  id: string
  title: string
  status: DiscoveryCandidateStatus
  confidence: number
  evidenceRefs: string[]
  risks: string[]
}

export function BootstrapReviewPage({ report, draft }: BootstrapReviewPageProps): BootstrapReviewViewModel {
  const domainBundle = report.domainDiscovery
  const statusCounts = buildStatusCounts(domainBundle)
  const auditFindings = domainBundle?.audit?.findings ?? []

  return {
    type: 'bootstrap-review-page',
    summary: {
      framework: report.framework ?? 'unknown',
      repositoryKind: report.repository?.kind ?? 'unknown',
      domain: domainBundle?.domain.domain ?? 'unknown',
      rolesDetected: report.roles.length,
      surfacesDetected: report.surfaces.length,
      personasGenerated: draft.personas.length,
      scenariosGenerated: draft.scenarios.length,
      evidenceItems: countEvidenceItems(domainBundle),
      runnableCandidates: statusCounts.runnable_candidate,
      mappingRequired: statusCounts.needs_human_mapping,
      restrictedCandidates: statusCounts.restricted,
    },
    domainReview: {
      domain: domainBundle?.domain.domain ?? 'unknown',
      label: domainBundle?.domain.label ?? domainBundle?.domain.domain ?? 'unknown',
      status: domainBundle?.domain.status ?? 'unavailable',
      confidence: domainBundle?.domain.confidence ?? 0,
      summary: domainBundle?.domain.summary ?? 'No domain discovery bundle was produced for this repository.',
      auditStatus: domainBundle?.audit?.status ?? 'unavailable',
      auditFindings,
    },
    reviewGates: buildReviewGates(domainBundle, statusCounts, auditFindings),
    statusCounts,
    roles: report.roles,
    surfaces: report.surfaces,
    personas: draft.personas,
    scenarios: draft.scenarios,
    capabilityCandidates: draft.capabilityCandidates,
    candidatePersonas: (domainBundle?.personas ?? []).map(candidatePersonaToItem),
    candidateScenarios: (domainBundle?.scenarios ?? []).map(candidateScenarioToItem),
    candidateCapabilities: (domainBundle?.capabilities ?? []).map(candidateCapabilityToItem),
    risks: report.risks,
    hostNotes: draft.hostNotes,
  }
}

function buildStatusCounts(domainBundle: DomainDiscoveryBundle | undefined): Record<DiscoveryCandidateStatus, number> {
  const counts: Record<DiscoveryCandidateStatus, number> = {
    draft: 0,
    runnable_candidate: 0,
    restricted: 0,
    needs_human_mapping: 0,
  }
  if (!domainBundle) return counts

  const candidates = [
    domainBundle.domain,
    ...domainBundle.personas,
    ...domainBundle.scenarios,
    ...domainBundle.capabilities,
    ...(domainBundle.audit ? [domainBundle.audit] : []),
  ]
  for (const candidate of candidates) {
    counts[candidate.status] += 1
  }
  return counts
}

function buildReviewGates(
  domainBundle: DomainDiscoveryBundle | undefined,
  statusCounts: Record<DiscoveryCandidateStatus, number>,
  auditFindings: DiscoveryAuditFinding[],
): BootstrapReviewViewModel['reviewGates'] {
  if (!domainBundle) {
    return [{
      id: 'static_bootstrap',
      severity: 'warning',
      title: 'Static bootstrap only',
      message: 'No domain-aware discovery bundle is available. Treat personas and scenarios as structural drafts.',
    }]
  }

  const gates: BootstrapReviewViewModel['reviewGates'] = []
  const blockerFindings = auditFindings.filter((finding) => finding.severity === 'blocker')

  if (statusCounts.restricted > 0 || blockerFindings.length > 0) {
    gates.push({
      id: 'restricted_candidates',
      severity: 'blocker',
      title: 'Restricted candidates',
      message: `${statusCounts.restricted} restricted candidate(s) and ${blockerFindings.length} audit blocker(s) must be resolved before certification.`,
    })
  }

  if (statusCounts.needs_human_mapping > 0) {
    gates.push({
      id: 'needs_human_mapping',
      severity: 'warning',
      title: 'Human mapping required',
      message: `${statusCounts.needs_human_mapping} candidate(s) need route, selector, credential, or capability mapping before becoming runnable.`,
    })
  }

  if (statusCounts.draft > 0) {
    gates.push({
      id: 'draft_review',
      severity: 'info',
      title: 'Draft review required',
      message: `${statusCounts.draft} candidate(s) are drafts. Review evidence and intent before promotion.`,
    })
  }

  if (statusCounts.runnable_candidate > 0) {
    gates.push({
      id: 'runnable_candidate',
      severity: 'success',
      title: 'Runnable candidates found',
      message: `${statusCounts.runnable_candidate} candidate(s) have enough evidence to attempt controlled execution after review.`,
    })
  }

  if (gates.length === 0) {
    gates.push({
      id: 'no_candidates',
      severity: 'info',
      title: 'No review candidates',
      message: 'Discovery completed, but no domain candidates were generated.',
    })
  }

  return gates
}

function countEvidenceItems(domainBundle: DomainDiscoveryBundle | undefined): number {
  if (!domainBundle) return 0
  const surfaceMap = domainBundle.surfaceMap
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
  ].reduce((total, items) => total + items.length, 0)
}

function candidatePersonaToItem(candidate: PersonaCandidate): CandidateReviewItem {
  return {
    id: candidate.id,
    title: candidate.title,
    status: candidate.status,
    confidence: candidate.confidence,
    evidenceRefs: candidate.evidenceRefs.map((ref) => ref.evidenceId),
    risks: candidate.risks.map((risk) => `${risk.severity}: ${risk.reason}`),
  }
}

function candidateScenarioToItem(candidate: ScenarioCandidate): CandidateReviewItem {
  return {
    id: candidate.id,
    title: candidate.title,
    status: candidate.status,
    confidence: candidate.confidence,
    evidenceRefs: candidate.evidenceRefs.map((ref) => ref.evidenceId),
    risks: candidate.risks.map((risk) => `${risk.severity}: ${risk.reason}`),
  }
}

function candidateCapabilityToItem(candidate: CapabilityCandidate): CandidateReviewItem {
  return {
    id: candidate.id,
    title: `${candidate.title} (${candidate.kind})`,
    status: candidate.status,
    confidence: candidate.confidence,
    evidenceRefs: candidate.evidenceRefs.map((ref) => ref.evidenceId),
    risks: candidate.risks.map((risk) => `${risk.severity}: ${risk.reason}`),
  }
}

function renderList(items: string[]) {
  if (items.length === 0) return '<li>none</li>'
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
}

function renderReviewGates(gates: BootstrapReviewViewModel['reviewGates']) {
  return gates.map((gate) => (
    `<div class="gate ${gate.severity}"><strong>${escapeHtml(gate.title)}</strong><span>${escapeHtml(gate.message)}</span></div>`
  )).join('')
}

function renderCandidateRows(items: CandidateReviewItem[]) {
  if (items.length === 0) return '<tr><td colspan="5">none</td></tr>'
  return items.map((item) => (
    '<tr>' +
      `<td><code>${escapeHtml(item.id)}</code><div>${escapeHtml(item.title)}</div></td>` +
      `<td>${escapeHtml(item.status)}</td>` +
      `<td>${Math.round(item.confidence * 100)}%</td>` +
      `<td>${escapeHtml(item.evidenceRefs.slice(0, 4).join(', ') || 'none')}</td>` +
      `<td>${escapeHtml(item.risks.slice(0, 2).join(' | ') || 'none')}</td>` +
    '</tr>'
  )).join('')
}

function renderCandidateTable(title: string, items: CandidateReviewItem[]) {
  return `
    <div class="section card">
      <h2>${escapeHtml(title)}</h2>
      <table>
        <thead><tr><th>Candidate</th><th>Status</th><th>Confidence</th><th>Evidence</th><th>Risks</th></tr></thead>
        <tbody>${renderCandidateRows(items)}</tbody>
      </table>
    </div>`
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
      .gates { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 16px 0 24px; }
      .gate { border: 1px solid #2a3040; border-radius: 8px; padding: 12px; background: #11151d; }
      .gate strong { display: block; margin-bottom: 6px; }
      .gate.success { border-color: rgba(52, 211, 153, 0.45); }
      .gate.warning { border-color: rgba(251, 191, 36, 0.45); }
      .gate.blocker { border-color: rgba(248, 113, 113, 0.45); }
      table { width: 100%; border-collapse: collapse; }
      th, td { border-bottom: 1px solid #2a3040; padding: 10px; text-align: left; vertical-align: top; }
      th { color: #98a2b3; font-size: 12px; text-transform: uppercase; }
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
      <div class="card"><strong>Evidence</strong><div>${viewModel.summary.evidenceItems}</div></div>
      <div class="card"><strong>Mapping Required</strong><div>${viewModel.summary.mappingRequired}</div></div>
      <div class="card"><strong>Runnable Candidates</strong><div>${viewModel.summary.runnableCandidates}</div></div>
      <div class="card"><strong>Restricted</strong><div>${viewModel.summary.restrictedCandidates}</div></div>
    </div>
    <div class="gates">${renderReviewGates(viewModel.reviewGates)}</div>
    <div class="section card">
      <h2>Domain Discovery</h2>
      <p><strong>${escapeHtml(viewModel.domainReview.label)}</strong> <span class="muted">(${escapeHtml(viewModel.domainReview.status)}, confidence ${Math.round(viewModel.domainReview.confidence * 100)}%)</span></p>
      <p>${escapeHtml(viewModel.domainReview.summary)}</p>
      <p class="muted">Repository kind: <code>${escapeHtml(viewModel.summary.repositoryKind)}</code> · Audit: <code>${escapeHtml(viewModel.domainReview.auditStatus)}</code></p>
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
    ${renderCandidateTable('Candidate Personas', viewModel.candidatePersonas)}
    ${renderCandidateTable('Candidate Scenarios', viewModel.candidateScenarios)}
    ${renderCandidateTable('Candidate Capabilities', viewModel.candidateCapabilities)}
    <div class="section card">
      <h2>Audit Findings</h2>
      <ul>${renderList(viewModel.domainReview.auditFindings.map((finding) => `${finding.severity} — ${finding.message}`))}</ul>
    </div>
  </body>
</html>`
}

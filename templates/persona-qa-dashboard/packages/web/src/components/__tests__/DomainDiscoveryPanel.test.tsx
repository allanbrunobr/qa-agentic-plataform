import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DomainDiscoveryPanel } from '../DomainDiscoveryPanel'
import type { Phase2DomainDiscoveryResponse } from '@/lib/api'

describe('DomainDiscoveryPanel', () => {
  it('renders unavailable state before discovery is generated', () => {
    render(<DomainDiscoveryPanel discovery={null} />)

    expect(screen.getByText('Domain Discovery')).toBeInTheDocument()
    expect(screen.getByText('aguardando discovery')).toBeInTheDocument()
    expect(screen.getByText(/Rode `discover-local`/)).toBeInTheDocument()
  })

  it('renders domain candidates with gated status and evidence summary', () => {
    render(<DomainDiscoveryPanel discovery={domainDiscovery()} />)

    expect(screen.getByText('Domain Discovery: Commerce')).toBeInTheDocument()
    expect(screen.getByText('Checkout and order workflows.')).toBeInTheDocument()
    expect(screen.getByText('82%')).toBeInTheDocument()
    expect(screen.getByText('commerce_fixture')).toBeInTheDocument()
    expect(screen.getByText('Shopper')).toBeInTheDocument()
    expect(screen.getByText('Place order')).toBeInTheDocument()
    expect(screen.getByText('Submit order')).toBeInTheDocument()
    expect(screen.getAllByText('needs human mapping').length).toBeGreaterThan(0)
    expect(screen.getByText('Selectors and auth still require mapping.')).toBeInTheDocument()
  })
})

function domainDiscovery(): Phase2DomainDiscoveryResponse {
  const evidenceRef = { evidenceId: 'button_submit_order', kind: 'button' }

  return {
    available: true,
    filePath: '/tmp/.agentic-qa/adapter/config/domain-discovery-bundle.generated.json',
    summary: {
      domain: 'commerce',
      label: 'Commerce',
      confidence: 0.82,
      status: 'draft',
      targetId: 'commerce_fixture',
      personas: 1,
      scenarios: 1,
      capabilities: 1,
      evidenceItems: 3,
      auditStatus: 'needs_human_mapping',
      auditFindings: 1,
      mappingRequired: 1,
    },
    bundle: {
      surfaceMap: {
        targetId: 'commerce_fixture',
        routes: [{}],
        components: [],
        forms: [],
        buttons: [{}],
        texts: [{}],
        navigation: [],
        packages: [],
        frameworks: [],
        tests: [],
      },
      domain: {
        domain: 'commerce',
        label: 'Commerce',
        summary: 'Checkout and order workflows.',
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
        steps: [],
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
    },
  }
}

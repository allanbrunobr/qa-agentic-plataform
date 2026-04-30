import { describe, expect, it } from 'vitest'
import {
  deriveScenarioDraftPromotionRecommendation,
  type ScenarioDraftPromotionRequirement,
} from '../services/scenario-draft-promotion-readiness-service.js'
import type { ScenarioDraft } from '../services/session-service.js'

describe('scenario draft promotion readiness recommendation', () => {
  it('keeps partially mapped drafts in review with structural blockers called out', () => {
    const draft = createDraft({
      status: 'pending',
      graphReadiness: {
        status: 'partially_mapped',
        confidence: 0.55,
        requiredCapabilityCount: 2,
        mappedCapabilityCount: 1,
        mappedCapabilityIds: ['submitOrder'],
        missingCapabilityIds: ['fillCustomerEmail'],
        supportSourceTypes: ['endpoint', 'http_call'],
      },
    })

    const recommendation = deriveScenarioDraftPromotionRecommendation(
      draft,
      [requirement('graph_readiness_fully_mapped', 'Graph readiness is partially_mapped; missing capabilities: fillCustomerEmail.')],
      false,
      false,
    )

    expect(recommendation).toEqual(expect.objectContaining({
      priority: 'normal',
      action: 'review',
      structurallyPromotable: false,
      summary: expect.stringContaining('missing capabilities: fillCustomerEmail'),
    }))
  })

  it('keeps structurally shallow drafts in review even when graph mapping is fully mapped', () => {
    const draft = createDraft({
      status: 'pending',
      graphReadiness: {
        status: 'fully_mapped',
        confidence: 0.91,
        requiredCapabilityCount: 1,
        mappedCapabilityCount: 1,
        mappedCapabilityIds: ['callPrimaryEndpoint'],
        missingCapabilityIds: [],
        supportSourceTypes: ['endpoint'],
        supportEndpointCount: 1,
        supportHandlerCount: 0,
        supportHttpCallCount: 0,
        supportDataAccessCount: 0,
      },
    })

    const recommendation = deriveScenarioDraftPromotionRecommendation(
      draft,
      [requirement('graph_evidence_depth', 'Graph evidence is too shallow (handlers=0, endpoints=1, http=0, data=0).')],
      false,
      false,
    )

    expect(recommendation).toEqual(expect.objectContaining({
      priority: 'normal',
      action: 'review',
      structurallyPromotable: false,
      summary: expect.stringContaining('Graph evidence is too shallow'),
    }))
  })

  it('recommends promote for approved drafts that are structurally promotion-ready', () => {
    const draft = createDraft({
      status: 'approved',
      graphReadiness: {
        status: 'fully_mapped',
        confidence: 0.88,
        requiredCapabilityCount: 2,
        mappedCapabilityCount: 2,
        mappedCapabilityIds: ['fillCustomerEmail', 'submitOrder'],
        missingCapabilityIds: [],
        supportSourceTypes: ['component', 'http_call'],
        supportHandlerCount: 1,
        supportHttpCallCount: 1,
      },
    })

    const recommendation = deriveScenarioDraftPromotionRecommendation(draft, [], true, true)

    expect(recommendation).toEqual(expect.objectContaining({
      priority: 'critical',
      action: 'promote',
      structurallyPromotable: true,
      summary: expect.stringContaining('Structurally promotion-ready'),
    }))
  })
})

function createDraft(input: {
  status: ScenarioDraft['status']
  graphReadiness: Record<string, unknown>
}): ScenarioDraft {
  return {
    id: 'draft-1',
    scenarioId: 'domain_commerce_readiness',
    name: 'Domain draft',
    description: 'Generated from domain discovery',
    status: input.status,
    gapType: 'domain_discovery_mapping',
    createdAt: '2026-04-28T00:00:00.000Z',
    updatedAt: '2026-04-28T00:00:00.000Z',
    contract: {
      id: 'domain_commerce_readiness',
      name: 'Readiness',
      steps: [],
      domainDiscovery: {
        sourceDomain: 'commerce',
        sourceScenarioId: 'place_order',
        mappingRequired: true,
        graphReadiness: {
          supportEndpointCount: 0,
          supportHandlerCount: 0,
          supportHttpCallCount: 0,
          supportDataAccessCount: 0,
          ...input.graphReadiness,
        },
        mappingReview: {
          selectorsMapped: true,
          authMapped: true,
          testDataMapped: true,
          assertionsMapped: true,
          reviewedBy: 'qa_lead',
          reviewedAt: '2026-04-28T00:00:00.000Z',
          notes: 'Ready',
        },
      },
    },
  }
}

function requirement(id: string, detail: string): ScenarioDraftPromotionRequirement {
  return {
    id,
    label: id,
    status: 'blocked',
    blocking: true,
    detail,
  }
}

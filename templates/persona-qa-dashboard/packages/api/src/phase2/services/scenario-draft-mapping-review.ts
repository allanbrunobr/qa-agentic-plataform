import type { ScenarioDraft } from './session-service.js'

export interface ScenarioDraftMappingReview {
  selectorsMapped: boolean
  authMapped: boolean
  testDataMapped: boolean
  assertionsMapped: boolean
  reviewedBy: string | null
  reviewedAt: string | null
  notes: string | null
}

export interface ScenarioDraftMappingReviewPatch {
  selectorsMapped?: boolean
  authMapped?: boolean
  testDataMapped?: boolean
  assertionsMapped?: boolean
  reviewedBy?: string
  notes?: string
}

export const DOMAIN_MAPPING_REVIEW_REQUIREMENTS = [
  'selectors_mapped',
  'auth_mapped',
  'test_data_mapped',
  'assertions_mapped',
]

export function getDomainDiscoveryContract(draft: ScenarioDraft): Record<string, unknown> | null {
  const candidate = draft.contract['domainDiscovery']
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : null
}

export function requiresDomainMappingReview(draft: ScenarioDraft): boolean {
  const domainDiscovery = getDomainDiscoveryContract(draft)
  return Boolean(domainDiscovery && domainDiscovery['mappingRequired'] !== false)
}

export function getScenarioDraftMappingReview(draft: ScenarioDraft): ScenarioDraftMappingReview {
  const domainDiscovery = getDomainDiscoveryContract(draft)
  const candidate = domainDiscovery?.['mappingReview']
  const review = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : {}

  return {
    selectorsMapped: review['selectorsMapped'] === true,
    authMapped: review['authMapped'] === true,
    testDataMapped: review['testDataMapped'] === true,
    assertionsMapped: review['assertionsMapped'] === true,
    reviewedBy: typeof review['reviewedBy'] === 'string' ? review['reviewedBy'] : null,
    reviewedAt: typeof review['reviewedAt'] === 'string' ? review['reviewedAt'] : null,
    notes: typeof review['notes'] === 'string' ? review['notes'] : null,
  }
}

export function isScenarioDraftMappingReviewComplete(draft: ScenarioDraft): boolean {
  if (!requiresDomainMappingReview(draft)) return true
  const review = getScenarioDraftMappingReview(draft)
  return review.selectorsMapped
    && review.authMapped
    && review.testDataMapped
    && review.assertionsMapped
    && Boolean(review.reviewedBy)
}

export function applyScenarioDraftMappingReview(
  draft: ScenarioDraft,
  patch: ScenarioDraftMappingReviewPatch,
): { contract: Record<string, unknown>; mappingReview: ScenarioDraftMappingReview } {
  const domainDiscovery = getDomainDiscoveryContract(draft)
  if (!domainDiscovery) {
    throw new Error('Scenario draft is not backed by domain discovery')
  }

  const current = getScenarioDraftMappingReview(draft)
  const mappingReview: ScenarioDraftMappingReview = {
    selectorsMapped: patch.selectorsMapped ?? current.selectorsMapped,
    authMapped: patch.authMapped ?? current.authMapped,
    testDataMapped: patch.testDataMapped ?? current.testDataMapped,
    assertionsMapped: patch.assertionsMapped ?? current.assertionsMapped,
    reviewedBy: patch.reviewedBy ?? current.reviewedBy,
    reviewedAt: patch.reviewedBy ? new Date().toISOString() : current.reviewedAt,
    notes: patch.notes ?? current.notes,
  }

  return {
    mappingReview,
    contract: {
      ...draft.contract,
      domainDiscovery: {
        ...domainDiscovery,
        mappingReview,
      },
    },
  }
}


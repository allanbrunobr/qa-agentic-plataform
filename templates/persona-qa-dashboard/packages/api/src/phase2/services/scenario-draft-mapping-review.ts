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

export interface ScenarioDraftGraphReadiness {
  status: string
  confidence: number
  requiredCapabilityCount: number
  mappedCapabilityCount: number
  mappedCapabilityIds: string[]
  missingCapabilityIds: string[]
  supportSourceTypes: string[]
  supportEndpointCount: number
  supportHandlerCount: number
  supportHttpCallCount: number
  supportDataAccessCount: number
}

export const DOMAIN_MAPPING_REVIEW_REQUIREMENTS = [
  'selectors_mapped',
  'auth_mapped',
  'test_data_mapped',
  'assertions_mapped',
]

export const GRAPH_READINESS_REQUIREMENTS = [
  'graph_readiness_fully_mapped',
  'graph_evidence_depth',
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

export function getScenarioDraftGraphReadiness(draft: ScenarioDraft): ScenarioDraftGraphReadiness | null {
  const domainDiscovery = getDomainDiscoveryContract(draft)
  const candidate = domainDiscovery?.['graphReadiness']
  const readiness = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : null
  if (!readiness) return null

  return {
    status: typeof readiness['status'] === 'string' ? readiness['status'] : 'unmapped',
    confidence: typeof readiness['confidence'] === 'number' ? readiness['confidence'] : 0,
    requiredCapabilityCount: typeof readiness['requiredCapabilityCount'] === 'number' ? readiness['requiredCapabilityCount'] : 0,
    mappedCapabilityCount: typeof readiness['mappedCapabilityCount'] === 'number' ? readiness['mappedCapabilityCount'] : 0,
    mappedCapabilityIds: readStringList(readiness['mappedCapabilityIds']),
    missingCapabilityIds: readStringList(readiness['missingCapabilityIds']),
    supportSourceTypes: readStringList(readiness['supportSourceTypes']),
    supportEndpointCount: readNumber(readiness['supportEndpointCount']),
    supportHandlerCount: readNumber(readiness['supportHandlerCount']),
    supportHttpCallCount: readNumber(readiness['supportHttpCallCount']),
    supportDataAccessCount: readNumber(readiness['supportDataAccessCount']),
  }
}

export function requiresGraphReadinessGate(draft: ScenarioDraft): boolean {
  return Boolean(getScenarioDraftGraphReadiness(draft))
}

export function isScenarioDraftGraphReady(draft: ScenarioDraft): boolean {
  const readiness = getScenarioDraftGraphReadiness(draft)
  if (!readiness) return true
  return readiness.status === 'fully_mapped'
    && readiness.requiredCapabilityCount > 0
    && readiness.mappedCapabilityCount === readiness.requiredCapabilityCount
    && hasScenarioDraftGraphStructuralEvidence(readiness)
}

export function hasScenarioDraftGraphStructuralEvidence(readiness: ScenarioDraftGraphReadiness): boolean {
  const supportTypes = new Set(readiness.supportSourceTypes)
  const endpointCount = readiness.supportEndpointCount > 0
    ? readiness.supportEndpointCount
    : supportTypes.has('endpoint') ? 1 : 0
  const handlerCount = readiness.supportHandlerCount > 0
    ? readiness.supportHandlerCount
    : ['function', 'handler', 'service', 'component', 'button', 'form'].some((type) => supportTypes.has(type)) ? 1 : 0
  const httpCallCount = readiness.supportHttpCallCount > 0
    ? readiness.supportHttpCallCount
    : supportTypes.has('http_call') ? 1 : 0
  const dataAccessCount = readiness.supportDataAccessCount > 0
    ? readiness.supportDataAccessCount
    : 0

  if (endpointCount > 0 && handlerCount === 0) return false
  return handlerCount > 0 || endpointCount > 0 || httpCallCount > 0 || dataAccessCount > 0
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

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
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

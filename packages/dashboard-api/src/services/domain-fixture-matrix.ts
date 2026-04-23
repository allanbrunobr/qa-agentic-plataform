import type {
  EvidenceRef,
  FrontendEvidenceKind,
  FrontendSurfaceMap,
} from '../../../host-sdk/src/domain-discovery-contracts.ts'

export type DomainFixtureId =
  | 'finance_operations'
  | 'education_learning'
  | 'commerce_checkout'
  | 'support_service'
  | 'retail_care'
  | 'technology_delivery'

export interface DomainFixtureExpectation {
  id: DomainFixtureId
  domain: string
  label: string
  description: string
  requiredFrameworks?: string[]
  requiredPackages?: string[]
  requiredRoutes?: string[]
  requiredNavigationTargets?: string[]
  requiredButtonTexts?: string[]
  requiredTextIncludes?: string[]
  requiredTestIncludes?: string[]
  requiredFormFieldGroups?: string[][]
  minCounts?: Partial<Record<FrontendEvidenceKind, number>>
  expectedPersonaSeeds: string[]
  expectedScenarioSeeds: string[]
  expectedCapabilityKinds: string[]
}

export interface DomainFixtureMissingExpectation {
  category: string
  expected: string
  reason: string
}

export interface DomainFixtureEvaluation {
  fixtureId: DomainFixtureId
  domain: string
  targetId: string
  passed: boolean
  counts: Record<FrontendEvidenceKind, number>
  missing: DomainFixtureMissingExpectation[]
  matchedEvidenceRefs: EvidenceRef[]
  expectedPersonaSeeds: string[]
  expectedScenarioSeeds: string[]
  expectedCapabilityKinds: string[]
}

export const DOMAIN_FIXTURE_MATRIX: DomainFixtureExpectation[] = [
  {
    id: 'finance_operations',
    domain: 'finance',
    label: 'Finance operations frontend',
    description: 'Portfolio review and transfer workflow for account holders.',
    requiredFrameworks: ['vite', 'react'],
    requiredPackages: ['react', 'react-router-dom'],
    requiredRoutes: ['/portfolio', '/transfers'],
    requiredNavigationTargets: ['/portfolio', '/transfers'],
    requiredButtonTexts: ['Submit transfer'],
    requiredTextIncludes: ['portfolio balance', 'transfer funds'],
    requiredTestIncludes: ['transfer funds'],
    requiredFormFieldGroups: [['amount', 'destinationAccount']],
    minCounts: { route: 2, form: 1, button: 2, text: 3, navigation: 2, test: 1 },
    expectedPersonaSeeds: ['account_holder', 'finance_operator'],
    expectedScenarioSeeds: ['review_portfolio', 'transfer_funds'],
    expectedCapabilityKinds: ['navigation', 'form_submit', 'assertion'],
  },
  {
    id: 'education_learning',
    domain: 'education',
    label: 'Education learning frontend',
    description: 'Course catalog and assignment workflow for learners and staff.',
    requiredFrameworks: ['nextjs', 'react'],
    requiredPackages: ['next', 'react'],
    requiredRoutes: ['/assignments', '/courses'],
    requiredNavigationTargets: ['/assignments'],
    requiredButtonTexts: ['Enroll student'],
    requiredTextIncludes: ['course catalog', 'assignment queue'],
    requiredTestIncludes: ['enroll student'],
    requiredFormFieldGroups: [['studentEmail', 'courseCode']],
    minCounts: { route: 2, form: 1, button: 1, text: 2, navigation: 1, test: 1 },
    expectedPersonaSeeds: ['student', 'course_coordinator'],
    expectedScenarioSeeds: ['enroll_in_course', 'review_assignments'],
    expectedCapabilityKinds: ['navigation', 'form_submit', 'assertion'],
  },
  {
    id: 'commerce_checkout',
    domain: 'commerce',
    label: 'Commerce checkout frontend',
    description: 'Product discovery and checkout workflow for online shoppers.',
    requiredFrameworks: ['vite', 'vue'],
    requiredPackages: ['vue'],
    requiredNavigationTargets: ['/checkout', '/products'],
    requiredButtonTexts: ['Place order'],
    requiredTextIncludes: ['product catalog', 'checkout details'],
    requiredTestIncludes: ['place order'],
    requiredFormFieldGroups: [['customerEmail', 'shippingAddress']],
    minCounts: { form: 1, button: 1, text: 2, navigation: 2, test: 1 },
    expectedPersonaSeeds: ['shopper', 'store_operator'],
    expectedScenarioSeeds: ['browse_products', 'place_order'],
    expectedCapabilityKinds: ['navigation', 'form_submit', 'assertion'],
  },
  {
    id: 'support_service',
    domain: 'support',
    label: 'Customer support frontend',
    description: 'Ticket triage and escalation workflow for support teams.',
    requiredFrameworks: ['svelte'],
    requiredPackages: ['svelte'],
    requiredNavigationTargets: ['/knowledge-base'],
    requiredButtonTexts: ['Escalate ticket'],
    requiredTextIncludes: ['support ticket queue', 'service level'],
    requiredTestIncludes: ['escalate ticket'],
    requiredFormFieldGroups: [['ticketId', 'priority', 'customerEmail']],
    minCounts: { form: 1, button: 1, text: 2, navigation: 1, test: 1 },
    expectedPersonaSeeds: ['support_agent', 'customer'],
    expectedScenarioSeeds: ['triage_ticket', 'escalate_ticket'],
    expectedCapabilityKinds: ['navigation', 'form_submit', 'assertion'],
  },
  {
    id: 'retail_care',
    domain: 'retail',
    label: 'Retail care frontend',
    description: 'Care plan and order workflow for operational staff.',
    requiredFrameworks: ['angular'],
    requiredPackages: ['@angular/core'],
    requiredNavigationTargets: ['/records'],
    requiredButtonTexts: ['Schedule order'],
    requiredTextIncludes: ['care plan workspace', 'customer records'],
    requiredTestIncludes: ['schedule order'],
    requiredFormFieldGroups: [['customerName', 'orderDate']],
    minCounts: { form: 1, button: 1, text: 2, navigation: 1, test: 1 },
    expectedPersonaSeeds: ['care_coordinator', 'customer'],
    expectedScenarioSeeds: ['review_care_plan', 'schedule_order'],
    expectedCapabilityKinds: ['navigation', 'form_submit', 'assertion'],
  },
  {
    id: 'technology_delivery',
    domain: 'technology',
    label: 'Technology delivery frontend',
    description: 'Deployment control and incident workflow for delivery teams.',
    requiredFrameworks: ['generic_frontend'],
    requiredRoutes: ['/'],
    requiredNavigationTargets: ['/incidents'],
    requiredButtonTexts: ['Promote release'],
    requiredTextIncludes: ['deployment control center', 'feature flag review'],
    requiredFormFieldGroups: [['environment', 'version']],
    minCounts: { route: 1, form: 1, button: 1, text: 2, navigation: 1 },
    expectedPersonaSeeds: ['release_manager', 'incident_responder'],
    expectedScenarioSeeds: ['promote_release', 'review_incident'],
    expectedCapabilityKinds: ['navigation', 'form_submit', 'assertion'],
  },
]

export function getDomainFixtureExpectation(id: DomainFixtureId): DomainFixtureExpectation {
  const expectation = DOMAIN_FIXTURE_MATRIX.find((candidate) => candidate.id === id)
  if (!expectation) throw new Error(`Unknown domain fixture expectation: ${id}`)
  return expectation
}

export function evaluateDomainFixture(
  surfaceMap: FrontendSurfaceMap,
  expectation: DomainFixtureExpectation,
): DomainFixtureEvaluation {
  const missing: DomainFixtureMissingExpectation[] = []
  const matched = new Map<string, EvidenceRef>()
  const counts = countSurfaceEvidence(surfaceMap)

  for (const [kind, minimum] of Object.entries(expectation.minCounts ?? {}) as Array<[FrontendEvidenceKind, number]>) {
    if (counts[kind] < minimum) {
      missing.push({
        category: kind,
        expected: `at least ${minimum}`,
        reason: `Scanner found ${counts[kind]} ${kind} evidence item(s).`,
      })
    }
  }

  requireMatches({
    category: 'framework',
    expected: expectation.requiredFrameworks,
    values: surfaceMap.frameworks.map((item) => item.frameworkName),
    evidence: surfaceMap.frameworks,
    matched,
    missing,
  })
  requireMatches({
    category: 'package',
    expected: expectation.requiredPackages,
    values: surfaceMap.packages.map((item) => item.packageName),
    evidence: surfaceMap.packages,
    matched,
    missing,
  })
  requireMatches({
    category: 'route',
    expected: expectation.requiredRoutes,
    values: surfaceMap.routes.map((item) => item.path),
    evidence: surfaceMap.routes,
    matched,
    missing,
    exact: true,
  })
  requireMatches({
    category: 'navigation',
    expected: expectation.requiredNavigationTargets,
    values: surfaceMap.navigation.map((item) => item.targetPath ?? item.extractedText),
    evidence: surfaceMap.navigation,
    matched,
    missing,
    exact: true,
  })
  requireMatches({
    category: 'button',
    expected: expectation.requiredButtonTexts,
    values: surfaceMap.buttons.map((item) => item.buttonText),
    evidence: surfaceMap.buttons,
    matched,
    missing,
  })
  requireMatches({
    category: 'test',
    expected: expectation.requiredTestIncludes,
    values: surfaceMap.tests.map((item) => item.testName),
    evidence: surfaceMap.tests,
    matched,
    missing,
  })
  requireTextMatches(surfaceMap, expectation.requiredTextIncludes, matched, missing)
  requireFormFieldGroups(surfaceMap, expectation.requiredFormFieldGroups, matched, missing)

  return {
    fixtureId: expectation.id,
    domain: expectation.domain,
    targetId: surfaceMap.targetId,
    passed: missing.length === 0,
    counts,
    missing,
    matchedEvidenceRefs: Array.from(matched.values()),
    expectedPersonaSeeds: [...expectation.expectedPersonaSeeds],
    expectedScenarioSeeds: [...expectation.expectedScenarioSeeds],
    expectedCapabilityKinds: [...expectation.expectedCapabilityKinds],
  }
}

export function evaluateDomainFixtureMatrix(
  surfaceMaps: Partial<Record<DomainFixtureId, FrontendSurfaceMap>>,
): DomainFixtureEvaluation[] {
  return DOMAIN_FIXTURE_MATRIX.map((expectation) => {
    const surfaceMap = surfaceMaps[expectation.id]
    if (!surfaceMap) {
      return {
        fixtureId: expectation.id,
        domain: expectation.domain,
        targetId: expectation.id,
        passed: false,
        counts: emptyCounts(),
        missing: [{
          category: 'fixture',
          expected: expectation.id,
          reason: 'No frontend surface map was provided for this domain fixture.',
        }],
        matchedEvidenceRefs: [],
        expectedPersonaSeeds: [...expectation.expectedPersonaSeeds],
        expectedScenarioSeeds: [...expectation.expectedScenarioSeeds],
        expectedCapabilityKinds: [...expectation.expectedCapabilityKinds],
      }
    }
    return evaluateDomainFixture(surfaceMap, expectation)
  })
}

function requireMatches(input: {
  category: string
  expected?: string[]
  values: string[]
  evidence: Array<{ id: string; kind: FrontendEvidenceKind }>
  matched: Map<string, EvidenceRef>
  missing: DomainFixtureMissingExpectation[]
  exact?: boolean
}) {
  for (const expected of input.expected ?? []) {
    const index = input.values.findIndex((value) => matches(value, expected, input.exact))
    if (index >= 0) {
      addMatch(input.matched, input.evidence[index])
      continue
    }
    input.missing.push({
      category: input.category,
      expected,
      reason: `No ${input.category} evidence matched "${expected}".`,
    })
  }
}

function requireTextMatches(
  surfaceMap: FrontendSurfaceMap,
  expected: string[] | undefined,
  matched: Map<string, EvidenceRef>,
  missing: DomainFixtureMissingExpectation[],
) {
  const evidence = [
    ...surfaceMap.texts,
    ...surfaceMap.forms,
    ...surfaceMap.buttons,
    ...surfaceMap.navigation,
  ]

  for (const term of expected ?? []) {
    const item = evidence.find((candidate) => matches(candidate.extractedText, term))
    if (item) {
      addMatch(matched, item)
      continue
    }
    missing.push({
      category: 'text',
      expected: term,
      reason: `No visible text evidence included "${term}".`,
    })
  }
}

function requireFormFieldGroups(
  surfaceMap: FrontendSurfaceMap,
  groups: string[][] | undefined,
  matched: Map<string, EvidenceRef>,
  missing: DomainFixtureMissingExpectation[],
) {
  for (const group of groups ?? []) {
    const form = surfaceMap.forms.find((candidate) => {
      const searchable = normalize([
        candidate.actionName ?? '',
        candidate.extractedText,
        ...candidate.fields,
      ].join(' '))
      return group.every((field) => searchable.includes(normalize(field)))
    })

    if (form) {
      addMatch(matched, form)
      continue
    }
    missing.push({
      category: 'form',
      expected: group.join(', '),
      reason: 'No single form evidence item contained all required fields.',
    })
  }
}

function countSurfaceEvidence(surfaceMap: FrontendSurfaceMap): Record<FrontendEvidenceKind, number> {
  return {
    route: surfaceMap.routes.length,
    component: surfaceMap.components.length,
    form: surfaceMap.forms.length,
    button: surfaceMap.buttons.length,
    text: surfaceMap.texts.length,
    navigation: surfaceMap.navigation.length,
    package: surfaceMap.packages.length,
    framework: surfaceMap.frameworks.length,
    test: surfaceMap.tests.length,
  }
}

function emptyCounts(): Record<FrontendEvidenceKind, number> {
  return {
    route: 0,
    component: 0,
    form: 0,
    button: 0,
    text: 0,
    navigation: 0,
    package: 0,
    framework: 0,
    test: 0,
  }
}

function matches(value: string | undefined, expected: string, exact = false) {
  if (!value) return false
  return exact ? normalize(value) === normalize(expected) : normalize(value).includes(normalize(expected))
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function addMatch(matched: Map<string, EvidenceRef>, item: { id: string; kind: FrontendEvidenceKind } | undefined) {
  if (!item) return
  matched.set(`${item.kind}:${item.id}`, { evidenceId: item.id, kind: item.kind })
}

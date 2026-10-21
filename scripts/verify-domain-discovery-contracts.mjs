import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const tsxLoaderCandidates = [
  path.join(repoRoot, 'node_modules/tsx/dist/loader.mjs'),
  path.join(repoRoot, 'templates/persona-qa-dashboard/node_modules/tsx/dist/loader.mjs'),
]
const tsxLoader = tsxLoaderCandidates.find((candidate) => fs.existsSync(candidate))
const preferredNodeBin = process.env.AGENTIC_RELEASE_NODE_BIN
  ?? path.dirname(process.execPath)
const preferredNodePath = path.join(preferredNodeBin, 'node')
const nodePath = fs.existsSync(preferredNodePath) ? preferredNodePath : process.execPath

function log(message) {
  process.stdout.write(`[verify-domain-discovery-contracts] ${message}\n`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

try {
  assert(tsxLoader, 'tsx loader not found; install dependencies before running domain discovery contract verification')

  const verificationCode = `
    import {
      CapabilityCandidateSchema,
      DiscoveryAuditSchema,
      DomainInferenceSchema,
      FrontendSurfaceMapSchema,
      MAX_EXTRACTED_TEXT_CHARS,
      MAX_SURFACE_EVIDENCE_ITEMS_PER_KIND,
      PersonaCandidateSchema,
      ScenarioCandidateSchema,
      assertEvidenceRefsExist,
      findMissingEvidenceRefs,
      normalizeFrontendSurfaceMap,
    } from './packages/host-sdk/src/domain-discovery-contracts.ts'

    function assert(condition, message) {
      if (!condition) throw new Error(message)
    }

    function assertRejects(label, fn) {
      let rejected = false
      try {
        fn()
      } catch {
        rejected = true
      }
      assert(rejected, label + ' should reject invalid input')
    }

    const source = { filePath: 'src/App.tsx', line: 10, column: 3 }
    const surfaceMapInput = {
      targetId: 'finance-dashboard',
      routes: [{ id: 'route_dashboard', kind: 'route', source, path: '/dashboard', label: 'Dashboard', extractedText: 'Portfolio dashboard' }],
      components: [{ id: 'component_portfolio', kind: 'component', source, componentName: 'PortfolioSummary', extractedText: 'Portfolio balance' }],
      forms: [{ id: 'form_transfer', kind: 'form', source, fields: ['amount', 'destination'], actionName: 'submitTransfer', extractedText: 'Transfer funds' }],
      buttons: [{ id: 'button_submit_transfer', kind: 'button', source, buttonText: 'Transfer', nearbyFormId: 'form_transfer', extractedText: 'Transfer' }],
      texts: [{ id: 'text_balance', kind: 'text', source, textRole: 'heading', extractedText: 'Current balance' }],
      navigation: [{ id: 'nav_accounts', kind: 'navigation', source, targetPath: '/accounts', extractedText: 'Accounts' }],
      packages: [{ id: 'pkg_react', kind: 'package', source: { filePath: 'package.json' }, packageName: 'react', versionRange: '^18.0.0', extractedText: 'react' }],
      frameworks: [{ id: 'framework_vite', kind: 'framework', source: { filePath: 'package.json' }, frameworkName: 'vite', extractedText: 'vite' }],
      tests: [{ id: 'test_transfer_flow', kind: 'test', source: { filePath: 'tests/transfer.spec.ts' }, testName: 'transfer funds', tool: 'playwright', extractedText: 'transfers funds' }],
    }

    const surfaceMap = FrontendSurfaceMapSchema.parse(surfaceMapInput)
    assert(surfaceMap.schemaVersion === 'domain-discovery/v1', 'schema version should default')
    assert(surfaceMap.forms[0].source.filePath === 'src/App.tsx', 'source location should be preserved')
    assert(surfaceMap.forms[0].extractedText === 'Transfer funds', 'extracted text should be stored separately')

    const evidenceRefs = [{ evidenceId: 'route_dashboard', kind: 'route' }, { evidenceId: 'form_transfer', kind: 'form' }]
    const domain = DomainInferenceSchema.parse({
      domain: 'finance',
      summary: 'Portfolio and transfer workflow evidence indicates a finance frontend.',
      confidence: 0.82,
      evidenceRefs,
      status: 'draft',
      risks: [{ id: 'auth_unknown', severity: 'medium', reason: 'Authentication flow is not mapped yet.' }],
      entities: [{
        id: 'entity_transfer',
        name: 'Transfer',
        kind: 'transaction',
        confidence: 0.76,
        evidenceRefs: [{ evidenceId: 'form_transfer', kind: 'form' }],
      }],
    })
    assert(domain.entities.length === 1, 'domain entities should parse')

    PersonaCandidateSchema.parse({
      id: 'account_holder',
      title: 'Account Holder',
      rationale: 'Uses visible balance and transfer UI.',
      goals: ['Review balance', 'Submit transfer'],
      allowedCapabilityIds: ['submit_transfer'],
      confidence: 0.78,
      evidenceRefs,
      status: 'draft',
    })

    ScenarioCandidateSchema.parse({
      id: 'transfer_funds_draft',
      title: 'Transfer funds draft',
      rationale: 'Connects dashboard route to transfer form evidence.',
      participatingPersonaIds: ['account_holder'],
      requiredCapabilityIds: ['submit_transfer'],
      confidence: 0.72,
      evidenceRefs,
      status: 'needs_human_mapping',
      steps: [{
        id: 'open_dashboard',
        title: 'Open dashboard',
        intent: 'Reach the portfolio dashboard.',
        capabilityId: 'open_dashboard',
        evidenceRefs: [{ evidenceId: 'route_dashboard', kind: 'route' }],
      }],
    })

    CapabilityCandidateSchema.parse({
      id: 'submit_transfer',
      title: 'Submit transfer',
      purpose: 'Submit the transfer form.',
      kind: 'form_submit',
      mappedSurfaceIds: ['form_transfer'],
      selectorHints: ['button:has-text("Transfer")'],
      confidence: 0.7,
      evidenceRefs: [{ evidenceId: 'form_transfer', kind: 'form' }],
      status: 'needs_human_mapping',
    })

    DiscoveryAuditSchema.parse({
      id: 'audit_finance_dashboard',
      summary: 'Generated output is evidence-backed but not runnable until auth and selectors are mapped.',
      confidence: 0.8,
      evidenceRefs,
      status: 'restricted',
      findings: [{
        id: 'missing_auth',
        severity: 'warning',
        message: 'Authentication is not mapped.',
        candidateIds: ['transfer_funds_draft'],
        evidenceRefs: [{ evidenceId: 'route_dashboard', kind: 'route' }],
      }],
      downgradedCandidateIds: ['transfer_funds_draft'],
    })

    assertRejects('persona evidence requirement', () => PersonaCandidateSchema.parse({
      id: 'unsupported_user',
      title: 'Unsupported User',
      rationale: 'No evidence.',
      goals: ['Do something'],
      confidence: 0.4,
      evidenceRefs: [],
      status: 'draft',
    }))

    assertRejects('scenario evidence requirement', () => ScenarioCandidateSchema.parse({
      id: 'unsupported_scenario',
      title: 'Unsupported scenario',
      rationale: 'No evidence.',
      participatingPersonaIds: ['unsupported_user'],
      confidence: 0.4,
      evidenceRefs: [],
      status: 'draft',
      steps: [],
    }))

    assertRejects('unknown status', () => DomainInferenceSchema.parse({
      domain: 'finance',
      summary: 'Invalid status should fail.',
      confidence: 0.5,
      evidenceRefs,
      status: 'complete',
    }))

    const oversizedText = 'x'.repeat(MAX_EXTRACTED_TEXT_CHARS + 25)
    assertRejects('oversized evidence raw parse', () => FrontendSurfaceMapSchema.parse({
      targetId: 'oversized',
      routes: [{ id: 'route_big', kind: 'route', source, path: '/', extractedText: oversizedText }],
    }))

    const manyRoutes = Array.from({ length: MAX_SURFACE_EVIDENCE_ITEMS_PER_KIND + 5 }, (_, index) => ({
      id: 'route_' + index,
      kind: 'route',
      source,
      path: '/' + index,
      extractedText: oversizedText,
    }))
    const normalized = normalizeFrontendSurfaceMap({ targetId: 'normalized', routes: manyRoutes })
    assert(normalized.routes.length === MAX_SURFACE_EVIDENCE_ITEMS_PER_KIND, 'normalizer should cap evidence count')
    assert(normalized.routes[0].extractedText.length === MAX_EXTRACTED_TEXT_CHARS, 'normalizer should truncate extracted text')

    const missing = findMissingEvidenceRefs(surfaceMap, [{ evidenceId: 'missing_button', kind: 'button' }])
    assert(missing.length === 1, 'missing evidence references should be detected')
    assertRejects('missing evidence assertion', () => assertEvidenceRefsExist(surfaceMap, missing, 'fixture'))
  `

  log('START schema validation')
  const result = spawnSync(nodePath, ['--import', tsxLoader, '--input-type=module', '-e', verificationCode], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  assert(result.status === 0, `schema validation failed with status ${result.status}`)
  log('PASS domain discovery contract verification')
} catch (error) {
  process.stderr.write(`[verify-domain-discovery-contracts] FAIL ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
}

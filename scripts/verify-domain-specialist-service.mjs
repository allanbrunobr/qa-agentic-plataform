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
  process.stdout.write(`[verify-domain-specialist-service] ${message}\n`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

try {
  assert(tsxLoader, 'tsx loader not found; install dependencies before running domain specialist verification')

  const verificationCode = `
    import {
      DomainDiscoveryBundleSchema,
      FrontendSurfaceMapSchema,
      findMissingEvidenceRefs,
    } from './packages/host-sdk/src/domain-discovery-contracts.ts'
    import { inferDomainDiscoveryBundle } from './packages/dashboard-api/src/services/domain-specialist-service.ts'

    function assert(condition, message) {
      if (!condition) throw new Error(message)
    }

    function refsFromBundle(bundle) {
      return [
        ...bundle.domain.evidenceRefs,
        ...bundle.personas.flatMap((persona) => persona.evidenceRefs),
        ...bundle.scenarios.flatMap((scenario) => [
          ...scenario.evidenceRefs,
          ...scenario.steps.flatMap((step) => step.evidenceRefs),
        ]),
        ...bundle.capabilities.flatMap((capability) => capability.evidenceRefs),
        ...(bundle.audit?.evidenceRefs ?? []),
        ...(bundle.audit?.findings ?? []).flatMap((finding) => finding.evidenceRefs ?? []),
      ]
    }

    const source = { filePath: 'src/App.tsx', line: 1 }
    const financeSurface = FrontendSurfaceMapSchema.parse({
      targetId: 'finance-fixture',
      routes: [
        { id: 'route_portfolio', kind: 'route', source, path: '/portfolio', label: 'Portfolio', extractedText: 'Portfolio dashboard' },
        { id: 'route_transfers', kind: 'route', source, path: '/transfers', label: 'Transfers', extractedText: 'Transfer funds' },
      ],
      forms: [{
        id: 'form_transfer',
        kind: 'form',
        source,
        fields: ['amount', 'destinationAccount'],
        actionName: 'submitTransfer',
        extractedText: 'Transfer funds Amount Destination account',
      }],
      buttons: [
        { id: 'button_review', kind: 'button', source, buttonText: 'Review account allocation', extractedText: 'Review account allocation' },
        { id: 'button_submit_transfer', kind: 'button', source, buttonText: 'Submit transfer', extractedText: 'Submit transfer' },
      ],
      texts: [
        { id: 'text_balance', kind: 'text', source, textRole: 'heading', extractedText: 'Portfolio balance' },
        { id: 'text_transfer', kind: 'text', source, textRole: 'heading', extractedText: 'Transfer funds' },
      ],
      navigation: [
        { id: 'nav_portfolio', kind: 'navigation', source, targetPath: '/portfolio', extractedText: 'Portfolio' },
        { id: 'nav_transfers', kind: 'navigation', source, targetPath: '/transfers', extractedText: 'Transfers' },
      ],
      packages: [
        { id: 'pkg_react', kind: 'package', source: { filePath: 'package.json' }, packageName: 'react', extractedText: 'react' },
      ],
      frameworks: [
        { id: 'framework_react', kind: 'framework', source: { filePath: 'package.json' }, frameworkName: 'react', extractedText: 'react' },
      ],
      tests: [
        { id: 'test_transfer', kind: 'test', source: { filePath: 'tests/finance.spec.ts' }, testName: 'transfer funds from portfolio dashboard', tool: 'playwright', extractedText: 'transfer funds from portfolio dashboard' },
      ],
    })

    const financeBundle = inferDomainDiscoveryBundle(financeSurface)
    DomainDiscoveryBundleSchema.parse(financeBundle)
    assert(financeBundle.domain.domain === 'finance', 'finance domain should be inferred')
    assert(financeBundle.domain.entities.some((entity) => entity.id === 'transfer'), 'transfer entity should be inferred')
    assert(financeBundle.personas.some((persona) => persona.id === 'account_holder'), 'account_holder persona should be generated')
    assert(financeBundle.scenarios.some((scenario) => scenario.id === 'submit_financial_operation'), 'finance operation scenario should be generated')
    assert(financeBundle.capabilities.some((capability) => capability.kind === 'form_submit'), 'form_submit capability should be generated')
    assert(financeBundle.scenarios.every((scenario) => scenario.status === 'needs_human_mapping'), 'generated scenarios should remain mapping-gated')
    assert(financeBundle.audit?.status === 'needs_human_mapping', 'finance audit should require human mapping')
    assert(findMissingEvidenceRefs(financeBundle.surfaceMap, refsFromBundle(financeBundle)).length === 0, 'finance bundle should not reference missing evidence')

    const educationSurface = FrontendSurfaceMapSchema.parse({
      targetId: 'education-fixture',
      routes: [
        { id: 'route_courses', kind: 'route', source, path: '/courses', label: 'Courses', extractedText: 'Course catalog' },
        { id: 'route_assignments', kind: 'route', source, path: '/assignments', label: 'Assignments', extractedText: 'Assignment queue' },
      ],
      forms: [{
        id: 'form_enroll',
        kind: 'form',
        source,
        fields: ['studentEmail', 'courseCode'],
        actionName: 'enrollStudent',
        extractedText: 'Enroll student Course code Student email',
      }],
      buttons: [
        { id: 'button_enroll', kind: 'button', source, buttonText: 'Enroll student', extractedText: 'Enroll student' },
      ],
      texts: [
        { id: 'text_courses', kind: 'text', source, textRole: 'heading', extractedText: 'Course catalog' },
        { id: 'text_assignments', kind: 'text', source, textRole: 'heading', extractedText: 'Assignment queue' },
      ],
      navigation: [
        { id: 'nav_assignments', kind: 'navigation', source, targetPath: '/assignments', extractedText: 'Assignments' },
      ],
      packages: [
        { id: 'pkg_next', kind: 'package', source: { filePath: 'package.json' }, packageName: 'next', extractedText: 'next' },
      ],
      frameworks: [
        { id: 'framework_nextjs', kind: 'framework', source: { filePath: 'package.json' }, frameworkName: 'nextjs', extractedText: 'next' },
      ],
      tests: [
        { id: 'test_enroll', kind: 'test', source: { filePath: 'e2e/education.spec.ts' }, testName: 'enroll student into course catalog', tool: 'playwright', extractedText: 'enroll student into course catalog' },
      ],
    })

    const educationBundle = inferDomainDiscoveryBundle(educationSurface)
    assert(educationBundle.domain.domain === 'education', 'education domain should be inferred')
    assert(educationBundle.personas.some((persona) => persona.id === 'student'), 'student persona should be generated')
    assert(educationBundle.scenarios.some((scenario) => scenario.id === 'manage_course_access'), 'course access scenario should be generated')
    assert(findMissingEvidenceRefs(educationBundle.surfaceMap, refsFromBundle(educationBundle)).length === 0, 'education bundle should not reference missing evidence')

    const retailSurface = FrontendSurfaceMapSchema.parse({
      targetId: 'retail-fixture',
      buttons: [
        { id: 'button_start_fulfillment', kind: 'button', source, buttonText: 'Iniciar Pedido', extractedText: 'Iniciar Pedido' },
        { id: 'button_generate_report', kind: 'button', source, buttonText: 'Gerar Relatório', extractedText: 'Gerar Relatório' },
        { id: 'button_end_fulfillment', kind: 'button', source, buttonText: 'Encerrar Pedido', extractedText: 'Encerrar Pedido' },
        { id: 'button_new_fulfillment', kind: 'button', source, buttonText: 'Nova Pedido', extractedText: 'Nova Pedido' },
        { id: 'button_copy_intake', kind: 'button', source, buttonText: 'Copiar Intake', extractedText: 'Copiar Intake' },
        { id: 'button_copy_notes', kind: 'button', source, buttonText: 'Copy Notes note to clipboard', extractedText: 'Copy Notes note to clipboard' },
        { id: 'button_settings', kind: 'button', source, buttonText: 'Settings', extractedText: 'Settings' },
      ],
      texts: [
        { id: 'text_intake', kind: 'text', source, textRole: 'heading', extractedText: 'Intake Estruturada' },
        { id: 'text_report', kind: 'text', source, textRole: 'heading', extractedText: 'Relatório Fulfillment Agent' },
        { id: 'text_notes', kind: 'text', source, textRole: 'heading', extractedText: 'Notes note' },
        { id: 'text_medications', kind: 'text', source, textRole: 'label', extractedText: 'Medicamentos em Uso' },
      ],
      components: [
        { id: 'component_intake_panel', kind: 'component', source, componentName: 'Intake', extractedText: 'Intake' },
        { id: 'component_dispatch_report_modal', kind: 'component', source, componentName: 'DispatchReportModal', extractedText: 'DispatchReportModal' },
      ],
      frameworks: [
        { id: 'framework_vite', kind: 'framework', source: { filePath: 'package.json' }, frameworkName: 'vite', extractedText: 'vite' },
        { id: 'framework_react', kind: 'framework', source: { filePath: 'package.json' }, frameworkName: 'react', extractedText: 'react' },
      ],
      tests: [
        { id: 'test_fulfillment', kind: 'test', source: { filePath: 'tests/fulfillment.spec.ts' }, testName: 'conduct fulfillment and review report', tool: 'playwright', extractedText: 'conduct fulfillment and review report' },
      ],
    })

    const retailBundle = inferDomainDiscoveryBundle(retailSurface)
    assert(retailBundle.domain.domain === 'retail', 'retail domain should be inferred')
    assert(retailBundle.personas.some((persona) => persona.id === 'operator'), 'operator persona should be generated')
    assert(retailBundle.personas.some((persona) => persona.id === 'operational_reviewer'), 'operational reviewer persona should be generated')

    const fulfillmentscenario = retailBundle.scenarios.find((scenario) => scenario.id === 'conduct_fulfillment')
    assert(fulfillmentscenario, 'fulfillment scenario should be generated')
    assert(
      fulfillmentscenario.steps.map((step) => step.capabilityId).join(',') === [
        'click_iniciar_pedido',
        'click_gerar_relat_rio',
        'click_encerrar_pedido',
        'assert_retail_visible_state',
      ].join(','),
      'fulfillment scenario should order start -> generate report -> end -> assert',
    )

    const reviewScenario = retailBundle.scenarios.find((scenario) => scenario.id === 'review_dispatch_report')
    assert(reviewScenario, 'dispatch report review scenario should be generated')
    assert(
      reviewScenario.steps.map((step) => step.capabilityId).join(',') === [
        'click_gerar_relat_rio',
        'click_copiar_intake',
        'click_copy_notes_note_to_clipboard',
        'assert_retail_visible_state',
      ].join(','),
      'review scenario should prefer report/review actions over fulfillment restart actions',
    )

    assert(
      !retailBundle.capabilities.some((capability) => capability.id === 'click_settings'),
      'utility controls should not be promoted into retail capabilities',
    )
    assert(findMissingEvidenceRefs(retailBundle.surfaceMap, refsFromBundle(retailBundle)).length === 0, 'retail bundle should not reference missing evidence')

    const unknownSurface = FrontendSurfaceMapSchema.parse({
      targetId: 'unknown-fixture',
      routes: [
        { id: 'route_root', kind: 'route', source: { filePath: 'index.html' }, path: '/', label: 'Root', extractedText: 'Welcome screen' },
      ],
      texts: [
        { id: 'text_welcome', kind: 'text', source: { filePath: 'index.html' }, textRole: 'heading', extractedText: 'Welcome home' },
      ],
      frameworks: [
        { id: 'framework_generic', kind: 'framework', source: { filePath: 'index.html' }, frameworkName: 'generic_frontend', extractedText: 'Static HTML frontend' },
      ],
    })

    const unknownBundle = inferDomainDiscoveryBundle(unknownSurface)
    assert(unknownBundle.domain.domain === 'unknown', 'weak evidence should fall back to unknown domain')
    assert(unknownBundle.audit?.status === 'restricted', 'unknown domain audit should be restricted')
    assert(unknownBundle.audit?.findings.some((finding) => finding.id === 'domain_not_confirmed'), 'unknown audit should explain weak domain evidence')
    assert(findMissingEvidenceRefs(unknownBundle.surfaceMap, refsFromBundle(unknownBundle)).length === 0, 'unknown bundle should not reference missing evidence')
  `

  log('START domain specialist service')
  const result = spawnSync(nodePath, ['--import', tsxLoader, '--input-type=module', '-e', verificationCode], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  assert(result.status === 0, `domain specialist verification failed with status ${result.status}`)
  log('PASS domain specialist service verification')
} catch (error) {
  process.stderr.write(`[verify-domain-specialist-service] FAIL ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
}

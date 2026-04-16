import type { AdapterExecutionDraft, AdapterModelBundle } from '../../../host-sdk/src/adapter-model.ts'
import type { Session } from '../contracts/session-types.ts'

export type ContractVerdict = 'contract_compliant' | 'contract_drift' | 'contract_violated' | 'contract_evaluating'

export interface StepContractCheck {
  stepId: string
  roleId: string
  expectedCapability: string
  observedTools: string[]
  expectedOrder: number
  observedOrder: number
  status: 'pending' | 'running' | 'complete' | 'failed'
  neverStarted: boolean
  incomplete: boolean
  outOfOrder: boolean
  capabilityMismatch: boolean
  expectedArtifacts: string[]
}

export interface AdapterContractEvaluation {
  verdict: ContractVerdict
  hardViolations: number
  driftSignals: number
  final: boolean
  expectedStepOrder: string[]
  observedStepOrder: string[]
  expectedArtifacts: string[]
  producedArtifacts: string[]
  missingArtifacts: string[]
  unexpectedArtifacts: string[]
  observedUnexpectedSteps: string[]
  stepChecks: StepContractCheck[]
}

function deriveObservedToolsByStep(session: Session): Record<string, string[]> {
  const toolsByStep = new Map<string, string[]>()
  let activeStepId: string | null = null

  for (const event of session.events ?? []) {
    const payload = (event.payload ?? event.data ?? {}) as Record<string, unknown>

    if (event.type === 'step_started') {
      activeStepId = typeof payload.stepId === 'string' ? payload.stepId : null
      continue
    }

    if (event.type === 'tool_call' && activeStepId) {
      const toolName = typeof payload.toolName === 'string' ? payload.toolName : null
      if (!toolName) continue
      const current = toolsByStep.get(activeStepId) ?? []
      current.push(toolName)
      toolsByStep.set(activeStepId, current)
      continue
    }

    if (event.type === 'step_completed' || event.type === 'step_failed') {
      activeStepId = null
    }
  }

  return Object.fromEntries(Array.from(toolsByStep.entries()))
}

function deriveProducedArtifacts(session: Session): string[] {
  const artifactNames = new Set<string>()

  for (const event of session.events ?? []) {
    const payload = (event.payload ?? event.data ?? {}) as Record<string, unknown>
    const produced = payload.producedArtifacts
    if (produced && typeof produced === 'object' && !Array.isArray(produced)) {
      for (const artifactId of Object.keys(produced as Record<string, unknown>)) {
        artifactNames.add(artifactId)
      }
    }
  }

  return Array.from(artifactNames)
}

export function buildAdapterContractEvaluation(
  session: Session,
  execution: AdapterExecutionDraft,
  model: AdapterModelBundle,
): AdapterContractEvaluation | null {
  const scenario = model.scenarios.find((item) => item.id === execution.scenarioId)
  if (!scenario) return null

  const expectedStepOrder = scenario.steps
  const observedStepOrder = (session.events ?? [])
    .filter((event) => event.type === 'step_started')
    .map((event) => String(((event.payload ?? event.data ?? {}) as Record<string, unknown>).stepId ?? ''))
    .filter(Boolean)

  const startedStepIds = new Set(observedStepOrder)
  const completedStepIds = new Set(
    (session.events ?? [])
      .filter((event) => event.type === 'step_completed')
      .map((event) => String(((event.payload ?? event.data ?? {}) as Record<string, unknown>).stepId ?? ''))
      .filter(Boolean),
  )
  const failedStepIds = new Set(
    (session.events ?? [])
      .filter((event) => event.type === 'step_failed')
      .map((event) => String(((event.payload ?? event.data ?? {}) as Record<string, unknown>).stepId ?? ''))
      .filter(Boolean),
  )

  const observedToolsByStep = deriveObservedToolsByStep(session)
  const stepChecks: StepContractCheck[] = expectedStepOrder.map((stepId, index) => {
    const stepDefinition = scenario.stepDefinitions?.find((item) => item.id === stepId)
    const observedTools = observedToolsByStep[stepId] ?? []
    const observedIndex = observedStepOrder.indexOf(stepId)
    const status =
      failedStepIds.has(stepId)
        ? 'failed'
        : completedStepIds.has(stepId)
          ? 'complete'
          : startedStepIds.has(stepId)
            ? 'running'
            : 'pending'

    return {
      stepId,
      roleId: stepDefinition?.roleId ?? 'unknown',
      expectedCapability: stepDefinition?.capabilityId ?? 'unknown',
      observedTools,
      expectedOrder: index,
      observedOrder: observedIndex,
      status,
      neverStarted: status === 'pending' && (session.status === 'complete' || session.status === 'failed'),
      incomplete: status === 'running' && session.status !== 'running' && session.status !== 'pending',
      outOfOrder: observedIndex !== -1 && observedIndex !== index,
      capabilityMismatch:
        observedTools.length > 0 && stepDefinition?.capabilityId
          ? !observedTools.includes(stepDefinition.capabilityId)
          : false,
      expectedArtifacts: stepDefinition?.producesArtifacts ?? [],
    }
  })

  const expectedArtifacts = scenario.expectedArtifacts
  const producedArtifacts = deriveProducedArtifacts(session)
  const isFinalSessionState = session.status === 'complete' || session.status === 'failed'
  const missingArtifacts = expectedArtifacts.filter((artifact) => !producedArtifacts.includes(artifact))
  const blockingMissingArtifacts = isFinalSessionState ? missingArtifacts : []
  const unexpectedArtifacts = producedArtifacts.filter((artifact) => !expectedArtifacts.includes(artifact))
  const observedUnexpectedSteps = observedStepOrder.filter((stepId) => !expectedStepOrder.includes(stepId))

  const hardViolations =
    stepChecks.filter((check) => check.neverStarted).length +
    stepChecks.filter((check) => check.incomplete).length +
    stepChecks.filter((check) => check.status === 'failed').length +
    blockingMissingArtifacts.length

  const driftSignals =
    unexpectedArtifacts.length +
    stepChecks.filter((check) => check.outOfOrder).length +
    observedUnexpectedSteps.length +
    stepChecks.filter((check) => check.capabilityMismatch).length

  const verdict: ContractVerdict =
    !isFinalSessionState
      ? 'contract_evaluating'
      : hardViolations > 0
        ? 'contract_violated'
        : driftSignals > 0
          ? 'contract_drift'
          : 'contract_compliant'

  return {
    verdict,
    hardViolations,
    driftSignals,
    final: isFinalSessionState,
    expectedStepOrder,
    observedStepOrder,
    expectedArtifacts,
    producedArtifacts,
    missingArtifacts,
    unexpectedArtifacts,
    observedUnexpectedSteps,
    stepChecks,
  }
}

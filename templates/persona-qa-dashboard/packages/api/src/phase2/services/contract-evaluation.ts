import { dump } from 'js-yaml';
import { loadScenario } from '../scenarios/index.js';
import type { SessionService } from './session-service.js';

type Session = NonNullable<ReturnType<SessionService['getSession']>>;

function deriveObservedToolsByStep(session: Session): Record<string, string[]> {
  const toolsByStep = new Map<string, string[]>();
  let activeStepId: string | null = null;

  for (const event of session.events) {
    const payload = (event.payload ?? event.data ?? {}) as Record<string, unknown>;

    if (event.type === 'step_started') {
      activeStepId = typeof payload.stepId === 'string' ? payload.stepId : null;
      continue;
    }

    if (event.type === 'tool_call' && activeStepId) {
      const toolName = typeof payload.toolName === 'string' ? payload.toolName : null;
      if (!toolName) continue;
      const current = toolsByStep.get(activeStepId) ?? [];
      current.push(toolName);
      toolsByStep.set(activeStepId, current);
      continue;
    }

    if (event.type === 'step_completed' || event.type === 'step_failed') {
      activeStepId = null;
    }
  }

  return Object.fromEntries(Array.from(toolsByStep.entries()));
}

function capabilityMatchesObservedTools(capabilityId: string, observedTools: string[]): boolean {
  if (observedTools.includes(capabilityId)) return true;

  const compositeCapabilityMap: Record<string, string[]> = {
    validateManagementClosure: ['verifyFinanceDashboard', 'verifyReportsPage'],
  };

  const compositeTools = compositeCapabilityMap[capabilityId];
  if (!compositeTools) return false;

  return compositeTools.every((tool) => observedTools.includes(tool));
}

export function buildContractEvaluation(session: Session) {
  let scenario;
  try {
    scenario = loadScenario(session.scenarioId);
  } catch {
    return {
      workflowContract: null,
      workflowContractYaml: null,
      contractEvaluation: null,
    };
  }
  const workflowContract = scenario.workflowContract ?? null;
  const workflowContractYaml = workflowContract
    ? dump(workflowContract, { noRefs: true, lineWidth: 120, quotingType: "'" })
    : null;

  if (!workflowContract) {
    return {
      workflowContract,
      workflowContractYaml,
      contractEvaluation: null,
    };
  }

  const contractSteps = workflowContract.steps;
  const expectedStepOrder = contractSteps.map((step) => step.id);
  const observedStepOrder = session.events
    .filter((event) => event.type === 'step_started')
    .map((event) => String((event.payload ?? event.data ?? {}).stepId ?? ''))
    .filter(Boolean);
  const startedStepIds = new Set(observedStepOrder);
  const completedStepIds = new Set(
    session.events
      .filter((event) => event.type === 'step_completed')
      .map((event) => String((event.payload ?? event.data ?? {}).stepId ?? ''))
      .filter(Boolean),
  );
  const failedStepIds = new Set(
    session.events
      .filter((event) => event.type === 'step_failed')
      .map((event) => String((event.payload ?? event.data ?? {}).stepId ?? ''))
      .filter(Boolean),
  );
  const observedToolsByStep = deriveObservedToolsByStep(session);

  const stepChecks = contractSteps.map((step) => {
    const observedTools = observedToolsByStep[step.id] ?? [];
    const observedIndex = observedStepOrder.indexOf(step.id);
    const status =
      failedStepIds.has(step.id)
        ? 'failed'
        : completedStepIds.has(step.id)
          ? 'complete'
          : startedStepIds.has(step.id)
            ? 'running'
            : 'pending';

    return {
      stepId: step.id,
      agentId: step.agentId,
      expectedCapability: step.capabilityId,
      observedTools,
      expectedOrder: step.order,
      observedOrder: observedIndex,
      status,
      neverStarted: status === 'pending' && (session.status === 'complete' || session.status === 'failed'),
      incomplete: status === 'running' && session.status !== 'running' && session.status !== 'pending',
      outOfOrder: observedIndex !== -1 && observedIndex !== step.order,
      capabilityMismatch:
        observedTools.length > 0 ? !capabilityMatchesObservedTools(step.capabilityId, observedTools) : false,
      expectedArtifacts: step.producedArtifacts,
    };
  });

  const expectedArtifacts = Array.from(new Set(contractSteps.flatMap((step) => step.producedArtifacts)));
  const producedArtifacts = Object.keys(session.artifacts ?? {});
  const isFinalSessionState = session.status === 'complete' || session.status === 'failed';
  const missingArtifacts = expectedArtifacts.filter((artifact) => !producedArtifacts.includes(artifact));
  const blockingMissingArtifacts = isFinalSessionState ? missingArtifacts : [];
  const unexpectedArtifacts = producedArtifacts.filter((artifact) => !expectedArtifacts.includes(artifact));
  const informationalArtifacts = unexpectedArtifacts;
  const observedUnexpectedSteps = observedStepOrder.filter((stepId) => !expectedStepOrder.includes(stepId));

  const hardViolations =
    stepChecks.filter((check) => check.neverStarted).length +
    stepChecks.filter((check) => check.incomplete).length +
    stepChecks.filter((check) => check.status === 'failed').length +
    blockingMissingArtifacts.length;

  const driftSignals =
    stepChecks.filter((check) => check.outOfOrder).length +
    observedUnexpectedSteps.length +
    stepChecks.filter((check) => check.capabilityMismatch).length;

  const verdict =
    !isFinalSessionState
      ? 'contract_evaluating'
      : hardViolations > 0
      ? 'contract_violated'
      : driftSignals > 0
        ? 'contract_drift'
        : 'contract_compliant';

  return {
    workflowContract,
    workflowContractYaml,
    contractEvaluation: {
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
      informationalArtifacts,
      observedUnexpectedSteps,
      stepChecks,
    },
  };
}

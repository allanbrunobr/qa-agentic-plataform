import { z } from 'zod';
import type { SensorFn } from '../services/sensor-runner.js';

/**
 * Output Sensor: validates agent step output against the agent's outputContract.
 * If the agent profile declares an outputContract schema, validates the step output against it.
 */
export const outputSensor: SensorFn = async (context) => {
  const { stepOutput, agentId, step, session } = context;

  // Try to find outputContract from context — agent profiles provide this
  // For now, validate that the output is a valid record and success flag is consistent
  const errors: string[] = [];
  const availableArtifacts = {
    ...session.artifacts,
    ...stepOutput.output,
  };
  const satisfiedBySessionArtifacts: string[] = [];

  if (stepOutput.success && Object.keys(stepOutput.output).length === 0 && step.producedArtifacts.length > 0) {
    const missingFromAvailableArtifacts = step.producedArtifacts.filter(
      (artifact) => !hasArtifactEvidence(availableArtifacts, artifact),
    );
    if (missingFromAvailableArtifacts.length > 0) {
      errors.push(`Agent "${agentId}" reported success but produced empty output while step requires artifacts: ${step.producedArtifacts.join(', ')}`);
    }
  }

  if (!stepOutput.success && !stepOutput.error) {
    errors.push(`Agent "${agentId}" reported failure without providing an error message`);
  }

  // Validate produced artifacts are present in output
  for (const artifact of step.producedArtifacts) {
    if (!stepOutput.success) continue;
    if (hasArtifactEvidence(stepOutput.output, artifact)) continue;
    if (hasArtifactEvidence(session.artifacts, artifact)) {
      satisfiedBySessionArtifacts.push(artifact);
      continue;
    }
    errors.push(`Agent "${agentId}" did not produce required artifact "${artifact}"`);
  }

  return {
    sensor: 'output',
    status: errors.length === 0 ? 'pass' : 'fail',
    details: {
      agentId,
      outputKeys: Object.keys(stepOutput.output),
      expectedArtifacts: step.producedArtifacts,
      satisfiedBySessionArtifacts,
      errors,
    },
  };
};

function hasArtifactEvidence(artifacts: Record<string, unknown>, artifact: string): boolean {
  if (artifacts[artifact] !== undefined) return true;
  return Object.values(artifacts).some((value) => artifactValueMatches(value, artifact));
}

function artifactValueMatches(value: unknown, artifact: string): boolean {
  if (!value || typeof value !== 'object') return false;

  const record = value as Record<string, unknown>;
  if (record['type'] === artifact) return true;

  const metadata = record['metadata'];
  if (metadata && typeof metadata === 'object') {
    const metadataRecord = metadata as Record<string, unknown>;
    if (metadataRecord['artifactType'] === artifact) return true;
  }

  const content = record['content'];
  if (typeof content !== 'string') return false;

  try {
    const parsed = JSON.parse(content) as unknown;
    return Boolean(parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>)[artifact] !== undefined);
  } catch {
    return false;
  }
}

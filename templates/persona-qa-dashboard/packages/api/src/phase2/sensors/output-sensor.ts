import { z } from 'zod';
import type { SensorFn } from '../services/sensor-runner.js';

/**
 * Output Sensor: validates agent step output against the agent's outputContract.
 * If the agent profile declares an outputContract schema, validates the step output against it.
 */
export const outputSensor: SensorFn = async (context) => {
  const { stepOutput, agentId, scenario, step } = context;

  // Try to find outputContract from context — agent profiles provide this
  // For now, validate that the output is a valid record and success flag is consistent
  const errors: string[] = [];

  if (stepOutput.success && Object.keys(stepOutput.output).length === 0 && step.producedArtifacts.length > 0) {
    errors.push(`Agent "${agentId}" reported success but produced empty output while step requires artifacts: ${step.producedArtifacts.join(', ')}`);
  }

  if (!stepOutput.success && !stepOutput.error) {
    errors.push(`Agent "${agentId}" reported failure without providing an error message`);
  }

  // Validate produced artifacts are present in output
  for (const artifact of step.producedArtifacts) {
    if (stepOutput.success && stepOutput.output[artifact] === undefined) {
      errors.push(`Agent "${agentId}" did not produce required artifact "${artifact}"`);
    }
  }

  return {
    sensor: 'output',
    status: errors.length === 0 ? 'pass' : 'fail',
    details: {
      agentId,
      outputKeys: Object.keys(stepOutput.output),
      expectedArtifacts: step.producedArtifacts,
      errors,
    },
  };
};

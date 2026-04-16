import type { SensorFn } from '../services/sensor-runner.js';

/**
 * Artifact Completeness Sensor: checks all required artifacts are present in the session.
 */
export const artifactSensor: SensorFn = async (context) => {
  const { session, step, stepOutput } = context;
  const missing: string[] = [];
  const availableArtifacts = {
    ...session.artifacts,
    ...stepOutput.output,
  };

  for (const required of step.requiredArtifacts) {
    if (availableArtifacts[required] === undefined) {
      missing.push(required);
    }
  }

  return {
    sensor: 'artifact_completeness',
    status: missing.length === 0 ? 'pass' : 'fail',
    details: {
      required: step.requiredArtifacts,
      present: Object.keys(availableArtifacts),
      missing,
    },
  };
};

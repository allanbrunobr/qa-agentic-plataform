import type { SensorFn } from '../services/sensor-runner.js';

/**
 * Timeout Sensor: checks if a step exceeded its timeout limit.
 */
export const timeoutSensor: SensorFn = async (context) => {
  const { stepOutput, step } = context;
  const timeoutMs = step.timeoutMs;

  if (!timeoutMs) {
    return {
      sensor: 'timeout',
      status: 'pass',
      details: { reason: 'No timeout configured for this step' },
    };
  }

  const exceeded = stepOutput.durationMs > timeoutMs;

  return {
    sensor: 'timeout',
    status: exceeded ? 'fail' : 'pass',
    details: {
      elapsed: stepOutput.durationMs,
      limit: timeoutMs,
      ...(exceeded && { overBy: stepOutput.durationMs - timeoutMs }),
    },
  };
};

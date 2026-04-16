import type { SensorFn } from '../services/sensor-runner.js'

export const trendSensor: SensorFn = async ({ session, step, scenario }) => {
  const trendEvent = session.events
    .filter((event) => event.type === 'trend_signal')
    .find((event) => event.payload?.['stepId'] === step.id)

  if (!trendEvent) {
    return {
      sensor: 'trend',
      status: 'pass',
      details: { reason: 'no degrading trend signal', scenarioId: scenario.id, stepId: step.id },
    }
  }

  return {
    sensor: 'trend',
    status: trendEvent.payload?.['severity'] === 'high' ? 'fail' : 'pass',
    details: trendEvent.payload ?? {},
  }
}

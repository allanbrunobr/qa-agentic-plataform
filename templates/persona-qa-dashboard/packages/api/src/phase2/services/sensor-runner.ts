import type { ScenarioStep, ScenarioContract } from '../types/scenario-types.js';
import type { AgentStepOutput } from '../types/agent-types.js';
import type { Session } from '../types/session-types.js';

export interface SensorResult {
  sensor: string;
  status: 'pass' | 'fail';
  details: Record<string, unknown>;
}

export interface SensorContext {
  sessionId: string;
  step: ScenarioStep;
  agentId: string;
  stepOutput: AgentStepOutput;
  session: Session;
  scenario: ScenarioContract;
}

export type SensorFn = (context: SensorContext) => Promise<SensorResult>;

export class SensorRunner {
  private sensors: Map<string, SensorFn> = new Map();

  registerSensor(name: string, fn: SensorFn): void {
    this.sensors.set(name, fn);
  }

  async runAll(context: SensorContext): Promise<SensorResult[]> {
    const results: SensorResult[] = [];
    for (const [name, fn] of this.sensors) {
      try {
        const result = await fn(context);
        results.push(result);
      } catch (error) {
        results.push({
          sensor: name,
          status: 'fail',
          details: { error: error instanceof Error ? error.message : String(error) },
        });
      }
    }
    return results;
  }
}

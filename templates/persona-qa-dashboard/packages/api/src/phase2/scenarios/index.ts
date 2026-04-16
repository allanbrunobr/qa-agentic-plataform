import { ScenarioContractSchema, type ScenarioContract } from '../types/scenario-types.js';
import { firstOrder } from './first-order.js';
import { firstOrderMultiRole } from './first-order-multi-role.js';
import { quarterlyReorderMultiRole } from './quarterly-reorder-multi-role.js';
import { quarterlyReorderClosureMultiRole } from './quarterly-reorder-closure-multi-role.js';

const SCENARIOS: Record<string, ScenarioContract> = {
  first_order: firstOrder,
  first_order_multi_role: firstOrderMultiRole,
  quarterly_reorder_multi_role: quarterlyReorderMultiRole,
  quarterly_reorder_closure_multi_role: quarterlyReorderClosureMultiRole,
};

export function loadScenario(scenarioId: string): ScenarioContract {
  const scenario = SCENARIOS[scenarioId];
  if (!scenario) {
    throw new Error(`Scenario "${scenarioId}" not found. Available: ${Object.keys(SCENARIOS).join(', ')}`);
  }
  return ScenarioContractSchema.parse(scenario);
}

export function listScenarios(): string[] {
  return Object.keys(SCENARIOS);
}

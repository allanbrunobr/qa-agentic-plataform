import type { AdapterScenarioModel } from '../../../../packages/host-sdk/src/adapter-model.ts'

export const templateScenariosModel: AdapterScenarioModel[] = [
  {
    id: 'primary_scenario',
    title: 'Primary scenario',
    roles: ['primary_role'],
    steps: ['step_one', 'step_two'],
    expectedArtifacts: ['artifact_one'],
  },
]

import type { WorkflowContract } from '../types/scenario-types.js'

export const firstOrderWorkflowContract: WorkflowContract = {
  version: '1.0',
  deterministic: true,
  steps: [
    {
      id: 'create_customer',
      order: 0,
      agentId: 'sales-associate',
      capabilityId: 'createCustomer',
      requiredArtifacts: [],
      producedArtifacts: ['customerId'],
      timeoutMs: 90_000,
      retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
    },
    {
      id: 'schedule_order',
      order: 1,
      agentId: 'sales-associate',
      capabilityId: 'scheduleOrder',
      requiredArtifacts: ['customerId'],
      producedArtifacts: ['eventId'],
      timeoutMs: 90_000,
      retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
    },
  ],
}

import type { WorkflowContract } from '../types/scenario-types.js'

export const firstOrderMultiRoleWorkflowContract: WorkflowContract = {
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
      timeoutMs: 90000,
      retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: 'schedule_order',
      order: 1,
      agentId: 'sales-associate',
      capabilityId: 'scheduleOrder',
      requiredArtifacts: ['customerId'],
      producedArtifacts: ['eventId'],
      timeoutMs: 90000,
      retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: 'complete_fulfillment',
      order: 2,
      agentId: 'fulfillment-agent',
      capabilityId: 'completeFulfillment',
      requiredArtifacts: ['customerId', 'eventId'],
      producedArtifacts: ['fulfillmentCompleted'],
      timeoutMs: 180000,
      retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    },
  ],
}

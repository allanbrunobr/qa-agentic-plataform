import type { WorkflowContract } from '../types/scenario-types.js'

export const firstOrderWorkflowContract: WorkflowContract = {
  version: '1.0',
  deterministic: true,
  steps: [
    {
      id: 'register_customer',
      order: 0,
      agentId: 'sales_associate',
      capabilityId: 'registerCustomer',
      requiredArtifacts: [],
      producedArtifacts: ['customerId'],
      timeoutMs: 90_000,
      retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
    },
    {
      id: 'create_order',
      order: 1,
      agentId: 'sales_associate',
      capabilityId: 'createOrder',
      requiredArtifacts: ['customerId'],
      producedArtifacts: ['orderId'],
      timeoutMs: 90_000,
      retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
    },
  ],
}

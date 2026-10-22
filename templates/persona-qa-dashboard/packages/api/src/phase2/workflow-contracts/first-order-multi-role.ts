import type { WorkflowContract } from '../types/scenario-types.js'

export const firstOrderMultiRoleWorkflowContract: WorkflowContract = {
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
      timeoutMs: 90000,
      retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: 'create_order',
      order: 1,
      agentId: 'sales_associate',
      capabilityId: 'createOrder',
      requiredArtifacts: ['customerId'],
      producedArtifacts: ['orderId'],
      timeoutMs: 90000,
      retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: 'fulfill_order',
      order: 2,
      agentId: 'fulfillment_agent',
      capabilityId: 'fulfillOrder',
      requiredArtifacts: ['customerId', 'orderId'],
      producedArtifacts: ['orderFulfilled'],
      timeoutMs: 180000,
      retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    },
  ],
}

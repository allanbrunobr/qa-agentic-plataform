import type { WorkflowContract } from '../types/scenario-types.js'

export const quarterlyReorderMultiRoleWorkflowContract: WorkflowContract = {
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
      retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: 'schedule_return',
      order: 1,
      agentId: 'sales-associate',
      capabilityId: 'scheduleOrder',
      requiredArtifacts: ['customerId'],
      producedArtifacts: ['eventId'],
      timeoutMs: 90_000,
      retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: 'complete_return_fulfillment',
      order: 2,
      agentId: 'fulfillment-agent',
      capabilityId: 'completeFulfillment',
      requiredArtifacts: ['customerId', 'eventId'],
      producedArtifacts: ['fulfillmentCompleted'],
      timeoutMs: 180_000,
      retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: 'review_billing_guide',
      order: 3,
      agentId: 'billing_clerk',
      capabilityId: 'findBillingGuideByEventId',
      requiredArtifacts: ['eventId', 'fulfillmentCompleted'],
      producedArtifacts: ['billingGuideReviewed'],
      timeoutMs: 120_000,
      retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    },
  ],
}

import type { WorkflowContract } from '../types/scenario-types.js'

export const quarterlyReorderMultiRoleWorkflowContract: WorkflowContract = {
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
      retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: 'create_reorder',
      order: 1,
      agentId: 'sales_associate',
      capabilityId: 'createOrder',
      requiredArtifacts: ['customerId'],
      producedArtifacts: ['orderId'],
      timeoutMs: 90_000,
      retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: 'fulfill_reorder',
      order: 2,
      agentId: 'fulfillment_agent',
      capabilityId: 'fulfillOrder',
      requiredArtifacts: ['customerId', 'orderId'],
      producedArtifacts: ['orderFulfilled'],
      timeoutMs: 180_000,
      retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: 'review_invoice',
      order: 3,
      agentId: 'billing_clerk',
      capabilityId: 'findInvoiceByOrderId',
      requiredArtifacts: ['orderId', 'orderFulfilled'],
      producedArtifacts: ['invoiceReviewed'],
      timeoutMs: 120_000,
      retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    },
  ],
}

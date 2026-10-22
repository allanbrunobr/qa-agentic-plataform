import type { ScenarioContract } from '../types/scenario-types.js';
import { firstOrderWorkflowContract } from '../workflow-contracts/first-order.js'

export const firstOrder: ScenarioContract = {
  id: 'first_order',
  name: 'First Order',
  description: 'First order scenario: register a customer and create an order.',
  steps: [
    {
      id: 'register_customer',
      name: 'Register Customer',
      description: 'The sales_associate agent registers a new customer in the system.',
      agentId: 'sales_associate',
      capabilityId: 'registerCustomer',
      order: 0,
      requiredArtifacts: [],
      producedArtifacts: ['customerId'],
      timeoutMs: 90_000,
      retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
    },
    {
      id: 'create_order',
      name: 'Create Order',
      description: 'The sales_associate agent creates an order for the registered customer.',
      agentId: 'sales_associate',
      capabilityId: 'createOrder',
      order: 1,
      requiredArtifacts: ['customerId'],
      producedArtifacts: ['orderId'],
      timeoutMs: 90_000,
      retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
    },
  ],
  workflowContract: firstOrderWorkflowContract,
  roles: ['sales_associate'],
  requiredArtifacts: ['customerId', 'orderId'],
  allowedTools: ['registerCustomer', 'createOrder'],
};

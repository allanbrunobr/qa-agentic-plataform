import type { ScenarioContract } from '../types/scenario-types.js';
import { firstOrderWorkflowContract } from '../workflow-contracts/first-order.js'

export const firstOrder: ScenarioContract = {
  id: 'first_order',
  name: 'First order',
  description: 'Cenário de first order: cadastro de customer e pedido de pedido.',
  steps: [
    {
      id: 'create_customer',
      name: 'Cadastrar Customer',
      description: 'Agente sales-associate cadastra um novo customer no sistema.',
      agentId: 'sales-associate',
      capabilityId: 'createCustomer',
      order: 0,
      requiredArtifacts: [],
      producedArtifacts: ['customerId'],
      timeoutMs: 60000,
      retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
    },
    {
      id: 'schedule_order',
      name: 'Agendar Pedido',
      description: 'Agente sales-associate agenda a pedido para o customer cadastrado.',
      agentId: 'sales-associate',
      capabilityId: 'scheduleOrder',
      order: 1,
      requiredArtifacts: ['customerId'],
      producedArtifacts: ['eventId'],
      timeoutMs: 60000,
      retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
    },
  ],
  workflowContract: firstOrderWorkflowContract,
  roles: ['sales-associate'],
  requiredArtifacts: ['customerId', 'eventId'],
  allowedTools: ['createCustomer', 'scheduleOrder'],
};

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadScenario, listScenarios } from '../scenarios/index.js';
import { Orchestrator } from '../services/orchestrator.js';
import { SessionService } from '../services/session-service.js';
import { AgentRuntime } from '../services/agent-runtime.js';

describe('Scenario Loading', () => {
  it('should load first_order scenario', () => {
    const scenario = loadScenario('first_order');

    expect(scenario.id).toBe('first_order');
    expect(scenario.name).toBe('First order');
    expect(scenario.steps).toHaveLength(2);
    expect(scenario.steps[0]!.id).toBe('create_customer');
    expect(scenario.steps[1]!.id).toBe('schedule_order');
  });

  it('should validate scenario contract with Zod', () => {
    const scenario = loadScenario('first_order');

    expect(scenario.requiredArtifacts).toContain('customerId');
    expect(scenario.requiredArtifacts).toContain('eventId');
    expect(scenario.roles).toContain('sales-associate');
    expect(scenario.allowedTools).toEqual(['createCustomer', 'scheduleOrder']);
    expect(scenario.workflowContract).toEqual({
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
          retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
        },
        {
          id: 'schedule_order',
          order: 1,
          agentId: 'sales-associate',
          capabilityId: 'scheduleOrder',
          requiredArtifacts: ['customerId'],
          producedArtifacts: ['eventId'],
          timeoutMs: 90000,
          retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
        },
      ],
    });
  });

  it('should throw on unknown scenario', () => {
    expect(() => loadScenario('nonexistent')).toThrow('Scenario "nonexistent" not found');
  });

  it('should list available scenarios', () => {
    const list = listScenarios();
    expect(list).toContain('first_order');
    expect(list).toContain('first_order_multi_role');
    expect(list).toContain('quarterly_reorder_multi_role');
  });

  it('should have correct step ordering', () => {
    const scenario = loadScenario('first_order');
    for (let i = 0; i < scenario.steps.length; i += 1) {
      expect(scenario.steps[i]!.order).toBe(i);
    }
  });

  it('should define required/produced artifacts per step', () => {
    const scenario = loadScenario('first_order');
    const step1 = scenario.steps[0]!;
    const step2 = scenario.steps[1]!;

    expect(step1.requiredArtifacts).toEqual([]);
    expect(step1.producedArtifacts).toContain('customerId');
    expect(step2.requiredArtifacts).toContain('customerId');
    expect(step2.producedArtifacts).toContain('eventId');
  });

  it('should load first_order_multi_role scenario with handoff to fulfillment-agent', () => {
    const scenario = loadScenario('first_order_multi_role');

    expect(scenario.roles).toEqual(['sales-associate', 'fulfillment-agent']);
    expect(scenario.steps).toHaveLength(3);
    expect(scenario.steps[1]!.handoff).toEqual({
      nextAgentId: 'fulfillment-agent',
      reason: expect.any(String),
      requiredArtifacts: ['customerId', 'eventId'],
      expectedOutput: expect.any(String),
    });
    expect(scenario.steps[2]!.agentId).toBe('fulfillment-agent');
    expect(scenario.allowedTools).toContain('completeFulfillment');
    expect(scenario.workflowContract).toEqual({
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
    });
  });

  it('should load quarterly_reorder_multi_role scenario with fulfillment-agent -> billing_clerk handoff', () => {
    const scenario = loadScenario('quarterly_reorder_multi_role');

    expect(scenario.roles).toEqual(['sales-associate', 'fulfillment-agent', 'billing_clerk']);
    expect(scenario.steps).toHaveLength(4);
    expect(scenario.steps[2]!.handoff).toEqual({
      nextAgentId: 'billing_clerk',
      reason: expect.any(String),
      requiredArtifacts: ['customerId', 'eventId', 'fulfillmentCompleted'],
      expectedOutput: expect.any(String),
    });
    expect(scenario.steps[3]!.agentId).toBe('billing_clerk');
    expect(scenario.allowedTools).toContain('findBillingGuideByEventId');
    expect(scenario.workflowContract).toEqual({
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
          id: 'schedule_return',
          order: 1,
          agentId: 'sales-associate',
          capabilityId: 'scheduleOrder',
          requiredArtifacts: ['customerId'],
          producedArtifacts: ['eventId'],
          timeoutMs: 90000,
          retryPolicy: { maxAttempts: 1, backoffMs: 0 },
        },
        {
          id: 'complete_return_fulfillment',
          order: 2,
          agentId: 'fulfillment-agent',
          capabilityId: 'completeFulfillment',
          requiredArtifacts: ['customerId', 'eventId'],
          producedArtifacts: ['fulfillmentCompleted'],
          timeoutMs: 180000,
          retryPolicy: { maxAttempts: 1, backoffMs: 0 },
        },
        {
          id: 'review_billing_guide',
          order: 3,
          agentId: 'billing_clerk',
          capabilityId: 'findBillingGuideByEventId',
          requiredArtifacts: ['eventId', 'fulfillmentCompleted'],
          producedArtifacts: ['billingGuideReviewed'],
          timeoutMs: 120000,
          retryPolicy: { maxAttempts: 1, backoffMs: 0 },
        },
      ],
    });
  });

  it('should load quarterly_reorder_closure_multi_role scenario with billing_clerk -> store_manager handoff', () => {
    const scenario = loadScenario('quarterly_reorder_closure_multi_role');

    expect(scenario.roles).toEqual(['sales-associate', 'fulfillment-agent', 'billing_clerk', 'store_manager']);
    expect(scenario.steps).toHaveLength(5);
    expect(scenario.steps[3]!.handoff).toEqual({
      nextAgentId: 'store_manager',
      reason: expect.any(String),
      requiredArtifacts: ['eventId', 'fulfillmentCompleted', 'billingGuideReviewed'],
      expectedOutput: expect.any(String),
    });
    expect(scenario.steps[4]!.agentId).toBe('store_manager');
    expect(scenario.allowedTools).toContain('verifyFinanceDashboard');
    expect(scenario.allowedTools).toContain('verifyReportsPage');
    expect(scenario.workflowContract).toEqual({
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
          id: 'schedule_return',
          order: 1,
          agentId: 'sales-associate',
          capabilityId: 'scheduleOrder',
          requiredArtifacts: ['customerId'],
          producedArtifacts: ['eventId'],
          timeoutMs: 90000,
          retryPolicy: { maxAttempts: 1, backoffMs: 0 },
        },
        {
          id: 'complete_return_fulfillment',
          order: 2,
          agentId: 'fulfillment-agent',
          capabilityId: 'completeFulfillment',
          requiredArtifacts: ['customerId', 'eventId'],
          producedArtifacts: ['fulfillmentCompleted'],
          timeoutMs: 180000,
          retryPolicy: { maxAttempts: 1, backoffMs: 0 },
        },
        {
          id: 'review_billing_guide',
          order: 3,
          agentId: 'billing_clerk',
          capabilityId: 'findBillingGuideByEventId',
          requiredArtifacts: ['eventId', 'fulfillmentCompleted'],
          producedArtifacts: ['billingGuideReviewed'],
          timeoutMs: 120000,
          retryPolicy: { maxAttempts: 1, backoffMs: 0 },
        },
        {
          id: 'validate_management_closure',
          order: 4,
          agentId: 'store_manager',
          capabilityId: 'validateManagementClosure',
          requiredArtifacts: ['eventId', 'billingGuideReviewed'],
          producedArtifacts: ['financeValidated', 'reportsValidated'],
          timeoutMs: 120000,
          retryPolicy: { maxAttempts: 1, backoffMs: 0 },
        },
      ],
    });
  });
});

describe('Run Resume', () => {
  let sessionService: SessionService;
  let agentRuntime: AgentRuntime;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    sessionService = new SessionService();
    agentRuntime = new AgentRuntime();
    orchestrator = new Orchestrator(agentRuntime, sessionService);
  });

  it('should resume from checkpoint after first step completed', async () => {
    const scenario = loadScenario('first_order');

    const session = sessionService.createSession(scenario.id);
    sessionService.updateStatus(session.id, 'running');
    sessionService.saveCheckpoint(session.id, 0);

    vi.spyOn(agentRuntime, 'executeStep').mockResolvedValue({
      stepIndex: 1,
      agentId: 'sales-associate',
      output: { eventId: '789' },
      toolCalls: [],
      durationMs: 100,
      success: true,
    });

    const result = await orchestrator.resumeRun(session.id, scenario);

    expect(result.status).toBe('complete');
    expect(agentRuntime.executeStep).toHaveBeenCalledTimes(1);
  });

  it('should throw if session not found', async () => {
    const scenario = loadScenario('first_order');
    await expect(orchestrator.resumeRun('nonexistent', scenario)).rejects.toThrow('Session nonexistent not found');
  });

  it('should resume from beginning if no checkpoint', async () => {
    const scenario = loadScenario('first_order');
    const session = sessionService.createSession(scenario.id);

    vi.spyOn(agentRuntime, 'executeStep').mockResolvedValue({
      stepIndex: 0,
      agentId: 'sales-associate',
      output: { customerId: '123', eventId: '456' },
      toolCalls: [],
      durationMs: 50,
      success: true,
    });

    const result = await orchestrator.resumeRun(session.id, scenario);

    expect(result.status).toBe('complete');
    expect(agentRuntime.executeStep).toHaveBeenCalledTimes(2);
  });
});

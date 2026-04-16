import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ToolRegistry } from '../services/tool-registry.js'
import {
  createCustomerHandler,
  createCustomerMetadata,
  completeFulfillmentHandler,
  completeFulfillmentMetadata,
  findBillingGuideByEventIdHandler,
  findBillingGuideByEventIdMetadata,
  openOrderDetailsHandler,
  openOrderDetailsMetadata,
  scheduleOrderHandler,
  scheduleOrderMetadata,
  verifyFinanceDashboardHandler,
  verifyFinanceDashboardMetadata,
  verifyReportsPageHandler,
  verifyReportsPageMetadata,
  registerWorkflowTools,
} from '../tools/workflow-tools.js'

const phase1CustomersModuleHref = new URL('../../../../../../integration-test/persona-tests/support/capabilities/customers.ts', import.meta.url).href
const phase1OrdersModuleHref = new URL('../../../../../../integration-test/persona-tests/support/capabilities/orders.ts', import.meta.url).href
const phase1OrderDetailsModuleHref = new URL('../../../../../../integration-test/persona-tests/support/capabilities/order-details.ts', import.meta.url).href
const phase1BillingModuleHref = new URL('../../../../../../integration-test/persona-tests/support/capabilities/billing.ts', import.meta.url).href
const phase1FinanceModuleHref = new URL('../../../../../../integration-test/persona-tests/support/capabilities/finance.ts', import.meta.url).href
const phase1ReportsModuleHref = new URL('../../../../../../integration-test/persona-tests/support/capabilities/reports.ts', import.meta.url).href

describe('workflow-tools', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock(phase1CustomersModuleHref)
    vi.doUnmock(phase1OrdersModuleHref)
    vi.doUnmock(phase1OrderDetailsModuleHref)
    vi.doUnmock(phase1BillingModuleHref)
    vi.doUnmock(phase1FinanceModuleHref)
    vi.doUnmock(phase1ReportsModuleHref)
  })

  describe('createCustomerHandler', () => {
    it('returns error when name is missing', async () => {
      const result = await createCustomerHandler({}, { page: {} })
      expect(result).toEqual({
        ok: false,
        error: { code: 'invalid_input', message: 'name is required', retryable: false },
      })
    })

    it('returns error when page is missing from context', async () => {
      const result = await createCustomerHandler({ name: 'Test' }, {})
      expect(result).toEqual({
        ok: false,
        error: { code: 'missing_context', message: expect.stringContaining('page'), retryable: false },
      })
    })

    it('calls Phase 1 createCustomer and returns ToolResult on success', async () => {
      vi.doMock(phase1CustomersModuleHref, () => ({
        createCustomer: vi.fn().mockResolvedValue({ customerId: '42' }),
      }))
      const { createCustomer } = await import(phase1CustomersModuleHref)

      const mockPage = { url: () => 'http://test' }
      const result = await createCustomerHandler({ name: 'João Silva', phone: '11999990000' }, { page: mockPage })

      expect(result).toEqual({
        ok: true,
        output: {
          customerId: '42',
          customerName: 'João Silva',
          customerPhone: '11999990000',
          phone: '11999990000',
        },
      })
      expect(createCustomer).toHaveBeenCalledWith(mockPage, { name: 'João Silva', phone: '11999990000' })
    })

    it('catches capability errors and returns ToolResult with retryable flag', async () => {
      vi.doMock(phase1CustomersModuleHref, () => ({
        createCustomer: vi.fn().mockRejectedValue(new Error('Timeout waiting for selector')),
      }))
      const { createCustomer } = await import(phase1CustomersModuleHref)

      const result = await createCustomerHandler({ name: 'Test' }, { page: {} })
      expect(result).toEqual({
        ok: false,
        error: { code: 'capability_error', message: 'Timeout waiting for selector', retryable: true },
      })
    })
  })

  describe('scheduleOrderHandler', () => {
    it('returns error when customerName is missing', async () => {
      const result = await scheduleOrderHandler({}, { page: {} })
      expect(result).toEqual({
        ok: false,
        error: { code: 'invalid_input', message: 'customerName is required', retryable: false },
      })
    })

    it('returns error when page is missing', async () => {
      const result = await scheduleOrderHandler({ customerName: 'Test' }, {})
      expect(result).toEqual({
        ok: false,
        error: { code: 'missing_context', message: expect.stringContaining('page'), retryable: false },
      })
    })

    it('calls Phase 1 scheduleOrder and returns ToolResult on success', async () => {
      vi.doMock(phase1OrdersModuleHref, () => ({
        scheduleOrder: vi.fn().mockResolvedValue({ eventId: '99' }),
      }))
      const { scheduleOrder } = await import(phase1OrdersModuleHref)

      const mockPage = { url: () => 'http://test' }
      const result = await scheduleOrderHandler(
        { customerName: 'João Silva', date: '2026-04-15' },
        { page: mockPage },
      )

      expect(result).toEqual({
        ok: true,
        output: {
          eventId: '99',
          customerName: 'João Silva',
          orderDate: '2026-04-15',
          orderTime: null,
          orderType: null,
        },
      })
      expect(scheduleOrder).toHaveBeenCalledWith(mockPage, {
        customerName: 'João Silva',
        date: '2026-04-15',
        time: undefined,
        type: undefined,
      })
    })

    it('falls back to customerName from artifacts when model sends a generic placeholder', async () => {
      vi.doMock(phase1OrdersModuleHref, () => ({
        scheduleOrder: vi.fn().mockResolvedValue({ eventId: '100' }),
      }))
      const { scheduleOrder } = await import(phase1OrdersModuleHref)

      const mockPage = { url: () => 'http://test' }
      const result = await scheduleOrderHandler(
        { customerName: 'Customer' },
        { page: mockPage, artifacts: { customerName: 'Maria Fase 2', orderType: 'Primeira Pedido' } },
      )

      expect(result).toEqual({
        ok: true,
        output: {
          eventId: '100',
          customerName: 'Maria Fase 2',
          orderDate: null,
          orderTime: null,
          orderType: 'Primeira Pedido',
        },
      })
      expect(scheduleOrder).toHaveBeenCalledWith(mockPage, {
        customerName: 'Maria Fase 2',
        date: undefined,
        time: undefined,
        type: 'Primeira Pedido',
      })
    })
  })

  describe('openOrderDetailsHandler', () => {
    it('returns error when customerId is missing', async () => {
      const result = await openOrderDetailsHandler({}, { page: {} })
      expect(result).toEqual({
        ok: false,
        error: { code: 'invalid_input', message: 'customerId is required', retryable: false },
      })
    })

    it('opens order details using Phase 1 capability', async () => {
      vi.doMock(phase1OrderDetailsModuleHref, () => ({
        openOrderDetails: vi.fn().mockResolvedValue(undefined),
        completeFulfillment: vi.fn().mockResolvedValue(undefined),
      }))
      const { openOrderDetails } = await import(phase1OrderDetailsModuleHref)

      const mockPage = { url: () => 'http://test' }
      const result = await openOrderDetailsHandler({ customerId: '42', eventId: '99' }, { page: mockPage })

      expect(result).toEqual({
        ok: true,
        output: {
          customerId: '42',
          eventId: '99',
          orderDetailsOpened: true,
        },
      })
      expect(openOrderDetails).toHaveBeenCalledWith(mockPage, '42', '99')
    })
  })

  describe('completeFulfillmentHandler', () => {
    it('falls back to artifacts and completes fulfillment', async () => {
      vi.doMock(phase1OrderDetailsModuleHref, () => ({
        openOrderDetails: vi.fn().mockResolvedValue(undefined),
        completeFulfillment: vi.fn().mockResolvedValue(undefined),
      }))
      const orderDetails = await import(phase1OrderDetailsModuleHref)

      const mockPage = { url: () => 'http://test' }
      const result = await completeFulfillmentHandler(
        {},
        { page: mockPage, artifacts: { customerId: '123', eventId: '456' } },
      )

      expect(result).toEqual({
        ok: true,
        output: {
          customerId: '123',
          eventId: '456',
          orderDetailsOpened: true,
          fulfillmentCompleted: true,
        },
      })
      expect(orderDetails.openOrderDetails).toHaveBeenCalledWith(mockPage, '123', '456')
      expect(orderDetails.completeFulfillment).toHaveBeenCalledWith(mockPage)
    })
  })

  describe('findBillingGuideByEventIdHandler', () => {
    it('returns error when eventId is missing', async () => {
      const result = await findBillingGuideByEventIdHandler({}, { page: {} })
      expect(result).toEqual({
        ok: false,
        error: { code: 'invalid_input', message: 'eventId is required', retryable: false },
      })
    })

    it('returns review output even when no guide exists', async () => {
      vi.doMock(phase1BillingModuleHref, () => ({
        findGuideByEventId: vi.fn().mockResolvedValue(null),
      }))

      const result = await findBillingGuideByEventIdHandler({}, {
        page: {},
        artifacts: { eventId: 'evt-1' },
      })

      expect(result).toEqual({
        ok: true,
        output: {
          eventId: 'evt-1',
          billingGuideReviewed: true,
          billingGuideFound: false,
          billingGuideId: null,
          billingGuideText: null,
        },
      })
    })

    it('returns guide details when a guide is found', async () => {
      vi.doMock(phase1BillingModuleHref, () => ({
        findGuideByEventId: vi.fn().mockResolvedValue({
          id: 'guide-1',
          eventId: 'evt-2',
          text: 'Guide row',
        }),
      }))

      const result = await findBillingGuideByEventIdHandler({ eventId: 'evt-2' }, { page: {} })

      expect(result).toEqual({
        ok: true,
        output: {
          eventId: 'evt-2',
          billingGuideReviewed: true,
          billingGuideFound: true,
          billingGuideId: 'guide-1',
          billingGuideText: 'Guide row',
        },
      })
    })
  })

  describe('verifyFinanceDashboardHandler', () => {
    it('validates finance dashboard successfully', async () => {
      vi.doMock(phase1FinanceModuleHref, () => ({
        openFinanceDashboard: vi.fn().mockResolvedValue(undefined),
        assertDashboardLoaded: vi.fn().mockResolvedValue(undefined),
      }))

      const result = await verifyFinanceDashboardHandler({ eventId: 'evt-3' }, { page: {} })

      expect(result).toEqual({
        ok: true,
        output: {
          eventId: 'evt-3',
          financeValidated: true,
        },
      })
    })
  })

  describe('verifyReportsPageHandler', () => {
    it('validates reports page successfully', async () => {
      vi.doMock(phase1ReportsModuleHref, () => ({
        openReportsPage: vi.fn().mockResolvedValue(undefined),
        assertReportsPageLoaded: vi.fn().mockResolvedValue(undefined),
      }))

      const result = await verifyReportsPageHandler({ eventId: 'evt-4' }, { page: {} })

      expect(result).toEqual({
        ok: true,
        output: {
          eventId: 'evt-4',
          reportsValidated: true,
        },
      })
    })
  })

  describe('registerWorkflowTools', () => {
    it('registers both tools in the registry', () => {
      const registry = new ToolRegistry()
      registerWorkflowTools(registry)

      expect(registry.has('createCustomer')).toBe(true)
      expect(registry.has('scheduleOrder')).toBe(true)
      expect(registry.has('openOrderDetails')).toBe(true)
      expect(registry.has('completeFulfillment')).toBe(true)
      expect(registry.has('findBillingGuideByEventId')).toBe(true)
      expect(registry.has('verifyFinanceDashboard')).toBe(true)
      expect(registry.has('verifyReportsPage')).toBe(true)

      const tools = registry.listTools()
      expect(tools).toHaveLength(7)
      expect(tools.every((t) => t.requiresBrowser)).toBe(true)
    })
  })

  describe('integration: execute through registry', () => {
    it('executes createCustomer through registry with policy check', async () => {
      vi.doMock(phase1CustomersModuleHref, () => ({
        createCustomer: vi.fn().mockResolvedValue({ customerId: '7' }),
      }))
      const { createCustomer } = await import(phase1CustomersModuleHref)

      const registry = new ToolRegistry()
      registerWorkflowTools(registry)

      const result = await registry.execute(
        'createCustomer',
        { name: 'Maria' },
        { browserAccess: true },
        { page: {} },
      )

      expect(result).toEqual({
        ok: true,
        output: {
          customerId: '7',
          customerName: 'Maria',
          customerPhone: null,
          phone: null,
        },
      })
    })

    it('blocks createCustomer when browser access denied by policy', async () => {
      const registry = new ToolRegistry()
      registerWorkflowTools(registry)

      const result = await registry.execute(
        'createCustomer',
        { name: 'Maria' },
        { browserAccess: false },
        { page: {} },
      )

      expect(result).toEqual({
        ok: false,
        error: { code: 'tool_not_allowed', message: expect.any(String), retryable: false },
      })
    })
  })
})

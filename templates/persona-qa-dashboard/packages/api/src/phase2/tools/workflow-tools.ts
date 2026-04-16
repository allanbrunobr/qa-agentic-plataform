/**
 * Phase 2 tool wrappers around Phase 1 UI capabilities.
 *
 * Each wrapper receives structured input + ToolContext (with page),
 * calls the real Phase 1 capability, and maps the result to ToolResult.
 */

import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { ToolHandler, ToolMetadata, ToolContext, ToolResult } from '../types/tool-types.js'
import type { ToolRegistry } from '../services/tool-registry.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const AGENTIC_QA_ROOT = path.resolve(__dirname, '../../../../../')

export const phase1CustomersModuleHref = pathToFileURL(
  path.resolve(AGENTIC_QA_ROOT, 'adapter/runtime/host-source-snapshot/integration-test/persona-tests/support/capabilities/customers.ts'),
).href
export const phase1OrdersModuleHref = pathToFileURL(
  path.resolve(AGENTIC_QA_ROOT, 'adapter/runtime/host-source-snapshot/integration-test/persona-tests/support/capabilities/orders.ts'),
).href
export const phase1OrderDetailsModuleHref = pathToFileURL(
  path.resolve(AGENTIC_QA_ROOT, 'adapter/runtime/host-source-snapshot/integration-test/persona-tests/support/capabilities/order-details.ts'),
).href
export const phase1BillingModuleHref = pathToFileURL(
  path.resolve(AGENTIC_QA_ROOT, 'adapter/runtime/host-source-snapshot/integration-test/persona-tests/support/capabilities/billing.ts'),
).href
export const phase1FinanceModuleHref = pathToFileURL(
  path.resolve(AGENTIC_QA_ROOT, 'adapter/runtime/host-source-snapshot/integration-test/persona-tests/support/capabilities/finance.ts'),
).href
export const phase1ReportsModuleHref = pathToFileURL(
  path.resolve(AGENTIC_QA_ROOT, 'adapter/runtime/host-source-snapshot/integration-test/persona-tests/support/capabilities/reports.ts'),
).href

async function importCustomersCapability(): Promise<{ createCustomer: (page: unknown, input: CreateCustomerInput) => Promise<unknown> }> {
  return (await import(phase1CustomersModuleHref)) as {
    createCustomer: (page: unknown, input: CreateCustomerInput) => Promise<unknown>
  }
}

async function importOrdersCapability(): Promise<{ scheduleOrder: (page: unknown, input: ScheduleOrderInput) => Promise<unknown> }> {
  return (await import(phase1OrdersModuleHref)) as {
    scheduleOrder: (page: unknown, input: ScheduleOrderInput) => Promise<unknown>
  }
}

async function importOrderDetailsCapability(): Promise<{
  openOrderDetails: (page: unknown, customerId: string, eventId?: string) => Promise<void>
  completeFulfillment: (page: unknown) => Promise<void>
}> {
  return (await import(phase1OrderDetailsModuleHref)) as {
    openOrderDetails: (page: unknown, customerId: string, eventId?: string) => Promise<void>
    completeFulfillment: (page: unknown) => Promise<void>
  }
}

async function importBillingCapability(): Promise<{
  findGuideByEventId: (page: unknown, eventId: string) => Promise<{ id: string | null; eventId: string | null; text: string } | null>
}> {
  return (await import(phase1BillingModuleHref)) as {
    findGuideByEventId: (page: unknown, eventId: string) => Promise<{ id: string | null; eventId: string | null; text: string } | null>
  }
}

async function importFinanceCapability(): Promise<{
  openFinanceDashboard: (page: unknown, options?: { dateFilter?: 'today' | 'week' | '30days'; dateFrom?: string; dateTo?: string }) => Promise<void>
  assertDashboardLoaded: (page: unknown) => Promise<void>
}> {
  return (await import(phase1FinanceModuleHref)) as {
    openFinanceDashboard: (page: unknown, options?: { dateFilter?: 'today' | 'week' | '30days'; dateFrom?: string; dateTo?: string }) => Promise<void>
    assertDashboardLoaded: (page: unknown) => Promise<void>
  }
}

async function importReportsCapability(): Promise<{
  openReportsPage: (page: unknown) => Promise<void>
  assertReportsPageLoaded: (page: unknown) => Promise<void>
}> {
  return (await import(phase1ReportsModuleHref)) as {
    openReportsPage: (page: unknown) => Promise<void>
    assertReportsPageLoaded: (page: unknown) => Promise<void>
  }
}

// --- createCustomer wrapper ---

export interface CreateCustomerInput {
  name: string
  phone?: string
}

export const createCustomerHandler: ToolHandler = async (
  input: unknown,
  context: ToolContext,
): Promise<ToolResult> => {
  const { name, phone } = input as CreateCustomerInput
  const fallbackName = typeof context.artifacts?.['customerName'] === 'string' ? String(context.artifacts['customerName']) : undefined
  const fallbackPhone = typeof context.artifacts?.['customerPhone'] === 'string' ? String(context.artifacts['customerPhone']) : undefined
  const resolvedName = name ?? fallbackName
  const resolvedPhone = phone ?? fallbackPhone

  if (!resolvedName) {
    return { ok: false, error: { code: 'invalid_input', message: 'name is required', retryable: false } }
  }

  if (!context.page) {
    return { ok: false, error: { code: 'missing_context', message: 'Playwright page is required for createCustomer', retryable: false } }
  }

  try {
    // Dynamic import to avoid hard dependency on Playwright at module load time
    const { createCustomer } = await importCustomersCapability()
    const result = await createCustomer(context.page, { name: resolvedName, phone: resolvedPhone }) as Record<string, unknown>
    return {
      ok: true,
      output: {
        ...result,
        customerName: resolvedName,
        customerPhone: resolvedPhone ?? null,
        phone: resolvedPhone ?? null,
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const retryable = !message.includes('not found') && !message.includes('invalid')
    return { ok: false, error: { code: 'capability_error', message, retryable } }
  }
}

export const createCustomerMetadata: ToolMetadata = {
  name: 'createCustomer',
  description: 'Create a new customer in the Reference Store system via UI automation',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Customer full name' },
      phone: { type: 'string', description: 'Customer phone number (optional)' },
    },
    required: ['name'],
  },
  requiresBrowser: true,
  tags: ['workflow', 'customer', 'phase1'],
}

// --- scheduleOrder wrapper ---

export interface ScheduleOrderInput {
  customerName: string
  date?: string
  time?: string
  type?: string
}

export const scheduleOrderHandler: ToolHandler = async (
  input: unknown,
  context: ToolContext,
): Promise<ToolResult> => {
  const { customerName, date, time, type } = input as ScheduleOrderInput
  const fallbackCustomerName = typeof context.artifacts?.['customerName'] === 'string' ? String(context.artifacts['customerName']) : undefined
  const fallbackDate = typeof context.artifacts?.['orderDate'] === 'string' ? String(context.artifacts['orderDate']) : undefined
  const fallbackTime = typeof context.artifacts?.['orderTime'] === 'string' ? String(context.artifacts['orderTime']) : undefined
  const fallbackType = typeof context.artifacts?.['orderType'] === 'string' ? String(context.artifacts['orderType']) : undefined
  const resolvedCustomerName = customerName && customerName !== 'Customer' ? customerName : fallbackCustomerName
  const resolvedDate = date ?? fallbackDate
  const resolvedTime = time ?? fallbackTime
  const resolvedType = type ?? fallbackType

  if (!resolvedCustomerName) {
    return { ok: false, error: { code: 'invalid_input', message: 'customerName is required', retryable: false } }
  }

  if (!context.page) {
    return { ok: false, error: { code: 'missing_context', message: 'Playwright page is required for scheduleOrder', retryable: false } }
  }

  try {
    const { scheduleOrder } = await importOrdersCapability()
    const result = await scheduleOrder(context.page, {
      customerName: resolvedCustomerName,
      date: resolvedDate,
      time: resolvedTime,
      type: resolvedType,
    }) as Record<string, unknown>
    return {
      ok: true,
      output: {
        ...result,
        customerName: resolvedCustomerName,
        orderDate: resolvedDate ?? null,
        orderTime: resolvedTime ?? null,
        orderType: resolvedType ?? null,
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const retryable = !message.includes('not found') && !message.includes('invalid')
    return { ok: false, error: { code: 'capability_error', message, retryable } }
  }
}

export const scheduleOrderMetadata: ToolMetadata = {
  name: 'scheduleOrder',
  description: 'Schedule an order for a customer in Reference Store via UI automation',
  inputSchema: {
    type: 'object',
    properties: {
      customerName: { type: 'string', description: 'Customer name to schedule for' },
      date: { type: 'string', description: 'Order date (optional)' },
      time: { type: 'string', description: 'Order start time (optional)' },
      type: { type: 'string', description: 'Order type (optional)' },
    },
    required: ['customerName'],
  },
  requiresBrowser: true,
  tags: ['workflow', 'order', 'phase1'],
}

// --- fulfillment-agent tools ---

export interface OpenOrderDetailsInput {
  customerId?: string
  eventId?: string
}

export const openOrderDetailsHandler: ToolHandler = async (
  input: unknown,
  context: ToolContext,
): Promise<ToolResult> => {
  const { customerId, eventId } = input as OpenOrderDetailsInput
  const resolvedCustomerId = customerId ?? (typeof context.artifacts?.['customerId'] === 'string' ? String(context.artifacts['customerId']) : undefined)
  const resolvedEventId = eventId ?? (typeof context.artifacts?.['eventId'] === 'string' ? String(context.artifacts['eventId']) : undefined)

  if (!resolvedCustomerId) {
    return { ok: false, error: { code: 'invalid_input', message: 'customerId is required', retryable: false } }
  }
  if (!context.page) {
    return { ok: false, error: { code: 'missing_context', message: 'Playwright page is required for openOrderDetails', retryable: false } }
  }

  try {
    const { openOrderDetails } = await importOrderDetailsCapability()
    await openOrderDetails(context.page, resolvedCustomerId, resolvedEventId)
    return {
      ok: true,
      output: {
        customerId: resolvedCustomerId,
        eventId: resolvedEventId ?? null,
        orderDetailsOpened: true,
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { code: 'capability_error', message, retryable: true } }
  }
}

export const openOrderDetailsMetadata: ToolMetadata = {
  name: 'openOrderDetails',
  description: 'Open the customer order details in Reference Store, optionally for a specific order event',
  inputSchema: {
    type: 'object',
    properties: {
      customerId: { type: 'string', description: 'Customer identifier' },
      eventId: { type: 'string', description: 'Order event identifier (optional but recommended)' },
    },
    required: ['customerId'],
  },
  requiresBrowser: true,
  tags: ['workflow', 'order-details', 'phase1'],
}

export interface CompleteFulfillmentInput {
  customerId?: string
  eventId?: string
}

export const completeFulfillmentHandler: ToolHandler = async (
  input: unknown,
  context: ToolContext,
): Promise<ToolResult> => {
  const { customerId, eventId } = input as CompleteFulfillmentInput
  const resolvedCustomerId = customerId ?? (typeof context.artifacts?.['customerId'] === 'string' ? String(context.artifacts['customerId']) : undefined)
  const resolvedEventId = eventId ?? (typeof context.artifacts?.['eventId'] === 'string' ? String(context.artifacts['eventId']) : undefined)

  if (!resolvedCustomerId) {
    return { ok: false, error: { code: 'invalid_input', message: 'customerId is required', retryable: false } }
  }
  if (!context.page) {
    return { ok: false, error: { code: 'missing_context', message: 'Playwright page is required for completeFulfillment', retryable: false } }
  }

  try {
    const { openOrderDetails, completeFulfillment } = await importOrderDetailsCapability()
    await openOrderDetails(context.page, resolvedCustomerId, resolvedEventId)
    await completeFulfillment(context.page)
    return {
      ok: true,
      output: {
        customerId: resolvedCustomerId,
        eventId: resolvedEventId ?? null,
        orderDetailsOpened: true,
        fulfillmentCompleted: true,
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { code: 'capability_error', message, retryable: true } }
  }
}

export const completeFulfillmentMetadata: ToolMetadata = {
  name: 'completeFulfillment',
  description: 'Open the order details and complete a fulfillment for the scheduled customer',
  inputSchema: {
    type: 'object',
    properties: {
      customerId: { type: 'string', description: 'Customer identifier' },
      eventId: { type: 'string', description: 'Order event identifier' },
    },
    required: ['customerId'],
  },
  requiresBrowser: true,
  tags: ['workflow', 'order-details', 'phase1'],
}

// --- billing_clerk tools ---

export interface FindBillingGuideByEventIdInput {
  eventId?: string
}

export const findBillingGuideByEventIdHandler: ToolHandler = async (
  input: unknown,
  context: ToolContext,
): Promise<ToolResult> => {
  const { eventId } = input as FindBillingGuideByEventIdInput
  const resolvedEventId = eventId ?? (typeof context.artifacts?.['eventId'] === 'string' ? String(context.artifacts['eventId']) : undefined)

  if (!resolvedEventId) {
    return { ok: false, error: { code: 'invalid_input', message: 'eventId is required', retryable: false } }
  }
  if (!context.page) {
    return { ok: false, error: { code: 'missing_context', message: 'Playwright page is required for findBillingGuideByEventId', retryable: false } }
  }

  try {
    const { findGuideByEventId } = await importBillingCapability()
    const guide = await findGuideByEventId(context.page, resolvedEventId)
    return {
      ok: true,
      output: {
        eventId: resolvedEventId,
        billingGuideReviewed: true,
        billingGuideFound: Boolean(guide),
        billingGuideId: guide?.id ?? null,
        billingGuideText: guide?.text ?? null,
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { code: 'capability_error', message, retryable: true } }
  }
}

export const findBillingGuideByEventIdMetadata: ToolMetadata = {
  name: 'findBillingGuideByEventId',
  description: 'Search the Billing module for a guide linked to an order event',
  inputSchema: {
    type: 'object',
    properties: {
      eventId: { type: 'string', description: 'Order event identifier' },
    },
    required: ['eventId'],
  },
  requiresBrowser: true,
  tags: ['workflow', 'billing', 'phase1'],
}

// --- gestor tools ---

export interface VerifyFinanceDashboardInput {
  eventId?: string
}

export const verifyFinanceDashboardHandler: ToolHandler = async (
  input: unknown,
  context: ToolContext,
): Promise<ToolResult> => {
  const { eventId } = input as VerifyFinanceDashboardInput
  const resolvedEventId = eventId ?? (typeof context.artifacts?.['eventId'] === 'string' ? String(context.artifacts['eventId']) : undefined)

  if (!context.page) {
    return { ok: false, error: { code: 'missing_context', message: 'Playwright page is required for verifyFinanceDashboard', retryable: false } }
  }

  try {
    const { openFinanceDashboard, assertDashboardLoaded } = await importFinanceCapability()
    await openFinanceDashboard(context.page)
    await assertDashboardLoaded(context.page)
    return {
      ok: true,
      output: {
        eventId: resolvedEventId ?? null,
        financeValidated: true,
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { code: 'capability_error', message, retryable: true } }
  }
}

export const verifyFinanceDashboardMetadata: ToolMetadata = {
  name: 'verifyFinanceDashboard',
  description: 'Open the financial dashboard and verify that the management surface loads correctly',
  inputSchema: {
    type: 'object',
    properties: {
      eventId: { type: 'string', description: 'Order event identifier (optional for traceability)' },
    },
  },
  requiresBrowser: true,
  tags: ['workflow', 'finance', 'phase1'],
}

export interface VerifyReportsPageInput {
  eventId?: string
}

export const verifyReportsPageHandler: ToolHandler = async (
  input: unknown,
  context: ToolContext,
): Promise<ToolResult> => {
  const { eventId } = input as VerifyReportsPageInput
  const resolvedEventId = eventId ?? (typeof context.artifacts?.['eventId'] === 'string' ? String(context.artifacts['eventId']) : undefined)

  if (!context.page) {
    return { ok: false, error: { code: 'missing_context', message: 'Playwright page is required for verifyReportsPage', retryable: false } }
  }

  try {
    const { openReportsPage, assertReportsPageLoaded } = await importReportsCapability()
    await openReportsPage(context.page)
    await assertReportsPageLoaded(context.page)
    return {
      ok: true,
      output: {
        eventId: resolvedEventId ?? null,
        reportsValidated: true,
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { code: 'capability_error', message, retryable: true } }
  }
}

export const verifyReportsPageMetadata: ToolMetadata = {
  name: 'verifyReportsPage',
  description: 'Open the reports page and verify that the management reports surface loads correctly',
  inputSchema: {
    type: 'object',
    properties: {
      eventId: { type: 'string', description: 'Order event identifier (optional for traceability)' },
    },
  },
  requiresBrowser: true,
  tags: ['workflow', 'reports', 'phase1'],
}

// --- Registration helper ---

export function registerWorkflowTools(registry: ToolRegistry): void {
  registry.register('createCustomer', createCustomerHandler, createCustomerMetadata)
  registry.register('scheduleOrder', scheduleOrderHandler, scheduleOrderMetadata)
  registry.register('openOrderDetails', openOrderDetailsHandler, openOrderDetailsMetadata)
  registry.register('completeFulfillment', completeFulfillmentHandler, completeFulfillmentMetadata)
  registry.register('findBillingGuideByEventId', findBillingGuideByEventIdHandler, findBillingGuideByEventIdMetadata)
  registry.register('verifyFinanceDashboard', verifyFinanceDashboardHandler, verifyFinanceDashboardMetadata)
  registry.register('verifyReportsPage', verifyReportsPageHandler, verifyReportsPageMetadata)
}

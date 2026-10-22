import type { AdapterCapabilityModel } from '../../../../packages/host-sdk/src/adapter-model.ts'

export const referenceStoreCapabilitiesModel: AdapterCapabilityModel[] = [
  { id: 'registerCustomer', purpose: 'Register customer records', sourceHint: 'integration-test/persona-tests/support/capabilities/customers.ts' },
  { id: 'createOrder', purpose: 'Create customer orders', sourceHint: 'integration-test/persona-tests/support/capabilities/orders.ts' },
  { id: 'openOrderDetails', purpose: 'Open order details', sourceHint: 'integration-test/persona-tests/support/capabilities/order-details.ts' },
  { id: 'fulfillOrder', purpose: 'Fulfill order from order details', sourceHint: 'integration-test/persona-tests/support/capabilities/order-details.ts' },
  { id: 'findInvoiceByOrderId', purpose: 'Locate and validate invoice by order', sourceHint: 'integration-test/persona-tests/support/capabilities/invoices.ts' },
  { id: 'verifyFinanceDashboard', purpose: 'Validate finance dashboard state', sourceHint: 'integration-test/persona-tests/support/capabilities/finance.ts' },
  { id: 'verifyReportsPage', purpose: 'Validate reports surface', sourceHint: 'integration-test/persona-tests/support/capabilities/reports.ts' },
]

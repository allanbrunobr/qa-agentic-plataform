import type { AdapterCapabilityModel } from '../../../../packages/host-sdk/src/adapter-model.ts'

export const referenceStoreCapabilitiesModel: AdapterCapabilityModel[] = [
  { id: 'createCustomer', purpose: 'Create customer records', sourceHint: 'integration-test/persona-tests/support/capabilities/customers.ts' },
  { id: 'scheduleOrder', purpose: 'Schedule fulfillments', sourceHint: 'integration-test/persona-tests/support/capabilities/orders.ts' },
  { id: 'openOrderDetails', purpose: 'Open customer operational record', sourceHint: 'integration-test/persona-tests/support/capabilities/order-details.ts' },
  { id: 'completeFulfillment', purpose: 'Complete fulfillment in order details', sourceHint: 'integration-test/persona-tests/support/capabilities/order-details.ts' },
  { id: 'findBillingGuideByEventId', purpose: 'Locate and validate Billing guide by event', sourceHint: 'integration-test/persona-tests/support/capabilities/billing.ts' },
  { id: 'verifyFinanceDashboard', purpose: 'Validate finance dashboard state', sourceHint: 'integration-test/persona-tests/support/capabilities/finance.ts' },
  { id: 'verifyReportsPage', purpose: 'Validate reports surface', sourceHint: 'integration-test/persona-tests/support/capabilities/reports.ts' },
]

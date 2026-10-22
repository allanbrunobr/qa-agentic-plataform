import type { AdapterPersonaModel } from '../../../../packages/host-sdk/src/adapter-model.ts'

export const referenceStorePersonasModel: AdapterPersonaModel[] = [
  {
    id: 'sales_associate',
    title: 'Sales Associate',
    goal: 'Register customers and create orders with evidence.',
    allowedCapabilities: ['registerCustomer', 'createOrder'],
  },
  {
    id: 'fulfillment_agent',
    title: 'Fulfillment Agent',
    goal: 'Fulfill orders and complete order details.',
    allowedCapabilities: ['openOrderDetails', 'fulfillOrder'],
  },
  {
    id: 'billing_clerk',
    title: 'Billing Clerk',
    goal: 'Review invoices and billing state.',
    allowedCapabilities: ['findInvoiceByOrderId'],
  },
  {
    id: 'store_manager',
    title: 'Store Manager',
    goal: 'Validate finance and reporting closure.',
    allowedCapabilities: ['verifyFinanceDashboard', 'verifyReportsPage'],
  },
]

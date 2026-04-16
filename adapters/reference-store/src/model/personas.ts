import type { AdapterPersonaModel } from '../../../../packages/host-sdk/src/adapter-model.ts'

export const referenceStorePersonasModel: AdapterPersonaModel[] = [
  {
    id: 'sales-associate',
    title: 'Sales Associate',
    goal: 'Register customers and schedule orders with evidence.',
    allowedCapabilities: ['createCustomer', 'scheduleOrder'],
  },
  {
    id: 'fulfillment-agent',
    title: 'Fulfillment Agent',
    goal: 'Complete fulfillment and operational documentation.',
    allowedCapabilities: ['openOrderDetails', 'completeFulfillment'],
  },
  {
    id: 'billing_clerk',
    title: 'Billing clerk',
    goal: 'Review insurance guide and Billing state.',
    allowedCapabilities: ['findBillingGuideByEventId'],
  },
  {
    id: 'store_manager',
    title: 'Gestor da Storea',
    goal: 'Validate finance and reporting closure.',
    allowedCapabilities: ['verifyFinanceDashboard', 'verifyReportsPage'],
  },
]

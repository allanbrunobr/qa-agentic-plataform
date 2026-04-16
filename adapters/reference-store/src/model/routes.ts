import type { AdapterRouteModel } from '../../../../packages/host-sdk/src/adapter-model.ts'

export const referenceStoreRoutesModel: AdapterRouteModel[] = [
  { id: 'customers', path: '/v2/customers/', purpose: 'customer registration and lookup' },
  { id: 'schedule', path: '/v2/agenda/', purpose: 'order scheduling and rescheduling' },
  { id: 'order-details', path: '/v2/registros/', purpose: 'operational fulfillment and record completion' },
  { id: 'billing', path: '/v2/billing/guias-pedido/', purpose: 'insurance guide review and Billing verification' },
  { id: 'finance', path: '/v2/painel-financeiro/', purpose: 'financial closure verification' },
  { id: 'reports', path: '/v2/relatorios/', purpose: 'reporting validation' },
]

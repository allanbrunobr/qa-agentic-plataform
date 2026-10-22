import type { AdapterRouteModel } from '../../../../packages/host-sdk/src/adapter-model.ts'

export const referenceStoreRoutesModel: AdapterRouteModel[] = [
  { id: 'customers', path: '/customers', purpose: 'customer registration and lookup' },
  { id: 'orders', path: '/orders', purpose: 'order creation and modification' },
  { id: 'order-details', path: '/orders/details', purpose: 'order fulfilment and detail completion' },
  { id: 'invoices', path: '/invoices', purpose: 'invoice review and billing verification' },
  { id: 'finance', path: '/finance', purpose: 'financial closure verification' },
  { id: 'reports', path: '/reports', purpose: 'reporting validation' },
]

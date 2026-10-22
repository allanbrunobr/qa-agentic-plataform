import type { AdapterPersonaModel } from '../../../../../packages/host-sdk/src/adapter-model.ts'

export const referenceStoreGeneratedPersonas: AdapterPersonaModel[] = [
  {
    "id": "sales_associate",
    "title": "Sales Associate",
    "goal": "Owns customer registration and order creation workflows.",
    "allowedCapabilities": [
      "registerCustomer",
      "createOrder",
      "captureScreenshot"
    ]
  },
  {
    "id": "fulfillment_agent",
    "title": "Fulfillment Agent",
    "goal": "Owns order details and fulfilment workflows.",
    "allowedCapabilities": [
      "openOrderDetails",
      "fulfillOrder",
      "captureScreenshot"
    ]
  },
  {
    "id": "billing_clerk",
    "title": "Billing Clerk",
    "goal": "Owns invoice review and billing workflow verification.",
    "allowedCapabilities": [
      "findInvoiceByOrderId",
      "captureScreenshot"
    ]
  },
  {
    "id": "store_manager",
    "title": "Store Manager",
    "goal": "Owns financial and reports closure validation.",
    "allowedCapabilities": [
      "verifyFinanceDashboard",
      "verifyReportsPage",
      "captureScreenshot"
    ]
  }
] as const

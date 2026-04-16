import type { AdapterPersonaModel } from '../../../../../packages/host-sdk/src/adapter-model.ts'

export const referenceStoreGeneratedPersonas: AdapterPersonaModel[] = [
  {
    "id": "sales-associate",
    "title": "Sales Associate",
    "goal": "Owns customer registration and scheduling workflows.",
    "allowedCapabilities": [
      "createCustomer",
      "scheduleOrder",
      "captureScreenshot"
    ]
  },
  {
    "id": "fulfillment-agent",
    "title": "Fulfillment Agent",
    "goal": "Owns operational record and fulfillment completion workflows.",
    "allowedCapabilities": [
      "openOrderDetails",
      "completeFulfillment",
      "captureScreenshot"
    ]
  },
  {
    "id": "billing_clerk",
    "title": "Billing clerk",
    "goal": "Owns guide review and insurance workflow verification.",
    "allowedCapabilities": [
      "findBillingGuideByEventId",
      "captureScreenshot"
    ]
  },
  {
    "id": "store_manager",
    "title": "Gestor da Storea",
    "goal": "Owns financial and reports closure validation.",
    "allowedCapabilities": [
      "verifyFinanceDashboard",
      "verifyReportsPage",
      "captureScreenshot"
    ]
  }
] as const

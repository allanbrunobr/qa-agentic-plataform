import type { AdapterScenarioModel } from '../../../../../packages/host-sdk/src/adapter-model.ts'

export const referenceStoreGeneratedScenarios: AdapterScenarioModel[] = [
  {
    "id": "first_order_multi_role",
    "title": "First order multi-role",
    "roles": [
      "sales-associate",
      "fulfillment-agent"
    ],
    "steps": [
      "create_customer",
      "schedule_order",
      "complete_fulfillment"
    ],
    "expectedArtifacts": [
      "customerId",
      "eventId",
      "fulfillmentCompleted"
    ],
    "stepDefinitions": [
      {
        "id": "create_customer",
        "roleId": "sales-associate",
        "capabilityId": "createCustomer",
        "producesArtifacts": [
          "customerId"
        ]
      },
      {
        "id": "schedule_order",
        "roleId": "sales-associate",
        "capabilityId": "scheduleOrder",
        "producesArtifacts": [
          "eventId"
        ]
      },
      {
        "id": "complete_fulfillment",
        "roleId": "fulfillment-agent",
        "capabilityId": "completeFulfillment",
        "producesArtifacts": [
          "fulfillmentCompleted"
        ]
      }
    ]
  },
  {
    "id": "quarterly_reorder_multi_role",
    "title": "Quarterly reorder multi-role",
    "roles": [
      "sales-associate",
      "fulfillment-agent",
      "billing_clerk"
    ],
    "steps": [
      "create_customer",
      "schedule_return",
      "complete_return_fulfillment",
      "review_billing_guide"
    ],
    "expectedArtifacts": [
      "customerId",
      "eventId",
      "fulfillmentCompleted",
      "billingGuideValidated"
    ],
    "stepDefinitions": [
      {
        "id": "create_customer",
        "roleId": "sales-associate",
        "capabilityId": "createCustomer",
        "producesArtifacts": [
          "customerId"
        ]
      },
      {
        "id": "schedule_return",
        "roleId": "sales-associate",
        "capabilityId": "scheduleOrder",
        "producesArtifacts": [
          "eventId"
        ]
      },
      {
        "id": "complete_return_fulfillment",
        "roleId": "fulfillment-agent",
        "capabilityId": "completeFulfillment",
        "producesArtifacts": [
          "fulfillmentCompleted"
        ]
      },
      {
        "id": "review_billing_guide",
        "roleId": "billing_clerk",
        "capabilityId": "findBillingGuideByEventId",
        "producesArtifacts": [
          "billingGuideValidated"
        ]
      }
    ]
  },
  {
    "id": "quarterly_reorder_closure_multi_role",
    "title": "Quarterly reorder closure multi-role",
    "roles": [
      "sales-associate",
      "fulfillment-agent",
      "billing_clerk",
      "store_manager"
    ],
    "steps": [
      "create_customer",
      "schedule_return",
      "complete_return_fulfillment",
      "review_billing_guide",
      "validate_closure"
    ],
    "expectedArtifacts": [
      "customerId",
      "eventId",
      "fulfillmentCompleted",
      "billingGuideValidated",
      "financeValidated",
      "reportsValidated"
    ],
    "stepDefinitions": [
      {
        "id": "create_customer",
        "roleId": "sales-associate",
        "capabilityId": "createCustomer",
        "producesArtifacts": [
          "customerId"
        ]
      },
      {
        "id": "schedule_return",
        "roleId": "sales-associate",
        "capabilityId": "scheduleOrder",
        "producesArtifacts": [
          "eventId"
        ]
      },
      {
        "id": "complete_return_fulfillment",
        "roleId": "fulfillment-agent",
        "capabilityId": "completeFulfillment",
        "producesArtifacts": [
          "fulfillmentCompleted"
        ]
      },
      {
        "id": "review_billing_guide",
        "roleId": "billing_clerk",
        "capabilityId": "findBillingGuideByEventId",
        "producesArtifacts": [
          "billingGuideValidated"
        ]
      },
      {
        "id": "validate_closure",
        "roleId": "store_manager",
        "capabilityId": "validateManagementClosure",
        "producesArtifacts": [
          "financeValidated",
          "reportsValidated"
        ]
      }
    ]
  }
] as const

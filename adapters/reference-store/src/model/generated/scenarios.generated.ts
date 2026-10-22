import type { AdapterScenarioModel } from '../../../../../packages/host-sdk/src/adapter-model.ts'

export const referenceStoreGeneratedScenarios: AdapterScenarioModel[] = [
  {
    "id": "first_order_multi_role",
    "title": "First order multi-role",
    "roles": [
      "sales_associate",
      "fulfillment_agent"
    ],
    "steps": [
      "register_customer",
      "create_order",
      "fulfill_order"
    ],
    "expectedArtifacts": [
      "customerId",
      "orderId",
      "orderFulfilled"
    ],
    "stepDefinitions": [
      {
        "id": "register_customer",
        "roleId": "sales_associate",
        "capabilityId": "registerCustomer",
        "producesArtifacts": [
          "customerId"
        ]
      },
      {
        "id": "create_order",
        "roleId": "sales_associate",
        "capabilityId": "createOrder",
        "producesArtifacts": [
          "orderId"
        ]
      },
      {
        "id": "fulfill_order",
        "roleId": "fulfillment_agent",
        "capabilityId": "fulfillOrder",
        "producesArtifacts": [
          "orderFulfilled"
        ]
      }
    ]
  },
  {
    "id": "quarterly_reorder_multi_role",
    "title": "Quarterly reorder multi-role",
    "roles": [
      "sales_associate",
      "fulfillment_agent",
      "billing_clerk"
    ],
    "steps": [
      "register_customer",
      "create_reorder",
      "fulfill_reorder",
      "review_invoice"
    ],
    "expectedArtifacts": [
      "customerId",
      "orderId",
      "orderFulfilled",
      "invoiceValidated"
    ],
    "stepDefinitions": [
      {
        "id": "register_customer",
        "roleId": "sales_associate",
        "capabilityId": "registerCustomer",
        "producesArtifacts": [
          "customerId"
        ]
      },
      {
        "id": "create_reorder",
        "roleId": "sales_associate",
        "capabilityId": "createOrder",
        "producesArtifacts": [
          "orderId"
        ]
      },
      {
        "id": "fulfill_reorder",
        "roleId": "fulfillment_agent",
        "capabilityId": "fulfillOrder",
        "producesArtifacts": [
          "orderFulfilled"
        ]
      },
      {
        "id": "review_invoice",
        "roleId": "billing_clerk",
        "capabilityId": "findInvoiceByOrderId",
        "producesArtifacts": [
          "invoiceValidated"
        ]
      }
    ]
  },
  {
    "id": "quarterly_reorder_closure_multi_role",
    "title": "Quarterly reorder closure multi-role",
    "roles": [
      "sales_associate",
      "fulfillment_agent",
      "billing_clerk",
      "store_manager"
    ],
    "steps": [
      "register_customer",
      "create_reorder",
      "fulfill_reorder",
      "review_invoice",
      "validate_closure"
    ],
    "expectedArtifacts": [
      "customerId",
      "orderId",
      "orderFulfilled",
      "invoiceValidated",
      "financeValidated",
      "reportsValidated"
    ],
    "stepDefinitions": [
      {
        "id": "register_customer",
        "roleId": "sales_associate",
        "capabilityId": "registerCustomer",
        "producesArtifacts": [
          "customerId"
        ]
      },
      {
        "id": "create_reorder",
        "roleId": "sales_associate",
        "capabilityId": "createOrder",
        "producesArtifacts": [
          "orderId"
        ]
      },
      {
        "id": "fulfill_reorder",
        "roleId": "fulfillment_agent",
        "capabilityId": "fulfillOrder",
        "producesArtifacts": [
          "orderFulfilled"
        ]
      },
      {
        "id": "review_invoice",
        "roleId": "billing_clerk",
        "capabilityId": "findInvoiceByOrderId",
        "producesArtifacts": [
          "invoiceValidated"
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

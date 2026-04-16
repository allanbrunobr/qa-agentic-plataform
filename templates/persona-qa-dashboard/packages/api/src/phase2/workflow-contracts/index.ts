import type { WorkflowContract } from '../types/scenario-types.js'
import { firstOrderWorkflowContract } from './first-order.js'
import { firstOrderMultiRoleWorkflowContract } from './first-order-multi-role.js'
import { quarterlyReorderClosureMultiRoleWorkflowContract } from './quarterly-reorder-closure-multi-role.js'
import { quarterlyReorderMultiRoleWorkflowContract } from './quarterly-reorder-multi-role.js'

export const workflowContracts = {
  first_order: firstOrderWorkflowContract,
  first_order_multi_role: firstOrderMultiRoleWorkflowContract,
  quarterly_reorder_multi_role: quarterlyReorderMultiRoleWorkflowContract,
  quarterly_reorder_closure_multi_role: quarterlyReorderClosureMultiRoleWorkflowContract,
} satisfies Record<string, WorkflowContract>

export type WorkflowContractId = keyof typeof workflowContracts

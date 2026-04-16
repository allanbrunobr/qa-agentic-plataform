import type { AdapterAuthModel } from '../../../../packages/host-sdk/src/adapter-model.ts'

export const referenceStoreAuthModel: AdapterAuthModel = {
  loginEntryPoint: '/login',
  supportsRoleSwitch: true,
  sessionHints: [
    'active store cookie is required for Billing and finance surfaces',
    'role changes must force a fresh authenticated session when context changes',
  ],
}

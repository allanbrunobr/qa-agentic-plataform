import type { AdapterAuthModel } from '../../../../packages/host-sdk/src/adapter-model.ts'

export const templateAuthModel: AdapterAuthModel = {
  loginEntryPoint: '/login',
  supportsRoleSwitch: false,
  sessionHints: [
    'replace with the real login entrypoint',
    'declare whether role switching requires a fresh authenticated session',
  ],
}

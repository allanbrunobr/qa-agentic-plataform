import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  RuntimeProviderSchema,
  listRuntimeProviders,
  loadRuntimeSettings,
  saveRuntimeSettings,
} from '../services/runtime-settings.js'

const UpdateRuntimeSettingsSchema = z.object({
  provider: RuntimeProviderSchema,
})

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings/runtime', async (_request, reply) => {
    const settings = loadRuntimeSettings()

    return reply.send({
      provider: settings.provider,
      supportedProviders: listRuntimeProviders(),
      appliesTo: 'next_run',
    })
  })

  app.patch('/api/settings/runtime', async (request, reply) => {
    const parsed = UpdateRuntimeSettingsSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_body',
        details: parsed.error.flatten(),
      })
    }

    const saved = await saveRuntimeSettings({
      provider: parsed.data.provider,
    })

    return reply.send({
      provider: saved.provider,
      supportedProviders: listRuntimeProviders(),
      appliesTo: 'next_run',
    })
  })
}


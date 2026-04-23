import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

export const RuntimeProviderSchema = z.enum(['anthropic', 'openai'])
export type RuntimeProvider = z.infer<typeof RuntimeProviderSchema>

export const RuntimeSettingsSchema = z.object({
  provider: RuntimeProviderSchema.default('anthropic'),
})

export type RuntimeSettings = z.infer<typeof RuntimeSettingsSchema>

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const API_PACKAGE_ROOT = path.resolve(__dirname, '../..')
const AGENTIC_QA_ROOT = path.resolve(API_PACKAGE_ROOT, '../..')
const RUNTIME_SETTINGS_PATH = path.join(AGENTIC_QA_ROOT, 'data', 'runtime-settings.json')

const PROVIDER_METADATA: Record<RuntimeProvider, { label: string; description: string }> = {
  anthropic: {
    label: 'Anthropic',
    description: 'Claude via Anthropic API.',
  },
  openai: {
    label: 'OpenAI',
    description: 'GPT via OpenAI Chat Completions API.',
  },
}

function parseRuntimeProvider(value: string | undefined): RuntimeProvider | null {
  const parsed = RuntimeProviderSchema.safeParse(value?.trim().toLowerCase())
  return parsed.success ? parsed.data : null
}

export function getRuntimeSettingsPath(): string {
  return RUNTIME_SETTINGS_PATH
}

export function listRuntimeProviders() {
  return Object.entries(PROVIDER_METADATA).map(([id, metadata]) => ({
    id: id as RuntimeProvider,
    label: metadata.label,
    description: metadata.description,
  }))
}

export function getDefaultRuntimeProvider(): RuntimeProvider {
  return (
    parseRuntimeProvider(process.env['MODEL_PROVIDER']) ??
    parseRuntimeProvider(process.env['LLM_PROVIDER']) ??
    'anthropic'
  )
}

export function loadRuntimeSettings(): RuntimeSettings {
  try {
    const raw = fs.readFileSync(RUNTIME_SETTINGS_PATH, 'utf8')
    const parsed = RuntimeSettingsSchema.safeParse(JSON.parse(raw))
    if (parsed.success) {
      return parsed.data
    }
  } catch {
    // Fall back to environment defaults when the settings file is absent or malformed.
  }

  return {
    provider: getDefaultRuntimeProvider(),
  }
}

export async function saveRuntimeSettings(nextSettings: RuntimeSettings): Promise<RuntimeSettings> {
  const parsed = RuntimeSettingsSchema.parse(nextSettings)
  await fs.promises.mkdir(path.dirname(RUNTIME_SETTINGS_PATH), { recursive: true })
  await fs.promises.writeFile(RUNTIME_SETTINGS_PATH, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
  return parsed
}


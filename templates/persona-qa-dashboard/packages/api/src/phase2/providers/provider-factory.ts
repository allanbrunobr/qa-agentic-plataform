import type { ModelProvider } from '../types/agent-types.js'
import { createAnthropicProvider, validateAnthropicApiKey } from './anthropic-provider.js'
import { createOpenAIProvider, validateOpenAIApiKey } from './openai-provider.js'
import { loadRuntimeSettings, type RuntimeProvider } from '../../services/runtime-settings.js'

export interface ProviderSelection {
  providerName: RuntimeProvider
  model: string
  provider: ModelProvider
}

function resolveRequestedProvider(provider?: RuntimeProvider): RuntimeProvider {
  return provider ?? loadRuntimeSettings().provider
}

function resolveOpenAIModel(requestedModel: string): string {
  if (requestedModel.startsWith('gpt-') || requestedModel.startsWith('o')) {
    return requestedModel
  }

  if (requestedModel.includes('haiku')) {
    return process.env.OPENAI_MODEL_FAST ?? 'gpt-4.1-mini'
  }

  return process.env.OPENAI_MODEL_SMART ?? process.env.OPENAI_MODEL_DEFAULT ?? 'gpt-4.1'
}

export function resolveProviderModel(providerName: RuntimeProvider, requestedModel: string): string {
  if (providerName === 'openai') {
    return resolveOpenAIModel(requestedModel)
  }

  return requestedModel
}

export function createModelProvider(options: { model: string; provider?: RuntimeProvider }): ProviderSelection {
  const providerName = resolveRequestedProvider(options.provider)
  const model = resolveProviderModel(providerName, options.model)

  if (providerName === 'openai') {
    return {
      providerName,
      model,
      provider: createOpenAIProvider(model),
    }
  }

  return {
    providerName,
    model,
    provider: createAnthropicProvider(model),
  }
}

export async function validateProviderCredentials(
  providerName: RuntimeProvider,
): Promise<{ ok: boolean; status?: number; message: string }> {
  if (providerName === 'openai') {
    return validateOpenAIApiKey(process.env.OPENAI_API_KEY ?? '')
  }

  return validateAnthropicApiKey(process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API ?? '')
}


// ============================================================
// AI provider presets — shared by the settings UI and the server.
// "Paid" presets are hosted APIs that need a key; "open source"
// presets run open-weight models either on a hosted inference API
// (Groq, Together, OpenRouter) or on your own machine (Ollama,
// LM Studio, vLLM) through the OpenAI-compatible protocol.
// ============================================================

import type { AIProviderKind } from '@/lib/db/types'

export interface AIPreset {
  id: string
  label: string
  kind: AIProviderKind
  category: 'paid' | 'open_source' | 'local'
  baseUrl: string | null
  /** Base URL can be edited (self-hosted / custom gateways). */
  customBaseUrl: boolean
  requiresKey: boolean
  defaultModel: string
  suggestedModels: string[]
  keyHelpUrl: string | null
}

export const AI_PRESETS: AIPreset[] = [
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    kind: 'anthropic',
    category: 'paid',
    baseUrl: null,
    customBaseUrl: false,
    requiresKey: true,
    defaultModel: 'claude-opus-5',
    suggestedModels: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    keyHelpUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai_compatible',
    category: 'paid',
    baseUrl: 'https://api.openai.com/v1',
    customBaseUrl: false,
    requiresKey: true,
    defaultModel: 'gpt-4o-mini',
    suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    keyHelpUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'gemini',
    category: 'paid',
    baseUrl: null,
    customBaseUrl: false,
    requiresKey: true,
    defaultModel: 'gemini-2.5-flash',
    suggestedModels: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    keyHelpUrl: 'https://aistudio.google.com/app/apikey',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai_compatible',
    category: 'paid',
    baseUrl: 'https://api.deepseek.com/v1',
    customBaseUrl: false,
    requiresKey: true,
    defaultModel: 'deepseek-chat',
    suggestedModels: ['deepseek-chat'],
    keyHelpUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'groq',
    label: 'Groq (Llama, Qwen — open models)',
    kind: 'openai_compatible',
    category: 'open_source',
    baseUrl: 'https://api.groq.com/openai/v1',
    customBaseUrl: false,
    requiresKey: true,
    defaultModel: 'llama-3.3-70b-versatile',
    suggestedModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    keyHelpUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (many open models)',
    kind: 'openai_compatible',
    category: 'open_source',
    baseUrl: 'https://openrouter.ai/api/v1',
    customBaseUrl: false,
    requiresKey: true,
    defaultModel: 'meta-llama/llama-3.3-70b-instruct',
    suggestedModels: ['meta-llama/llama-3.3-70b-instruct', 'qwen/qwen-2.5-72b-instruct', 'mistralai/mistral-small'],
    keyHelpUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'together',
    label: 'Together AI (open models)',
    kind: 'openai_compatible',
    category: 'open_source',
    baseUrl: 'https://api.together.xyz/v1',
    customBaseUrl: false,
    requiresKey: true,
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    suggestedModels: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo'],
    keyHelpUrl: 'https://api.together.xyz/settings/api-keys',
  },
  {
    id: 'kimi',
    label: 'Kimi (Moonshot AI)',
    kind: 'openai_compatible',
    category: 'open_source',
    baseUrl: 'https://api.moonshot.ai/v1',
    customBaseUrl: false,
    requiresKey: true,
    defaultModel: 'kimi-k2-turbo-preview',
    suggestedModels: ['kimi-k2-turbo-preview', 'kimi-k2-0905-preview', 'moonshot-v1-8k'],
    keyHelpUrl: 'https://platform.moonshot.ai/console/api-keys',
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM (GPT-OSS, Nemotron, Kimi, DeepSeek)',
    kind: 'openai_compatible',
    category: 'open_source',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    customBaseUrl: false,
    requiresKey: true,
    // NVIDIA's catalogue lists far more models than any one key may
    // call, and the big reasoning models queue for minutes on the free
    // tier — too slow for a live WhatsApp reply. Only models verified
    // to answer a structured request quickly are suggested here; the
    // Test button is the real check.
    defaultModel: 'openai/gpt-oss-20b',
    suggestedModels: ['openai/gpt-oss-20b', 'nvidia/nemotron-3-super-120b-a12b'],
    keyHelpUrl: 'https://build.nvidia.com',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    kind: 'openai_compatible',
    category: 'paid',
    baseUrl: 'https://api.mistral.ai/v1',
    customBaseUrl: false,
    requiresKey: true,
    defaultModel: 'mistral-small-latest',
    suggestedModels: ['mistral-small-latest', 'mistral-large-latest'],
    keyHelpUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'ollama',
    label: 'Ollama (self-hosted, free)',
    kind: 'openai_compatible',
    category: 'local',
    baseUrl: 'http://localhost:11434/v1',
    customBaseUrl: true,
    requiresKey: false,
    defaultModel: 'llama3.1',
    suggestedModels: ['llama3.1', 'qwen2.5', 'mistral', 'gemma2'],
    keyHelpUrl: 'https://ollama.com/download',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (self-hosted, free)',
    kind: 'openai_compatible',
    category: 'local',
    baseUrl: 'http://localhost:1234/v1',
    customBaseUrl: true,
    requiresKey: false,
    defaultModel: 'local-model',
    suggestedModels: [],
    keyHelpUrl: 'https://lmstudio.ai',
  },
  {
    id: 'custom',
    label: 'Custom OpenAI-compatible (vLLM, LocalAI, gateway)',
    kind: 'openai_compatible',
    category: 'open_source',
    baseUrl: '',
    customBaseUrl: true,
    requiresKey: false,
    defaultModel: '',
    suggestedModels: [],
    keyHelpUrl: null,
  },
]

export function getPreset(id: string): AIPreset | undefined {
  return AI_PRESETS.find((p) => p.id === id)
}

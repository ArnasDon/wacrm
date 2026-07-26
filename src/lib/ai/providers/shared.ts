export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface StructuredOutputContract {
  name: string
  description?: string
  schema: Record<string, unknown>
}

export interface ProviderArgs {
  apiKey: string
  model: string
  systemPrompt: string
  messages: ChatMessage[]
  timeoutMs: number
  maxTokens: number
  signal?: AbortSignal
  /** OpenAI-only: request Chat Completions JSON mode. Anthropic has no
   *  equivalent flag in the raw Messages API used here — generateJson
   *  relies on strict prompting + tolerant parsing for that provider. */
  responseFormat?: 'json_object'
  /** Native structured-output contract. Adapters must fail closed when
   * the selected model cannot honor it; this never falls back to free JSON. */
  structuredOutput?: StructuredOutputContract
}

export interface ProviderResult {
  text: string
  structuredData?: unknown
  usage: { promptTokens: number; completionTokens: number } | null
}

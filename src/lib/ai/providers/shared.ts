export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ProviderArgs {
  apiKey: string
  model: string
  systemPrompt: string
  messages: ChatMessage[]
  timeoutMs: number
  /** OpenAI-only: request Chat Completions JSON mode. Anthropic has no
   *  equivalent flag in the raw Messages API used here — generateJson
   *  relies on strict prompting + tolerant parsing for that provider. */
  responseFormat?: 'json_object'
}

export interface ProviderResult {
  text: string
  usage: { promptTokens: number; completionTokens: number } | null
}

export type AiProvider = 'openai' | 'anthropic'

export interface AiConfig {
  accountId: string
  provider: AiProvider
  model: string
  apiKey: string
  agentEnabled: boolean
  pipelineMoveEnabled: boolean
  knowledgeEnabled: boolean
  embeddingsModel: string
  embeddingsApiKey: string | null
  autoReplyMaxPerConversation: number
  handoffAgentId: string | null
}

export interface AiUsage {
  promptTokens: number
  completionTokens: number
}

export class AiError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, opts: { code: string; status?: number }) {
    super(message)
    this.name = 'AiError'
    this.code = opts.code
    this.status = opts.status ?? 500
  }
}

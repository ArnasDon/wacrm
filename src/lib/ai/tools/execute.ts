import { logToolEvent } from './log'
import type { ToolCall, ToolExecutionResult, ToolExecutor } from './loop-types'

/**
 * Run one tool call against `executor` with a hard wall-clock budget.
 * Never throws — a timeout, or any exception the executor itself lets
 * through, becomes an `isError: true` result the model sees as a
 * recoverable failure, and is always logged first (see log.ts) so it
 * doesn't disappear silently. This is what both provider tool loops
 * (anthropic.ts / openai.ts) call for every `tool_use` block.
 */
export async function executeToolCallWithTimeout(
  call: ToolCall,
  executor: ToolExecutor,
  timeoutMs: number,
): Promise<ToolExecutionResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<ToolExecutionResult>((resolve) => {
    timer = setTimeout(() => {
      logToolEvent('tool_timeout', {
        toolName: call.name,
        toolCallId: call.id,
        detail: `Tool call exceeded the ${timeoutMs}ms budget.`,
      })
      resolve({
        content: `A ferramenta "${call.name}" demorou demasiado tempo a responder. Tenta de novo ou informa o utilizador.`,
        isError: true,
      })
    }, timeoutMs)
  })

  const run = (async (): Promise<ToolExecutionResult> => {
    try {
      const result = await executor(call)
      if (result.isError) {
        logToolEvent('tool_error', {
          toolName: call.name,
          toolCallId: call.id,
          detail: result.content,
        })
      }
      return result
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      logToolEvent('tool_exception', {
        toolName: call.name,
        toolCallId: call.id,
        detail,
      })
      return {
        content: `A ferramenta "${call.name}" falhou inesperadamente: ${detail}`,
        isError: true,
      }
    }
  })()

  try {
    return await Promise.race([run, timeout])
  } finally {
    clearTimeout(timer)
  }
}

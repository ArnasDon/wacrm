// ============================================================
// Structured logging for the tool-calling loop. Tool errors are always
// reported back to the model as a `tool_result` (never let a failed
// tool crash the conversation), but they must never be swallowed
// either — every failure path here also emits one structured line so
// it's greppable/alertable in production logs.
// ============================================================

export type ToolLogEvent =
  | 'tool_error'
  | 'tool_timeout'
  | 'tool_exception'
  | 'iteration_limit_reached'

export function logToolEvent(
  event: ToolLogEvent,
  ctx: {
    toolName?: string
    toolCallId?: string
    iterations?: number
    detail: string
  },
): void {
  console.error(
    JSON.stringify({
      component: 'eter-agent-tool-loop',
      event,
      ...ctx,
      at: new Date().toISOString(),
    }),
  )
}

import { createAgentNotification } from '@/lib/eter/repo/notifications.repo'
import type { ToolExecutionResult } from '../loop-types'
import type { ToolHandlerContext } from './context'
import { requireString, optionalEnum, ToolInputError } from './parse-input'

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

const TITLE_MAX = 80

/** notify_admin — executes directly. Uses `notifications` (migration
 *  027, extended by 038 with `type: 'agent_notification'`) as the
 *  delivery channel, via notifications.repo.ts. Requires a configured
 *  recipient (`ctx.defaultNotifyUserId`, typically the account's
 *  `ai_configs.handoff_agent_id`) — with none configured this is a
 *  reported tool error, not a silently dropped alert. */
export async function notifyAdminHandler(
  ctx: ToolHandlerContext,
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  try {
    const message = requireString(input, 'message')
    const priority = optionalEnum(input, 'priority', PRIORITIES)

    if (!ctx.defaultNotifyUserId) {
      return {
        isError: true,
        content:
          'Não há nenhum administrador configurado para receber notificações nesta conta (falta handoff_agent_id em ai_configs).',
      }
    }

    const title =
      message.length > TITLE_MAX ? `${message.slice(0, TITLE_MAX - 1).trimEnd()}…` : message

    await createAgentNotification(ctx.db, ctx.accountId, {
      userId: ctx.defaultNotifyUserId,
      title: priority ? `[${priority}] ${title}` : title,
      body: message,
      conversationId: ctx.conversationId,
      contactId: ctx.contactId,
    })

    return { isError: false, content: 'Notificação enviada ao administrador.' }
  } catch (err) {
    if (err instanceof ToolInputError) return { isError: true, content: err.message }
    throw err
  }
}

import { supabaseAdmin } from '@/lib/supabase/admin'
import { createResendClient, loadEmailConfig } from '@/lib/email/send'

/**
 * Entrega de un `send_email` de automatización.
 *
 * Vive aparte del engine porque hay DOS caminos que la necesitan: el paso
 * en vivo (`runStep`) y el drenaje de `message_queue`, que reproduce un
 * envío que la cuota diaria aplazó. Si el cuerpo siguiera dentro del
 * switch del engine, el drenaje tendría que copiarlo — que es justo cómo
 * el resto de canales acabaron con cinco copias del mismo pipeline.
 *
 * El asunto y el HTML llegan YA interpolados: la sustitución de variables
 * necesita el `ExecuteArgs` de la ejecución, que no sobrevive a la cola.
 * Se renderiza antes de consultar la cuota y se guarda el resultado en el
 * payload, igual que `send_message` hace con su texto.
 */
export async function deliverAutomationEmail(args: {
  accountId: string
  contactId: string
  /** Null cuando el envío se reproduce desde la cola. */
  automationId: string | null
  templateName: string
  recipient: string
  subject: string
  html: string
}): Promise<{ resendMessageId: string }> {
  const { apiKey, fromEmail, replyTo } = await loadEmailConfig(args.accountId)
  const { id: resendMessageId } = await createResendClient(apiKey).send(
    fromEmail,
    replyTo,
    { to: args.recipient, subject: args.subject, html: args.html },
  )

  // Persistir en email_sends (DAD §7.7 — Item 13 del plan §13): el webhook de
  // Resend actualiza status/contadores por resend_message_id (048).
  await supabaseAdmin().from('email_sends').insert({
    account_id: args.accountId,
    contact_id: args.contactId,
    automation_id: args.automationId,
    template_name: args.templateName,
    recipient: args.recipient,
    subject: args.subject,
    html: args.html,
    status: 'sent',
    resend_message_id: resendMessageId,
  })

  return { resendMessageId }
}

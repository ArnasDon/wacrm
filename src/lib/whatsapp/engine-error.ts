import { SendMessageError } from '@/lib/whatsapp/send-error';

/**
 * Traduz uma falha do núcleo de volta às mensagens que os engines de
 * Flows e Automations lançavam antes da extração do seam. Essas strings
 * chegam a `automation_logs` e aos logs do runner, então são visíveis ao
 * usuário: mantê-las idênticas é parte do critério de aceite da Onda 0.
 *
 * O mapeamento é por `reason`, não por `code`, porque `code` é contrato
 * público e agrupa casos que os engines reportam separados.
 */
export function toEngineError(err: unknown): Error {
  if (!(err instanceof SendMessageError)) {
    return err instanceof Error ? err : new Error(String(err));
  }
  switch (err.reason) {
    case 'contact_not_found':
      return new Error('contact not found for this account');
    case 'contact_phone_invalid':
      return new Error(`contact phone invalid: ${String(err.cause)}`);
    case 'not_configured':
      return new Error('WhatsApp not configured for this account');
    // Os engines sempre propagaram o erro cru do provedor, sem o
    // prefixo "Meta API error:" que a API pública usa.
    case 'provider_error':
      return err.cause instanceof Error
        ? err.cause
        : new Error(String(err.cause));
    case 'message_insert_failed':
      return new Error(
        `sent to Meta but DB insert failed: ${String(err.cause)}`
      );
    default:
      return new Error(err.message);
  }
}

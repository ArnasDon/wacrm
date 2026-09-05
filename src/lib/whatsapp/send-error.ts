/**
 * Motivo fino de uma falha de envio. Existe porque `code` é contrato
 * público (`/api/v1/messages` o serializa cru) e agrupa casos que os
 * engines de Flows e Automations reportam com mensagens distintas.
 * Nunca sai do processo.
 */
export type SendFailureReason =
  | 'conversation_not_found'
  | 'contact_not_found'
  | 'contact_phone_invalid'
  | 'not_configured'
  | 'unsupported_capability'
  | 'template_malformed'
  | 'provider_error'
  | 'message_insert_failed';

/**
 * Falha tipada com um `code` de máquina e um `status` HTTP sugerido. Os
 * chamadores mapeiam para o próprio formato de resposta
 * (`toErrorResponse` na rota do dashboard, o envelope v1 na pública,
 * `toEngineError` nos engines).
 */
export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  readonly reason?: SendFailureReason;

  constructor(
    code: string,
    message: string,
    status: number,
    options?: { reason?: SendFailureReason; cause?: unknown }
  ) {
    super(
      message,
      options?.cause !== undefined ? { cause: options.cause } : undefined
    );
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
    this.reason = options?.reason;
  }
}

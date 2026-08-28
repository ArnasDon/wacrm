import { createMetaTransport } from './meta-transport';
import type { TransportConnection, WhatsAppTransport } from './types';

export * from './types';
export { createMetaTransport } from './meta-transport';

/**
 * Monta o transporte da conexão. A Onda 0 só conhece a Meta; a Onda 1
 * acrescenta o ramo `'uazapi'` e nada mais neste arquivo muda.
 */
export function createTransport(conn: TransportConnection): WhatsAppTransport {
  switch (conn.provider) {
    case 'meta':
      return createMetaTransport(conn);
    default:
      throw new Error(
        `No transport implemented for provider "${conn.provider}"`
      );
  }
}

import { createMetaTransport } from './meta-transport';
import { createUazapiTransport } from './uazapi-transport';
import type { TransportConnection, WhatsAppTransport } from './types';

export * from './types';
export { createMetaTransport } from './meta-transport';
export { createUazapiTransport } from './uazapi-transport';

/**
 * Monta o transporte da conexão. A união `TransportConnection` é
 * discriminada por `provider` e exaustiva (`meta | uazapi`) — o
 * typecheck garante que todo ramo está coberto, sem `default`.
 */
export function createTransport(conn: TransportConnection): WhatsAppTransport {
  switch (conn.provider) {
    case 'meta':
      return createMetaTransport(conn);
    case 'uazapi':
      return createUazapiTransport(conn);
  }
}

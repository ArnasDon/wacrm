import { decrypt } from '@/lib/whatsapp/encryption'
import type { ZapiCredentials } from '@/lib/whatsapp/zapi-api'

export interface ZapiConfigRow {
  zapi_instance_id?: string | null
  zapi_instance_token?: string | null
  zapi_client_token?: string | null
}

export function buildZapiCredentials(config: ZapiConfigRow): ZapiCredentials | null {
  if (!config.zapi_instance_id || !config.zapi_instance_token || !config.zapi_client_token) {
    return null
  }

  return {
    instanceId: config.zapi_instance_id,
    instanceToken: decrypt(config.zapi_instance_token),
    clientToken: decrypt(config.zapi_client_token),
  }
}

export function requireZapiCredentials(config: ZapiConfigRow): ZapiCredentials {
  const credentials = buildZapiCredentials(config)
  if (!credentials) {
    throw new Error('Z-API is not configured for this account')
  }
  return credentials
}

import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
} from 'baileys'

import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { supabaseAdmin } from './admin-client'

/**
 * Supabase-backed AuthenticationState for Baileys, mirroring the shape
 * of Baileys' own reference `useMultiFileAuthState` (node_modules/
 * baileys/lib/Utils/use-multi-file-auth-state.js) but persisting to two
 * tables instead of one JSON file per key:
 *
 *   - `baileys_sessao.creds_criptografado` — the (small) creds object,
 *     rewritten whole on every `saveCreds()`.
 *   - `baileys_sessao_keys` — one row per (tipo, key_id) signal key, so
 *     the frequent `keys.set()` calls during normal operation (message
 *     ratchet updates, prekey consumption, etc.) touch only the rows
 *     that changed instead of rewriting one giant blob.
 *
 * Every value is JSON-serialized with `BufferJSON` (Baileys' own
 * Buffer/Uint8Array-safe replacer/reviver — creds and signal keys are
 * full of binary key material) and then encrypted with the same
 * `encrypt()`/`decrypt()` (AES-256-GCM, ENCRYPTION_KEY) already used
 * for `whatsapp_config.access_token` — no new secret-storage mechanism.
 */

export interface SupabaseAuthState {
  sessaoId: string
  state: AuthenticationState
  saveCreds: () => Promise<void>
}

function serialize(value: unknown): string {
  return encrypt(JSON.stringify(value, BufferJSON.replacer))
}

function deserialize<T>(ciphertext: string): T {
  return JSON.parse(decrypt(ciphertext), BufferJSON.reviver) as T
}

export async function getSupabaseAuthState(
  accountId: string,
  identificador = 'principal',
): Promise<SupabaseAuthState> {
  const db = supabaseAdmin()

  const { data: existing, error: selErr } = await db
    .from('baileys_sessao')
    .select('id, creds_criptografado')
    .eq('account_id', accountId)
    .eq('identificador', identificador)
    .maybeSingle()
  if (selErr) {
    throw new Error(`[baileys/auth-state] failed to load session row: ${selErr.message}`)
  }

  let sessaoId: string
  // `creds` is mutated in place by Baileys (registration id, signed
  // pre-key rotation, `me`, etc.) — saveCreds() below closes over this
  // same reference, so it always persists the latest state as long as
  // we never reassign the variable, only its properties.
  let creds: AuthenticationCreds

  if (existing) {
    sessaoId = existing.id as string
    creds = existing.creds_criptografado
      ? deserialize<AuthenticationCreds>(existing.creds_criptografado as string)
      : initAuthCreds()
  } else {
    creds = initAuthCreds()
    const { data: created, error: insErr } = await db
      .from('baileys_sessao')
      .insert({
        account_id: accountId,
        identificador,
        creds_criptografado: serialize(creds),
      })
      .select('id')
      .single()
    if (insErr || !created) {
      throw new Error(
        `[baileys/auth-state] failed to create session row: ${insErr?.message ?? 'unknown error'}`,
      )
    }
    sessaoId = created.id as string
  }

  const saveCreds = async () => {
    const { error } = await db
      .from('baileys_sessao')
      .update({ creds_criptografado: serialize(creds) })
      .eq('id', sessaoId)
    if (error) {
      console.error('[baileys/auth-state] saveCreds failed:', error.message)
    }
  }

  const keys = {
    async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
      const data: { [id: string]: SignalDataTypeMap[T] } = {}
      if (ids.length === 0) return data

      const { data: rows, error } = await db
        .from('baileys_sessao_keys')
        .select('key_id, valor_criptografado')
        .eq('sessao_id', sessaoId)
        .eq('tipo', type)
        .in('key_id', ids)
      if (error) {
        console.error('[baileys/auth-state] keys.get failed:', error.message)
        return data
      }

      for (const row of rows ?? []) {
        if (!row.valor_criptografado) continue
        let value = deserialize<unknown>(row.valor_criptografado as string)
        // Mirrors use-multi-file-auth-state.js: app-state-sync-key data
        // is a proto message, not a plain object — round-tripping it
        // through JSON needs this explicit reconstruction.
        if (type === 'app-state-sync-key' && value) {
          value = proto.Message.AppStateSyncKeyData.fromObject(value as Record<string, unknown>)
        }
        data[row.key_id as string] = value as SignalDataTypeMap[T]
      }
      return data
    },

    async set(data: SignalDataSet) {
      const upserts: {
        sessao_id: string
        tipo: string
        key_id: string
        valor_criptografado: string
        updated_at: string
      }[] = []
      const deletions: { tipo: string; key_id: string }[] = []
      const now = new Date().toISOString()

      for (const tipo of Object.keys(data) as (keyof SignalDataSet)[]) {
        const category = data[tipo]
        if (!category) continue
        for (const key_id of Object.keys(category)) {
          const value = category[key_id]
          if (value == null) {
            deletions.push({ tipo, key_id })
          } else {
            upserts.push({
              sessao_id: sessaoId,
              tipo,
              key_id,
              valor_criptografado: serialize(value),
              updated_at: now,
            })
          }
        }
      }

      if (upserts.length > 0) {
        const { error } = await db
          .from('baileys_sessao_keys')
          .upsert(upserts, { onConflict: 'sessao_id,tipo,key_id' })
        if (error) console.error('[baileys/auth-state] keys.set upsert failed:', error.message)
      }
      for (const { tipo, key_id } of deletions) {
        const { error } = await db
          .from('baileys_sessao_keys')
          .delete()
          .eq('sessao_id', sessaoId)
          .eq('tipo', tipo)
          .eq('key_id', key_id)
        if (error) console.error('[baileys/auth-state] keys.set delete failed:', error.message)
      }
    },
  }

  return { sessaoId, state: { creds, keys }, saveCreds }
}

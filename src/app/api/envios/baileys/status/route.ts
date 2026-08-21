import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { getConnectionEntry } from '@/lib/baileys/connection'

/**
 * Read-only status for the pairing screen — never opens a socket
 * itself (that's POST .../parear). Any account member can view it
 * (same visibility as `whatsapp_config`'s SELECT policy); the QR image
 * only exists in this process's memory (`connection.ts`), so it's
 * returned here rather than read straight off the DB row like
 * `status_conexao` could be.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data: sessao } = await supabase
      .from('baileys_sessao')
      .select('status_conexao, updated_at')
      .eq('account_id', accountId)
      .eq('identificador', 'principal')
      .maybeSingle()

    const entry = getConnectionEntry(accountId)

    return NextResponse.json({
      status: sessao?.status_conexao ?? 'desconectado',
      updatedAt: sessao?.updated_at ?? null,
      qrDataUrl: entry?.qrDataUrl ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

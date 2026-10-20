import { headers } from 'next/headers';
import { supabaseAdmin } from '@/lib/push/admin-client';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface TunnelAuthContext {
  db: SupabaseClient;
  accountId: string;
}

/**
 * Valida a autenticação entre WACRM e Meus Imóveis.
 * Aceita Bearer token configurado em TUNNEL_API_KEY ou service role key.
 */
export async function authenticateTunnelRequest(request: Request): Promise<TunnelAuthContext | null> {
  let authHeader = request?.headers?.get('authorization') || '';
  if (!authHeader) {
    try {
      const reqHeaders = await headers();
      authHeader = reqHeaders.get('authorization') || '';
    } catch {
      // Executando fora do escopo de requisição Next.js (ex: testes unitários)
    }
  }
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  const configuredKey = process.env.TUNNEL_API_KEY;

  // Validação estrita e exclusiva de TUNNEL_API_KEY (Fail-Closed)
  // SUPABASE_SERVICE_ROLE_KEY NÃO é aceita como credencial do túnel
  if (!configuredKey || !token || token !== configuredKey) {
    return null;
  }

  const db = supabaseAdmin();

  // 1. Se o cliente túnel autenticado especificar x-account-id válido, respeita-o
  const requestedAccountId = request?.headers?.get('x-account-id')?.trim();
  if (requestedAccountId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedAccountId)) {
    return {
      db,
      accountId: requestedAccountId.toLowerCase(),
    };
  }

  // 2. Se houver conta canônica configurada via env, utiliza-a
  if (process.env.MATCH_CANONICAL_ACCOUNT_ID) {
    return {
      db,
      accountId: process.env.MATCH_CANONICAL_ACCOUNT_ID.trim(),
    };
  }

  // 2. Resolve a conta operacional principal do Ronaldo Meira (f8d2ae51-e393-4a74-a432-ddab0610837e)
  //    ou a conta com default_currency = 'BRL' / maior base de contatos reais
  const { data: realProfile } = await db
    .from('profiles')
    .select('account_id')
    .eq('email', 'ronaldomeiracorretor@gmail.com')
    .not('account_id', 'is', null)
    .limit(1)
    .maybeSingle();

  if (realProfile?.account_id) {
    return {
      db,
      accountId: realProfile.account_id,
    };
  }

  const { data: account } = await db
    .from('accounts')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!account) {
    return null;
  }

  return {
    db,
    accountId: account.id,
  };
}

/**
 * Converte qualquer identificador de imóvel (ex: 'dev-c7a289bfd98a050a' ou UUID)
 * para o mesmo UUID determinístico usado pelo adaptador do Meus Imóveis.
 */
export function ensurePropertyUuid(id: string): string {
  const clean = (id || '').trim();
  if (!clean) return '00000000-0000-4000-8000-000000000000';
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(clean)) {
    return clean.toLowerCase();
  }

  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = ((hash << 5) - hash) + clean.charCodeAt(i);
    hash |= 0;
  }
  const hex =
    Math.abs(hash).toString(16).padStart(8, '0') +
    (clean.length * 31).toString(16).padStart(8, '0') +
    'a1b2c3d4e5f6';

  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    '4' + hex.substring(13, 16),
    'a' + hex.substring(17, 20),
    hex.substring(20, 32).padEnd(12, '0'),
  ].join('-');
}

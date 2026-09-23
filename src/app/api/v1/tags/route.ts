// ============================================================
// GET /api/v1/tags — o catálogo de tags da conta (scope: contacts:read)
//
// Existe para quem integra descobrir o catálogo — sem isso, a única
// maneira seria abrir o dashboard e ler a tela. As três portas que
// etiquetam contato (`POST /contacts`, `PATCH /contacts/{id}` e
// `POST /contacts/{id}/tags`) aceitam tanto o `name` quanto o `id`
// devolvidos aqui. ⚠️ Até 22/09/2026 aceitavam só nome, e um integrador
// que mandou o `id` desta lista criou uma etiqueta chamada com o UUID —
// ver `src/lib/api/v1/tags-do-contato.ts`.
//
// Escopo `contacts:read` em vez de um `tags:read` próprio: tag só
// existe para etiquetar contato, e uma chave que lê contato já recebe
// as tags dele embutidas em `GET /api/v1/contacts`. Um escopo a mais
// não esconderia nada.
//
// Não paginado: o catálogo é de dezenas de linhas, não de milhares — e
// não se repete por nome, porque a 983 pôs um índice único em
// `(account_id, name_key)` (nome aparado, sem acento e sem caixa).
// Ordem ALFABÉTICA, estável — é a mesma régua das outras listas planas
// da v1.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ApiError, ok, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:read');

    const { data, error } = await ctx.supabase
      .from('tags')
      .select('id, name, color')
      .eq('account_id', ctx.accountId)
      .order('name');

    if (error) {
      console.error('[api/v1/tags] list error:', error);
      throw new ApiError('internal', 'Failed to list tags', 500);
    }

    return ok(data ?? []);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

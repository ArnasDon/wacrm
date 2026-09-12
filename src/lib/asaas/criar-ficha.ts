import type { SupabaseClient } from "@supabase/supabase-js";

import { findExistingContact, isUniqueViolation } from "@/lib/contacts/dedupe";
import { resolveImportTagIds } from "@/lib/contacts/resolve-import-tags";
import { variantesDoNonoDigito } from "@/lib/contacts/telefone";

/**
 * A ficha que NASCE do Asaas (D2, decidida pelo operador em 12/09/2026):
 * para o cliente do Asaas com telefone e sem ficha no CRM, o ciclo cria o
 * CONTATO — e só ele. I/O.
 *
 * O que morde:
 *
 * - `findExistingContact` vem primeiro, como PORTÃO anti-duplicata (últimos
 *   8 dígitos, tolerante a tronco) — não como vínculo. Se ele devolver ficha
 *   cujo número NÃO é igual nem irmã do nono dígito do número do Asaas, o
 *   ciclo NÃO cria e NÃO liga: devolve o candidato, e o cliente vai para
 *   "Para confirmar" (D5). Se devolver a irmã/igual, é um vínculo por
 *   TELEFONE que a leitura em memória perdeu por corrida (a ficha nasceu
 *   entre o índice e agora) — liga, não cria.
 * - ⚠️ `contacts.user_id` é o DONO DA CONTA (`accounts.owner_user_id`),
 *   resolvido SEM fallback: a coluna cascateia de `auth.users`, e o dono é
 *   o único login que a conta impede de apagar (971). Há varredura
 *   estrutural cobrando isto (`src/lib/contacts/dono-duravel.test.ts`).
 * - 23505 na corrida = reler e aplicar a mesma régua.
 * - A ficha recebe a etiqueta `asaas` por `resolveImportTagIds` (a régua
 *   única de etiqueta), com INSERT direto em `contact_tags`: a ficha entra
 *   em "todos os contatos" do disparo e nos filtros, e a etiqueta é o que
 *   deixa o operador excluí-la (ou achá-la). ⚠️ Direto, e não por
 *   `tag-events.ts`: aquele caminho dispara o gatilho `tag_added` das
 *   automações, e 264 fichas de uma vez virariam 264 disparos. Falha na
 *   etiqueta não desfaz a ficha — é registrada e o ciclo segue.
 * - SEM conversa: 264 conversas vazias de uma vez iriam para o fim da
 *   caixa como ruído. A conversa nasce quando o cliente escrever ou no
 *   primeiro envio da régua (criada pela VARREDURA, Fase 3).
 * - ⚠️ O nome legal não sobrevive à primeira mensagem do cliente:
 *   `inbound-store` sobrescreve `contacts.name` com o push name do
 *   WhatsApp. É por isso que a régua usa o nome do Asaas, nunca o da ficha.
 */

export const ETIQUETA_DA_FICHA = "asaas";

/**
 * O que o ciclo resolve UMA vez e reaproveita em cada ficha: o dono da conta
 * e o id da etiqueta `asaas`. Medido no primeiro ciclo real (12/09/2026):
 * sem o cache eram cinco idas ao banco por ficha (~1,4 s cada), e 231 das
 * 264 fichas não couberam no prazo de um ciclo.
 */
export interface ContextoDaFicha {
  dono?: string | null;
  tagId?: string | null;
}

export type ResultadoDaFicha =
  | { ok: true; contactId: string; criou: boolean; /** a etiqueta `asaas` ficou gravada? (só faz sentido quando `criou`) */ etiquetada: boolean }
  /** o sufixo bate com OUTRO número: vai para "Para confirmar" com o candidato */
  | { ok: false; codigo: "sufixo"; candidatoId: string }
  | { ok: false; codigo: "db_error" | "sem_dono" };

/** Puro: a ficha achada pelo sufixo tem o MESMO número (ou a irmã do 9)? */
export function mesmoNumero(daFicha: string | null | undefined, doAsaas: string): boolean {
  const digitos = (daFicha ?? "").replace(/\D/g, "");
  return digitos !== "" && variantesDoNonoDigito(doAsaas).includes(digitos);
}

async function donoDaConta(admin: SupabaseClient, accountId: string): Promise<string | null> {
  const { data, error } = await admin.from("accounts").select("owner_user_id").eq("id", accountId).maybeSingle();
  if (error) return null;
  return typeof data?.owner_user_id === "string" ? data.owner_user_id : null;
}

/**
 * Põe a etiqueta `asaas` numa ficha. Devolve se ficou gravada.
 * ⚠️ O Supabase NÃO lança em erro de banco — devolve `{ error }` — então o
 * retorno do upsert é conferido; sem isso a ficha ficava sem etiqueta para
 * sempre com cara de sucesso (achado do Codex no PR #201). Quem chama guarda
 * a pendência: `etiquetarFichasCriadas` refaz no ciclo seguinte.
 */
export async function etiquetar(admin: SupabaseClient, accountId: string, dono: string, contactId: string, contexto: ContextoDaFicha): Promise<boolean> {
  try {
    if (contexto.tagId === undefined) {
      const { tagIdByKey } = await resolveImportTagIds(admin, { accountId, userId: dono, tagNames: [ETIQUETA_DA_FICHA], canCreateTags: true });
      contexto.tagId = tagIdByKey.get(ETIQUETA_DA_FICHA) ?? null;
    }
    if (!contexto.tagId) return false;
    const { error } = await admin
      .from("contact_tags")
      .upsert({ contact_id: contactId, tag_id: contexto.tagId }, { onConflict: "contact_id,tag_id", ignoreDuplicates: true });
    if (error) {
      console.warn(`[asaas] etiqueta na ficha ${contactId} falhou: ${error.message}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[asaas] etiqueta na ficha ${contactId} falhou:`, e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * As fichas que o CRM criou e ainda estão SEM a etiqueta `asaas` (o upsert
 * falhou naquele ciclo) ganham a etiqueta agora. Duas leituras e um upsert
 * em lote por ciclo — barato, e é o caminho de retentativa que a criação
 * sozinha não tem: a ficha já existe e o ciclo seguinte a vê como ligada.
 */
export async function etiquetarFichasCriadas(
  admin: SupabaseClient,
  accountId: string,
  contactIds: readonly string[],
  contexto: ContextoDaFicha,
): Promise<number> {
  if (contactIds.length === 0) return 0;
  if (contexto.dono === undefined) contexto.dono = await donoDaConta(admin, accountId);
  if (!contexto.dono) return 0;
  if (contexto.tagId === undefined) {
    try {
      const { tagIdByKey } = await resolveImportTagIds(admin, { accountId, userId: contexto.dono, tagNames: [ETIQUETA_DA_FICHA], canCreateTags: true });
      contexto.tagId = tagIdByKey.get(ETIQUETA_DA_FICHA) ?? null;
    } catch {
      return 0;
    }
  }
  const tagId = contexto.tagId;
  if (!tagId) return 0;
  const jaTem = new Set<string>();
  for (let i = 0; i < contactIds.length; i += 200) {
    const { data, error } = await admin
      .from("contact_tags")
      .select("contact_id")
      .eq("tag_id", tagId)
      .in("contact_id", contactIds.slice(i, i + 200));
    if (error) return 0;
    for (const l of (data ?? []) as { contact_id: string }[]) jaTem.add(l.contact_id);
  }
  const faltam = contactIds.filter((id) => !jaTem.has(id));
  if (faltam.length === 0) return 0;
  const { error } = await admin
    .from("contact_tags")
    .upsert(faltam.map((contact_id) => ({ contact_id, tag_id: tagId })), { onConflict: "contact_id,tag_id", ignoreDuplicates: true });
  if (error) {
    console.warn(`[asaas] reetiquetar ${faltam.length} ficha(s) falhou: ${error.message}`);
    return 0;
  }
  return faltam.length;
}

export async function criarFichaDoAsaas(
  admin: SupabaseClient,
  accountId: string,
  cliente: { nome: string; telefone: string },
  contexto: ContextoDaFicha = {},
): Promise<ResultadoDaFicha> {
  const busca = await findExistingContact(admin, accountId, cliente.telefone);
  // ⚠️ Erro de banco NÃO é "não achei": criar agora duplicaria a ficha.
  if (busca.falhou) return { ok: false, codigo: "db_error" };
  if (busca.contato) {
    return mesmoNumero(busca.contato.phone, cliente.telefone)
      ? { ok: true, contactId: busca.contato.id, criou: false, etiquetada: false }
      : { ok: false, codigo: "sufixo", candidatoId: busca.contato.id };
  }

  if (contexto.dono === undefined) contexto.dono = await donoDaConta(admin, accountId);
  const dono = contexto.dono;
  if (!dono) return { ok: false, codigo: "sem_dono" };

  const nome = cliente.nome.trim() || cliente.telefone;
  const { data: criado, error } = await admin
    .from("contacts")
    .insert({ account_id: accountId, user_id: dono, phone: cliente.telefone, name: nome })
    .select("id")
    .single();
  if (error || !criado) {
    if (!isUniqueViolation(error)) return { ok: false, codigo: "db_error" };
    // Corrida: alguém gravou o mesmo número entre a busca e o insert. Reler
    // e aplicar a MESMA régua — a ficha pode ser a irmã do 9 ou só o sufixo.
    const deNovo = await findExistingContact(admin, accountId, cliente.telefone);
    if (deNovo.falhou || !deNovo.contato) return { ok: false, codigo: "db_error" };
    return mesmoNumero(deNovo.contato.phone, cliente.telefone)
      ? { ok: true, contactId: deNovo.contato.id, criou: false, etiquetada: false }
      : { ok: false, codigo: "sufixo", candidatoId: deNovo.contato.id };
  }

  const contactId = criado.id as string;
  const etiquetada = await etiquetar(admin, accountId, dono, contactId, contexto);
  return { ok: true, contactId, criou: true, etiquetada };
}

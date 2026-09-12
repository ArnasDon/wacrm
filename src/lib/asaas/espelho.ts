import type { SupabaseClient } from "@supabase/supabase-js";

import type { ParcelaDoEspelho } from "./inadimplencia";
import { montarListas, type ClienteDoEspelho, type FichaResumida, type ListasDoEspelho } from "./listas";
import type { Candidato } from "./vinculo";

/**
 * LER o espelho para as telas — I/O, em service role (as tabelas são fechadas
 * ao navegador). Devolve o que o membro não enxergaria sozinho: se o Asaas
 * está conectado, quando a última listagem completa das vencidas começou e
 * se a leitura é FRESCA — sem isso, "em dia" seria afirmação sobre dado
 * parado. Toda leitura PAGINA (o PostgREST corta em 1000 sem avisar).
 */

const PAGINA = 1000;
const LOTE_DE_IDS = 200;

/** Quanto tempo depois da última listagem completa a leitura ainda é "fresca" — duas vezes o laço lento. */
export const LEITURA_FRESCA_MS = 2 * 15 * 60_000;

export interface ConfigDoEspelho {
  status: string;
  last_sync_at: string | null;
  last_sync_attempt_at: string | null;
  vencidas_listadas_em: string | null;
  last_full_sync_at: string | null;
  last_error: string | null;
}

export interface Espelho {
  conectado: boolean;
  config: ConfigDoEspelho | null;
  leituraFresca: boolean;
  listas: ListasDoEspelho;
}

async function lerTudo<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, rotulo: string): Promise<T[]> {
  const tudo: T[] = [];
  for (let pagina = 0; pagina < 50; pagina++) {
    const { data, error } = await consulta(pagina * PAGINA, (pagina + 1) * PAGINA - 1);
    if (error) throw new Error(`${rotulo}: ${error.message}`);
    const linhas = (data ?? []) as T[];
    tudo.push(...linhas);
    if (linhas.length < PAGINA) return tudo;
  }
  throw new Error(`${rotulo}: mais de 50 páginas`);
}

export const COLUNAS_DA_COBRANCA =
  "id, asaas_payment_id, asaas_customer_id, status, deleted, valor, juros_e_multa, vencimento, vencimento_original, vista_vencida_em, pago_em, forma, pode_pagar_apos_vencimento, dias_ate_cancelar_registro, descricao, parcelamento_id, parcela_numero, parcela_total, link_fatura, link_boleto, visto_em";

export function lerParcela(l: Record<string, unknown>): ParcelaDoEspelho {
  return {
    id: l.id as string,
    asaas_payment_id: l.asaas_payment_id as string,
    asaas_customer_id: l.asaas_customer_id as string,
    status: l.status as string,
    deleted: l.deleted === true,
    valor: Number(l.valor ?? 0),
    juros_e_multa: l.juros_e_multa === null || l.juros_e_multa === undefined ? null : Number(l.juros_e_multa),
    vencimento: l.vencimento as string,
    vencimento_original: (l.vencimento_original as string | null) ?? null,
    vista_vencida_em: (l.vista_vencida_em as string | null) ?? null,
    pago_em: (l.pago_em as string | null) ?? null,
    forma: (l.forma as string | null) ?? null,
    pode_pagar_apos_vencimento: typeof l.pode_pagar_apos_vencimento === "boolean" ? l.pode_pagar_apos_vencimento : null,
    dias_ate_cancelar_registro: typeof l.dias_ate_cancelar_registro === "number" ? l.dias_ate_cancelar_registro : null,
    descricao: (l.descricao as string | null) ?? null,
    parcelamento_id: (l.parcelamento_id as string | null) ?? null,
    parcela_numero: typeof l.parcela_numero === "number" ? l.parcela_numero : null,
    parcela_total: typeof l.parcela_total === "number" ? l.parcela_total : null,
    link_fatura: (l.link_fatura as string | null) ?? null,
    link_boleto: (l.link_boleto as string | null) ?? null,
    visto_em: l.visto_em as string,
  };
}

export async function lerConfigDoEspelho(admin: SupabaseClient, accountId: string): Promise<ConfigDoEspelho | null> {
  const { data, error } = await admin
    .from("cb_asaas_config")
    .select("status, last_sync_at, last_sync_attempt_at, vencidas_listadas_em, last_full_sync_at, last_error")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw new Error(`config: ${error.message}`);
  return (data ?? null) as ConfigDoEspelho | null;
}

/** Puro: a última listagem completa das vencidas é recente o bastante para afirmar "em dia"? */
export function leituraFresca(config: ConfigDoEspelho | null, agora: Date): boolean {
  if (!config || config.status !== "conectado" || !config.vencidas_listadas_em) return false;
  const inicio = Date.parse(config.vencidas_listadas_em);
  return Number.isFinite(inicio) && agora.getTime() - inicio <= LEITURA_FRESCA_MS;
}

async function lerClientes(admin: SupabaseClient, accountId: string): Promise<ClienteDoEspelho[]> {
  const linhas = await lerTudo<Record<string, unknown>>(
    (de, ate) =>
      admin
        .from("cb_asaas_clientes")
        .select(
          "id, asaas_customer_id, nome, cpf_cnpj, email, celular, telefone, contact_id, vinculo_origem, vinculado_por_nome, vinculado_em, contatos_recusados, candidatos, deleted, notificacoes_desligadas",
        )
        .eq("account_id", accountId)
        .order("id")
        .range(de, ate),
    "clientes",
  );
  return linhas.map((l) => ({
    id: l.id as string,
    asaas_customer_id: l.asaas_customer_id as string,
    nome: (l.nome as string | null) ?? "",
    cpf_cnpj: (l.cpf_cnpj as string | null) ?? null,
    email: (l.email as string | null) ?? null,
    celular: (l.celular as string | null) ?? null,
    telefone: (l.telefone as string | null) ?? null,
    contact_id: (l.contact_id as string | null) ?? null,
    vinculo_origem: (l.vinculo_origem as string | null) ?? null,
    vinculado_por_nome: (l.vinculado_por_nome as string | null) ?? null,
    vinculado_em: (l.vinculado_em as string | null) ?? null,
    contatos_recusados: Array.isArray(l.contatos_recusados) ? (l.contatos_recusados as string[]) : [],
    candidatos: Array.isArray(l.candidatos) ? (l.candidatos as Candidato[]) : [],
    deleted: l.deleted === true,
    notificacoes_desligadas: l.notificacoes_desligadas === true,
  }));
}

/** As cobranças DEVIDAS (vencidas e negativadas) da conta, não apagadas. */
export async function lerCobrancasDevidas(admin: SupabaseClient, accountId: string): Promise<ParcelaDoEspelho[]> {
  const linhas = await lerTudo<Record<string, unknown>>(
    (de, ate) =>
      admin
        .from("cb_asaas_cobrancas")
        .select(COLUNAS_DA_COBRANCA)
        .eq("account_id", accountId)
        .eq("deleted", false)
        .in("status", ["OVERDUE", "DUNNING_REQUESTED"])
        .order("id")
        .range(de, ate),
    "cobranças devidas",
  );
  return linhas.map(lerParcela);
}

/** As fichas de uma lista de ids, em lotes — nome e telefone, e só. */
export async function lerFichas(admin: SupabaseClient, accountId: string, ids: Iterable<string>): Promise<Map<string, FichaResumida>> {
  const mapa = new Map<string, FichaResumida>();
  const lista = [...new Set(ids)];
  for (let i = 0; i < lista.length; i += LOTE_DE_IDS) {
    const { data, error } = await admin.from("contacts").select("id, name, phone").eq("account_id", accountId).in("id", lista.slice(i, i + LOTE_DE_IDS));
    if (error) throw new Error(`fichas: ${error.message}`);
    for (const f of (data ?? []) as { id: string; name: string | null; phone: string | null }[]) mapa.set(f.id, { id: f.id, nome: f.name, telefone: f.phone });
  }
  return mapa;
}

export async function lerEspelho(admin: SupabaseClient, accountId: string, agora: Date = new Date()): Promise<Espelho> {
  const config = await lerConfigDoEspelho(admin, accountId);
  const [clientes, cobrancas] = await Promise.all([lerClientes(admin, accountId), lerCobrancasDevidas(admin, accountId)]);
  const ids = new Set<string>();
  for (const c of clientes) {
    if (c.contact_id) ids.add(c.contact_id);
    for (const k of c.candidatos) ids.add(k.contact_id);
  }
  const fichas = await lerFichas(admin, accountId, ids);
  return {
    conectado: config !== null,
    config,
    leituraFresca: leituraFresca(config, agora),
    listas: montarListas(clientes, cobrancas, fichas, agora, config?.vencidas_listadas_em ?? null),
  };
}

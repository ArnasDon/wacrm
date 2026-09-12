import type { SupabaseClient } from "@supabase/supabase-js";

import { decrypt, encrypt } from "@/lib/whatsapp/encryption";

import { AsaasError, criarClienteAsaas, type AmbienteDoAsaas, type ClienteAsaas } from "./cliente";
import { lerCliente } from "./leitura";

/**
 * Depois de quanto tempo SEM BATIMENTO um ciclo é considerado morto e o
 * cadeado (`cb_asaas_config.sincronizando_desde`, 995), recolhido. O ciclo
 * bate (`last_sync_attempt_at`) a cada passo — listagem, lote de cobranças,
 * a cada 20 releituras, a cada 25 fichas —, então um ciclo VIVO nunca fica
 * 10 minutos sem sinal, por mais páginas que a conta tenha. É o que permite
 * recolher cedo sem correr o risco de dois ciclos juntos (Codex, PR #201).
 */
export const RECOLHER_CICLO_MS = 10 * 60_000;

/** O filtro do claim: cadeado livre, ou um ciclo sem batimento há mais de `RECOLHER_CICLO_MS`. */
export function filtroDoCadeadoLivre(agoraMs: number = Date.now()): string {
  return `sincronizando_desde.is.null,last_sync_attempt_at.lt.${new Date(agoraMs - RECOLHER_CICLO_MS).toISOString()}`;
}

/**
 * Conectar e desconectar o Asaas — I/O. A chave é TESTADA na hora (uma
 * listagem de UM cliente), gravada cifrada, e nunca mais sai: nenhuma rota
 * a devolve, nem mascarada.
 *
 * ⚠️ **Só produção.** `conectarAsaas` grava sempre `ambiente = 'producao'`,
 * e a coluna existe para outras instalações. O motivo está na 992 e na §3.7
 * do plano: aqui o ambiente LOCAL e a produção usam o MESMO projeto
 * Supabase, e a config é uma linha por conta — conectar o sandbox na tela
 * local TROCARIA a conexão da produção, e o cron da VPS passaria a procurar
 * as cobranças reais no sandbox (404 em tudo, o escritório inteiro "em
 * dia"). O sandbox só se testa com `fetchFn` falso.
 *
 * ⚠️ **Chave de OUTRA conta do Asaas.** Com espelho existente, antes de
 * gravar a chave nova ela relê um `cus_…` conhecido: 404 = a chave enxerga
 * outra conta → recusada (`conta_trocada`). Sem isso, trocar a chave pela
 * de outro CNPJ zeraria o aviso de todo mundo no ciclo seguinte. O cartão
 * oferece "Desconectar e apagar os dados do Asaas" para o caso legítimo.
 */

export type CodigoDaConexao =
  | "chave_invalida"
  | "ambiente_errado"
  | "sem_permissao"
  | "limite"
  | "rede"
  | "asaas_error"
  | "db_error"
  | "chave_ilegivel"
  | "nao_conectado"
  | "conta_trocada"
  | "em_curso";

export type ResultadoDaConexao = { ok: true } | { ok: false; codigo: CodigoDaConexao };

type FabricaDeCliente = (chave: string, ambiente: AmbienteDoAsaas) => ClienteAsaas;

const criarPadrao: FabricaDeCliente = (chave, ambiente) => criarClienteAsaas(chave, { ambiente });

/**
 * Puro: a chave é reconhecidamente de HOMOLOGAÇÃO (sandbox)?
 *
 * ⚠️ Responde `false` para chave SEM prefixo — as criadas antes de
 * 10/03/2025 não o têm, e recusá-las barraria chave de produção legítima. O
 * portão de verdade é o 401 `invalid_environment` do próprio Asaas; isto é
 * só o aviso barato, dado antes de gastar um pedido.
 */
export function ehChaveDeSandbox(chave: string): boolean {
  return chave.trim().startsWith("$aact_hmlg_");
}

function codigoDaFalha(e: unknown): CodigoDaConexao {
  if (!(e instanceof AsaasError)) return "asaas_error";
  // `nao_encontrado` numa LISTAGEM é o Asaas mudando de forma, não a chave.
  return e.codigo === "nao_encontrado" ? "asaas_error" : e.codigo;
}

/** Quantos clientes e cobranças o espelho guarda — para a pergunta do "apagar os dados". */
export async function contarEspelho(admin: SupabaseClient, accountId: string): Promise<{ clientes: number; cobrancas: number } | null> {
  const [c, p] = await Promise.all([
    admin.from("cb_asaas_clientes").select("id", { count: "exact", head: true }).eq("account_id", accountId),
    admin.from("cb_asaas_cobrancas").select("id", { count: "exact", head: true }).eq("account_id", accountId),
  ]);
  if (c.error || p.error) return null;
  return { clientes: c.count ?? 0, cobrancas: p.count ?? 0 };
}

/** Os três clientes vistos mais recentemente — as sondas da prova de identidade. */
async function clientesConhecidos(admin: SupabaseClient, accountId: string): Promise<string[] | null> {
  const { data, error } = await admin
    .from("cb_asaas_clientes")
    .select("asaas_customer_id")
    .eq("account_id", accountId)
    .eq("deleted", false)
    .order("visto_em", { ascending: false })
    .limit(3);
  if (error) return null;
  return ((data ?? []) as { asaas_customer_id: string }[]).map((l) => l.asaas_customer_id);
}

/** Todos os ids vivos do espelho, paginados — a prova final, pela listagem da chave. */
async function idsDoEspelho(admin: SupabaseClient, accountId: string): Promise<Set<string> | null> {
  const ids = new Set<string>();
  for (let pagina = 0; pagina < 50; pagina++) {
    const { data, error } = await admin
      .from("cb_asaas_clientes")
      .select("asaas_customer_id")
      .eq("account_id", accountId)
      .eq("deleted", false)
      .order("id")
      .range(pagina * 1000, pagina * 1000 + 999);
    if (error) return null;
    const linhas = (data ?? []) as { asaas_customer_id: string }[];
    for (const l of linhas) ids.add(l.asaas_customer_id);
    if (linhas.length < 1000) return ids;
  }
  return ids;
}

/**
 * A chave enxerga esta conta do Asaas? Sondas pelos clientes mais recentes;
 * se todos derem 404 (apagados no Asaas desde a última listagem), a prova
 * final é uma página de `/customers` cruzando com o espelho — sondas fixas
 * recusariam uma chave nova legítima (Codex, PR #201). Lança `AsaasError`
 * em falha de rede/cota.
 */
export async function mesmaConta(admin: SupabaseClient, accountId: string, cliente: ClienteAsaas): Promise<"sim" | "nao" | "db_error" | "sem_espelho"> {
  const conhecidos = await clientesConhecidos(admin, accountId);
  if (conhecidos === null) return "db_error";
  if (conhecidos.length === 0) return "sem_espelho";
  for (const id of conhecidos) {
    if ((await cliente.obter<unknown>(`/customers/${id}`)) !== null) return "sim";
  }
  const ids = await idsDoEspelho(admin, accountId);
  if (ids === null) return "db_error";
  const pagina = await cliente.listar<unknown>("/customers", { limit: 100 });
  for (const bruto of pagina.data) {
    const lido = lerCliente(bruto);
    if (lido && ids.has(lido.id)) return "sim";
  }
  return "nao";
}

export async function conectarAsaas(
  admin: SupabaseClient,
  accountId: string,
  userId: string,
  chave: string,
  opcoes: { nome?: string | null; expiraEm?: string | null; cliente?: FabricaDeCliente } = {},
): Promise<ResultadoDaConexao> {
  if (ehChaveDeSandbox(chave)) return { ok: false, codigo: "ambiente_errado" };

  const cliente = (opcoes.cliente ?? criarPadrao)(chave, "producao");
  try {
    // O teste mais barato que prova as três coisas: a chave vale, o
    // ambiente é o certo e a permissão de Clientes está marcada.
    await cliente.listar("/customers", { limit: 1 });
  } catch (e) {
    return { ok: false, codigo: codigoDaFalha(e) };
  }

  // Com espelho, a chave nova tem de enxergar um cliente que o espelho conhece.
  try {
    const prova = await mesmaConta(admin, accountId, cliente);
    if (prova === "db_error") return { ok: false, codigo: "db_error" };
    if (prova === "nao") return { ok: false, codigo: "conta_trocada" };
  } catch (e) {
    return { ok: false, codigo: codigoDaFalha(e) };
  }

  const agora = new Date().toISOString();
  const { error } = await admin.from("cb_asaas_config").upsert(
    {
      account_id: accountId,
      api_key: encrypt(chave),
      chave_nome: opcoes.nome?.trim() || null,
      ambiente: "producao",
      chave_expira_em: opcoes.expiraEm || null,
      status: "conectado",
      last_error: null,
      created_by: userId,
      updated_at: agora,
    },
    { onConflict: "account_id" },
  );
  if (error) return { ok: false, codigo: "db_error" };
  return { ok: true };
}

/**
 * Apaga a config. O espelho FICA (é histórico de cobrança do escritório,
 * e a chave nova o reaproveita) — a menos que `apagarEspelho`: aí os
 * clientes vão embora e as cobranças em cascata. As FICHAS criadas pela D2
 * ficam: são contatos do escritório, como qualquer outro.
 */
export async function desconectarAsaas(admin: SupabaseClient, accountId: string, opcoes: { apagarEspelho?: boolean } = {}): Promise<ResultadoDaConexao> {
  // ⚠️ Toma o CADEADO antes de apagar: um ciclo em curso já tem o cliente
  // HTTP na mão e continuaria gravando no espelho recém-apagado — e, com
  // outra conta conectada logo depois, misturaria os clientes das duas
  // (Codex, PR #201, 5ª rodada). Sem linha de config não há ciclo possível
  // (`lerConfig` devolve `nao_conectado`): segue direto.
  const { data: existente, error: erroLeitura } = await admin.from("cb_asaas_config").select("account_id").eq("account_id", accountId).maybeSingle();
  if (erroLeitura) return { ok: false, codigo: "db_error" };
  if (existente) {
    const { data: tomado, error: erroClaim } = await admin
      .from("cb_asaas_config")
      .update({ sincronizando_desde: new Date().toISOString() })
      .eq("account_id", accountId)
      .or(filtroDoCadeadoLivre())
      .select("account_id");
    if (erroClaim) return { ok: false, codigo: "db_error" };
    if (!tomado || tomado.length === 0) return { ok: false, codigo: "em_curso" };
  }
  if (opcoes.apagarEspelho) {
    const { error } = await admin.from("cb_asaas_clientes").delete().eq("account_id", accountId);
    if (error) return { ok: false, codigo: "db_error" };
  }
  const { error } = await admin.from("cb_asaas_config").delete().eq("account_id", accountId);
  if (error) return { ok: false, codigo: "db_error" };
  return { ok: true };
}

export type ConfigLida =
  | { ok: true; cliente: ClienteAsaas; ambiente: AmbienteDoAsaas }
  | { ok: false; codigo: CodigoDaConexao };

/** A conexão da conta, já pronta para falar com o Asaas. */
export async function clienteDaConta(
  admin: SupabaseClient,
  accountId: string,
  opcoes: { cliente?: FabricaDeCliente } = {},
): Promise<ConfigLida> {
  const { data, error } = await admin
    .from("cb_asaas_config")
    .select("api_key, ambiente")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) return { ok: false, codigo: "db_error" };
  if (!data) return { ok: false, codigo: "nao_conectado" };
  const ambiente = (data.ambiente as AmbienteDoAsaas | null) ?? "producao";
  try {
    const chave = decrypt(data.api_key as string);
    return { ok: true, cliente: (opcoes.cliente ?? criarPadrao)(chave, ambiente), ambiente };
  } catch {
    // ⚠️ Marcar o erro aqui é o que faz o cartão explicar o que houve —
    // chave ilegível é `ENCRYPTION_KEY` rotacionada, e a saída é reconectar.
    await admin
      .from("cb_asaas_config")
      .update({ status: "erro", last_error: "chave_ilegivel", updated_at: new Date().toISOString() })
      .eq("account_id", accountId);
    return { ok: false, codigo: "chave_ilegivel" };
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";

import { decrypt, encrypt } from "@/lib/whatsapp/encryption";

import { AsaasError, criarClienteAsaas, type AmbienteDoAsaas, type ClienteAsaas } from "./cliente";

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
  | "nao_conectado";

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
 * Apaga a config. Nada mais é apagado — não há espelho ainda, e quando
 * houver ele é histórico de cobrança do escritório.
 */
export async function desconectarAsaas(admin: SupabaseClient, accountId: string): Promise<ResultadoDaConexao> {
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

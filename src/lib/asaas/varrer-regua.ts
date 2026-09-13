import type { SupabaseClient } from "@supabase/supabase-js";

import { diaNoFuso, FUSO_PADRAO } from "@/lib/agenda/fuso";
import { dispararAutomacoes, type ResultadoDoDisparo } from "@/lib/automations/engine";
import { loadStepsTree } from "@/lib/automations/steps-tree";
import { probeChannels } from "@/lib/cb-channels/health";
import { isUniqueViolation } from "@/lib/contacts/dedupe";

import { aplicarCobranca } from "./aplicar";
import type { ClienteAsaas } from "./cliente";
import { clienteDaConta } from "./conexao";
import { COLUNAS_DA_COBRANCA, lerParcela } from "./espelho";
import { classificar, ehDevida, resumirDivida, type ParcelaDoEspelho } from "./inadimplencia";
import { lerCobranca } from "./leitura";
import {
  agruparLembretes,
  agruparPorCliente,
  dentroDoIntervalo,
  lerAutomacaoDaRegua,
  montarVariaveis,
  RECOLHER_NA_FILA_MS,
  RECOLHER_TRAVA_MS,
  RESULTADOS_QUE_CONTAM_COMO_ENVIO,
  resultadoDoLog,
  vencidasDoCliente,
  type AutomacaoDaRegua,
  type ContextoDaRegua,
  type GrupoDeCobranca,
  type GrupoDeLembrete,
} from "./regua";

/**
 * A VARREDURA da régua de cobrança (§3.6 do plano) — I/O, em service role,
 * chamada pelo cron do Asaas depois da sincronização de cada conta (o
 * espelho recém-atualizado; sem outro `docker stack deploy`). As decisões
 * puras moram em `regua.ts`. O que ela faz, nesta ordem:
 *
 *  0. `regua_ativa` desligado (D20) → não lê candidata nenhuma.
 *  1. Recolhe travas órfãs (`reservado` há mais de 10 min): sem log da
 *     automação para aquele contato criado depois da trava = nada rodou →
 *     a trava é apagada e o ciclo seguinte tenta dentro da janela; COM log =
 *     pode ter saído → `incerto`, nunca reenviado.
 *  1b. Reconcilia as travas `na_fila` (o provedor recusou o envio e o MOTOR
 *     o reenfileirou, PR #205): o log daquela execução já tem desfecho →
 *     `enviado`/`falhou`/`barrada`; sem desfecho depois de 1 h → `incerto`.
 *  2. As automações ligadas dos dois gatilhos, com a CONEXÃO do primeiro
 *     `send_message` (D19) resolvida e VIVA — id que não resolve na conta
 *     pula a automação inteira ("conexão da mensagem inválida"); conexão
 *     desconectada pula a candidata SEM travar, e o ciclo seguinte tenta.
 *  3. As candidatas: cliente LIGADO a uma ficha e fora da lista de exceção
 *     (D21); parcela devida vista DEPOIS de ligar (D13), na última listagem
 *     completa, ainda pagável, cruzando o marco HOJE dentro da janela —
 *     agrupadas por CLIENTE do Asaas, através das automações (D11).
 *  4. Reconfirma cada parcela no Asaas (`GET /payments/{id}`) e aplica ao
 *     espelho — quem pagou há três minutos sai antes da trava. `rede`/
 *     `limite` param a varredura sem travar nada.
 *  5. Intervalo mínimo (D11, 13/09): cobrança enviada ao cliente há menos de
 *     N dias → o grupo é travado como `absorvida`, sem mensagem.
 *  6. TRAVA o grupo num INSERT só (23505 em qualquer parcela = outro
 *     processo pegou → o grupo inteiro sai), reconferindo o interruptor
 *     antes; a conversa da ficha nasce aqui se não existir (a ficha da D2
 *     não tem conversa, e o passo `send_message` não a cria), com o canal
 *     do passo e sem pino.
 *  7. Dispara SÓ a automação carimbada (`automation_id` no contexto) e mede
 *     pelo `automation_logs` — `enviado` só com o `send_message` bem-sucedido;
 *     `na_fila` quando o motor reenfileirou (a trava guarda o id do log para
 *     o passo 1b). Grupos do mesmo contato em SEQUÊNCIA (o log não guarda
 *     contexto). ⚠️ `enviado`, `na_fila` e `incerto` contam como "cobrado"
 *     para o intervalo mínimo e o "uma por cliente por dia".
 *  8. O lembrete (D17): mesma mecânica, sobre o que vence hoje; o cliente com
 *     marco hoje cede a vez à cobrança, que leva a linha "e hoje vence…".
 *
 * ⚠️ Toda leitura do banco PAGINA (o PostgREST corta em 1000 sem avisar).
 * ⚠️ A mensagem sai pelo caminho do ROBÔ (`engineSendText`, via
 * `dispararAutomacoes`) — nunca `sendMessageToConversation`: não reabre
 * conversa encerrada, não zera o contador de espera, não mexe em não lidas
 * (D16; pino em `regua.chamadores.test.ts`).
 */

export interface ResultadoDaRegua {
  ativa: boolean;
  automacoes: number;
  /** grupos (cliente × dia) examinados */
  candidatos: number;
  enviados: number;
  /** o provedor recusou e o motor reenfileirou (PR #205): sai em 30 s / 5 min, fora da varredura */
  naFila: number;
  absorvidos: number;
  barrados: number;
  falhas: number;
  /** candidatas puladas por conexão desconectada (tentam no ciclo seguinte) */
  semConexao: number;
  /** automações puladas por conexão que não resolve na conta */
  conexaoInvalida: number;
  orfasRecolhidas: number;
  /** travas `na_fila` fechadas pelo log da execução (passo 1b) */
  reconciliadas: number;
  /** o interruptor foi desligado no meio do ciclo */
  desligadaNoMeio: boolean;
  /** `rede`/`limite`/erro que encerrou a varredura antes do fim */
  interrompida: string | null;
}

export interface DependenciasDaVarredura {
  agora?: Date;
  prazoMs?: number;
  fuso?: string;
  cliente?: ClienteAsaas;
  /** os passos de uma automação, em ÁRVORE (padrão: `loadStepsTree`) */
  lerPassos?: (automationId: string) => Promise<PassoDaArvore[]>;
  /** o disparo (padrão: `dispararAutomacoes`) */
  disparar?: typeof dispararAutomacoes;
  /** id da conexão → viva? (padrão: `probeChannels`; `undefined` = desconhecida) */
  saudeDasConexoes?: (accountId: string) => Promise<Map<string, boolean>>;
}

const PAGINA = 1000;
const PRAZO_PADRAO_MS = 45_000;

/** A forma mínima do que `loadStepsTree` devolve: passo com ramos opcionais. */
export interface PassoDaArvore {
  step_type: string;
  step_config: Record<string, unknown>;
  branches?: { yes?: PassoDaArvore[]; no?: PassoDaArvore[] };
}

/**
 * O PRIMEIRO `send_message` da automação, em ordem de execução — entrando
 * nos ramos de condição. ⚠️ `loadStepsTree` devolve só a raiz com os ramos
 * aninhados: um `find` na raiz não enxerga o envio posto dentro de um "Se",
 * e `validate.ts` aceita essa forma — a automação ligava e toda varredura a
 * pulava como "conexão inválida", em silêncio (Codex, PR #206).
 */
export function primeiroEnvio(passos: readonly PassoDaArvore[]): PassoDaArvore | null {
  for (const p of passos) {
    if (p.step_type === "send_message") return p;
    if (p.branches) {
      const dentro = primeiroEnvio([...(p.branches.yes ?? []), ...(p.branches.no ?? [])]);
      if (dentro) return dentro;
    }
  }
  return null;
}

interface ConfigDaRegua {
  regua_ativa: boolean;
  regua_ativada_em: string | null;
  regua_intervalo_dias: number;
  vencidas_listadas_em: string | null;
}

interface ClienteLigado {
  asaas_customer_id: string;
  contact_id: string;
  nome: string;
}

interface AutomacaoPronta extends AutomacaoDaRegua {
  channelId: string;
}

class ParadaDaVarredura extends Error {
  constructor(public readonly motivo: string) {
    super(motivo);
    this.name = "ParadaDaVarredura";
  }
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

async function lerConfigDaRegua(admin: SupabaseClient, accountId: string): Promise<ConfigDaRegua | null> {
  const { data, error } = await admin
    .from("cb_asaas_config")
    .select("regua_ativa, regua_ativada_em, regua_intervalo_dias, vencidas_listadas_em")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw new Error(`config: ${error.message}`);
  if (!data) return null;
  return {
    regua_ativa: data.regua_ativa === true,
    regua_ativada_em: (data.regua_ativada_em as string | null) ?? null,
    regua_intervalo_dias: typeof data.regua_intervalo_dias === "number" ? data.regua_intervalo_dias : 3,
    vencidas_listadas_em: (data.vencidas_listadas_em as string | null) ?? null,
  };
}

/** O interruptor AINDA está ligado? Reconferido antes de cada trava (D20). */
async function reguaAindaLigada(admin: SupabaseClient, accountId: string): Promise<boolean> {
  const { data, error } = await admin.from("cb_asaas_config").select("regua_ativa").eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`interruptor: ${error.message}`);
  return data?.regua_ativa === true;
}

async function saudePadrao(admin: SupabaseClient, accountId: string): Promise<Map<string, boolean>> {
  const mapa = new Map<string, boolean>();
  try {
    for (const c of await probeChannels(admin, accountId)) mapa.set(c.id, c.tone === "ok" || c.tone === "warn");
  } catch (e) {
    console.warn("[asaas] régua: sonda das conexões falhou —", e instanceof Error ? e.message : e);
  }
  return mapa;
}

/** As automações ligadas dos dois gatilhos, com a conexão do primeiro `send_message`. */
async function lerAutomacoes(
  admin: SupabaseClient,
  accountId: string,
  lerPassos: NonNullable<DependenciasDaVarredura["lerPassos"]>,
  saida: ResultadoDaRegua,
): Promise<AutomacaoPronta[]> {
  const { data, error } = await admin
    .from("automations")
    .select("id, name, trigger_type, trigger_config")
    .eq("account_id", accountId)
    .eq("is_active", true)
    .in("trigger_type", ["asaas_cobranca_vencida", "asaas_cobranca_vence_hoje"]);
  if (error) throw new Error(`automações: ${error.message}`);
  const prontas: AutomacaoPronta[] = [];
  for (const bruta of (data ?? []) as { id: string; name: string; trigger_type: string; trigger_config: unknown }[]) {
    const lida = lerAutomacaoDaRegua(bruta);
    if (!lida) {
      console.warn(`[asaas] régua: automação ${bruta.id} com config inválida — pulada`);
      continue;
    }
    const passos = await lerPassos(bruta.id);
    const envio = primeiroEnvio(passos);
    const channelId = typeof envio?.step_config?.channel_id === "string" ? envio.step_config.channel_id : "";
    if (!channelId) {
      // A ativação exige a conexão (validate.ts); só chega aqui automação
      // gravada antes — e sem conexão a régua não manda por número nenhum.
      saida.conexaoInvalida += 1;
      continue;
    }
    prontas.push({ ...lida, channelId });
  }
  return prontas;
}

/** As conexões ativas da conta (id → existe), para a cerca de D19. */
async function conexoesDaConta(admin: SupabaseClient, accountId: string): Promise<Set<string>> {
  const { data, error } = await admin.from("cb_channels").select("id").eq("account_id", accountId).eq("status", "connected");
  if (error) throw new Error(`conexões: ${error.message}`);
  return new Set(((data ?? []) as { id: string }[]).map((c) => c.id));
}

async function lerClientesLigados(admin: SupabaseClient, accountId: string): Promise<Map<string, ClienteLigado>> {
  const linhas = await lerTudo<{ asaas_customer_id: string; contact_id: string; nome: string | null }>(
    (de, ate) =>
      admin
        .from("cb_asaas_clientes")
        .select("asaas_customer_id, contact_id, nome")
        .eq("account_id", accountId)
        .eq("deleted", false)
        .eq("regua_desligada", false)
        .not("contact_id", "is", null)
        .order("id")
        .range(de, ate),
    "clientes ligados",
  );
  return new Map(linhas.map((l) => [l.asaas_customer_id, { asaas_customer_id: l.asaas_customer_id, contact_id: l.contact_id, nome: l.nome ?? "" }]));
}

/** As parcelas em aberto (devidas ou pendentes) dos clientes ligados. */
async function lerParcelas(admin: SupabaseClient, accountId: string): Promise<ParcelaDoEspelho[]> {
  const linhas = await lerTudo<Record<string, unknown>>(
    (de, ate) =>
      admin
        .from("cb_asaas_cobrancas")
        .select(COLUNAS_DA_COBRANCA)
        .eq("account_id", accountId)
        .eq("deleted", false)
        .in("status", ["OVERDUE", "DUNNING_REQUESTED", "PENDING"])
        .order("id")
        .range(de, ate),
    "cobranças em aberto",
  );
  return linhas.map(lerParcela);
}

interface EnvioRecente {
  asaas_customer_id: string;
  tipo: string;
  resultado: string;
  criado_em: string;
}

/** Os envios de hoje e a última cobrança enviada por cliente — o intervalo mínimo e "uma por cliente por dia". */
async function lerEnviosRecentes(admin: SupabaseClient, accountId: string, desde: string): Promise<EnvioRecente[]> {
  return lerTudo<EnvioRecente>(
    (de, ate) =>
      admin
        .from("cb_asaas_regua_envios")
        .select("asaas_customer_id, tipo, resultado, criado_em")
        .eq("account_id", accountId)
        .gte("criado_em", desde)
        .order("criado_em", { ascending: false })
        .range(de, ate),
    "envios recentes",
  );
}

/**
 * Travas `reservado` há mais de 10 min sem desfecho: com log da automação
 * para o contato criado depois da trava, pode ter saído (`incerto`, nunca
 * reenviado); sem log, nada rodou — apagada, e o ciclo seguinte tenta.
 */
async function recolherOrfas(admin: SupabaseClient, accountId: string, agora: Date): Promise<number> {
  const corte = new Date(agora.getTime() - RECOLHER_TRAVA_MS).toISOString();
  const { data, error } = await admin
    .from("cb_asaas_regua_envios")
    .select("id, automation_id, contact_id, criado_em")
    .eq("account_id", accountId)
    .eq("resultado", "reservado")
    .lt("criado_em", corte)
    .limit(200);
  if (error) throw new Error(`órfãs: ${error.message}`);
  let recolhidas = 0;
  for (const t of (data ?? []) as { id: string; automation_id: string | null; contact_id: string | null; criado_em: string }[]) {
    let temLog = false;
    if (t.automation_id && t.contact_id) {
      const { data: logs, error: erroLog } = await admin
        .from("automation_logs")
        .select("id")
        .eq("automation_id", t.automation_id)
        .eq("contact_id", t.contact_id)
        .gte("created_at", t.criado_em)
        .limit(1);
      // ⚠️ Leitura que FALHA não é "não rodou": apagar a trava aqui deixaria
      // o ciclo seguinte mandar de novo uma mensagem que pode ter saído. A
      // órfã fica `reservado` e a varredura seguinte tenta ler outra vez
      // (Codex, PR #206).
      if (erroLog) {
        console.warn(`[asaas] régua: não consegui ler o log da trava ${t.id} — fica reservada:`, erroLog.message);
        continue;
      }
      temLog = (logs?.length ?? 0) > 0;
    }
    if (temLog) {
      await admin.from("cb_asaas_regua_envios").update({ resultado: "incerto", detalhe: "trava sem desfecho, com execução registrada", finalizado_em: agora.toISOString() }).eq("id", t.id).eq("resultado", "reservado");
    } else {
      await admin.from("cb_asaas_regua_envios").delete().eq("id", t.id).eq("resultado", "reservado");
    }
    recolhidas++;
  }
  return recolhidas;
}

/**
 * Travas `na_fila` (passo 1b): o motor reenfileirou o `send_message` e a
 * varredura não esperou — o desfecho está no log da execução, pelo id que a
 * trava guardou. Com desfecho → o resultado de sempre; log sumido, ou sem
 * desfecho depois de `RECOLHER_NA_FILA_MS` → `incerto`. Cerca de posse:
 * `resultado = 'na_fila'`.
 */
async function reconciliarNaFila(admin: SupabaseClient, accountId: string, agora: Date): Promise<number> {
  const { data, error } = await admin
    .from("cb_asaas_regua_envios")
    .select("id, automation_log_id, criado_em")
    .eq("account_id", accountId)
    .eq("resultado", "na_fila")
    .order("criado_em", { ascending: true })
    .limit(200);
  if (error) throw new Error(`na fila: ${error.message}`);
  const travas = (data ?? []) as { id: string; automation_log_id: string | null; criado_em: string }[];
  if (travas.length === 0) return 0;
  const ids = [...new Set(travas.map((t) => t.automation_log_id).filter((v): v is string => typeof v === "string"))];
  const logs = new Map<string, { desfecho: string | null; steps_executed: { step_type: string; status: string }[]; error_message: string | null }>();
  if (ids.length > 0) {
    const { data: linhas, error: erroLogs } = await admin.from("automation_logs").select("id, desfecho, steps_executed, error_message").in("id", ids);
    if (erroLogs) throw new Error(`logs da fila: ${erroLogs.message}`);
    for (const l of (linhas ?? []) as { id: string; desfecho: string | null; steps_executed: { step_type: string; status: string }[] | null; error_message: string | null }[]) {
      logs.set(l.id, { desfecho: l.desfecho, steps_executed: l.steps_executed ?? [], error_message: l.error_message });
    }
  }
  const disparo = { candidatas: 1, foraDoEscopo: 0, executadas: 1, emEspera: 1 };
  let fechadas = 0;
  for (const t of travas) {
    const log = t.automation_log_id ? (logs.get(t.automation_log_id) ?? null) : null;
    const velha = agora.getTime() - Date.parse(t.criado_em) > RECOLHER_NA_FILA_MS;
    let resultado: string | null = null;
    let detalhe: string | null = null;
    if (!log) {
      if (!velha) continue;
      resultado = "incerto";
      detalhe = "retentativa sem log da execução";
    } else {
      const medido = resultadoDoLog(log, disparo);
      if (medido === "na_fila") {
        if (!velha) continue; // o motor ainda vai rodar de novo
        resultado = "incerto";
        detalhe = "retentativa sem desfecho registrado";
      } else {
        resultado = medido;
        detalhe = log.error_message ? log.error_message.slice(0, 300) : null;
      }
    }
    await admin.from("cb_asaas_regua_envios").update({ resultado, detalhe, finalizado_em: agora.toISOString() }).eq("id", t.id).eq("resultado", "na_fila");
    fechadas++;
  }
  return fechadas;
}

/**
 * A conversa 1:1 do contato — a mais antiga; senão nasce aqui, com o canal
 * do passo e sem pino, e `user_id` = o DONO da conta (`dono-duravel`).
 */
async function conversaDoContato(admin: SupabaseClient, accountId: string, contactId: string, channelId: string): Promise<string> {
  const { data: existente, error } = await admin
    .from("conversations")
    .select("id")
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`conversa: ${error.message}`);
  if (existente && existente.length > 0) return existente[0].id as string;
  const { data: conta, error: erroConta } = await admin.from("accounts").select("owner_user_id").eq("id", accountId).maybeSingle();
  const dono = typeof conta?.owner_user_id === "string" ? conta.owner_user_id : null;
  if (erroConta || !dono) throw new Error("conversa: dono da conta não resolvido");
  const { data: nova, error: erroNova } = await admin
    .from("conversations")
    .insert({ account_id: accountId, user_id: dono, contact_id: contactId, channel_id: channelId, channel_pinned: false })
    .select("id")
    .single();
  if (!erroNova && nova) return nova.id as string;
  if (isUniqueViolation(erroNova)) {
    const { data: raced } = await admin.from("conversations").select("id").eq("account_id", accountId).eq("contact_id", contactId).order("created_at", { ascending: true }).limit(1);
    if (raced && raced.length > 0) return raced[0].id as string;
  }
  throw new Error(`conversa: não foi possível criar (${erroNova?.message ?? "?"})`);
}

/** Relê cada parcela no Asaas e aplica ao espelho; devolve as que continuam como o chamador quer. */
async function reconfirmar(
  admin: SupabaseClient,
  accountId: string,
  cliente: ClienteAsaas,
  parcelas: readonly ParcelaDoEspelho[],
  aceita: (p: ParcelaDoEspelho) => boolean,
  vistoEm: string,
): Promise<ParcelaDoEspelho[]> {
  const vivas: ParcelaDoEspelho[] = [];
  for (const p of parcelas) {
    const bruta = await cliente.obter<unknown>(`/payments/${p.asaas_payment_id}`);
    const lida = bruta ? lerCobranca(bruta) : null;
    if (!lida) {
      await admin.from("cb_asaas_cobrancas").update({ deleted: true, visto_em: vistoEm, updated_at: vistoEm }).eq("account_id", accountId).eq("asaas_payment_id", p.asaas_payment_id);
      continue;
    }
    await aplicarCobranca(admin, accountId, lida, vistoEm);
    const atual: ParcelaDoEspelho = {
      ...p,
      status: lida.status,
      deleted: lida.apagado,
      valor: lida.valor,
      juros_e_multa: lida.jurosEMulta,
      vencimento: lida.vencimento ?? p.vencimento,
      pago_em: lida.pagoEm,
      link_fatura: lida.linkFatura,
      link_boleto: lida.linkBoleto,
      pode_pagar_apos_vencimento: lida.podePagarAposVencimento,
      dias_ate_cancelar_registro: lida.diasAteCancelarRegistro,
    };
    if (aceita(atual)) vivas.push(atual);
  }
  return vivas;
}

interface LinhaDaTrava {
  account_id: string;
  cobranca_id: string;
  asaas_customer_id: string;
  tipo: "atraso" | "vence_hoje";
  marco: number;
  vencimento: string;
  automation_id: string;
  automation_nome: string;
  contact_id: string;
  resultado: "reservado" | "absorvida";
  detalhe: string | null;
}

/** A trava do grupo: UM INSERT; 23505 = outro processo pegou. Devolve os ids `reservado`, ou `null` quando perdeu. */
async function travar(admin: SupabaseClient, linhas: LinhaDaTrava[]): Promise<string[] | null> {
  const { data, error } = await admin.from("cb_asaas_regua_envios").insert(linhas).select("id, resultado");
  if (error) {
    if (isUniqueViolation(error)) return null;
    throw new Error(`trava: ${error.message}`);
  }
  return ((data ?? []) as { id: string; resultado: string }[]).filter((l) => l.resultado === "reservado").map((l) => l.id);
}

async function medir(
  admin: SupabaseClient,
  automationId: string,
  contactId: string,
  desde: string,
  disparo: ResultadoDoDisparo,
): Promise<{ resultado: ReturnType<typeof resultadoDoLog>; detalhe: string | null; logId: string | null }> {
  const { data } = await admin
    .from("automation_logs")
    .select("id, desfecho, steps_executed, error_message")
    .eq("automation_id", automationId)
    .eq("contact_id", contactId)
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(1);
  const log = (data?.[0] as { id: string; desfecho: string | null; steps_executed: { step_type: string; status: string }[] | null; error_message: string | null } | undefined) ?? null;
  const resultado = resultadoDoLog(log ? { desfecho: log.desfecho, steps_executed: log.steps_executed ?? [] } : null, disparo);
  const detalhe = log?.error_message ? log.error_message.slice(0, 300) : disparo.erro ?? null;
  return { resultado, detalhe, logId: log?.id ?? null };
}

/** Fecha as travas `reservado` do grupo com o desfecho medido; `na_fila` fica com o id do log para o passo 1b. */
async function fecharTravas(admin: SupabaseClient, ids: string[], resultado: string, detalhe: string | null, agora: string, logId: string | null = null): Promise<void> {
  if (ids.length === 0) return;
  const patch: Record<string, unknown> = { resultado, detalhe, automation_log_id: logId };
  if (resultado !== "na_fila") patch.finalizado_em = agora;
  await admin.from("cb_asaas_regua_envios").update(patch).in("id", ids).eq("resultado", "reservado");
}

export async function varrerRegua(admin: SupabaseClient, accountId: string, deps: DependenciasDaVarredura = {}): Promise<ResultadoDaRegua> {
  const agora = deps.agora ?? new Date();
  const prazoMs = deps.prazoMs ?? Date.now() + PRAZO_PADRAO_MS;
  const fuso = deps.fuso ?? FUSO_PADRAO;
  const lerPassos = deps.lerPassos ?? loadStepsTree;
  const disparar = deps.disparar ?? dispararAutomacoes;
  const saida: ResultadoDaRegua = { ativa: false, automacoes: 0, candidatos: 0, enviados: 0, naFila: 0, absorvidos: 0, barrados: 0, falhas: 0, semConexao: 0, conexaoInvalida: 0, orfasRecolhidas: 0, reconciliadas: 0, desligadaNoMeio: false, interrompida: null };
  try {
    const config = await lerConfigDaRegua(admin, accountId);
    if (!config || !config.regua_ativa) return saida;
    saida.ativa = true;
    saida.orfasRecolhidas = await recolherOrfas(admin, accountId, agora);
    saida.reconciliadas = await reconciliarNaFila(admin, accountId, agora);

    const automacoes = await lerAutomacoes(admin, accountId, lerPassos, saida);
    saida.automacoes = automacoes.length;
    if (automacoes.length === 0) return saida;

    // D19: a conexão do passo tem de existir na conta; a que não existe pula
    // a automação inteira. A viva/desconectada é conferida por candidata.
    const conexoes = await conexoesDaConta(admin, accountId);
    const validas = automacoes.filter((a) => {
      if (conexoes.has(a.channelId)) return true;
      saida.conexaoInvalida += 1;
      console.warn(`[asaas] régua: a conexão da automação ${a.id} não existe na conta — pulada`);
      return false;
    });
    if (validas.length === 0) return saida;
    const saude = await (deps.saudeDasConexoes ?? ((id: string) => saudePadrao(admin, id)))(accountId);

    const ctx: ContextoDaRegua = { hoje: diaNoFuso(agora, fuso), reguaAtivadaEm: config.regua_ativada_em, somenteDiasUteis: true, fuso };
    const vistoEm = agora.toISOString();
    const [clientes, parcelasTodas] = await Promise.all([lerClientesLigados(admin, accountId), lerParcelas(admin, accountId)]);
    // Só as parcelas de clientes ligados e fora da exceção (D21), e só as
    // vistas na última listagem completa (as "em conferência" ficam fora).
    const corte = config.vencidas_listadas_em ? Date.parse(config.vencidas_listadas_em) : null;
    const parcelas = parcelasTodas.filter((p) => clientes.has(p.asaas_customer_id) && (corte === null || !ehDevida(classificar(p.status, p.deleted)) || Date.parse(p.visto_em) >= corte));
    const desde = new Date(agora.getTime() - Math.max(config.regua_intervalo_dias, 1) * 86_400_000 - 86_400_000).toISOString();
    const envios = await lerEnviosRecentes(admin, accountId, desde);
    // `enviado`, `na_fila` e `incerto` contam como cobrado: mandar de menos é o lado seguro.
    const enviadosHoje = new Set(envios.filter((e) => RESULTADOS_QUE_CONTAM_COMO_ENVIO.has(e.resultado) && diaNoFuso(new Date(e.criado_em), fuso) === ctx.hoje).map((e) => e.asaas_customer_id));
    const ultimaCobranca = new Map<string, string>();
    for (const e of envios) {
      if (e.tipo === "atraso" && RESULTADOS_QUE_CONTAM_COMO_ENVIO.has(e.resultado) && !ultimaCobranca.has(e.asaas_customer_id)) ultimaCobranca.set(e.asaas_customer_id, e.criado_em);
    }

    const { data: conta } = await admin.from("accounts").select("name").eq("id", accountId).maybeSingle();
    const escritorio = typeof conta?.name === "string" ? conta.name : "";
    const cliente = deps.cliente ?? (await (async () => { const c = await clienteDaConta(admin, accountId); if (!c.ok) throw new ParadaDaVarredura(c.codigo); return c.cliente; })());

    const porCliente = new Map<string, ParcelaDoEspelho[]>();
    for (const p of parcelas) {
      const lista = porCliente.get(p.asaas_customer_id) ?? [];
      lista.push(p);
      porCliente.set(p.asaas_customer_id, lista);
    }

    // ---- as cobranças por marco (passos 3 a 7)
    const grupos = agruparPorCliente(validas, parcelas, ctx, agora);
    // Quem tem marco HOJE cede o lembrete à cobrança (D17, uma mensagem só)
    // — MENOS quem o intervalo mínimo vai absorver: aí não sai cobrança
    // nenhuma, e o lembrete tem de sair (o lembrete não conta nem é contado
    // pelo intervalo; Codex, PR #206).
    const comMarcoHoje = new Set(
      agruparPorCliente(validas, parcelas, ctx, agora, { semJanela: true })
        .filter((g) => !dentroDoIntervalo(ultimaCobranca.get(g.asaasCustomerId) ?? null, ctx.hoje, config.regua_intervalo_dias, fuso))
        .map((g) => g.asaasCustomerId),
    );
    for (const grupo of grupos) {
      if (Date.now() > prazoMs) throw new ParadaDaVarredura("prazo");
      saida.candidatos += 1;
      const ligado = clientes.get(grupo.asaasCustomerId);
      if (!ligado) continue;
      if (enviadosHoje.has(grupo.asaasCustomerId)) continue; // no máximo UMA por cliente por dia
      const automacao = validas.find((a) => a.id === grupo.automacao.id);
      if (!automacao) continue;
      if (saude.get(automacao.channelId) !== true) {
        saida.semConexao += 1;
        continue;
      }
      // 4) reconfirma no Asaas o que vai cruzar o marco
      const cruzaram = await reconfirmar(admin, accountId, cliente, grupo.cruzaram.map((c) => c.parcela), (p) => ehDevida(classificar(p.status, p.deleted)), vistoEm);
      if (cruzaram.length === 0) continue;
      const marcoDe = new Map(grupo.cruzaram.map((c) => [c.parcela.id, c.automacao]));
      const dia = ctx.hoje;
      const venceHoje = (porCliente.get(grupo.asaasCustomerId) ?? []).filter((p) => classificar(p.status, p.deleted) === "a_vencer" && p.vencimento === dia);
      // 5) o intervalo mínimo (D11, 13/09)
      const absorvida = dentroDoIntervalo(ultimaCobranca.get(grupo.asaasCustomerId) ?? null, dia, config.regua_intervalo_dias, fuso);
      if (!(await reguaAindaLigada(admin, accountId))) {
        saida.desligadaNoMeio = true;
        break;
      }
      const linhas: LinhaDaTrava[] = cruzaram.map((p) => {
        const a = marcoDe.get(p.id) ?? grupo.automacao;
        const daMensagem = a.id === grupo.automacao.id && !absorvida;
        return {
          account_id: accountId,
          cobranca_id: p.id,
          asaas_customer_id: grupo.asaasCustomerId,
          tipo: "atraso",
          marco: a.marco,
          vencimento: p.vencimento,
          automation_id: grupo.automacao.id,
          automation_nome: grupo.automacao.nome,
          contact_id: ligado.contact_id,
          resultado: daMensagem ? "reservado" : "absorvida",
          detalhe: absorvida ? `intervalo mínimo de ${config.regua_intervalo_dias} dias` : daMensagem ? null : `absorvida pelo marco de ${grupo.automacao.marco} dias`,
        };
      });
      // a parcela que vence hoje entra na mensagem e fica travada como lembrete
      // absorvido (D17, uma mensagem só) — só quando a cobrança SAI: absorvida
      // pelo intervalo, o lembrete segue livre para o passo 8
      for (const p of absorvida ? [] : venceHoje) {
        linhas.push({ account_id: accountId, cobranca_id: p.id, asaas_customer_id: grupo.asaasCustomerId, tipo: "vence_hoje", marco: 0, vencimento: p.vencimento, automation_id: grupo.automacao.id, automation_nome: grupo.automacao.nome, contact_id: ligado.contact_id, resultado: "absorvida", detalhe: `absorvida pela cobrança de ${grupo.automacao.marco} dias` });
      }
      const ids = await travar(admin, linhas);
      if (ids === null) continue; // outro processo pegou
      if (absorvida) {
        saida.absorvidos += 1;
        continue;
      }
      // 6) a conversa, o contexto e o disparo
      const vencidas = resumirDivida(vencidasDoCliente(porCliente.get(grupo.asaasCustomerId) ?? []).map((p) => cruzaram.find((c) => c.id === p.id) ?? p), agora, config.vencidas_listadas_em, fuso).vencidas;
      const conversationId = await conversaDoContato(admin, accountId, ligado.contact_id, automacao.channelId);
      const vars = montarVariaveis({ clienteNome: ligado.nome, escritorioNome: escritorio, vencidas, cruzaram, venceHoje, hoje: dia, agora, fuso });
      const carimbo = new Date().toISOString();
      const disparo = await disparar({
        accountId,
        triggerType: "asaas_cobranca_vencida",
        contactId: ligado.contact_id,
        context: { automation_id: automacao.id, conversation_id: conversationId, channel_id: automacao.channelId, vars },
      });
      // 7) o desfecho, pelo log
      const { resultado, detalhe, logId } = await medir(admin, grupo.automacao.id, ligado.contact_id, carimbo, disparo);
      await fecharTravas(admin, ids, resultado, detalhe, new Date().toISOString(), logId);
      if (resultado === "enviado" || resultado === "na_fila") {
        if (resultado === "enviado") saida.enviados += 1;
        else saida.naFila += 1;
        enviadosHoje.add(grupo.asaasCustomerId);
        ultimaCobranca.set(grupo.asaasCustomerId, carimbo);
      } else if (resultado === "barrada") saida.barrados += 1;
      else saida.falhas += 1;
    }

    // ---- o lembrete do vencimento (passo 8, D17)
    if (saida.desligadaNoMeio) return saida;
    const lembretes: GrupoDeLembrete[] = agruparLembretes(validas, parcelas, comMarcoHoje, ctx, agora);
    for (const grupo of lembretes) {
      if (Date.now() > prazoMs) throw new ParadaDaVarredura("prazo");
      saida.candidatos += 1;
      const ligado = clientes.get(grupo.asaasCustomerId);
      if (!ligado) continue;
      const automacao = validas.find((a) => a.id === grupo.automacao.id);
      if (!automacao) continue;
      if (saude.get(automacao.channelId) !== true) {
        saida.semConexao += 1;
        continue;
      }
      const dia = ctx.hoje;
      // reconfirma: quem pagou por Pix de manhã não recebe lembrete à tarde
      const venceHoje = await reconfirmar(admin, accountId, cliente, grupo.venceHoje, (p) => { const c = classificar(p.status, p.deleted); return c === "a_vencer" || (c === "vencida" && p.vencimento < dia); }, vistoEm);
      if (venceHoje.length === 0) continue;
      if (!(await reguaAindaLigada(admin, accountId))) {
        saida.desligadaNoMeio = true;
        break;
      }
      const ids = await travar(
        admin,
        venceHoje.map((p) => ({ account_id: accountId, cobranca_id: p.id, asaas_customer_id: grupo.asaasCustomerId, tipo: "vence_hoje" as const, marco: 0, vencimento: p.vencimento, automation_id: automacao.id, automation_nome: automacao.nome, contact_id: ligado.contact_id, resultado: "reservado" as const, detalhe: null })),
      );
      if (ids === null) continue;
      const conversationId = await conversaDoContato(admin, accountId, ligado.contact_id, automacao.channelId);
      const vars = montarVariaveis({ clienteNome: ligado.nome, escritorioNome: escritorio, vencidas: [], cruzaram: [], venceHoje, hoje: dia, agora, fuso });
      const carimbo = new Date().toISOString();
      const disparo = await disparar({
        accountId,
        triggerType: "asaas_cobranca_vence_hoje",
        contactId: ligado.contact_id,
        context: { automation_id: automacao.id, conversation_id: conversationId, channel_id: automacao.channelId, vars },
      });
      const { resultado, detalhe, logId } = await medir(admin, automacao.id, ligado.contact_id, carimbo, disparo);
      await fecharTravas(admin, ids, resultado, detalhe, new Date().toISOString(), logId);
      if (resultado === "enviado") saida.enviados += 1;
      else if (resultado === "na_fila") saida.naFila += 1;
      else if (resultado === "barrada") saida.barrados += 1;
      else saida.falhas += 1;
    }
    return saida;
  } catch (e) {
    const motivo = e instanceof ParadaDaVarredura ? e.motivo : e instanceof Error ? e.message.slice(0, 200) : "erro";
    if (motivo !== "prazo") console.error(`[asaas] régua da conta ${accountId} interrompida (${motivo})`);
    saida.interrompida = motivo;
    return saida;
  }
}

/** Para o teste estrutural e o cartão: os tipos do gatilho da régua. */
export type { GrupoDeCobranca };

import { diaNoFuso, FUSO_PADRAO, paraInstante } from "@/lib/agenda/fuso";

import { classificar, diaPorExtenso, diasDeAtraso, dinheiro, ehDevida, rotuloDaParcela, rotulosDasParcelas, valorAtualizado, type ParcelaDoEspelho } from "./inadimplencia";

/**
 * A RÉGUA DE COBRANÇA — a parte PURA (Fase 3 do plano do Asaas, §3.6):
 * que parcela cruza que marco em que dia, a janela do dia, o lembrete do
 * vencimento, o intervalo mínimo entre cobranças, a absorção do lembrete
 * pela cobrança e as variáveis que a mensagem usa. Sem I/O: a varredura
 * (`varrer-regua.ts`) lê o banco e chama isto.
 *
 * Regras do operador (12 e 13/09/2026) que moram aqui:
 * - D13: quem JÁ estava atrasado quando a régua foi ligada fica de fora —
 *   só a parcela vista vencida DEPOIS de `regua_ativada_em` entra. "Se
 *   atrasar mais uma vez, aí sim recebe."
 * - D11: uma mensagem por CLIENTE, com TODAS as vencidas dele; o marco
 *   decide QUANDO, o conteúdo é sempre tudo; e um INTERVALO MÍNIMO (3 dias
 *   por padrão) entre cobranças ao mesmo cliente — o marco que cai dentro do
 *   intervalo é `absorvida`. ⚠️ O intervalo vale entre COBRANÇAS; o lembrete
 *   do vencimento não conta nem é contado (contando-o, o marco de 1 dia, que
 *   é o dia seguinte ao lembrete, nunca sairia).
 * - D17: lembrete no dia do vencimento — e, quando o mesmo cliente tem marco
 *   cruzando no mesmo dia, UMA mensagem só: a cobrança, com a linha "e hoje
 *   vence…"; o lembrete é absorvido.
 * - D12: só em dia útil; fim de semana e feriado nacional de data fixa
 *   empurram para o dia útil seguinte; nunca depois das 18h.
 * - D6 (revista em 13/09): a negativada entra como qualquer vencida.
 *
 * ⚠️ Toda data aqui é texto `AAAA-MM-DD` com aritmética sobre o texto (via
 * `Date.UTC`), nunca `new Date("2026-09-01")` — que é meia-noite UTC e
 * retrocede um dia no Brasil. O único lugar com fuso é `paraInstante`, para
 * a janela do dia, e `diaNoFuso`, para "que dia é hoje".
 */

/** A hora limite: nada sai depois disto (D12). */
export const HORA_LIMITE = "18:00";
export const HORA_PADRAO_COBRANCA = "09:00";
export const HORA_PADRAO_LEMBRETE = "08:00";
/** A faixa que o editor aceita para `hora_envio` (a mesma de `validate.ts` para a tarefa). */
export const HORA_MINIMA = "08:00";
export const HORA_MAXIMA = "17:00";
/** O intervalo mínimo entre COBRANÇAS ao mesmo cliente (D11, 13/09): editável no cartão. */
export const INTERVALO_PADRAO_DIAS = 3;
/** Quantos dias a mais que o marco o espelho pode ter demorado a VER a vencida (C7) sem perder o marco. */
export const TOLERANCIA_DA_VISTA_DIAS = 3;
/** Depois de quanto tempo uma trava `reservado` sem desfecho é órfã. */
export const RECOLHER_TRAVA_MS = 10 * 60_000;
/**
 * Depois de quanto tempo uma trava `na_fila` (o motor reenfileirou o envio,
 * PR #205) sem desfecho no log vira `incerto`. A retentativa roda em 30 s e
 * depois em 5 min, mais o tique do agendador — uma hora cobre com folga.
 */
export const RECOLHER_NA_FILA_MS = 60 * 60_000;

/** Os valores do CHECK de `cb_asaas_regua_envios.resultado` (998), rotulados por chave montada na aba. */
export const RESULTADOS_DA_TRAVA = ["reservado", "enviado", "absorvida", "barrada", "falhou", "fora_do_escopo", "sem_automacao", "incerto", "na_fila"] as const;
export type ResultadoDaTrava = (typeof RESULTADOS_DA_TRAVA)[number];

/**
 * O que conta como "já cobrado" para o intervalo mínimo (D11) e o "uma por
 * cliente por dia": o que SAIU, o que está na fila do motor (vai sair) e o
 * incerto (pode ter saído). Mandar de menos é o lado seguro de uma cobrança.
 */
export const RESULTADOS_QUE_CONTAM_COMO_ENVIO: ReadonlySet<string> = new Set(["enviado", "na_fila", "incerto"]);

/** Feriados nacionais de data FIXA (MM-DD). Os móveis ficam fora da v1 (§8). */
export const FERIADOS_NACIONAIS_FIXOS = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"] as const;

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `HH:MM` entre 08:00 e 17:00? */
export function horaDeEnvioValida(hora: unknown): hora is string {
  return typeof hora === "string" && RE_HORA.test(hora) && hora >= HORA_MINIMA && hora <= HORA_MAXIMA;
}

function diaEmMs(dia: string): number {
  const [a, m, d] = dia.split("-").map(Number);
  return Date.UTC(a, m - 1, d);
}

/** `AAAA-MM-DD` + n dias (n pode ser negativo). */
export function somarDias(dia: string, n: number): string {
  return new Date(diaEmMs(dia) + n * 86_400_000).toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado, do próprio texto (sem fuso). */
export function diaDaSemana(dia: string): number {
  return new Date(diaEmMs(dia)).getUTCDay();
}

export function ehFeriadoFixo(dia: string): boolean {
  return (FERIADOS_NACIONAIS_FIXOS as readonly string[]).includes(dia.slice(5));
}

/** Dia útil = segunda a sexta e não feriado nacional de data fixa. */
export function ehDiaUtil(dia: string): boolean {
  const s = diaDaSemana(dia);
  return s !== 0 && s !== 6 && !ehFeriadoFixo(dia);
}

/** O próprio dia, se útil; senão o próximo útil. */
export function proximoDiaUtil(dia: string): string {
  let d = dia;
  for (let i = 0; i < 10 && !ehDiaUtil(d); i++) d = somarDias(d, 1);
  return d;
}

/** O último dia útil ESTRITAMENTE antes de `dia`. */
export function diaUtilAnterior(dia: string): string {
  let d = somarDias(dia, -1);
  for (let i = 0; i < 10 && !ehDiaUtil(d); i++) d = somarDias(d, -1);
  return d;
}

export interface ContextoDaRegua {
  /** `AAAA-MM-DD` no fuso do escritório */
  hoje: string;
  /** `cb_asaas_config.regua_ativada_em` — o instante em que o interruptor foi ligado (D20) */
  reguaAtivadaEm: string | null;
  somenteDiasUteis: boolean;
  fuso: string;
}

/**
 * A parcela entrou na régua? Só a vista vencida DEPOIS de o interruptor
 * ser ligado (D13): na primeira sincronização TODAS as vencidas ganham
 * `vista_vencida_em` = aquele dia, e ligar a régua não pode despejar as 405
 * de uma vez — nem o marco de 30 dias delas, semanas depois. "Se atrasar
 * mais uma vez, aí sim recebe."
 */
export function entrouNaRegua(p: Pick<ParcelaDoEspelho, "vista_vencida_em">, reguaAtivadaEm: string | null): boolean {
  if (!p.vista_vencida_em || !reguaAtivadaEm) return false;
  return Date.parse(p.vista_vencida_em) > Date.parse(reguaAtivadaEm);
}

/**
 * O DIA-ALVO de um marco para esta parcela — ou `null` quando este marco não
 * lhe cabe. É `vencimento + marco`; se o espelho só a viu vencida DEPOIS
 * disso (o Asaas marca vencida tarde — C7 — ou a sincronização estava
 * parada), o dia em que viu, desde que dentro de `TOLERANCIA_DA_VISTA_DIAS`;
 * passado disso, o marco foi perdido e o próximo o cobre (a mensagem lista
 * tudo de qualquer jeito, D11). Com `somenteDiasUteis`, fim de semana e
 * feriado empurram para o dia útil seguinte (D12).
 */
export function diaAlvoDoMarco(p: Pick<ParcelaDoEspelho, "vencimento" | "vista_vencida_em">, marco: number, ctx: ContextoDaRegua): string | null {
  if (!RE_DIA.test(p.vencimento) || !Number.isInteger(marco) || marco < 1) return null;
  const base = somarDias(p.vencimento, marco);
  let alvo = base;
  if (p.vista_vencida_em) {
    const vista = diaNoFuso(new Date(p.vista_vencida_em), ctx.fuso);
    if (vista > base) {
      if (vista > somarDias(base, TOLERANCIA_DA_VISTA_DIAS)) return null;
      alvo = vista;
    }
  }
  return ctx.somenteDiasUteis ? proximoDiaUtil(alvo) : alvo;
}

/** Puro: `agora` está entre `hora_envio` e as 18:00 do dia `hoje`, no fuso? */
export function janelaAberta(agora: Date, hoje: string, horaEnvio: string, fuso: string = FUSO_PADRAO): boolean {
  if (!RE_DIA.test(hoje) || !RE_HORA.test(horaEnvio)) return false;
  const inicio = paraInstante(hoje, horaEnvio, fuso).getTime();
  const fim = paraInstante(hoje, HORA_LIMITE, fuso).getTime();
  const t = agora.getTime();
  return t >= inicio && t < fim;
}

/**
 * Os vencimentos que o LEMBRETE cobre hoje (D17). Sem "só dia útil": hoje.
 * Com ele: nada em fim de semana/feriado, e no primeiro dia útil seguinte
 * TODOS os dias desde o último dia útil (exclusive) até hoje — o boleto de
 * sábado pode ser pago na segunda sem juros, e o lembrete diz isso. ⚠️
 * Empurrar, nunca pular: ~2 de cada 7 vencimentos caem em fim de semana.
 */
export function diasDoLembrete(hoje: string, somenteDiasUteis: boolean): string[] {
  if (!somenteDiasUteis) return [hoje];
  if (!ehDiaUtil(hoje)) return [];
  const dias: string[] = [];
  for (let d = somarDias(diaUtilAnterior(hoje), 1); d <= hoje; d = somarDias(d, 1)) dias.push(d);
  return dias;
}

/**
 * O boleto ainda pode ser pago? O que o Asaas diz que não pode fica fora
 * (precisa de gente para gerar outra cobrança) e é contado no cartão.
 * `dias_ate_cancelar_registro` > 0 = o registro do boleto é cancelado N dias
 * depois do vencimento; nulo = sem cancelamento automático.
 */
export function aindaPagavel(p: Pick<ParcelaDoEspelho, "pode_pagar_apos_vencimento" | "dias_ate_cancelar_registro" | "vencimento">, hoje: string): boolean {
  if (p.pode_pagar_apos_vencimento === false) return false;
  const teto = p.dias_ate_cancelar_registro;
  if (typeof teto === "number" && teto > 0 && RE_DIA.test(p.vencimento)) {
    return somarDias(p.vencimento, teto) >= hoje;
  }
  return true;
}

/**
 * O intervalo mínimo (D11, 13/09): a cobrança de hoje é ABSORVIDA quando a
 * última cobrança ENVIADA a este cliente foi há menos de `intervaloDias`.
 * `ultimaCobrancaEm` é o instante do envio; conta-se em dias de calendário
 * no fuso do escritório — enviada dia 10, intervalo 3 → livre a partir do 13.
 */
export function dentroDoIntervalo(ultimaCobrancaEm: string | null, hoje: string, intervaloDias: number, fuso: string = FUSO_PADRAO): boolean {
  if (!ultimaCobrancaEm || !Number.isFinite(intervaloDias) || intervaloDias <= 0) return false;
  const ultima = diaNoFuso(new Date(ultimaCobrancaEm), fuso);
  return somarDias(ultima, intervaloDias) > hoje;
}

/** Uma linha de `cobranca_detalhe`: "• Parcela 3/12 — R$ 648,20 (atualizado) — venceu em 23/08/2026 — https://…" */
export function linhaDaParcela(p: ParcelaDoEspelho, hoje: string): string {
  const rotulo = p.parcela_numero !== null ? `Parcela ${rotuloDaParcela(p)}` : rotuloDaParcela(p);
  const comJuros = p.juros_e_multa !== null && p.juros_e_multa > 0;
  const valor = comJuros ? `${dinheiro(valorAtualizado(p))} (atualizado)` : `${dinheiro(p.valor)} (valor original)`;
  const quando = p.vencimento === hoje ? `vence hoje (${diaPorExtenso(p.vencimento)})` : p.vencimento > hoje ? `vence em ${diaPorExtenso(p.vencimento)}` : `venceu em ${diaPorExtenso(p.vencimento)}`;
  const link = p.link_fatura ?? p.link_boleto ?? "";
  return `• ${rotulo} — ${valor} — ${quando}${link ? ` — ${link}` : ""}`;
}

function somaAtualizada(parcelas: readonly ParcelaDoEspelho[]): number {
  return Math.round(parcelas.reduce((s, p) => s + valorAtualizado(p), 0) * 100) / 100;
}

function primeiroNome(nome: string): string {
  const limpo = nome.trim().split(/\s+/)[0] ?? "";
  // Nome de empresa em caixa alta continua como está; nome de gente ganha a
  // primeira maiúscula.
  if (limpo.length <= 1 || limpo === limpo.toUpperCase()) return limpo;
  return limpo.charAt(0).toUpperCase() + limpo.slice(1).toLowerCase();
}

export interface DadosDasVariaveis {
  clienteNome: string;
  escritorioNome: string;
  /** TODAS as vencidas do cliente, da mais antiga para a mais nova (D11) */
  vencidas: readonly ParcelaDoEspelho[];
  /** as que CRUZARAM o marco hoje (vazio no lembrete) */
  cruzaram: readonly ParcelaDoEspelho[];
  /** as que vencem hoje (o lembrete; ou a linha "e hoje vence…" da cobrança) */
  venceHoje: readonly ParcelaDoEspelho[];
  hoje: string;
  agora: Date;
  fuso?: string;
}

/**
 * As `{{vars.*}}` da mensagem (§3.6). `cobranca_detalhe` é TUDO o que o
 * cliente deve (D11); no lembrete, só o que vence hoje. `dias_de_atraso` é
 * o da parcela que cruzou o marco (vencida na sexta, o marco de 1 dia sai
 * na segunda com "3"); `dias_de_atraso_maior`, o da mais antiga.
 */
export function montarVariaveis(d: DadosDasVariaveis): Record<string, string> {
  const fuso = d.fuso ?? FUSO_PADRAO;
  const ehLembrete = d.vencidas.length === 0 && d.venceHoje.length > 0;
  const detalhe = (ehLembrete ? d.venceHoje : d.vencidas).map((p) => linhaDaParcela(p, d.hoje)).join("\n");
  const maisAntiga = d.vencidas[0] ?? null;
  const cruzou = d.cruzaram[0] ?? null;
  const dias = (p: ParcelaDoEspelho | null) => (p ? String(Math.max(0, diasDeAtraso(p.vencimento, d.agora, fuso) ?? 0)) : "0");
  const venceHojeDetalhe = d.venceHoje.map((p) => linhaDaParcela(p, d.hoje)).join("\n");
  return {
    cliente_nome: d.clienteNome.trim(),
    cliente_primeiro_nome: primeiroNome(d.clienteNome),
    escritorio_nome: d.escritorioNome.trim(),
    cobranca_detalhe: detalhe,
    cobranca_parcelas: rotulosDasParcelas(ehLembrete ? d.venceHoje : d.vencidas, 12),
    cobranca_valor: dinheiro(somaAtualizada(ehLembrete ? d.venceHoje : d.vencidas)),
    cobranca_vencimento: maisAntiga ? diaPorExtenso(maisAntiga.vencimento) : d.venceHoje[0] ? diaPorExtenso(d.venceHoje[0].vencimento) : "",
    cobranca_quantidade: String(ehLembrete ? d.venceHoje.length : d.vencidas.length),
    dias_de_atraso: dias(cruzou),
    dias_de_atraso_maior: dias(maisAntiga),
    marco_detalhe: d.cruzaram.map((p) => linhaDaParcela(p, d.hoje)).join("\n"),
    // D17 revista (13/09): a cobrança do dia em que também vence parcela
    // ganha a linha "e hoje vence…"; no lembrete é o próprio detalhe.
    vence_hoje_detalhe: venceHojeDetalhe,
    vencimento_texto: textoDoVencimento(d.venceHoje, d.hoje),
  };
}

/** "vence hoje"; ou "venceu no sábado, 12/09 — o boleto pode ser pago hoje sem juros" (o lembrete empurrado, D17). */
export function textoDoVencimento(venceHoje: readonly ParcelaDoEspelho[], hoje: string): string {
  const passadas = venceHoje.filter((p) => p.vencimento < hoje);
  if (passadas.length === 0) return venceHoje.length > 0 ? "vence hoje" : "";
  const dia = passadas[0].vencimento;
  const nomes = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  const [, m, dd] = dia.split("-");
  return `venceu ${ehFeriadoFixo(dia) ? "no feriado" : `no ${nomes[diaDaSemana(dia)]}`}, ${dd}/${m} — o boleto pode ser pago hoje sem juros`;
}

export interface AutomacaoDaRegua {
  id: string;
  nome: string;
  tipo: "atraso" | "vence_hoje";
  /** `dias_de_atraso` (0 no lembrete) */
  marco: number;
  horaEnvio: string;
  somenteDiasUteis: boolean;
}

/**
 * Puro: a config do gatilho → o que a varredura precisa. `null` quando a
 * config não serve (a ativação já recusa; só chega aqui automação gravada
 * antes da validação).
 */
export function lerAutomacaoDaRegua(a: { id: string; name: string; trigger_type: string; trigger_config: unknown }): AutomacaoDaRegua | null {
  const cfg = (a.trigger_config ?? {}) as Record<string, unknown>;
  const somenteDiasUteis = cfg.somente_dias_uteis !== false;
  if (a.trigger_type === "asaas_cobranca_vence_hoje") {
    const horaEnvio = horaDeEnvioValida(cfg.hora_envio) ? cfg.hora_envio : HORA_PADRAO_LEMBRETE;
    return { id: a.id, nome: a.name, tipo: "vence_hoje", marco: 0, horaEnvio, somenteDiasUteis };
  }
  if (a.trigger_type === "asaas_cobranca_vencida") {
    const marco = Number(cfg.dias_de_atraso);
    if (!Number.isInteger(marco) || marco < 1 || marco > 365) return null;
    const horaEnvio = horaDeEnvioValida(cfg.hora_envio) ? cfg.hora_envio : HORA_PADRAO_COBRANCA;
    return { id: a.id, nome: a.name, tipo: "atraso", marco, horaEnvio, somenteDiasUteis };
  }
  return null;
}

/** Os dois gatilhos da régua — a lista que `runAutomationById`, o diálogo e a rota manual recusam. */
export const GATILHOS_DA_REGUA = ["asaas_cobranca_vencida", "asaas_cobranca_vence_hoje"] as const;

export function ehGatilhoDaRegua(tipo: string | null | undefined): boolean {
  return (GATILHOS_DA_REGUA as readonly string[]).includes(tipo ?? "");
}

/** As parcelas DEVIDAS (vencidas e negativadas — D6 revista) de um cliente, da mais antiga para a mais nova. */
export function vencidasDoCliente(parcelas: readonly ParcelaDoEspelho[]): ParcelaDoEspelho[] {
  return parcelas.filter((p) => ehDevida(classificar(p.status, p.deleted))).sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0));
}

export interface GrupoDeCobranca {
  asaasCustomerId: string;
  /** a automação de MAIOR marco entre as que cruzaram hoje (a que manda a mensagem) */
  automacao: AutomacaoDaRegua;
  /** parcela → o marco que ela cruzou hoje (para as travas) */
  cruzaram: { parcela: ParcelaDoEspelho; automacao: AutomacaoDaRegua }[];
}

/**
 * Puro: agrupa por CLIENTE do Asaas, ATRAVÉS das automações (D11). Com
 * parcelas mensais, o marco de 30 dias da de agosto e o de 1 dia da de
 * setembro caem no mesmo dia: sai UMA mensagem — a da automação de maior
 * marco — e a trava de todas as parcelas que cruzaram leva o marco de cada
 * uma (as que não geraram mensagem ficam `absorvida`).
 */
export function agruparPorCliente(
  automacoes: readonly AutomacaoDaRegua[],
  parcelas: readonly ParcelaDoEspelho[],
  ctx: ContextoDaRegua,
  agora: Date,
  /**
   * `semJanela`: ignora a hora de envio — é como o lembrete das 8h descobre
   * que o cliente TEM marco às 9h e cede a vez (uma mensagem só, D17).
   */
  opcoes: { semJanela?: boolean } = {},
): GrupoDeCobranca[] {
  const grupos = new Map<string, GrupoDeCobranca>();
  for (const automacao of automacoes) {
    if (automacao.tipo !== "atraso") continue;
    const c = { ...ctx, somenteDiasUteis: automacao.somenteDiasUteis };
    if (!opcoes.semJanela && !janelaAberta(agora, ctx.hoje, automacao.horaEnvio, ctx.fuso)) continue;
    for (const p of parcelas) {
      if (!ehDevida(classificar(p.status, p.deleted))) continue;
      if (!entrouNaRegua(p, ctx.reguaAtivadaEm)) continue;
      if (!aindaPagavel(p, ctx.hoje)) continue;
      if (diaAlvoDoMarco(p, automacao.marco, c) !== ctx.hoje) continue;
      const g = grupos.get(p.asaas_customer_id) ?? { asaasCustomerId: p.asaas_customer_id, automacao, cruzaram: [] };
      g.cruzaram.push({ parcela: p, automacao });
      if (automacao.marco > g.automacao.marco) g.automacao = automacao;
      grupos.set(p.asaas_customer_id, g);
    }
  }
  return [...grupos.values()];
}

export interface GrupoDeLembrete {
  asaasCustomerId: string;
  automacao: AutomacaoDaRegua;
  venceHoje: ParcelaDoEspelho[];
}

/**
 * Puro: os lembretes de hoje, por cliente (D17). ⚠️ Cliente com marco de
 * cobrança cruzando hoje (`clientesComMarcoHoje`) NÃO recebe lembrete — a
 * cobrança das 9h absorve (uma mensagem só, 13/09). Se às 9h a cobrança não
 * sair (pagou as vencidas antes), o cliente deixa de ter marco e o lembrete
 * volta a ser candidato no ciclo seguinte, dentro da janela.
 */
export function agruparLembretes(
  automacoes: readonly AutomacaoDaRegua[],
  parcelas: readonly ParcelaDoEspelho[],
  clientesComMarcoHoje: ReadonlySet<string>,
  ctx: ContextoDaRegua,
  agora: Date,
): GrupoDeLembrete[] {
  const lembrete = automacoes.find((a) => a.tipo === "vence_hoje");
  if (!lembrete) return [];
  if (!janelaAberta(agora, ctx.hoje, lembrete.horaEnvio, ctx.fuso)) return [];
  const dias = new Set(diasDoLembrete(ctx.hoje, lembrete.somenteDiasUteis));
  if (dias.size === 0) return [];
  const grupos = new Map<string, GrupoDeLembrete>();
  for (const p of parcelas) {
    if (p.deleted || !dias.has(p.vencimento)) continue;
    // PENDING, ou já OVERDUE quando o vencimento caiu no fim de semana (o
    // Asaas pode marcar vencida antes de o lembrete empurrado sair — C7).
    const classe = classificar(p.status, p.deleted);
    if (classe !== "a_vencer" && !(classe === "vencida" && p.vencimento < ctx.hoje)) continue;
    if (clientesComMarcoHoje.has(p.asaas_customer_id)) continue;
    const g = grupos.get(p.asaas_customer_id) ?? { asaasCustomerId: p.asaas_customer_id, automacao: lembrete, venceHoje: [] };
    g.venceHoje.push(p);
    grupos.set(p.asaas_customer_id, g);
  }
  return [...grupos.values()];
}

/**
 * Puro: o que o log da automação diz que aconteceu → o resultado da trava.
 * `enviado` só com o `send_message` bem-sucedido e a execução concluída;
 * `barrada` (condição) e `falhou` vêm do desfecho; sem log = a automação
 * não rodou (desligada entre a seleção e o disparo, ou fora do escopo).
 *
 * ⚠️ `na_fila`: o provedor RECUSOU o envio (4xx) e o motor o reenfileirou
 * (PR #205) — o log fica `partial`, sem desfecho, e o disparo volta com
 * `emEspera`. Não é "falhou" (vai rodar de novo em 30 s) nem "incerto"
 * (nada saiu); a varredura seguinte reconcilia pelo log (`reconciliarNaFila`).
 * A régua não tem "Aguardar" (validate.ts), então `emEspera` aqui é só isso.
 */
export function resultadoDoLog(
  log: { desfecho: string | null; steps_executed: { step_type: string; status: string }[] } | null,
  disparo: { candidatas: number; foraDoEscopo: number; executadas: number; emEspera?: number },
): "enviado" | "barrada" | "falhou" | "fora_do_escopo" | "sem_automacao" | "incerto" | "na_fila" {
  if (!log) {
    if (disparo.candidatas === 0) return "sem_automacao";
    if (disparo.executadas === 0 && disparo.foraDoEscopo > 0) return "fora_do_escopo";
    return disparo.executadas > 0 ? "incerto" : "sem_automacao";
  }
  if (log.desfecho === "falhou") return "falhou";
  if (log.desfecho === "barrada") return "barrada";
  const enviou = log.steps_executed.some((s) => s.step_type === "send_message" && s.status === "success");
  if (log.desfecho === "concluida") return enviou ? "enviado" : "barrada";
  if (enviou) return "enviado";
  if ((disparo.emEspera ?? 0) > 0) return "na_fila";
  // Sem desfecho e sem espera: o processo morreu no meio — pode ter saído.
  return "incerto";
}

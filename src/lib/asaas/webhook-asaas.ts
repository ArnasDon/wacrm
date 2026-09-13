import type { SupabaseClient } from "@supabase/supabase-js";

import { diaNoFuso, FUSO_PADRAO } from "@/lib/agenda/fuso";
import { NOME_DO_APP } from "@/lib/marca";
import { encrypt } from "@/lib/whatsapp/encryption";

import { aplicarCobranca } from "./aplicar";
import type { EstadoDoWebhook } from "./cartao";
import { AsaasError, type ClienteAsaas } from "./cliente";
import { clienteDaConta, type CodigoDaConexao } from "./conexao";
import { lerCobranca } from "./leitura";
import { garantirClientes } from "./sincronizar";
import {
  type AvisoDoWebhook,
  CODIGO_DO_EVENTO_DE_CHAVE,
  decisaoDoCron,
  deveEntrarNoEspelho,
  EVENTOS_ASSINADOS,
  gerarTokenDaUrl,
  gerarTokenDeAutenticacao,
  lerWebhookDoAsaas,
  nomeDoWebhook,
  urlDoWebhook,
  type WebhookNoAsaas,
} from "./webhook";

/**
 * O ciclo de vida do webhook no Asaas (D7) e o processamento de cada
 * entrega — I/O, em service role. As decisões puras moram em `webhook.ts`.
 *
 * Quem cria é o CRM, pela API, com a permissão Webhooks da chave: gera o
 * token de autenticação, REAPROVEITA um webhook que já aponte para a nossa
 * URL (trocar a chave não pode criar um segundo e dobrar as entregas),
 * confere a fila a cada ciclo do cron, religa UMA vez e apaga ao
 * desconectar. Sem a permissão, o cartão diz isso e o ciclo de 15 min segue
 * sozinho — decisão do operador (13/09/2026).
 *
 * ⚠️ A CRIAÇÃO AUTOMÁTICA vive só em `cuidarDoWebhook`, chamada pelo CRON:
 * o preview desta instalação carrega a URL pública da produção, e criar a
 * partir dele registraria no Asaas um endereço que só atende depois do
 * deploy — 15 entregas falhadas interrompem a fila. O botão do cartão só
 * cria quando o pedido vem do próprio host público (`podeCriarDaqui`).
 */

export type CodigoDoWebhook = CodigoDaConexao | "nao_encontrado" | "url_inalcancavel" | "sem_email";

export type ResultadoDoWebhook = { ok: true; estado: EstadoDoWebhook } | { ok: false; codigo: CodigoDoWebhook };

export interface ConfigDoWebhook {
  account_id: string;
  created_by: string | null;
  chave_nome: string | null;
  webhook_token: string | null;
  webhook_auth_token: string | null;
  webhook_asaas_id: string | null;
  webhook_email: string | null;
  webhook_state: EstadoDoWebhook | null;
  webhook_religado_em: string | null;
  /** a última conferência OU tentativa (a retentativa diária do `erro` conta a partir daqui) */
  webhook_conferido_em: string | null;
}

const COLUNAS_DO_WEBHOOK =
  "account_id, created_by, chave_nome, webhook_token, webhook_auth_token, webhook_asaas_id, webhook_email, webhook_state, webhook_religado_em, webhook_conferido_em";

/** Até 10 webhooks por conta: uma página de 100 sobra; o teto de 2 é só cerca. */
const PAGINAS_DE_WEBHOOKS = 2;
/** Quanto o processamento de UMA entrega pode gastar lendo o cliente novo no Asaas. */
const PRAZO_DO_EVENTO_MS = 15_000;
/** GETs simultâneos ao Asaas a partir das entregas — uma fila religada despeja 14 dias de eventos de uma vez, e a conta tem 50. */
export const EVENTOS_SIMULTANEOS = 4;

export async function lerConfigDoWebhook(admin: SupabaseClient, accountId: string): Promise<ConfigDoWebhook | null | "db_error"> {
  const { data, error } = await admin.from("cb_asaas_config").select(COLUNAS_DO_WEBHOOK).eq("account_id", accountId).maybeSingle();
  if (error) return "db_error";
  return (data ?? null) as ConfigDoWebhook | null;
}

/**
 * Para quem o Asaas manda os alertas de falha de entrega: o e-mail já
 * guardado, senão o do administrador que conectou, senão o do dono da
 * conta. É campo OBRIGATÓRIO na API do Asaas.
 */
export async function emailDosAlertas(admin: SupabaseClient, accountId: string, config: Pick<ConfigDoWebhook, "webhook_email" | "created_by">): Promise<string | null> {
  if (config.webhook_email) return config.webhook_email;
  const candidatos: string[] = [];
  if (config.created_by) candidatos.push(config.created_by);
  const { data: conta } = await admin.from("accounts").select("owner_user_id").eq("id", accountId).maybeSingle();
  if (typeof conta?.owner_user_id === "string") candidatos.push(conta.owner_user_id);
  for (const userId of candidatos) {
    const { data } = await admin.from("profiles").select("email").eq("user_id", userId).maybeSingle();
    const email = typeof data?.email === "string" ? data.email.trim() : "";
    if (email) return email;
  }
  return null;
}

function corpoDoWebhook(url: string, email: string, authToken: string): Record<string, unknown> {
  return {
    name: nomeDoWebhook(NOME_DO_APP),
    url,
    email,
    enabled: true,
    interrupted: false,
    apiVersion: 3,
    authToken,
    // D8: o corpo é aviso e a cobrança é relida — a ordem não importa, e um
    // evento preso não pode segurar os seguintes.
    sendType: "NON_SEQUENTIALLY",
    events: [...EVENTOS_ASSINADOS],
  };
}

function codigoDe(e: unknown): CodigoDoWebhook {
  return e instanceof AsaasError ? e.codigo : "asaas_error";
}

async function gravarFalha(admin: SupabaseClient, accountId: string, estado: EstadoDoWebhook | null, codigo: string, agora: string): Promise<void> {
  await admin.from("cb_asaas_config").update({ webhook_state: estado, webhook_erro: codigo, webhook_conferido_em: agora, updated_at: agora }).eq("account_id", accountId);
}

/**
 * O estado `erro` (o Asaas recusou a criação) é retentado pelo cron UMA vez
 * por dia: uma lista de eventos que o Asaas não aceite no primeiro ciclo
 * travaria a integração até alguém clicar — e, corrigida a causa num deploy,
 * o webhook nasce sozinho no dia seguinte (revisão do PR #204, R1).
 */
export const RETENTAR_ERRO_MS = 24 * 60 * 60_000;

/**
 * Cria — ou reaproveita e atualiza — o webhook desta conta no Asaas, com um
 * token de autenticação NOVO, e grava tudo. Três tentativas, nesta ordem: o
 * id que já é nosso; um webhook do Asaas com a MESMA URL (chave trocada,
 * config apagada e refeita); criar.
 */
export async function garantirWebhook(
  admin: SupabaseClient,
  accountId: string,
  cliente: ClienteAsaas,
  origem: string,
  email: string,
  agora: Date = new Date(),
): Promise<ResultadoDoWebhook> {
  const config = await lerConfigDoWebhook(admin, accountId);
  if (config === "db_error") return { ok: false, codigo: "db_error" };
  if (!config) return { ok: false, codigo: "nao_conectado" };
  const carimbo = agora.toISOString();
  // ⚠️ O token da URL é gravado ANTES de falar com o Asaas, cercado por
  // `IS NULL`: é só endereço, e gravá-lo cedo torna a URL DETERMINÍSTICA.
  // Sem isso, um POST que dava certo seguido de uma gravação que falhava
  // deixava um webhook ÓRFÃO no Asaas (respondendo 404 até interromper a
  // fila), e a tentativa seguinte — ou o cron e o botão correndo juntos —
  // gerava outro token, não achava o órfão pela URL e criava um SEGUNDO
  // (revisão independente do PR #204).
  const token = config.webhook_token ?? (await carimbarTokenDaUrl(admin, accountId));
  if (!token) return { ok: false, codigo: "db_error" };
  const url = urlDoWebhook(origem, token);
  const authToken = gerarTokenDeAutenticacao();
  const corpo = corpoDoWebhook(url, email, authToken);

  let w: WebhookNoAsaas | null = null;
  try {
    // ⚠️ Um PUT que deu certo mas voltou sem `id` (forma estranha) CONTINUA
    // sendo o webhook que já existe — cair para o POST criaria um segundo
    // na mesma URL e dobraria as entregas (revisão do PR #204).
    const atualizar = async (id: string): Promise<WebhookNoAsaas> => {
      const resposta = lerWebhookDoAsaas(await cliente.enviar<unknown>("PUT", `/webhooks/${id}`, corpo));
      return resposta ?? { id, url, enabled: true, interrupted: false, penalizados: 0, temToken: true };
    };
    if (config.webhook_asaas_id) {
      const atual = lerWebhookDoAsaas(await cliente.obter<unknown>(`/webhooks/${config.webhook_asaas_id}`));
      if (atual) w = await atualizar(atual.id);
    }
    if (!w) {
      const lista = await cliente.listarTudo<unknown>("/webhooks", { limit: 100 }, PAGINAS_DE_WEBHOOKS);
      const igual = lista.map(lerWebhookDoAsaas).find((x): x is WebhookNoAsaas => x !== null && x.url === url);
      if (igual) w = await atualizar(igual.id);
    }
    if (!w) w = lerWebhookDoAsaas(await cliente.enviar<unknown>("POST", "/webhooks", corpo));
    if (!w) throw new AsaasError("asaas_error", "resposta do webhook sem id");
    // O Asaas devolve `hasAuthToken`: sem ele, TODA entrega chegaria sem o
    // cabeçalho e a rota responderia 401 até a fila ser interrompida.
    if (!w.temToken) throw new AsaasError("asaas_error", "o Asaas não registrou o token de autenticação do webhook");
  } catch (e) {
    const codigo = codigoDe(e);
    // Sem a permissão Webhooks e recusa do Asaas precisam de GENTE (o
    // estado sai de NULL e o cron para de tentar); rede e cota são
    // passageiras — o estado fica como estava e o ciclo seguinte tenta.
    const estado: EstadoDoWebhook | null = codigo === "sem_permissao" ? "sem_permissao" : codigo === "rede" || codigo === "limite" ? config.webhook_state : "erro";
    console.warn(`[asaas] webhook da conta ${accountId} não criado (${codigo}):`, e instanceof Error ? e.message : e);
    await gravarFalha(admin, accountId, estado, codigo, carimbo);
    return { ok: false, codigo };
  }

  const { error } = await admin
    .from("cb_asaas_config")
    .update({
      webhook_token: token,
      webhook_auth_token: encrypt(authToken),
      webhook_asaas_id: w.id,
      webhook_email: email,
      webhook_state: "ativo",
      webhook_erro: null,
      webhook_religado_em: null,
      webhook_conferido_em: carimbo,
      updated_at: carimbo,
    })
    .eq("account_id", accountId);
  if (error) {
    console.error(`[asaas] webhook da conta ${accountId} criado no Asaas (${w.id}) mas não gravado:`, error.message);
    return { ok: false, codigo: "db_error" };
  }
  return { ok: true, estado: "ativo" };
}

/** Grava um token de URL novo só se ainda não há um; devolve o que ficou valendo (o nosso ou o do concorrente). */
async function carimbarTokenDaUrl(admin: SupabaseClient, accountId: string): Promise<string | null> {
  const novo = gerarTokenDaUrl();
  const { data, error } = await admin.from("cb_asaas_config").update({ webhook_token: novo }).eq("account_id", accountId).is("webhook_token", null).select("webhook_token");
  if (error) return null;
  if (data && data.length > 0) return novo;
  const atual = await lerConfigDoWebhook(admin, accountId);
  return atual && atual !== "db_error" ? atual.webhook_token : null;
}

/**
 * O que o cron faz a cada ciclo com o webhook que já existe: lê
 * `GET /webhooks/{id}` e grava o estado; fila interrompida é religada UMA
 * vez (a segunda vira "precisa de atenção"); 404 = apagado no painel
 * (`ausente`, e o cartão oferece recriar).
 */
export async function conferirWebhook(
  admin: SupabaseClient,
  accountId: string,
  cliente: ClienteAsaas,
  config: ConfigDoWebhook,
  agora: Date = new Date(),
): Promise<ResultadoDoWebhook> {
  if (!config.webhook_asaas_id) return { ok: false, codigo: "nao_encontrado" };
  const carimbo = agora.toISOString();
  let w: WebhookNoAsaas | null;
  try {
    w = lerWebhookDoAsaas(await cliente.obter<unknown>(`/webhooks/${config.webhook_asaas_id}`));
  } catch (e) {
    const codigo = codigoDe(e);
    if (codigo !== "rede" && codigo !== "limite") await gravarFalha(admin, accountId, config.webhook_state, codigo, carimbo);
    return { ok: false, codigo };
  }
  if (!w) {
    const { error } = await admin
      .from("cb_asaas_config")
      .update({ webhook_asaas_id: null, webhook_state: "ausente", webhook_erro: null, webhook_conferido_em: carimbo, updated_at: carimbo })
      .eq("account_id", accountId);
    return error ? { ok: false, codigo: "db_error" } : { ok: true, estado: "ausente" };
  }
  const decisao = decisaoDoCron(w, config.webhook_religado_em !== null);
  const patch: Record<string, unknown> = { webhook_conferido_em: carimbo, webhook_erro: null, updated_at: carimbo };
  let estado: EstadoDoWebhook;
  if (decisao === "religar") {
    try {
      await cliente.enviar<unknown>("PUT", `/webhooks/${w.id}`, { interrupted: false });
      estado = "ativo";
      patch.webhook_religado_em = carimbo;
      console.warn(`[asaas] fila do webhook da conta ${accountId} estava interrompida — religada uma vez`);
    } catch (e) {
      estado = "interrompido";
      patch.webhook_erro = codigoDe(e);
    }
  } else {
    estado = decisao;
  }
  patch.webhook_state = estado;
  const { error } = await admin.from("cb_asaas_config").update(patch).eq("account_id", accountId);
  return error ? { ok: false, codigo: "db_error" } : { ok: true, estado };
}

/** O "Religar" de GENTE: religa a fila e zera o marcador — o CRM ganha o direito de religar sozinho mais uma vez. */
export async function religarWebhook(admin: SupabaseClient, accountId: string, opcoes: { cliente?: ClienteAsaas; agora?: Date } = {}): Promise<ResultadoDoWebhook> {
  const config = await lerConfigDoWebhook(admin, accountId);
  if (config === "db_error") return { ok: false, codigo: "db_error" };
  if (!config) return { ok: false, codigo: "nao_conectado" };
  if (!config.webhook_asaas_id) return { ok: false, codigo: "nao_encontrado" };
  const c = opcoes.cliente ? { ok: true as const, cliente: opcoes.cliente } : await clienteDaConta(admin, accountId);
  if (!c.ok) return { ok: false, codigo: c.codigo };
  const carimbo = (opcoes.agora ?? new Date()).toISOString();
  try {
    await c.cliente.enviar<unknown>("PUT", `/webhooks/${config.webhook_asaas_id}`, { interrupted: false, enabled: true });
  } catch (e) {
    const codigo = codigoDe(e);
    await gravarFalha(admin, accountId, config.webhook_state, codigo, carimbo);
    return { ok: false, codigo };
  }
  const { error } = await admin
    .from("cb_asaas_config")
    .update({ webhook_state: "ativo", webhook_erro: null, webhook_religado_em: null, webhook_conferido_em: carimbo, updated_at: carimbo })
    .eq("account_id", accountId);
  return error ? { ok: false, codigo: "db_error" } : { ok: true, estado: "ativo" };
}

/**
 * Apaga o webhook no Asaas e marca `desligado` — o cron não o recria. O
 * 404 conta como apagado. Outra falha (chave inválida, rede) deixa o estado
 * como está e devolve o código: o cartão manda apagar no painel do Asaas,
 * senão o Asaas insiste por horas, interrompe a fila e manda três e-mails.
 */
export async function apagarWebhook(admin: SupabaseClient, accountId: string, opcoes: { cliente?: ClienteAsaas; agora?: Date } = {}): Promise<ResultadoDoWebhook> {
  const config = await lerConfigDoWebhook(admin, accountId);
  if (config === "db_error") return { ok: false, codigo: "db_error" };
  if (!config) return { ok: false, codigo: "nao_conectado" };
  const carimbo = (opcoes.agora ?? new Date()).toISOString();
  if (config.webhook_asaas_id) {
    const c = opcoes.cliente ? { ok: true as const, cliente: opcoes.cliente } : await clienteDaConta(admin, accountId);
    if (!c.ok) return { ok: false, codigo: c.codigo };
    try {
      await c.cliente.enviar<unknown>("DELETE", `/webhooks/${config.webhook_asaas_id}`);
    } catch (e) {
      const codigo = codigoDe(e);
      if (codigo !== "nao_encontrado") {
        await gravarFalha(admin, accountId, config.webhook_state, codigo, carimbo);
        return { ok: false, codigo };
      }
    }
  }
  const { error } = await admin
    .from("cb_asaas_config")
    .update({ webhook_asaas_id: null, webhook_state: "desligado", webhook_erro: null, webhook_religado_em: null, updated_at: carimbo })
    .eq("account_id", accountId);
  return error ? { ok: false, codigo: "db_error" } : { ok: true, estado: "desligado" };
}

/** O botão "Ativar" do cartão: cria (ou refaz) o webhook, qualquer que seja o estado. */
export async function ativarWebhook(
  admin: SupabaseClient,
  accountId: string,
  opcoes: { origem: string | null; cliente?: ClienteAsaas; agora?: Date },
): Promise<ResultadoDoWebhook> {
  if (!opcoes.origem) return { ok: false, codigo: "url_inalcancavel" };
  const config = await lerConfigDoWebhook(admin, accountId);
  if (config === "db_error") return { ok: false, codigo: "db_error" };
  if (!config) return { ok: false, codigo: "nao_conectado" };
  const c = opcoes.cliente ? { ok: true as const, cliente: opcoes.cliente } : await clienteDaConta(admin, accountId);
  if (!c.ok) return { ok: false, codigo: c.codigo };
  const email = await emailDosAlertas(admin, accountId, config);
  if (!email) return { ok: false, codigo: "sem_email" };
  return garantirWebhook(admin, accountId, c.cliente, opcoes.origem, email, opcoes.agora);
}

/**
 * O passo do CRON, depois da sincronização de cada conta: com webhook, confere;
 * sem webhook e sem decisão de gente (estado NULO), cria — quando há endereço
 * público. Estado `desligado`, `ausente`, `sem_permissao` ou `erro` espera o
 * cartão: o cron não insiste no que uma pessoa (ou o Asaas) já recusou.
 */
export async function cuidarDoWebhook(
  admin: SupabaseClient,
  accountId: string,
  opcoes: { origem: string | null; cliente?: ClienteAsaas; agora?: Date },
): Promise<ResultadoDoWebhook> {
  const config = await lerConfigDoWebhook(admin, accountId);
  if (config === "db_error") return { ok: false, codigo: "db_error" };
  if (!config) return { ok: false, codigo: "nao_conectado" };
  const c = opcoes.cliente ? { ok: true as const, cliente: opcoes.cliente } : await clienteDaConta(admin, accountId);
  if (!c.ok) return { ok: false, codigo: c.codigo };
  if (config.webhook_asaas_id) return conferirWebhook(admin, accountId, c.cliente, config, opcoes.agora);
  if (config.webhook_state !== null) {
    const agoraMs = (opcoes.agora ?? new Date()).getTime();
    const ultimaTentativa = config.webhook_conferido_em ? Date.parse(config.webhook_conferido_em) : 0;
    if (config.webhook_state !== "erro" || agoraMs - ultimaTentativa < RETENTAR_ERRO_MS) return { ok: true, estado: config.webhook_state };
  }
  if (!opcoes.origem) return { ok: false, codigo: "url_inalcancavel" };
  const email = await emailDosAlertas(admin, accountId, config);
  if (!email) {
    await gravarFalha(admin, accountId, "erro", "sem_email", (opcoes.agora ?? new Date()).toISOString());
    return { ok: false, codigo: "sem_email" };
  }
  return garantirWebhook(admin, accountId, c.cliente, opcoes.origem, email, opcoes.agora);
}

export type ResultadoDoEvento = "aplicada" | "apagada" | "ignorada" | "chave" | "falhou";

/** Um semáforo simples: no máximo `max` trabalhos ao mesmo tempo, os demais esperam na ordem. */
export function criarSemaforo(max: number): { com<T>(fn: () => Promise<T>): Promise<T> } {
  let ativos = 0;
  const espera: (() => void)[] = [];
  return {
    async com<T>(fn: () => Promise<T>): Promise<T> {
      // ⚠️ Quem espera HERDA a vaga de quem terminou (o contador não cai
      // entre os dois): decrementar e deixar o acordado incrementar abria
      // uma fresta em que um chamador novo tomava a vaga e o acordado passava
      // de `max` (revisão do PR #204, R8).
      if (ativos >= max) await new Promise<void>((liberar) => espera.push(liberar));
      else ativos++;
      try {
        return await fn();
      } finally {
        const proximo = espera.shift();
        if (proximo) proximo();
        else ativos--;
      }
    },
  };
}

const semaforo = criarSemaforo(EVENTOS_SIMULTANEOS);

/**
 * O trabalho de UMA entrega, depois do 200 (`after()`): relê a cobrança na
 * API com a nossa chave e aplica ao espelho — só cobrança devida, ou que o
 * espelho já conhece, ou que vence hoje (D17). 404 na cobrança = apagada
 * (marca `deleted` só se a linha existe). Evento de chave só conta se o
 * nome é o da NOSSA chave. O resultado fica em `cb_asaas_eventos`.
 *
 * ⚠️ Passa pelo semáforo: uma fila religada despeja dias de eventos de uma
 * vez, e cada um custa um ou dois GET — a conta tem 50 simultâneos,
 * divididos com o outro sistema do escritório.
 */
export async function processarEvento(
  admin: SupabaseClient,
  accountId: string,
  aviso: AvisoDoWebhook,
  opcoes: { eventoId: string; cliente?: ClienteAsaas; agora?: Date; fuso?: string },
): Promise<ResultadoDoEvento> {
  return semaforo.com(async () => {
    const agora = opcoes.agora ?? new Date();
    const vistoEm = agora.toISOString();
    const hoje = diaNoFuso(agora, opcoes.fuso ?? FUSO_PADRAO);
    let resultado: ResultadoDoEvento = "ignorada";
    let detalhe: string | null = null;
    try {
      if (aviso.tipo === "cobranca") {
        const c = opcoes.cliente ? { ok: true as const, cliente: opcoes.cliente } : await clienteDaConta(admin, accountId);
        if (!c.ok) throw new AsaasError("asaas_error", c.codigo);
        const bruta = await c.cliente.obter<unknown>(`/payments/${aviso.paymentId}`);
        const lida = bruta ? lerCobranca(bruta) : null;
        if (!lida) {
          // 404 na cobrança: só vira `deleted` se a linha existe E o CLIENTE
          // dela ainda responde — os dois 404 juntos são a chave de outra
          // conta, a mesma cerca da reconciliação do ciclo.
          const { data: linha, error: erroLinha } = await admin
            .from("cb_asaas_cobrancas")
            .select("id, asaas_customer_id")
            .eq("account_id", accountId)
            .eq("asaas_payment_id", aviso.paymentId)
            .maybeSingle();
          if (erroLinha) throw new Error(erroLinha.message);
          if (!linha) {
            detalhe = "404";
          } else if ((await c.cliente.obter<unknown>(`/customers/${linha.asaas_customer_id}`)) === null) {
            resultado = "falhou";
            detalhe = "conta_trocada";
          } else {
            const { error } = await admin
              .from("cb_asaas_cobrancas")
              .update({ deleted: true, visto_em: vistoEm, updated_at: vistoEm })
              .eq("account_id", accountId)
              .eq("asaas_payment_id", aviso.paymentId);
            if (error) throw new Error(error.message);
            resultado = "apagada";
            detalhe = "404";
          }
        } else {
          const { data: existente, error } = await admin
            .from("cb_asaas_cobrancas")
            .select("id")
            .eq("account_id", accountId)
            .eq("asaas_payment_id", lida.id)
            .limit(1);
          if (error) throw new Error(error.message);
          if (!deveEntrarNoEspelho(lida, (existente?.length ?? 0) > 0, hoje)) {
            detalhe = lida.status;
          } else if (!lida.clienteId) {
            resultado = "falhou";
            detalhe = "sem_cliente";
          } else {
            const { semLinha, adiados } = await garantirClientes(admin, accountId, c.cliente, [lida.clienteId], vistoEm, Date.now() + PRAZO_DO_EVENTO_MS);
            if (semLinha.size > 0 || adiados.size > 0) {
              resultado = "falhou";
              detalhe = semLinha.size > 0 ? "cliente_ausente" : "cliente_adiado";
            } else if (!(await aplicarCobranca(admin, accountId, lida, vistoEm))) {
              // sem vencimento a linha não cabe no espelho (`linhaDaCobranca`)
              resultado = "falhou";
              detalhe = "descartada";
            } else {
              resultado = "aplicada";
              detalhe = lida.status;
            }
          }
        }
      } else if (aviso.tipo === "chave") {
        const codigo = CODIGO_DO_EVENTO_DE_CHAVE[aviso.evento];
        const config = await lerConfigDoWebhook(admin, accountId);
        if (config === "db_error") throw new Error("config: leitura falhou");
        if (codigo && config && aviso.nome && config.chave_nome && aviso.nome === config.chave_nome) {
          const { error } = await admin.from("cb_asaas_config").update({ status: "erro", last_error: codigo, updated_at: vistoEm }).eq("account_id", accountId);
          if (error) throw new Error(error.message);
          resultado = "chave";
          detalhe = codigo;
        } else {
          // Sem `chave_nome` na config não há como saber se a chave é a nossa —
          // o cartão avisa que o nome da chave não foi informado.
          detalhe = !config?.chave_nome ? "sem_nome_da_chave_na_config" : aviso.nome ? "outra_chave" : "sem_nome";
        }
      } else {
        detalhe = aviso.evento;
      }
    } catch (e) {
      resultado = "falhou";
      detalhe = e instanceof AsaasError ? e.codigo : e instanceof Error ? e.message.slice(0, 200) : "erro";
      console.error(`[asaas] evento ${aviso.evento} da conta ${accountId} falhou:`, e instanceof Error ? e.message : e);
    }
    const { error: erroFinal } = await admin.from("cb_asaas_eventos").update({ processado_em: new Date().toISOString(), resultado, detalhe }).eq("id", opcoes.eventoId);
    if (erroFinal) console.error(`[asaas] evento ${opcoes.eventoId} processado (${resultado}) mas o registro não foi atualizado:`, erroFinal.message);
    return resultado;
  });
}

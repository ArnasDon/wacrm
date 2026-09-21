import type { SupabaseClient } from "@supabase/supabase-js";

import { ehUrlAlcancavel } from "@/lib/cb-channels/webhook-url";
import { decrypt, encrypt } from "@/lib/whatsapp/encryption";

import { gerarChaveDeAssinatura, gerarTokenDeWebhook } from "./assinatura";
import { CalendlyError, criarClienteCalendly, type ClienteCalendly, type EscopoDaAssinatura } from "./cliente";
import { EVENTO_AGENDADO, EVENTO_CANCELADO } from "./payload";

/**
 * Conectar, reassinar e desconectar o Calendly — o I/O da integração.
 *
 * Conectar = validar o token em `/users/me`, criar a assinatura do webhook
 * e gravar tudo CIFRADO. A assinatura é tentada no escopo `organization`
 * (todos os eventos da organização — o advogado que atende pode não ser o
 * dono do token) e cai para `user` quando o Calendly recusa (403: token de
 * quem não administra a organização). Sem nenhuma das duas, o token ainda
 * é gravado com `status = 'erro'`: o operador vê no cartão que o token é
 * bom e que o webhook não pôde ser assinado (quase sempre plano sem
 * webhooks), e "Reassinar" tenta de novo sem pedir o token outra vez.
 *
 * ⚠️ A URL do webhook sai de `NEXT_PUBLIC_SITE_URL` e é RECUSADA quando não
 * é alcançável de fora (`ehUrlAlcancavel`, a guarda da Evolution): um dev
 * local conectando o Calendly da produção registraria `localhost`, e todo
 * agendamento real passaria a bater numa porta que não existe — o Calendly
 * retenta por 24h e desativa a assinatura, em silêncio.
 */

/**
 * ⚠️ O CANCELAMENTO entrou em 20/09/2026 (1013), e a assinatura JÁ CRIADA no
 * Calendly não muda sozinha: quem está conectado desde antes continua
 * recebendo só `invitee.created` até apertar "Reassinar" no cartão da
 * integração. Sem isso a correção não chega a rodar — o Calendly nem entrega
 * o evento.
 */
export const EVENTOS_ASSINADOS = [EVENTO_AGENDADO, EVENTO_CANCELADO];

export function urlDoWebhook(origem: string, token: string): string {
  return `${origem.replace(/\/+$/, "")}/api/cb/calendly/webhook/${token}`;
}

/** A origem pública do CRM, ou `null` quando ela não é alcançável de fora. */
export function origemPublica(requestOrigin?: string | null): string | null {
  const origem = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") || requestOrigin?.replace(/\/+$/, "") || null;
  return origem && ehUrlAlcancavel(origem) ? origem : null;
}

export type CodigoDaConexao =
  | "token_invalido"
  | "sem_permissao"
  | "nao_encontrado"
  | "limite"
  | "rede"
  | "calendly_error"
  | "url_inalcancavel"
  | "db_error"
  | "nao_conectado"
  | "chave_ilegivel";

export type ResultadoDaConexao =
  | { ok: true; usuario: { nome: string; email: string }; escopo: EscopoDaAssinatura | null; webhookErro: CodigoDaConexao | null }
  | { ok: false; codigo: CodigoDaConexao };

type FabricaDeCliente = (token: string) => ClienteCalendly;

function codigoDe(e: unknown): CodigoDaConexao {
  return e instanceof CalendlyError ? e.codigo : "calendly_error";
}

/**
 * Cria a assinatura: organização primeiro, usuário como plano B.
 * Devolve a assinatura criada e o escopo que funcionou.
 */
async function assinarWebhook(
  cliente: ClienteCalendly,
  args: { url: string; organizationUri: string; userUri: string; signingKey: string },
): Promise<{ uri: string; escopo: EscopoDaAssinatura; estado: "active" | "disabled" }> {
  try {
    const a = await cliente.criarAssinatura({
      url: args.url,
      events: EVENTOS_ASSINADOS,
      organization: args.organizationUri,
      scope: "organization",
      signingKey: args.signingKey,
    });
    return { uri: a.uri, escopo: "organization", estado: a.estado };
  } catch (e) {
    if (!(e instanceof CalendlyError) || e.codigo !== "sem_permissao") throw e;
  }
  const a = await cliente.criarAssinatura({
    url: args.url,
    events: EVENTOS_ASSINADOS,
    organization: args.organizationUri,
    scope: "user",
    user: args.userUri,
    signingKey: args.signingKey,
  });
  return { uri: a.uri, escopo: "user", estado: a.estado };
}

async function apagarSeExistir(cliente: ClienteCalendly, uri: string | null | undefined): Promise<void> {
  if (!uri) return;
  try {
    await cliente.apagarAssinatura(uri);
  } catch (e) {
    // Assinatura já apagada (404) ou Calendly fora do ar: a nova assinatura
    // segue; a velha, se ainda existir, aponta para o MESMO token de webhook
    // e a rota a aceita com a chave nova? Não — a chave muda. Ela vai bater
    // em 401 até o Calendly desativá-la (24h). Registrado, não fatal.
    console.warn("[calendly] não foi possível apagar a assinatura antiga:", e instanceof Error ? e.message : e);
  }
}

export async function conectarCalendly(
  admin: SupabaseClient,
  accountId: string,
  userId: string,
  token: string,
  origem: string | null,
  opcoes: { cliente?: FabricaDeCliente } = {},
): Promise<ResultadoDaConexao> {
  if (!origem) return { ok: false, codigo: "url_inalcancavel" };
  const cliente = (opcoes.cliente ?? criarClienteCalendly)(token);

  let usuario;
  try {
    usuario = await cliente.usuarioAtual();
  } catch (e) {
    console.warn(`[calendly] conexão recusada (${codigoDe(e)}):`, e instanceof Error ? e.message : e);
    return { ok: false, codigo: codigoDe(e) };
  }

  // Reconectar mantém o token da URL (a assinatura antiga, se ficar viva,
  // continua apontando para uma rota que existe) e apaga a assinatura antiga.
  const { data: anterior } = await admin
    .from("cb_calendly_config")
    .select("webhook_token, webhook_uri, access_token")
    .eq("account_id", accountId)
    .maybeSingle();
  if (anterior?.webhook_uri && typeof anterior.access_token === "string") {
    try {
      await apagarSeExistir((opcoes.cliente ?? criarClienteCalendly)(decrypt(anterior.access_token)), anterior.webhook_uri);
    } catch {
      /* token antigo ilegível: a assinatura antiga fica para o Calendly desativar */
    }
  }
  const webhookToken = typeof anterior?.webhook_token === "string" && anterior.webhook_token ? anterior.webhook_token : gerarTokenDeWebhook();
  const signingKey = gerarChaveDeAssinatura();

  let assinatura: { uri: string; escopo: EscopoDaAssinatura; estado: "active" | "disabled" } | null = null;
  let webhookErro: CodigoDaConexao | null = null;
  try {
    assinatura = await assinarWebhook(cliente, {
      url: urlDoWebhook(origem, webhookToken),
      organizationUri: usuario.organizationUri,
      userUri: usuario.uri,
      signingKey,
    });
  } catch (e) {
    webhookErro = codigoDe(e);
    console.warn(`[calendly] assinatura do webhook recusada (${webhookErro}):`, e instanceof Error ? e.message : e);
  }

  const agora = new Date().toISOString();
  const { error } = await admin.from("cb_calendly_config").upsert(
    {
      account_id: accountId,
      access_token: encrypt(token),
      signing_key: encrypt(signingKey),
      webhook_token: webhookToken,
      user_uri: usuario.uri,
      organization_uri: usuario.organizationUri,
      user_name: usuario.nome,
      user_email: usuario.email,
      scheduling_url: usuario.schedulingUrl,
      webhook_uri: assinatura?.uri ?? null,
      webhook_scope: assinatura?.escopo ?? null,
      webhook_state: assinatura?.estado ?? null,
      status: assinatura ? "conectado" : "erro",
      last_error: assinatura ? null : webhookErro,
      created_by: userId,
      updated_at: agora,
    },
    { onConflict: "account_id" },
  );
  if (error) return { ok: false, codigo: "db_error" };

  return { ok: true, usuario: { nome: usuario.nome, email: usuario.email }, escopo: assinatura?.escopo ?? null, webhookErro };
}

/** Recria a assinatura com o token guardado (assinatura desativada, URL nova…). */
export async function reassinarWebhook(
  admin: SupabaseClient,
  accountId: string,
  origem: string | null,
  opcoes: { cliente?: FabricaDeCliente } = {},
): Promise<{ ok: true; escopo: EscopoDaAssinatura } | { ok: false; codigo: CodigoDaConexao }> {
  if (!origem) return { ok: false, codigo: "url_inalcancavel" };
  const { data: config, error } = await admin
    .from("cb_calendly_config")
    .select("access_token, webhook_token, webhook_uri, user_uri, organization_uri")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) return { ok: false, codigo: "db_error" };
  if (!config) return { ok: false, codigo: "nao_conectado" };

  let token: string;
  try {
    token = decrypt(config.access_token);
  } catch {
    return { ok: false, codigo: "chave_ilegivel" };
  }
  const cliente = (opcoes.cliente ?? criarClienteCalendly)(token);
  await apagarSeExistir(cliente, config.webhook_uri);

  const signingKey = gerarChaveDeAssinatura();
  try {
    const assinatura = await assinarWebhook(cliente, {
      url: urlDoWebhook(origem, config.webhook_token),
      organizationUri: config.organization_uri,
      userUri: config.user_uri,
      signingKey,
    });
    const { error: erroUpdate } = await admin
      .from("cb_calendly_config")
      .update({
        signing_key: encrypt(signingKey),
        webhook_uri: assinatura.uri,
        webhook_scope: assinatura.escopo,
        webhook_state: assinatura.estado,
        status: "conectado",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("account_id", accountId);
    if (erroUpdate) return { ok: false, codigo: "db_error" };
    return { ok: true, escopo: assinatura.escopo };
  } catch (e) {
    const codigo = codigoDe(e);
    console.warn(`[calendly] reassinatura recusada (${codigo}):`, e instanceof Error ? e.message : e);
    await admin
      .from("cb_calendly_config")
      .update({ webhook_uri: null, webhook_scope: null, webhook_state: null, status: "erro", last_error: codigo, updated_at: new Date().toISOString() })
      .eq("account_id", accountId);
    return { ok: false, codigo };
  }
}

/** Apaga a assinatura no Calendly (melhor esforço) e a config. Os eventos ficam. */
export async function desconectarCalendly(
  admin: SupabaseClient,
  accountId: string,
  opcoes: { cliente?: FabricaDeCliente } = {},
): Promise<{ ok: true } | { ok: false; codigo: CodigoDaConexao }> {
  const { data: config } = await admin
    .from("cb_calendly_config")
    .select("access_token, webhook_uri")
    .eq("account_id", accountId)
    .maybeSingle();
  if (config?.webhook_uri) {
    try {
      await apagarSeExistir((opcoes.cliente ?? criarClienteCalendly)(decrypt(config.access_token)), config.webhook_uri);
    } catch {
      /* token ilegível: a assinatura fica para o Calendly desativar em 24h de 401 */
    }
  }
  const { error } = await admin.from("cb_calendly_config").delete().eq("account_id", accountId);
  if (error) return { ok: false, codigo: "db_error" };
  return { ok: true };
}

/**
 * Confere no Calendly o estado da assinatura guardada e corrige a linha
 * quando divergem. O Calendly DESATIVA a assinatura depois de 24h de
 * entregas com falha e não avisa — só a coluna gravada na criação ficaria,
 * dizendo "ativo" para sempre (achado do Codex no PR #128). Chamada pelo
 * cartão a cada carga; nunca lança (Calendly fora do ar = fica o que está).
 */
export async function conferirAssinatura(
  admin: SupabaseClient,
  accountId: string,
  opcoes: { cliente?: FabricaDeCliente } = {},
): Promise<void> {
  const { data: config } = await admin
    .from("cb_calendly_config")
    .select("access_token, webhook_uri, webhook_state, status, last_error")
    .eq("account_id", accountId)
    .maybeSingle();
  if (!config?.webhook_uri) return;

  let token: string;
  try {
    token = decrypt(config.access_token);
  } catch {
    return;
  }
  const agora = new Date().toISOString();
  try {
    const viva = await (opcoes.cliente ?? criarClienteCalendly)(token).assinatura(config.webhook_uri);
    if (viva.estado !== config.webhook_state) {
      await admin
        .from("cb_calendly_config")
        .update({ webhook_state: viva.estado, updated_at: agora })
        .eq("account_id", accountId);
    }

    // ⚠️⚠️ A assinatura de pé pode estar INCOMPLETA, e esse é o modo de
    // falha SILENCIOSO desta integração: a lista de eventos é fixada na
    // CRIAÇÃO, então quem assinou antes de 20/09/2026 continua recebendo só
    // `invitee.created` — o cancelamento nunca chega, os lembretes de uma
    // reunião cancelada saem do mesmo jeito, e nada na tela sugere que falta
    // um clique. Aqui isso vira erro VISÍVEL, com o botão "Reassinar" ao
    // lado, que é exatamente o conserto.
    const faltando = EVENTOS_ASSINADOS.filter((e) => !viva.eventos.includes(e));
    if (faltando.length > 0) {
      await admin
        .from("cb_calendly_config")
        .update({ status: "erro", last_error: "assinatura_incompleta", updated_at: agora })
        .eq("account_id", accountId);
    } else if (config.status === "erro" && config.last_error === "assinatura_incompleta") {
      // Reassinou: some o aviso. Só este código é limpo — outro erro
      // gravado aqui é de outra coisa e não se apaga de carona.
      await admin
        .from("cb_calendly_config")
        .update({ status: "ok", last_error: null, updated_at: agora })
        .eq("account_id", accountId);
    }
  } catch (e) {
    const codigo = codigoDe(e);
    if (codigo === "nao_encontrado") {
      // Apagada do lado de lá (pelo painel do Calendly, ou por nós numa
      // reconexão que não gravou): o que resta é reassinar.
      await admin
        .from("cb_calendly_config")
        .update({ webhook_state: "disabled", updated_at: agora })
        .eq("account_id", accountId);
    } else if (codigo === "token_invalido") {
      await admin
        .from("cb_calendly_config")
        .update({ status: "erro", last_error: "token_invalido", updated_at: agora })
        .eq("account_id", accountId);
    }
    // rede/limite/outros: sem informação nova, fica o que está.
  }
}

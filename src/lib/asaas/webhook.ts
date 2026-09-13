import { randomBytes, timingSafeEqual } from "node:crypto";

import { ehUrlAlcancavel } from "@/lib/cb-channels/webhook-url";

import { classificar, ehDevida } from "./inadimplencia";
import type { CobrancaDoAsaas } from "./leitura";

/**
 * O AVISO NA HORA do Asaas (webhook, Fase 2 do plano) — a parte PURA: o que
 * chega, o que o CRM assina, como o estado do webhook é lido, e as duas
 * decisões que a rota e o cron tomam sem I/O.
 *
 * ⚠️ O corpo da entrega é AVISO, não dado (D8). De evento de cobrança o CRM
 * lê só `payment.id` e relê a cobrança na API com a própria chave — a
 * releitura devolve o estado ATUAL, então a ordem de chegada deixa de
 * importar (`sendType: NON_SEQUENTIALLY`: um evento preso não segura a
 * fila). De evento de chave lê só `accessToken.name`, porque os eventos de
 * chave são da CONTA inteira e só o nome diz se a chave é a nossa.
 *
 * ⚠️ "Atributos novos podem aparecer a qualquer momento", diz a doc — a
 * leitura é tolerante e nada aqui lança por campo desconhecido.
 *
 * ⚠️ A autenticação da entrega é IGUALDADE do token no cabeçalho
 * `asaas-access-token` (não há HMAC): o CRM gera um token aleatório de 48
 * caracteres, informa ao Asaas na criação e o guarda cifrado; a rota compara
 * em tempo constante. O token da URL (`webhook_token`) só diz de qual conta
 * é a entrega — a lição da 982: URL vaza; a credencial mora no cabeçalho.
 */

/** Os eventos que o CRM assina — só o que mexe no ESTADO de uma cobrança devida, mais os da chave. */
export const EVENTOS_ASSINADOS = [
  "PAYMENT_OVERDUE",
  "PAYMENT_UPDATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_RECEIVED_IN_CASH_UNDONE",
  "PAYMENT_DELETED",
  "PAYMENT_RESTORED",
  "PAYMENT_REFUNDED",
  "PAYMENT_DUNNING_REQUESTED",
  "PAYMENT_DUNNING_RECEIVED",
  "ACCESS_TOKEN_DISABLED",
  "ACCESS_TOKEN_EXPIRED",
  "ACCESS_TOKEN_DELETED",
] as const;

/** O evento de chave → o código que o cartão traduz (`asaas.motivo.<código>`). */
export const CODIGO_DO_EVENTO_DE_CHAVE: Record<string, "chave_desabilitada" | "chave_expirada" | "chave_apagada"> = {
  ACCESS_TOKEN_DISABLED: "chave_desabilitada",
  ACCESS_TOKEN_EXPIRED: "chave_expirada",
  ACCESS_TOKEN_DELETED: "chave_apagada",
};

/** Forma do token da URL (o mesmo formato do Calendly e dos webhooks de entrada). */
export const RE_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

/** O segmento da URL que identifica a CONTA — 32 caracteres em base64url. */
export function gerarTokenDaUrl(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * A CREDENCIAL que o Asaas devolve em `asaas-access-token`: 48 caracteres
 * em base64url (a API exige de 32 a 255, sem espaços, sem sequência óbvia).
 * ⚠️ Nunca a chave da API — a doc proíbe, e a chave nunca sai do banco.
 */
export function gerarTokenDeAutenticacao(): string {
  return randomBytes(36).toString("base64url");
}

/** Igualdade em tempo constante; recebido ausente ou de outro tamanho é `false`. */
export function tokenConfere(recebido: string | null | undefined, esperado: string): boolean {
  if (!recebido || !esperado) return false;
  const a = Buffer.from(recebido, "utf8");
  const b = Buffer.from(esperado, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function urlDoWebhook(origem: string, token: string): string {
  return `${origem.replace(/\/+$/, "")}/api/cb/asaas/webhook/${token}`;
}

/** O nome do webhook na tela do Asaas — o operador precisa reconhecê-lo entre os dele. */
export function nomeDoWebhook(app: string): string {
  return `${app} — aviso de cobrança`;
}

/**
 * A origem PÚBLICA do CRM, ou `null` quando ela não é alcançável de fora
 * (`ehUrlAlcancavel`, a guarda da Evolution). ⚠️ Nesta instalação o
 * `.env.local` do preview aponta para a MESMA URL da produção: criar o
 * webhook a partir do preview registraria no Asaas um endereço que só
 * atende depois do deploy — por isso a criação automática vive SÓ no cron
 * (que só roda na VPS), e o botão do cartão é um gesto explícito.
 */
export function origemPublica(): string | null {
  const origem = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") || null;
  return origem && ehUrlAlcancavel(origem) ? origem : null;
}

/**
 * O HOST por onde o pedido entrou. ⚠️ Nunca só `new URL(request.url).host`:
 * o servidor `standalone` da produção sobe com `HOSTNAME=0.0.0.0` e o Next
 * monta `request.url` a partir DISSO, não do `Host` — em produção ele é
 * `0.0.0.0:3000`, sempre. O Traefik escreve `x-forwarded-host`, e o próprio
 * Next preenche o cabeçalho com o `Host` quando ele falta (`base-server`),
 * então a ordem é a mesma do OAuth do Instagram (`origemDoPedido`):
 * `x-forwarded-host` → `host` → a URL (revisão independente do PR #204).
 */
export function hostDoPedido(request: Pick<Request, "headers" | "url">): string {
  const primeiro = (v: string | null) => v?.split(",")[0]?.trim() ?? "";
  const doCabecalho = primeiro(request.headers.get("x-forwarded-host")) || primeiro(request.headers.get("host"));
  if (/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(doCabecalho)) return doCabecalho.toLowerCase();
  try {
    return new URL(request.url).host.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Puro: o pedido veio do PRÓPRIO host público? É a guarda do botão "Ativar"
 * e da primeira sincronização depois de conectar — sem ela, a máquina de
 * alguém com a URL da produção no `.env.local` registraria o webhook no
 * Asaas antes de o deploy existir (a mesma família da guarda da Evolution
 * em `webhook-url.ts`, `origemDoPedido`).
 */
export function podeCriarDaqui(origem: string | null, request: Pick<Request, "headers" | "url">): boolean {
  if (!origem) return false;
  try {
    const host = hostDoPedido(request);
    return host !== "" && new URL(origem).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function texto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const aparado = v.trim();
  return aparado === "" ? null : aparado;
}

export type AvisoDoWebhook =
  | { tipo: "cobranca"; eventoId: string; evento: string; paymentId: string; criadoEm: string | null }
  | { tipo: "chave"; eventoId: string; evento: string; nome: string | null; criadoEm: string | null }
  | { tipo: "outro"; eventoId: string; evento: string; criadoEm: string | null };

/**
 * Puro: o corpo da entrega → o AVISO. `null` quando não há `id` nem `event`
 * (não é uma entrega do Asaas). Evento de cobrança sem `payment.id` vira
 * `outro` — registrado, não processado.
 *
 * ⚠️ O `id` do evento contém `&` (`evt_…&368604920`) — vai para o banco como
 * texto, nunca para uma URL.
 */
export function lerAviso(corpo: unknown): AvisoDoWebhook | null {
  if (!ehObjeto(corpo)) return null;
  const eventoId = texto(corpo.id)?.slice(0, 200) ?? null;
  const evento = texto(corpo.event)?.slice(0, 80) ?? null;
  if (!eventoId || !evento) return null;
  const criadoEm = texto(corpo.dateCreated)?.slice(0, 40) ?? null;
  if (evento.startsWith("PAYMENT_")) {
    const paymentId = ehObjeto(corpo.payment) ? texto(corpo.payment.id) : null;
    if (paymentId) return { tipo: "cobranca", eventoId, evento, paymentId, criadoEm };
    return { tipo: "outro", eventoId, evento, criadoEm };
  }
  if (evento.startsWith("ACCESS_TOKEN_")) {
    const nome = ehObjeto(corpo.accessToken) ? texto(corpo.accessToken.name) : null;
    return { tipo: "chave", eventoId, evento, nome, criadoEm };
  }
  return { tipo: "outro", eventoId, evento, criadoEm };
}

/**
 * Puro: a cobrança relida entra (ou continua) no espelho?
 *
 * O espelho guarda o que o CRM já viu VENCIDO e o que vence HOJE (D17) —
 * não é cópia do Asaas. Um `PAYMENT_RECEIVED` de uma cobrança nunca vista
 * não tem nada a atualizar; o mesmo evento numa cobrança que o espelho
 * conhece é justamente o "pagou, some do aviso".
 */
export function deveEntrarNoEspelho(c: CobrancaDoAsaas, jaExiste: boolean, hoje: string): boolean {
  if (jaExiste) return true;
  if (ehDevida(classificar(c.status, c.apagado))) return true;
  return c.status === "PENDING" && c.vencimento === hoje;
}

export interface WebhookNoAsaas {
  id: string;
  url: string | null;
  enabled: boolean;
  interrupted: boolean;
  penalizados: number;
  temToken: boolean;
}

/** Puro: a resposta de `GET/POST/PUT /webhooks…` → o que interessa. `null` sem `id`. */
export function lerWebhookDoAsaas(bruto: unknown): WebhookNoAsaas | null {
  if (!ehObjeto(bruto)) return null;
  const id = texto(bruto.id);
  if (!id) return null;
  return {
    id,
    url: texto(bruto.url),
    enabled: bruto.enabled !== false,
    interrupted: bruto.interrupted === true,
    penalizados: typeof bruto.penalizedRequestsCount === "number" ? bruto.penalizedRequestsCount : 0,
    temToken: bruto.hasAuthToken === true,
  };
}

/**
 * Puro: o que o cron faz com o webhook que acabou de ler.
 *
 * - `desligado`: alguém o desligou no painel do Asaas (o CRM não religa
 *   sozinho o que uma pessoa desligou — o cartão oferece "Ativar").
 * - `religar`: a fila está interrompida e o CRM AINDA NÃO religou desde o
 *   último gesto de gente → religa uma vez (`PUT { interrupted: false }`).
 * - `interrompido`: interrompida DE NOVO depois de o CRM religar — a doc
 *   manda corrigir a causa antes; vira "precisa de atenção" no cartão.
 * - `penalizado`: entregas em backoff (`penalizedRequestsCount > 0`) — a fila
 *   anda, mas com atraso; o cartão avisa.
 */
export function decisaoDoCron(w: WebhookNoAsaas, jaReligou: boolean): "ativo" | "penalizado" | "interrompido" | "desligado" | "religar" {
  if (!w.enabled) return "desligado";
  if (w.interrupted) return jaReligou ? "interrompido" : "religar";
  if (w.penalizados > 0) return "penalizado";
  return "ativo";
}

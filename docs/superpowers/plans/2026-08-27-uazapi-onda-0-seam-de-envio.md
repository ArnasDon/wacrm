# Onda 0 — Extração do seam de envio (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extrair a sequência "carrega config → decripta token → retry de
variante de telefone → chama a API do provedor → persiste → atualiza
conversa", hoje copiada em 5 lugares, para um transporte + um núcleo de
envio compartilhados — sem adicionar uma linha de UAZAPI e sem mudar
comportamento observável.

**Architecture:** Três camadas novas em `src/lib/whatsapp/`. (1)
`providers/` define a interface `WhatsAppTransport` e a implementa para a
Meta; o retry de variantes de telefone e o `phone_number_id` ficam
inteiramente dentro do transporte Meta. (2) `resolve-connection.ts` é o
**único** lugar que lê a tabela de configuração e decripta a credencial —
na Onda 1 é o único arquivo cuja query muda para `whatsapp_connections`.
(3) `send-core.ts` orquestra capacidade → contato → envio → persistência
→ pausa de flow. Os 5 call sites viram invocações finas: três pelo núcleo
(inbox/API pública, Flows, Automations) e dois direto pelo transporte
(broadcast, que persiste em `broadcast_recipients`, e reação, que
persiste em `message_reactions`).

**Tech Stack:** TypeScript 6, Next.js 16.2.12 (App Router), Supabase JS
2.107, Vitest 4.1.10 (`environment: node`), Prettier (`semi: true`,
`singleQuote: true`, `printWidth: 80`, `trailingComma: es5`).

**Spec:** `docs/superpowers/specs/2026-08-27-uazapi-provider-design.md`
(seções 1–3, 4.2, 5, 6, 7). As seções 4.1 (migração 040), 4.3 (inbound),
4.4 (provisionamento) e 4.5 (UI) são das Ondas 1–2 e ganham planos
próprios.

## Global Constraints

- **Critério de aceite da onda (spec §4.2, §5, §6):** refactor puro, só
  Meta, zero mudança de comportamento observável. `npm test` passa com a
  suíte existente **inalterada**, com uma única exceção autorizada e
  justificada na Task 7.
- **Nenhum arquivo `supabase/migrations/*` é criado ou alterado nesta
  onda.** A tabela continua sendo `whatsapp_config` e a coluna continua
  sendo `access_token`. O rename é da Onda 1.
- **Nenhuma menção a `uazapi` em código de produção nesta onda.** O tipo
  `ProviderName` inclui `'uazapi'` porque é uma união de tipos; nenhum
  transporte para ele é escrito, e `createTransport` lança para qualquer
  provider que não seja `'meta'`.
- **O contrato HTTP público não muda.** `src/app/api/v1/messages/route.ts`
  serializa `err.code`, `err.message` e `err.status` de `SendMessageError`
  direto no envelope v1. Os códigos `bad_request`, `not_found`,
  `whatsapp_not_configured`, `template_malformed`, `meta_error` e
  `db_error`, suas mensagens e seus status ficam **byte a byte iguais**.
- Comandos de verificação: `npm test`, `npm run typecheck`, `npm run lint`.
- Rode `npx prettier --write <arquivos tocados>` antes de cada commit.
- Convenção de nomes: `provider` (não `vendor`), `credential` (não
  `token`) na fronteira do seam, `providerMessageId` (não `wamid`, não
  `whatsappMessageId`) dentro de `providers/` e `send-core.ts`.

---

## Estrutura de arquivos

**Criados**

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/whatsapp/providers/types.ts` | `ProviderName`, `ProviderCapabilities`, `TransportResult`, os args de cada método, `WhatsAppTransport`, `UnsupportedCapabilityError`. Zero I/O. |
| `src/lib/whatsapp/providers/meta-transport.ts` | `createMetaTransport(conn)`. Único lugar que conhece `phone_number_id` e o retry de variantes de telefone. |
| `src/lib/whatsapp/providers/index.ts` | `createTransport(conn)` — despacho por `conn.provider`. |
| `src/lib/whatsapp/providers/meta-transport.test.ts` | Retry de variantes, `normalizedRecipient`, reação sem retry, descritor de capacidades. |
| `src/lib/whatsapp/send-error.ts` | `SendMessageError` + `SendFailureReason`. Mora sozinho para que `send-core.ts` e `resolve-conversation.ts` o importem sem ciclo. |
| `src/lib/whatsapp/resolve-connection.ts` | `resolveConnection()` — o único leitor de `whatsapp_config` no caminho de envio. |
| `src/lib/whatsapp/resolve-connection.test.ts` | Achou / não achou / self-heal de ciphertext legado. |
| `src/lib/whatsapp/send-core.ts` | `sendViaConnection()` — capacidade, contato, envio, persistência, pausa de flow. |
| `src/lib/whatsapp/send-core.test.ts` | Rejeição por capacidade, writeback de telefone, shape do insert, override de preview, gate da pausa de flow. |
| `src/lib/whatsapp/engine-error.ts` | `toEngineError()` — mapeia `SendMessageError` de volta às mensagens que Flows e Automations lançam hoje. |

**Modificados**

| Arquivo | Mudança |
|---|---|
| `src/lib/whatsapp/send-message.ts` | Re-exporta `SendMessageError` e delega ao núcleo. Contrato exportado inalterado. |
| `src/lib/flows/meta-send.ts` | As 4 funções `engineSend*` viram wrappers finos do núcleo. |
| `src/lib/automations/meta-send.ts` | `engineSendText` / `engineSendTemplate` viram wrappers finos. `engineSendInteractive` não muda. |
| `src/lib/whatsapp/broadcast-core.ts` | `BroadcastPlan.phoneNumberId` + `.accessToken` → `.connection`. `deliverBroadcast` monta o transporte. |
| `src/lib/whatsapp/broadcast-resume.ts` | Monta o plano com `connection`. |
| `src/app/api/whatsapp/react/route.ts` | Usa `resolveConnection` + `transport.sendReaction`. |
| `src/lib/whatsapp/broadcast-resume.test.ts` | **Uma linha** (Task 7) — rename de campo, não mudança de comportamento. |

**Deliberadamente fora desta onda**

- `fetchMedia` na interface do transporte. A spec §4.2 o lista, mas seu
  único consumidor é `mirrorInboundMedia`, que é inbound (Onda 1).
  Adicioná-lo agora criaria um método sem chamador.
- A **suíte de contrato de transporte** da spec §6 ("uma suíte única
  rodada contra os dois transportes"). Com um transporte só, ela seria a
  suíte da Task 1 com um invólucro a mais. Ela nasce na Onda 1, quando
  existir um segundo transporte para rodá-la contra.
- Resolução de conexão em 3 níveis (conversa → explícito → primária).
  Com uma linha por account os três níveis colapsam em um. A assinatura
  já aceita `connectionId` e `conversationId` para que os call sites não
  precisem mudar de novo na Onda 1.

---

## Task 1: Interface do transporte + transporte Meta

**Files:**
- Create: `src/lib/whatsapp/providers/types.ts`
- Create: `src/lib/whatsapp/providers/meta-transport.ts`
- Create: `src/lib/whatsapp/providers/index.ts`
- Test: `src/lib/whatsapp/providers/meta-transport.test.ts`

**Interfaces:**
- Consumes: `sendTextMessage`, `sendMediaMessage`, `sendTemplateMessage`,
  `sendInteractiveButtons`, `sendInteractiveList`, `sendReactionMessage`,
  `MediaKind` de `@/lib/whatsapp/meta-api`; `phoneVariants`,
  `isRecipientNotAllowedError` de `@/lib/whatsapp/phone-utils`;
  `InteractiveMessagePayload` de `@/lib/whatsapp/interactive`;
  `SendTimeParams` de `@/lib/whatsapp/template-send-builder`;
  `MessageTemplate` de `@/types`.
- Produces: `ProviderName`, `ProviderCapabilities`, `TransportResult`,
  `TransportConnection`, `TransportTextArgs`, `TransportMediaArgs`,
  `TransportInteractiveArgs`, `TransportTemplateArgs`,
  `TransportReactionArgs`, `WhatsAppTransport`,
  `UnsupportedCapabilityError`,
  `createMetaTransport(conn: TransportConnection): WhatsAppTransport`,
  `createTransport(conn: TransportConnection): WhatsAppTransport`.

> **Por que o retry de variantes fica aqui:** `phoneVariants` +
> `isRecipientNotAllowedError` existem por causa do sandbox da Meta e do
> trunk 0 brasileiro. É gambiarra de provedor, não regra de negócio. Ela
> vaza para fora só como `TransportResult.normalizedRecipient` — "a API
> aceitou este outro número" — e cabe ao chamador decidir se grava isso
> no contato. Hoje inbox/Flows/Automations gravam e o broadcast não; esse
> contraste é exatamente o que a estrutura preserva.
>
> **Por que `sendReaction` NÃO usa o retry:** `react/route.ts` hoje manda
> o telefone sanitizado direto, sem loop. Adicionar retry aqui mudaria
> comportamento num caminho de falha. Fica sem, com comentário no código.

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/lib/whatsapp/providers/meta-transport.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const sendTextMessage = vi.fn();
const sendReactionMessage = vi.fn();

vi.mock('@/lib/whatsapp/meta-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendTextMessage: (...a: unknown[]) => sendTextMessage(...a),
  sendMediaMessage: vi.fn(async () => ({ messageId: 'wamid.media' })),
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'wamid.tpl' })),
  sendInteractiveButtons: vi.fn(async () => ({ messageId: 'wamid.btn' })),
  sendInteractiveList: vi.fn(async () => ({ messageId: 'wamid.list' })),
  sendReactionMessage: (...a: unknown[]) => sendReactionMessage(...a),
}));

import { createMetaTransport } from './meta-transport';
import { createTransport } from './index';
import type { TransportConnection } from './types';

const conn: TransportConnection = {
  id: 'cfg-1',
  accountId: 'acct-1',
  provider: 'meta',
  phoneNumberId: 'pn-1',
  credential: 'plain-token',
};

const NOT_ALLOWED =
  '(#131030) Recipient phone number not in allowed list';

beforeEach(() => {
  sendTextMessage.mockReset();
  sendReactionMessage.mockReset();
});

describe('createMetaTransport', () => {
  it('declara as capacidades da Meta', () => {
    expect(createMetaTransport(conn).capabilities).toEqual({
      templates: true,
      interactive: true,
      reactions: true,
      media: true,
    });
    expect(createMetaTransport(conn).provider).toBe('meta');
  });

  it('envia texto pelo phone_number_id da conexão e não reporta normalização quando a primeira variante passa', async () => {
    sendTextMessage.mockResolvedValueOnce({ messageId: 'wamid.1' });
    const result = await createMetaTransport(conn).sendText({
      to: '5511999998888',
      text: 'oi',
    });
    expect(result).toEqual({
      providerMessageId: 'wamid.1',
      normalizedRecipient: undefined,
    });
    expect(sendTextMessage).toHaveBeenCalledWith({
      phoneNumberId: 'pn-1',
      accessToken: 'plain-token',
      to: '5511999998888',
      text: 'oi',
      contextMessageId: undefined,
    });
  });

  it('tenta a próxima variante em "recipient not allowed" e reporta o número aceito', async () => {
    sendTextMessage
      .mockRejectedValueOnce(new Error(NOT_ALLOWED))
      .mockResolvedValueOnce({ messageId: 'wamid.2' });

    const result = await createMetaTransport(conn).sendText({
      to: '5511999998888',
      text: 'oi',
    });

    expect(result.providerMessageId).toBe('wamid.2');
    // `phoneVariants('5511999998888')` devolve, nesta ordem:
    // ['5511999998888', '50511999998888', '55011999998888',
    //  '55101999998888']. A segunda tentativa usa o índice 1.
    expect(result.normalizedRecipient).toBe('50511999998888');
    expect(sendTextMessage).toHaveBeenCalledTimes(2);
  });

  it('não tenta outra variante em erro que não seja "recipient not allowed"', async () => {
    sendTextMessage.mockRejectedValue(new Error('(#132000) Template mismatch'));
    await expect(
      createMetaTransport(conn).sendText({ to: '5511999998888', text: 'oi' })
    ).rejects.toThrow(/132000/);
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
  });

  it('propaga o último erro quando todas as variantes são rejeitadas', async () => {
    sendTextMessage.mockRejectedValue(new Error(NOT_ALLOWED));
    await expect(
      createMetaTransport(conn).sendText({ to: '5511999998888', text: 'oi' })
    ).rejects.toThrow(/131030/);
    expect(sendTextMessage.mock.calls.length).toBeGreaterThan(1);
  });

  it('manda reação sem retry de variante (paridade com /api/whatsapp/react)', async () => {
    sendReactionMessage.mockRejectedValueOnce(new Error(NOT_ALLOWED));
    await expect(
      createMetaTransport(conn).sendReaction({
        to: '5511999998888',
        targetProviderMessageId: 'wamid.target',
        emoji: '👍',
      })
    ).rejects.toThrow(/131030/);
    expect(sendReactionMessage).toHaveBeenCalledTimes(1);
  });
});

describe('createTransport', () => {
  it('devolve o transporte Meta para provider="meta"', () => {
    expect(createTransport(conn).provider).toBe('meta');
  });

  it('lança para um provider ainda não implementado', () => {
    expect(() => createTransport({ ...conn, provider: 'uazapi' })).toThrow(
      /uazapi/
    );
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/lib/whatsapp/providers/meta-transport.test.ts`
Expected: FAIL com `Failed to resolve import "./meta-transport"`.

- [ ] **Step 3: Escrever `providers/types.ts`**

```ts
// ============================================================
// Contrato de transporte de WhatsApp.
//
// Um transporte é a ÚNICA coisa que fala com a API de um provedor.
// Ele não vê o banco: recebe uma conexão já resolvida (credencial
// decriptada) e devolve o id de mensagem do provedor. Quem persiste é
// o núcleo (`send-core.ts`) ou, no caso do broadcast e da reação, o
// próprio call site — os dois gravam em tabelas que não são `messages`.
// ============================================================

import type { MediaKind } from '@/lib/whatsapp/meta-api';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';
import type { MessageTemplate } from '@/types';

export type ProviderName = 'meta' | 'uazapi';

/**
 * O que o transporte IMPLEMENTA hoje — não o que a API do provedor é
 * capaz de fazer. O núcleo consulta isto antes de enviar e a UI usa o
 * mesmo descritor para esconder affordances que não se aplicam.
 */
export interface ProviderCapabilities {
  templates: boolean;
  interactive: boolean;
  reactions: boolean;
  media: boolean;
}

/**
 * Linha de configuração com a credencial JÁ DECRIPTADA. Produzida por
 * `resolveConnection()`; consumida só por transportes.
 */
export interface TransportConnection {
  id: string;
  accountId: string;
  provider: ProviderName;
  /** Meta: `phone_number_id`. Null para provedores que não usam um. */
  phoneNumberId: string | null;
  /** Meta: access token. (Onda 1: UAZAPI usa a mesma coluna.) */
  credential: string;
}

export interface TransportResult {
  providerMessageId: string;
  /**
   * Telefone que a API realmente aceitou, quando o transporte aplicou
   * normalização própria (o retry de variantes da Meta). Ausente quando
   * o número enviado foi o número aceito. O chamador decide se grava
   * isso de volta no contato — inbox/Flows/Automations gravam, o
   * broadcast não.
   */
  normalizedRecipient?: string;
}

interface BaseSendArgs {
  /** Telefone sanitizado, só dígitos. */
  to: string;
  /** Id de mensagem DO PROVEDOR que está sendo respondida (quote). */
  replyToProviderMessageId?: string;
}

export interface TransportTextArgs extends BaseSendArgs {
  text: string;
}

export interface TransportMediaArgs extends BaseSendArgs {
  mediaKind: MediaKind;
  /** URL pública que o provedor busca no momento do envio. */
  link: string;
  caption?: string;
  filename?: string;
}

export interface TransportInteractiveArgs extends BaseSendArgs {
  payload: InteractiveMessagePayload;
}

export interface TransportTemplateArgs extends BaseSendArgs {
  templateName: string;
  language?: string;
  template?: MessageTemplate;
  messageParams?: SendTimeParams;
  params?: string[];
}

export interface TransportReactionArgs {
  to: string;
  targetProviderMessageId: string;
  /** Emoji único, ou string vazia para remover. */
  emoji: string;
}

export interface WhatsAppTransport {
  readonly provider: ProviderName;
  readonly capabilities: ProviderCapabilities;
  sendText(args: TransportTextArgs): Promise<TransportResult>;
  sendMedia(args: TransportMediaArgs): Promise<TransportResult>;
  sendInteractive(args: TransportInteractiveArgs): Promise<TransportResult>;
  sendTemplate(args: TransportTemplateArgs): Promise<TransportResult>;
  sendReaction(args: TransportReactionArgs): Promise<TransportResult>;
}

/**
 * Lançado quando se pede a um transporte algo que ele não declara em
 * `capabilities`. O núcleo mapeia para um 400 com mensagem clara, em vez
 * de deixar a chamada morrer no fio com erro opaco do provedor.
 */
export class UnsupportedCapabilityError extends Error {
  readonly provider: ProviderName;
  readonly capability: keyof ProviderCapabilities;
  constructor(provider: ProviderName, capability: keyof ProviderCapabilities) {
    super(`Provider "${provider}" does not support ${capability} messages`);
    this.name = 'UnsupportedCapabilityError';
    this.provider = provider;
    this.capability = capability;
  }
}
```

- [ ] **Step 4: Escrever `providers/meta-transport.ts`**

```ts
// ============================================================
// Transporte Meta Cloud API.
//
// Concentra tudo que é específico da Meta: o `phone_number_id`, o
// vocabulário `contextMessageId`, e o retry de variantes de telefone
// (`phoneVariants` / `isRecipientNotAllowedError`) — gambiarra do
// sandbox da Meta e do trunk 0 brasileiro que existia copiada em quatro
// arquivos e agora existe uma vez, aqui.
// ============================================================

import {
  sendTextMessage,
  sendMediaMessage,
  sendTemplateMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  sendReactionMessage,
} from '@/lib/whatsapp/meta-api';
import {
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import type {
  TransportConnection,
  TransportInteractiveArgs,
  TransportMediaArgs,
  TransportReactionArgs,
  TransportTemplateArgs,
  TransportTextArgs,
  TransportResult,
  WhatsAppTransport,
} from './types';

/**
 * Roda `attempt` contra cada variante plausível do número, avançando SÓ
 * quando a Meta responde "recipient not in allowed list". Qualquer outro
 * erro sobe imediatamente — tentar outra variante contra um template
 * malformado só multiplica a mesma falha.
 */
async function withPhoneVariants(
  to: string,
  attempt: (phone: string) => Promise<string>
): Promise<TransportResult> {
  const variants = phoneVariants(to);
  let lastError: unknown = null;

  for (const variant of variants) {
    try {
      const providerMessageId = await attempt(variant);
      return {
        providerMessageId,
        normalizedRecipient: variant === to ? undefined : variant,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!isRecipientNotAllowedError(message)) throw err;
      lastError = err;
      console.warn(
        `[meta-transport] variant "${variant}" rejected by Meta, trying next…`
      );
    }
  }

  // `phoneVariants` só devolve [] para entrada vazia, que o núcleo já
  // barrou em `isValidE164`. O throw existe para que um caminho novo não
  // passe silenciosamente com um id de mensagem vazio.
  throw lastError ?? new Error(`No phone variants to try for "${to}"`);
}

export function createMetaTransport(
  conn: TransportConnection
): WhatsAppTransport {
  const phoneNumberId = conn.phoneNumberId;
  if (!phoneNumberId) {
    throw new Error('Meta transport requires a phone_number_id');
  }
  const accessToken = conn.credential;

  return {
    provider: 'meta',
    capabilities: {
      templates: true,
      interactive: true,
      reactions: true,
      media: true,
    },

    sendText(args: TransportTextArgs) {
      return withPhoneVariants(args.to, async (to) => {
        const r = await sendTextMessage({
          phoneNumberId,
          accessToken,
          to,
          text: args.text,
          contextMessageId: args.replyToProviderMessageId,
        });
        return r.messageId;
      });
    },

    sendMedia(args: TransportMediaArgs) {
      return withPhoneVariants(args.to, async (to) => {
        const r = await sendMediaMessage({
          phoneNumberId,
          accessToken,
          to,
          kind: args.mediaKind,
          link: args.link,
          caption: args.caption,
          filename: args.filename,
          contextMessageId: args.replyToProviderMessageId,
        });
        return r.messageId;
      });
    },

    sendInteractive(args: TransportInteractiveArgs) {
      return withPhoneVariants(args.to, async (to) => {
        const p = args.payload;
        if (p.kind === 'buttons') {
          const r = await sendInteractiveButtons({
            phoneNumberId,
            accessToken,
            to,
            bodyText: p.body,
            headerText: p.header || undefined,
            footerText: p.footer || undefined,
            buttons: p.buttons,
            contextMessageId: args.replyToProviderMessageId,
          });
          return r.messageId;
        }
        const r = await sendInteractiveList({
          phoneNumberId,
          accessToken,
          to,
          bodyText: p.body,
          buttonLabel: p.button_label,
          headerText: p.header || undefined,
          footerText: p.footer || undefined,
          sections: p.sections,
          contextMessageId: args.replyToProviderMessageId,
        });
        return r.messageId;
      });
    },

    sendTemplate(args: TransportTemplateArgs) {
      return withPhoneVariants(args.to, async (to) => {
        const r = await sendTemplateMessage({
          phoneNumberId,
          accessToken,
          to,
          templateName: args.templateName,
          language: args.language,
          template: args.template,
          messageParams: args.messageParams,
          params: args.params,
          contextMessageId: args.replyToProviderMessageId,
        });
        return r.messageId;
      });
    },

    // Sem retry de variantes, de propósito: `/api/whatsapp/react` sempre
    // mandou o número sanitizado direto. Uma reação só é possível numa
    // conversa já estabelecida, onde o número que funciona já foi
    // descoberto e gravado no contato.
    async sendReaction(args: TransportReactionArgs) {
      const r = await sendReactionMessage({
        phoneNumberId,
        accessToken,
        to: args.to,
        targetMessageId: args.targetProviderMessageId,
        emoji: args.emoji,
      });
      return { providerMessageId: r.messageId };
    },
  };
}
```

- [ ] **Step 5: Escrever `providers/index.ts`**

```ts
import { createMetaTransport } from './meta-transport';
import type { TransportConnection, WhatsAppTransport } from './types';

export * from './types';
export { createMetaTransport } from './meta-transport';

/**
 * Monta o transporte da conexão. A Onda 0 só conhece a Meta; a Onda 1
 * acrescenta o ramo `'uazapi'` e nada mais neste arquivo muda.
 */
export function createTransport(conn: TransportConnection): WhatsAppTransport {
  switch (conn.provider) {
    case 'meta':
      return createMetaTransport(conn);
    default:
      throw new Error(
        `No transport implemented for provider "${conn.provider}"`
      );
  }
}
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `npm test -- src/lib/whatsapp/providers/meta-transport.test.ts`
Expected: PASS, 8 testes.

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/lib/whatsapp/providers
git add src/lib/whatsapp/providers
git commit -m "refactor(whatsapp): extract WhatsAppTransport seam with a Meta implementation"
```

---

## Task 2: `resolveConnection()` + `SendMessageError` em módulo próprio

**Files:**
- Create: `src/lib/whatsapp/send-error.ts`
- Create: `src/lib/whatsapp/resolve-connection.ts`
- Test: `src/lib/whatsapp/resolve-connection.test.ts`

**Interfaces:**
- Consumes: `decrypt`, `encrypt`, `isLegacyFormat` de
  `@/lib/whatsapp/encryption`; `TransportConnection` de
  `@/lib/whatsapp/providers/types`.
- Produces:
  - `SendFailureReason` e `SendMessageError` (construtor com 4º
    parâmetro `options` opcional), de `send-error.ts`.
  - `interface ResolveConnectionOptions { connectionId?: string; conversationId?: string; selfHeal?: boolean }`
  - `resolveConnection(db: SupabaseClient, accountId: string, options?: ResolveConnectionOptions): Promise<TransportConnection>`

> **Por que `SendMessageError` muda de arquivo:** `resolve-conversation.ts`
> já o importa de `send-message.ts`, e `send-core.ts` vai precisar dele
> antes de `send-message.ts` existir na sua forma nova. Um módulo próprio
> quebra o ciclo. `send-message.ts` continua re-exportando o símbolo
> (Task 4), então `import { SendMessageError } from './send-message'` —
> que dois testes existentes usam — continua resolvendo.
>
> **Por que `reason` existe:** o `code` de `SendMessageError` é contrato
> público (`/api/v1/messages` o serializa cru) e `bad_request` cobre hoje
> tanto "contato sem telefone" quanto "telefone em formato inválido".
> Flows e Automations lançam mensagens diferentes para esses dois casos.
> `reason` é o discriminador interno que deixa `toEngineError` (Task 5)
> reproduzir as mensagens antigas sem tocar no `code`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/lib/whatsapp/resolve-connection.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `decrypted:${v}`,
  encrypt: (v: string) => `encrypted:${v}`,
  isLegacyFormat: (v: string) => v === 'legacy-cipher',
}));

import { resolveConnection } from './resolve-connection';
import { SendMessageError } from './send-error';

interface Captured {
  updates: Record<string, unknown>[];
}

function configDb(
  row: Record<string, unknown> | null,
  captured: Captured = { updates: [] }
): SupabaseClient {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    update: (patch: Record<string, unknown>) => {
      captured.updates.push(patch);
      return builder;
    },
    single: async () => ({
      data: row,
      error: row ? null : { message: 'no rows' },
    }),
    // O self-heal faz `.update().eq().then()` — o builder precisa ser
    // "thenable" para que esse caminho resolva.
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ error: null }).then(resolve),
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

const ROW = {
  id: 'cfg-1',
  account_id: 'acct-1',
  phone_number_id: 'pn-1',
  access_token: 'cipher',
};

describe('resolveConnection', () => {
  it('devolve a conexão com a credencial decriptada', async () => {
    const conn = await resolveConnection(configDb(ROW), 'acct-1');
    expect(conn).toEqual({
      id: 'cfg-1',
      accountId: 'acct-1',
      provider: 'meta',
      phoneNumberId: 'pn-1',
      credential: 'decrypted:cipher',
    });
  });

  it('lança whatsapp_not_configured / 400 quando não há linha', async () => {
    await expect(
      resolveConnection(configDb(null), 'acct-1')
    ).rejects.toBeInstanceOf(SendMessageError);
    await resolveConnection(configDb(null), 'acct-1').catch(
      (e: SendMessageError) => {
        expect(e.code).toBe('whatsapp_not_configured');
        expect(e.status).toBe(400);
        expect(e.reason).toBe('not_configured');
        expect(e.message).toBe(
          'WhatsApp not configured. Please set up your WhatsApp integration first.'
        );
      }
    );
  });

  it('reescreve um ciphertext legado só quando selfHeal está ligado', async () => {
    const legacy = { ...ROW, access_token: 'legacy-cipher' };

    const off: Captured = { updates: [] };
    await resolveConnection(configDb(legacy, off), 'acct-1');
    expect(off.updates).toEqual([]);

    const on: Captured = { updates: [] };
    await resolveConnection(configDb(legacy, on), 'acct-1', { selfHeal: true });
    expect(on.updates).toEqual([
      { access_token: 'encrypted:decrypted:legacy-cipher' },
    ]);
  });

  it('não reescreve um ciphertext já moderno mesmo com selfHeal ligado', async () => {
    const captured: Captured = { updates: [] };
    await resolveConnection(configDb(ROW, captured), 'acct-1', {
      selfHeal: true,
    });
    expect(captured.updates).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/lib/whatsapp/resolve-connection.test.ts`
Expected: FAIL com `Failed to resolve import "./resolve-connection"`.

- [ ] **Step 3: Escrever `send-error.ts`**

```ts
/**
 * Motivo fino de uma falha de envio. Existe porque `code` é contrato
 * público (`/api/v1/messages` o serializa cru) e agrupa casos que os
 * engines de Flows e Automations reportam com mensagens distintas.
 * Nunca sai do processo.
 */
export type SendFailureReason =
  | 'conversation_not_found'
  | 'contact_not_found'
  | 'contact_phone_invalid'
  | 'not_configured'
  | 'unsupported_capability'
  | 'template_malformed'
  | 'provider_error'
  | 'message_insert_failed';

/**
 * Falha tipada com um `code` de máquina e um `status` HTTP sugerido. Os
 * chamadores mapeiam para o próprio formato de resposta
 * (`toErrorResponse` na rota do dashboard, o envelope v1 na pública,
 * `toEngineError` nos engines).
 */
export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  readonly reason?: SendFailureReason;

  constructor(
    code: string,
    message: string,
    status: number,
    options?: { reason?: SendFailureReason; cause?: unknown }
  ) {
    super(
      message,
      options?.cause !== undefined ? { cause: options.cause } : undefined
    );
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
    this.reason = options?.reason;
  }
}
```

- [ ] **Step 4: Escrever `resolve-connection.ts`**

```ts
// ============================================================
// Resolução de conexão de WhatsApp.
//
// O ÚNICO lugar do caminho de envio que lê a tabela de configuração e
// decripta a credencial. Toda a Onda 1 (rename para
// `whatsapp_connections`, `access_token` → `credential`, resolução em
// três níveis) cabe dentro deste arquivo: nada acima dele conhece o nome
// da tabela ou o formato do ciphertext.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import type { TransportConnection } from '@/lib/whatsapp/providers/types';
import { SendMessageError } from '@/lib/whatsapp/send-error';

export interface ResolveConnectionOptions {
  /**
   * Conexão explícita. Onda 0: aceito e ignorado — há no máximo uma
   * linha por account, então os três níveis da spec §4 (conversa →
   * explícito → primária) colapsam num só. A assinatura já existe para
   * que os call sites não precisem mudar de novo na Onda 1.
   */
  connectionId?: string;
  /** Conversa de origem. Mesma observação de `connectionId`. */
  conversationId?: string;
  /**
   * Reescreve um ciphertext CBC legado no formato GCM atual. Ligado só
   * pelo caminho da inbox / API pública, que é o único que fazia isso
   * antes deste refactor — os engines não escreviam na tabela de
   * configuração e continuam não escrevendo.
   */
  selfHeal?: boolean;
}

export async function resolveConnection(
  db: SupabaseClient,
  accountId: string,
  options: ResolveConnectionOptions = {}
): Promise<TransportConnection> {
  const { data: config, error } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();

  if (error || !config) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400,
      { reason: 'not_configured' }
    );
  }

  const credential = decrypt(config.access_token);

  // Auto-cura de ciphertexts CBC legados. Fire-and-forget, idempotente.
  if (options.selfHeal && isLegacyFormat(config.access_token)) {
    void db
      .from('whatsapp_config')
      .update({ access_token: encrypt(credential) })
      .eq('id', config.id)
      .then(
        ({ error: upgradeError }: { error: { message: string } | null }) => {
          if (upgradeError) {
            console.warn(
              '[resolve-connection] credential GCM upgrade failed:',
              upgradeError.message
            );
          }
        }
      );
  }

  return {
    id: config.id,
    accountId,
    // Onda 0: a tabela não tem coluna `provider` ainda. A migração 040
    // faz o backfill com este mesmo valor para toda linha existente.
    provider: 'meta',
    phoneNumberId: config.phone_number_id ?? null,
    credential,
  };
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npm test -- src/lib/whatsapp/resolve-connection.test.ts`
Expected: PASS, 4 testes.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/whatsapp/send-error.ts src/lib/whatsapp/resolve-connection.ts src/lib/whatsapp/resolve-connection.test.ts
git add src/lib/whatsapp/send-error.ts src/lib/whatsapp/resolve-connection.ts src/lib/whatsapp/resolve-connection.test.ts
git commit -m "refactor(whatsapp): centralise config lookup and credential decryption in resolveConnection"
```

---

## Task 3: `sendViaConnection()` — o núcleo de envio

**Files:**
- Create: `src/lib/whatsapp/send-core.ts`
- Test: `src/lib/whatsapp/send-core.test.ts`

**Interfaces:**
- Consumes: `resolveConnection` de `@/lib/whatsapp/resolve-connection`;
  `createTransport`, `UnsupportedCapabilityError`, `WhatsAppTransport`,
  `TransportResult`, `ProviderCapabilities` de
  `@/lib/whatsapp/providers`; `SendMessageError` de
  `@/lib/whatsapp/send-error`; `sanitizePhoneForMeta`, `isValidE164` de
  `@/lib/whatsapp/phone-utils`; `interactivePayloadPreviewText`,
  `InteractiveMessagePayload` de `@/lib/whatsapp/interactive`;
  `supabaseAdmin` de
  `@/lib/flows/admin-client`; `MediaKind` de `@/lib/whatsapp/meta-api`;
  `SendTimeParams` de `@/lib/whatsapp/template-send-builder`;
  `MessageTemplate` de `@/types`.
- Produces:
  - `type OutboundMessage` — união de `text | media | interactive | template`.
  - `interface SendViaConnectionParams`, `interface SendViaConnectionResult`.
  - `sendViaConnection(db: SupabaseClient, accountId: string, params: SendViaConnectionParams): Promise<SendViaConnectionResult>`
  - `sendViaConnection` sempre lança `SendMessageError`.

> **Por que reação não está em `OutboundMessage`:** uma reação não gera
> linha em `messages` — ela vai para `message_reactions`. Meter esse caso
> no núcleo obrigaria a ramificar a persistência inteira. `react/route.ts`
> (Task 8) usa `resolveConnection` + `transport.sendReaction` direto.
>
> **Por que a resolução de template NÃO está no núcleo:** os três
> chamadores resolvem diferente. A inbox aborta em linha malformada
> (`template_malformed`, 500) e manda `resolved.language` no fio; as
> Automations toleram a linha malformada e mandam o `language` cru que o
> autor da automação escreveu. Unificar isso mudaria comportamento nos
> dois. O chamador resolve e passa `template` + `language` prontos; o
> núcleo só usa a linha para reconstruir o corpo persistido.
>
> **Por que `persistedMediaUrl` é campo separado de `link`:** `link` é o
> que o provedor busca; `persistedMediaUrl` é o que a inbox renderiza.
> Hoje são a mesma coisa na inbox e o segundo é **null** nos envios de
> mídia dos Flows (`flows/meta-send.ts` nunca gravou `media_url`).
> Separar os dois preserva isso à risca e deixa a correção — Flows passar
> o próprio link aqui — como um one-liner rastreável (ver Follow-ups).
>
> **Os três booleanos** (`selfHealCredential`, `pauseActiveFlowRun`,
> `previewText`) existem só para preservar divergências reais entre os
> call sites de hoje. Cada um está anotado no código com quem o liga e
> por quê. São candidatos a convergência depois da Onda 2, não desenho
> permanente.

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/lib/whatsapp/send-core.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const resolveConnection = vi.fn();
const createTransport = vi.fn();
const flowPause = vi.fn();

vi.mock('@/lib/whatsapp/resolve-connection', () => ({
  resolveConnection: (...a: unknown[]) => resolveConnection(...a),
}));
vi.mock('@/lib/whatsapp/providers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createTransport: (...a: unknown[]) => createTransport(...a),
}));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({
          eq: () => ({
            eq: async () => {
              flowPause();
              return { error: null };
            },
          }),
        }),
      }),
    }),
  }),
}));

import { sendViaConnection } from './send-core';
import { SendMessageError } from './send-error';
import { UnsupportedCapabilityError } from './providers/types';
import type { WhatsAppTransport } from './providers/types';

const CONN = {
  id: 'cfg-1',
  accountId: 'acct-1',
  provider: 'meta' as const,
  phoneNumberId: 'pn-1',
  credential: 'tok',
};

/** Transporte falso: registra a chamada, devolve o que lhe mandarem. */
function fakeTransport(
  overrides: Partial<WhatsAppTransport> = {},
  calls: unknown[] = []
): WhatsAppTransport {
  const ok = async (args: unknown) => {
    calls.push(args);
    return { providerMessageId: 'pmid-1' };
  };
  return {
    provider: 'meta',
    capabilities: {
      templates: true,
      interactive: true,
      reactions: true,
      media: true,
    },
    sendText: ok,
    sendMedia: ok,
    sendInteractive: ok,
    sendTemplate: ok,
    sendReaction: ok,
    ...overrides,
  } as WhatsAppTransport;
}

interface Writes {
  message?: Record<string, unknown>;
  conversation?: Record<string, unknown>;
  contact?: Record<string, unknown>;
}

function coreDb(writes: Writes, contactPhone = '5511999998888'): SupabaseClient {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        insert: (row: Record<string, unknown>) => {
          if (table === 'messages') writes.message = row;
          return builder;
        },
        update: (row: Record<string, unknown>) => {
          if (table === 'conversations') writes.conversation = row;
          if (table === 'contacts') writes.contact = row;
          return builder;
        },
        maybeSingle: async () => ({
          data:
            table === 'contacts' ? { id: 'ct-1', phone: contactPhone } : null,
          error: null,
        }),
        single: async () => {
          if (table === 'conversations') {
            return {
              data: {
                id: 'cv-1',
                contact: { id: 'ct-1', phone: contactPhone },
              },
              error: null,
            };
          }
          if (table === 'messages') {
            return { data: { id: 'msg-1' }, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ error: null }).then(resolve),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  resolveConnection.mockReset();
  createTransport.mockReset();
  flowPause.mockReset();
  resolveConnection.mockResolvedValue(CONN);
});

describe('sendViaConnection', () => {
  it('persiste a mensagem e atualiza a conversa no caminho de texto', async () => {
    const writes: Writes = {};
    createTransport.mockReturnValue(fakeTransport());

    const result = await sendViaConnection(coreDb(writes), 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'text', text: 'olá' },
      senderType: 'agent',
    });

    expect(result).toEqual({ messageId: 'msg-1', providerMessageId: 'pmid-1' });
    expect(writes.message).toMatchObject({
      conversation_id: 'cv-1',
      sender_type: 'agent',
      content_type: 'text',
      content_text: 'olá',
      media_url: null,
      template_name: null,
      interactive_payload: null,
      message_id: 'pmid-1',
      status: 'sent',
      ai_generated: false,
      reply_to_message_id: null,
    });
    expect(writes.conversation).toMatchObject({ last_message_text: 'olá' });
  });

  it('rejeita com 400 quando o transporte não declara a capacidade', async () => {
    createTransport.mockReturnValue(
      fakeTransport({
        capabilities: {
          templates: false,
          interactive: true,
          reactions: true,
          media: true,
        },
      })
    );

    await sendViaConnection(coreDb({}), 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'template', templateName: 'promo' },
      senderType: 'agent',
    }).catch((e: SendMessageError) => {
      expect(e).toBeInstanceOf(SendMessageError);
      expect(e.status).toBe(400);
      expect(e.reason).toBe('unsupported_capability');
      expect(e.cause).toBeInstanceOf(UnsupportedCapabilityError);
    });
    expect.assertions(4);
  });

  it('grava no contato o número que o transporte normalizou', async () => {
    const writes: Writes = {};
    createTransport.mockReturnValue(
      fakeTransport({
        sendText: async () => ({
          providerMessageId: 'pmid-2',
          normalizedRecipient: '55011999998888',
        }),
      })
    );

    await sendViaConnection(coreDb(writes), 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'text', text: 'oi' },
      senderType: 'agent',
    });

    expect(writes.contact).toEqual({ phone: '55011999998888' });
  });

  it('não toca no contato quando o transporte não normalizou nada', async () => {
    const writes: Writes = {};
    createTransport.mockReturnValue(fakeTransport());
    await sendViaConnection(coreDb(writes), 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'text', text: 'oi' },
      senderType: 'agent',
    });
    expect(writes.contact).toBeUndefined();
  });

  it('usa previewText quando o chamador o fornece, e o padrão quando não', async () => {
    createTransport.mockReturnValue(fakeTransport());

    const withOverride: Writes = {};
    await sendViaConnection(coreDb(withOverride), 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'media', mediaKind: 'image', link: 'https://x/y.jpg' },
      senderType: 'bot',
      previewText: '[image]',
    });
    expect(withOverride.conversation).toMatchObject({
      last_message_text: '[image]',
    });

    const withDefault: Writes = {};
    await sendViaConnection(coreDb(withDefault), 'acct-1', {
      conversationId: 'cv-1',
      message: {
        kind: 'media',
        mediaKind: 'image',
        link: 'https://x/y.jpg',
        caption: 'legenda',
      },
      senderType: 'bot',
    });
    expect(withDefault.conversation).toMatchObject({
      last_message_text: 'legenda',
    });
  });

  it('só persiste media_url quando o chamador passa persistedMediaUrl', async () => {
    createTransport.mockReturnValue(fakeTransport());

    const semUrl: Writes = {};
    await sendViaConnection(coreDb(semUrl), 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'media', mediaKind: 'image', link: 'https://x/y.jpg' },
      senderType: 'bot',
    });
    expect(semUrl.message).toMatchObject({ media_url: null });

    const comUrl: Writes = {};
    await sendViaConnection(coreDb(comUrl), 'acct-1', {
      conversationId: 'cv-1',
      message: {
        kind: 'media',
        mediaKind: 'image',
        link: 'https://x/y.jpg',
        persistedMediaUrl: 'https://x/y.jpg',
      },
      senderType: 'agent',
    });
    expect(comUrl.message).toMatchObject({ media_url: 'https://x/y.jpg' });
  });

  it('pausa o flow run ativo só quando pauseActiveFlowRun está ligado', async () => {
    createTransport.mockReturnValue(fakeTransport());

    await sendViaConnection(coreDb({}), 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'text', text: 'oi' },
      senderType: 'bot',
    });
    expect(flowPause).not.toHaveBeenCalled();

    await sendViaConnection(coreDb({}), 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'text', text: 'oi' },
      senderType: 'agent',
      pauseActiveFlowRun: true,
    });
    expect(flowPause).toHaveBeenCalledTimes(1);
  });

  it('rejeita telefone fora de E.164 antes de chamar o transporte', async () => {
    const transport = fakeTransport();
    const spy = vi.spyOn(transport, 'sendText');
    createTransport.mockReturnValue(transport);

    await sendViaConnection(coreDb({}, '123'), 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'text', text: 'oi' },
      senderType: 'agent',
    }).catch((e: SendMessageError) => {
      expect(e.code).toBe('bad_request');
      expect(e.reason).toBe('contact_phone_invalid');
      expect(e.cause).toBe('123');
    });
    expect(spy).not.toHaveBeenCalled();
    expect.assertions(4);
  });

  it('embrulha uma falha do provedor em meta_error / 502 preservando a causa', async () => {
    const boom = new Error('(#132000) Template mismatch');
    createTransport.mockReturnValue(
      fakeTransport({
        sendText: async () => {
          throw boom;
        },
      })
    );

    await sendViaConnection(coreDb({}), 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'text', text: 'oi' },
      senderType: 'agent',
    }).catch((e: SendMessageError) => {
      expect(e.code).toBe('meta_error');
      expect(e.status).toBe(502);
      expect(e.message).toBe('Meta API error: (#132000) Template mismatch');
      expect(e.reason).toBe('provider_error');
      expect(e.cause).toBe(boom);
    });
    expect.assertions(5);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/lib/whatsapp/send-core.test.ts`
Expected: FAIL com `Failed to resolve import "./send-core"`.

- [ ] **Step 3: Escrever `send-core.ts`**

```ts
// ============================================================
// Núcleo de envio.
//
// A sequência "resolve conexão → confere capacidade → resolve contato →
// envia pelo transporte → persiste em `messages` → atualiza a conversa →
// pausa o flow ativo" existia copiada em `send-message.ts`,
// `flows/meta-send.ts` e `automations/meta-send.ts`. Existe aqui.
//
// O núcleo NÃO cobre:
//   - reações (vão para `message_reactions`, não `messages`);
//   - broadcast (persiste em `broadcast_recipients` e tem duas fases).
// Esses dois usam `resolveConnection` + o transporte diretamente.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  interactivePayloadPreviewText,
  type InteractiveMessagePayload,
} from '@/lib/whatsapp/interactive';
import type { MediaKind } from '@/lib/whatsapp/meta-api';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { createTransport } from '@/lib/whatsapp/providers';
import {
  UnsupportedCapabilityError,
  type ProviderCapabilities,
  type TransportResult,
  type WhatsAppTransport,
} from '@/lib/whatsapp/providers/types';
import { resolveConnection } from '@/lib/whatsapp/resolve-connection';
import { SendMessageError } from '@/lib/whatsapp/send-error';
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';
import type { MessageTemplate } from '@/types';

export type OutboundMessage =
  | { kind: 'text'; text: string }
  | {
      kind: 'media';
      mediaKind: MediaKind;
      /** URL pública que o provedor busca no envio. */
      link: string;
      caption?: string | null;
      filename?: string | null;
      /**
       * O que vai para `messages.media_url` — o que a inbox renderiza.
       * Distinto de `link` de propósito: os envios de mídia dos Flows
       * nunca gravaram uma URL, e a Onda 0 preserva isso. Ver Follow-ups.
       */
      persistedMediaUrl?: string | null;
    }
  | { kind: 'interactive'; payload: InteractiveMessagePayload }
  | {
      kind: 'template';
      templateName: string;
      /** Idioma que vai no fio. O chamador já resolveu o en/en_US. */
      language?: string;
      /**
       * Linha local, SÓ quando o chamador quer os componentes completos
       * (header de mídia, botões com variável) no payload — `meta-api`
       * monta o array de components quando recebe isto. A inbox passa; as
       * Automations NÃO passam, porque hoje mandam só `params` no fio.
       */
      template?: MessageTemplate | null;
      messageParams?: SendTimeParams;
      params?: string[];
      /**
       * Corpo a gravar em `messages.content_text`. Calculado pelo
       * chamador porque a inbox e as Automations chegam nele por
       * caminhos diferentes — e porque ele é independente do que vai no
       * fio (as Automations usam a linha local para o texto persistido
       * mesmo sem mandá-la no payload).
       */
      persistedText?: string | null;
    };

export interface SendViaConnectionParams {
  conversationId: string;
  /**
   * Quando presente, o contato é resolvido por id (caminho dos engines,
   * que já têm o contato em mãos). Sem ele, o contato sai da conversa
   * (caminho da inbox / API pública).
   */
  contactId?: string;
  /** Repassado a `resolveConnection`. Onda 0: sem efeito. */
  connectionId?: string;
  message: OutboundMessage;
  senderType: 'agent' | 'bot';
  aiGenerated?: boolean;
  replyToMessageId?: string | null;
  /**
   * Sobrescreve `conversations.last_message_text`. Existe porque os três
   * chamadores calculavam esse resumo com regras ligeiramente diferentes
   * antes deste refactor. Só Flows (mídia, interativo) e Automations
   * (template) passam.
   */
  previewText?: string;
  /**
   * Marca o flow run ativo do contato como `paused_by_agent`. Ligado só
   * pela inbox / API pública: um agente digitando é o sinal mais forte de
   * "cede o lugar, tem humano aqui". Um envio de bot nunca se pausa.
   */
  pauseActiveFlowRun?: boolean;
  /** Repassado a `resolveConnection`. Ligado só pela inbox / API. */
  selfHealCredential?: boolean;
}

export interface SendViaConnectionResult {
  /** Nosso `messages.id`. */
  messageId: string;
  /** Id de mensagem do provedor (Meta: o `wamid`). */
  providerMessageId: string;
}

/** Texto é universal; os demais tipos precisam de uma capacidade. */
function requiredCapability(
  kind: OutboundMessage['kind']
): keyof ProviderCapabilities | null {
  switch (kind) {
    case 'media':
      return 'media';
    case 'interactive':
      return 'interactive';
    case 'template':
      return 'templates';
    default:
      return null;
  }
}

function dispatchSend(
  transport: WhatsAppTransport,
  to: string,
  message: OutboundMessage,
  replyToProviderMessageId: string | undefined
): Promise<TransportResult> {
  switch (message.kind) {
    case 'text':
      return transport.sendText({ to, text: message.text, replyToProviderMessageId });
    case 'media':
      return transport.sendMedia({
        to,
        mediaKind: message.mediaKind,
        link: message.link,
        caption: message.caption || undefined,
        filename: message.filename || undefined,
        replyToProviderMessageId,
      });
    case 'interactive':
      return transport.sendInteractive({
        to,
        payload: message.payload,
        replyToProviderMessageId,
      });
    case 'template':
      return transport.sendTemplate({
        to,
        templateName: message.templateName,
        language: message.language,
        template: message.template ?? undefined,
        messageParams: message.messageParams,
        params: message.params,
        replyToProviderMessageId,
      });
  }
}

interface ResolvedContact {
  id: string;
  phone: string;
}

async function loadContact(
  db: SupabaseClient,
  accountId: string,
  params: SendViaConnectionParams
): Promise<ResolvedContact> {
  // Caminho dos engines: o contato já é conhecido por id. O filtro por
  // account_id é defesa em profundidade — os engines usam o cliente
  // service-role, que ignora RLS.
  if (params.contactId) {
    const { data: contact, error } = await db
      .from('contacts')
      .select('id, phone')
      .eq('id', params.contactId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (error || !contact?.phone) {
      throw new SendMessageError('not_found', 'Contact not found', 404, {
        reason: 'contact_not_found',
      });
    }
    return { id: contact.id, phone: contact.phone };
  }

  // Caminho da inbox / API pública: contato vem da conversa.
  const { data: conversation, error } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', params.conversationId)
    .eq('account_id', accountId)
    .single();

  if (error || !conversation) {
    throw new SendMessageError('not_found', 'Conversation not found', 404, {
      reason: 'conversation_not_found',
    });
  }

  const contact = conversation.contact;
  if (!contact?.phone) {
    throw new SendMessageError(
      'bad_request',
      'Contact phone number not found',
      400,
      { reason: 'contact_not_found' }
    );
  }
  return { id: contact.id, phone: contact.phone };
}

/**
 * Resolve `replyToMessageId` (nosso UUID) para o id de mensagem do
 * provedor. O pai tem de pertencer à MESMA conversa — senão um chamador
 * poderia citar mensagens que não pode ver, chutando UUIDs.
 */
async function resolveReplyTarget(
  db: SupabaseClient,
  conversationId: string,
  replyToMessageId: string
): Promise<string | undefined> {
  const { data: parent, error } = await db
    .from('messages')
    .select('message_id, conversation_id')
    .eq('id', replyToMessageId)
    .eq('conversation_id', conversationId)
    .maybeSingle();

  if (error || !parent) {
    throw new SendMessageError(
      'bad_request',
      'reply_to_message_id not found in this conversation',
      400
    );
  }
  if (!parent.message_id) {
    console.warn(
      '[send-core] reply target has no provider message id; sending without context'
    );
    return undefined;
  }
  return parent.message_id;
}

export async function sendViaConnection(
  db: SupabaseClient,
  accountId: string,
  params: SendViaConnectionParams
): Promise<SendViaConnectionResult> {
  const { message, conversationId } = params;

  // A ORDEM DOS PASSOS 1–3 NÃO É ARBITRÁRIA. Ela reproduz a ordem que
  // `send-message.ts` usa hoje — conversa → telefone do contato → E.164
  // → config — e que os dois engines também seguem. Resolver a conexão
  // primeiro (como a lista de passos da spec §4.2 sugere) faria uma
  // conta sem `whatsapp_config` responder `whatsapp_not_configured`/400
  // a um envio para conversa inexistente, onde hoje responde
  // `not_found`/404: mudança observável no envelope v1 público, contra o
  // critério de aceite da própria onda. Entre a lista de passos e o
  // "zero mudança observável", vale o segundo.

  // 1. Contato + telefone.
  const contact = await loadContact(db, accountId, params);
  const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
  if (!isValidE164(sanitizedPhone)) {
    throw new SendMessageError(
      'bad_request',
      'Invalid phone number format',
      400,
      { reason: 'contact_phone_invalid', cause: contact.phone }
    );
  }

  // 2. Conexão + transporte. `createTransport` pode lançar `Error` cru
  //    (transporte Meta sem `phone_number_id`); o núcleo promete lançar
  //    sempre `SendMessageError`, então converte aqui.
  const connection = await resolveConnection(db, accountId, {
    connectionId: params.connectionId,
    conversationId,
    selfHeal: params.selfHealCredential,
  });
  let transport: WhatsAppTransport;
  try {
    transport = createTransport(connection);
  } catch (err) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400,
      { reason: 'not_configured', cause: err }
    );
  }

  // 3. Capacidade — erro claro de 400 em vez de falha opaca no fio.
  const capability = requiredCapability(message.kind);
  if (capability && !transport.capabilities[capability]) {
    const err = new UnsupportedCapabilityError(transport.provider, capability);
    throw new SendMessageError('bad_request', err.message, 400, {
      reason: 'unsupported_capability',
      cause: err,
    });
  }

  // 4. Alvo da resposta citada.
  const replyToProviderMessageId = params.replyToMessageId
    ? await resolveReplyTarget(db, conversationId, params.replyToMessageId)
    : undefined;

  // 5. Envio.
  let sent: TransportResult;
  try {
    sent = await dispatchSend(
      transport,
      sanitizedPhone,
      message,
      replyToProviderMessageId
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown Meta API error';
    console.error('[send-core] provider send failed:', detail);
    // O prefixo "Meta API error:" é contrato do envelope v1 de hoje. A
    // Onda 1 o torna dependente do provedor.
    throw new SendMessageError('meta_error', `Meta API error: ${detail}`, 502, {
      reason: 'provider_error',
      cause: err,
    });
  }

  // 6. Writeback do telefone que o provedor aceitou.
  if (sent.normalizedRecipient && sent.normalizedRecipient !== sanitizedPhone) {
    console.log(
      `[send-core] auto-corrected contact phone: ${sanitizedPhone} → ${sent.normalizedRecipient}`
    );
    await db
      .from('contacts')
      .update({ phone: sent.normalizedRecipient })
      .eq('id', contact.id);
  }

  // 7. Persistência.
  const contentType = message.kind === 'media' ? message.mediaKind : message.kind;
  const persistedText =
    message.kind === 'text'
      ? message.text
      : message.kind === 'media'
        ? (message.caption ?? null)
        : message.kind === 'interactive'
          ? message.payload.body
          : (message.persistedText ?? null);

  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: params.senderType,
      content_type: contentType,
      content_text: persistedText,
      media_url:
        message.kind === 'media' ? (message.persistedMediaUrl ?? null) : null,
      template_name: message.kind === 'template' ? message.templateName : null,
      interactive_payload:
        message.kind === 'interactive' ? message.payload : null,
      message_id: sent.providerMessageId,
      status: 'sent',
      ai_generated: params.aiGenerated ?? false,
      reply_to_message_id: params.replyToMessageId || null,
    })
    .select()
    .single();

  if (msgError || !messageRecord) {
    console.error('[send-core] error inserting sent message:', msgError);
    throw new SendMessageError(
      'db_error',
      `Message sent to Meta but failed to save to DB: ${msgError?.message ?? 'no row returned'}`,
      500,
      { reason: 'message_insert_failed', cause: msgError?.message }
    );
  }

  // 8. Resumo da conversa.
  const preview =
    params.previewText ??
    (message.kind === 'interactive'
      ? interactivePayloadPreviewText(message.payload)
      : persistedText || `[${contentType}]`);

  const now = new Date().toISOString();
  await db
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: now,
      updated_at: now,
    })
    .eq('id', conversationId);

  // 9. Pausa do flow ativo. Best-effort: nunca derruba um envio que já
  //    chegou ao provedor.
  if (params.pauseActiveFlowRun) {
    try {
      const { error: pauseErr } = await supabaseAdmin()
        .from('flow_runs')
        .update({
          status: 'paused_by_agent',
          ended_at: new Date().toISOString(),
          end_reason: 'agent_replied',
        })
        .eq('account_id', accountId)
        .eq('contact_id', contact.id)
        .eq('status', 'active');
      if (pauseErr) {
        console.error('[flows] pause-on-agent-send failed:', pauseErr.message);
      }
    } catch (err) {
      console.error(
        '[flows] pause-on-agent-send threw:',
        err instanceof Error ? err.message : err
      );
    }
  }

  return {
    messageId: messageRecord.id,
    providerMessageId: sent.providerMessageId,
  };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test -- src/lib/whatsapp/send-core.test.ts`
Expected: PASS, 9 testes.

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/whatsapp/send-core.ts src/lib/whatsapp/send-core.test.ts
git add src/lib/whatsapp/send-core.ts src/lib/whatsapp/send-core.test.ts
git commit -m "refactor(whatsapp): add sendViaConnection, the shared outbound send core"
```

---

## Task 4: Religar `send-message.ts` ao núcleo

**Files:**
- Modify: `src/lib/whatsapp/send-message.ts`
- Test: `src/lib/whatsapp/send-message.test.ts` (**não editar** — é o
  critério de aceite)

**Interfaces:**
- Consumes: `sendViaConnection`, `OutboundMessage` de
  `@/lib/whatsapp/send-core`; `SendMessageError` de
  `@/lib/whatsapp/send-error`; `resolveTemplateRow` de
  `@/lib/whatsapp/template-body`.
- Produces (inalterado): `MEDIA_KINDS`, `VALID_MESSAGE_TYPES`,
  `SendMessageError`, `SendMessageParams`, `SendMessageResult`,
  `validateSendMessageParams`, `sendMessageToConversation`.

- [ ] **Step 1: Rodar a suíte alvo antes de tocar em nada (baseline)**

Run: `npm test -- src/lib/whatsapp/send-message.test.ts src/app/api/whatsapp/send/route.test.ts src/lib/whatsapp/resolve-conversation.test.ts`
Expected: PASS. Anote o número de testes — tem de ser idêntico no fim.

- [ ] **Step 2: Trocar a definição de `SendMessageError` por um re-export**

No topo de `src/lib/whatsapp/send-message.ts`, remova a declaração
`export class SendMessageError { … }` inteira e ponha:

```ts
// `SendMessageError` mora em `send-error.ts` desde a extração do seam,
// para que `send-core.ts` e `resolve-conversation.ts` o importem sem
// ciclo. Re-exportado aqui porque este continua sendo o caminho de
// import que o resto do código usa.
export { SendMessageError } from '@/lib/whatsapp/send-error';
export type { SendFailureReason } from '@/lib/whatsapp/send-error';
```

E acrescente o import de valor que o corpo do arquivo ainda usa:

```ts
import { SendMessageError } from '@/lib/whatsapp/send-error';
```

- [ ] **Step 3: Substituir o corpo de `sendMessageToConversation`**

`validateSendMessageParams` e as constantes ficam **exatamente como
estão**. Troque só o corpo de `sendMessageToConversation`, a partir do
`const isMediaKind = …`, por:

```ts
  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  // Resolução de template: fica aqui, não no núcleo, porque esta é a
  // única superfície que ABORTA numa linha local malformada (e devolve
  // `template_malformed` no envelope v1) e que manda `resolved.language`
  // no fio em vez do idioma cru pedido pelo chamador.
  let templateRow: MessageTemplate | null = null;
  let sendLanguage = templateLanguage || 'en_US';
  if (messageType === 'template' && templateName) {
    const resolved = await resolveTemplateRow(
      db,
      accountId,
      templateName,
      templateLanguage
    );
    if (resolved.malformed) {
      throw new SendMessageError(
        'template_malformed',
        'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
        500,
        { reason: 'template_malformed' }
      );
    }
    templateRow = resolved.row;
    sendLanguage = resolved.language;
  }

  const message: OutboundMessage =
    messageType === 'template'
      ? {
          kind: 'template',
          templateName: templateName!,
          language: sendLanguage,
          template: templateRow,
          // `templateMessageParams` é `unknown` no contrato público; o
          // `?? undefined` é a expressão que este arquivo já usava ao
          // chamar `sendTemplateMessage`, preservada à risca. (Verificado:
          // `meta-api` só acessa este objeto com optional chaining
          // — `messageParams?.body` etc. — então null e undefined são
          // equivalentes ali; o `??` fica por fidelidade, não por
          // necessidade.)
          messageParams: (templateMessageParams ?? undefined) as
            | SendTimeParams
            | undefined,
          params: templateParams || [],
          // Corpo *substituído*: o composer pré-renderiza e manda em
          // `contentText`; todo outro chamador manda nada, e gravar null
          // aqui deixava a inbox com bolha vazia (issue #483).
          persistedText: templateContentText(
            templateRow,
            templateBodyParams(templateParams, templateMessageParams),
            contentText
          ),
        }
      : isMediaKind
        ? {
            kind: 'media',
            mediaKind: messageType as MediaKind,
            link: mediaUrl!,
            caption: contentText,
            filename,
            persistedMediaUrl: mediaUrl!,
          }
        : messageType === 'interactive'
          ? { kind: 'interactive', payload: interactivePayload! }
          : { kind: 'text', text: contentText! };

  const result = await sendViaConnection(db, accountId, {
    conversationId,
    message,
    senderType: 'agent',
    replyToMessageId,
    // Único caminho que reescrevia ciphertext CBC legado antes do
    // refactor; segue sendo o único.
    selfHealCredential: true,
    // Um agente digitando é o sinal mais forte de "cede o lugar".
    pauseActiveFlowRun: true,
  });

  return {
    messageId: result.messageId,
    whatsappMessageId: result.providerMessageId,
  };
}
```

Ajuste os imports do arquivo: saem `sendTextMessage`,
`sendTemplateMessage`, `sendMediaMessage`, `sendInteractiveButtons`,
`sendInteractiveList`, `decrypt`, `encrypt`, `isLegacyFormat`,
`supabaseAdmin`, `sanitizePhoneForMeta`, `isValidE164`, `phoneVariants`,
`isRecipientNotAllowedError`, `templateBodyParams`, `templateContentText`,
`interactivePayloadPreviewText`. Entram `sendViaConnection` +
`OutboundMessage` de `@/lib/whatsapp/send-core`, `MediaKind` de
`@/lib/whatsapp/meta-api`, `SendTimeParams` de
`@/lib/whatsapp/template-send-builder`. `validateInteractivePayload` e
`InteractiveMessagePayload` continuam (a validação de payload segue
neste arquivo), e `resolveTemplateRow`, `templateBodyParams` e
`templateContentText` também — a resolução e a renderização do template
ficam aqui, não no núcleo.

> A coerção de `templateMessageParams` foi verificada contra o código
> atual antes desta task: hoje o arquivo passa
> `messageParams: templateMessageParams ?? undefined` para
> `sendTemplateMessage`, e `meta-api` lê o objeto apenas por optional
> chaining. O código acima reproduz essa expressão e só acrescenta o
> `as` que o `unknown` do contrato público exige. Não invente outra
> coerção.

- [ ] **Step 4: Rodar a suíte alvo e confirmar paridade**

Run: `npm test -- src/lib/whatsapp/send-message.test.ts src/app/api/whatsapp/send/route.test.ts src/lib/whatsapp/resolve-conversation.test.ts`
Expected: PASS, mesmo número de testes do Step 1, **sem uma linha de
teste alterada**.

Run: `npm run typecheck && npm run lint`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/whatsapp/send-message.ts
git add src/lib/whatsapp/send-message.ts
git commit -m "refactor(whatsapp): route sendMessageToConversation through the send core"
```

---

## Task 5: Religar `flows/meta-send.ts` ao núcleo

**Files:**
- Create: `src/lib/whatsapp/engine-error.ts`
- Modify: `src/lib/flows/meta-send.ts`
- Test: `src/lib/flows/dispatch.test.ts`, `src/lib/ai/auto-reply.test.ts`
  (**não editar** — ambos mockam `meta-send` inteiro; a paridade é o
  critério)

**Interfaces:**
- Consumes: `sendViaConnection`, `OutboundMessage` de
  `@/lib/whatsapp/send-core`; `SendMessageError` de
  `@/lib/whatsapp/send-error`; `supabaseAdmin` de `./admin-client`.
- Produces:
  - `toEngineError(err: unknown): Error` de
    `@/lib/whatsapp/engine-error`.
  - Assinaturas **inalteradas**: `engineSendText`, `engineSendMedia`,
    `engineSendInteractiveButtons`, `engineSendInteractiveList`, todas
    devolvendo `Promise<{ whatsapp_message_id: string }>`.

> **Por que `toEngineError` existe:** as strings que estes engines lançam
> hoje (`'contact not found for this account'`, `'contact phone invalid:
> …'`, `'sent to Meta but DB insert failed: …'`) acabam em
> `automation_logs` e nos logs do runner — são visíveis ao usuário.
> Preservá-las é parte do "zero mudança observável", e o campo `reason`
> de `SendMessageError` é o que torna isso possível sem tocar no `code`,
> que é contrato do envelope v1.

- [ ] **Step 1: Baseline**

Run: `npm test -- src/lib/flows src/lib/ai/auto-reply.test.ts`
Expected: PASS. Anote a contagem.

- [ ] **Step 2: Escrever `src/lib/whatsapp/engine-error.ts`**

```ts
import { SendMessageError } from '@/lib/whatsapp/send-error';

/**
 * Traduz uma falha do núcleo de volta às mensagens que os engines de
 * Flows e Automations lançavam antes da extração do seam. Essas strings
 * chegam a `automation_logs` e aos logs do runner, então são visíveis ao
 * usuário: mantê-las idênticas é parte do critério de aceite da Onda 0.
 *
 * O mapeamento é por `reason`, não por `code`, porque `code` é contrato
 * público e agrupa casos que os engines reportam separados.
 */
export function toEngineError(err: unknown): Error {
  if (!(err instanceof SendMessageError)) {
    return err instanceof Error ? err : new Error(String(err));
  }
  switch (err.reason) {
    case 'contact_not_found':
      return new Error('contact not found for this account');
    case 'contact_phone_invalid':
      return new Error(`contact phone invalid: ${String(err.cause)}`);
    case 'not_configured':
      return new Error('WhatsApp not configured for this account');
    // Os engines sempre propagaram o erro cru do provedor, sem o
    // prefixo "Meta API error:" que a API pública usa.
    case 'provider_error':
      return err.cause instanceof Error
        ? err.cause
        : new Error(String(err.cause));
    case 'message_insert_failed':
      return new Error(
        `sent to Meta but DB insert failed: ${String(err.cause)}`
      );
    default:
      return new Error(err.message);
  }
}
```

- [ ] **Step 3: Reescrever `src/lib/flows/meta-send.ts`**

O arquivo inteiro passa a ser:

```ts
import type {
  InteractiveButton,
  InteractiveListSection,
  MediaKind,
} from '@/lib/whatsapp/meta-api'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import { toEngineError } from '@/lib/whatsapp/engine-error'
import {
  sendViaConnection,
  type OutboundMessage,
} from '@/lib/whatsapp/send-core'
import { supabaseAdmin } from './admin-client'

// ------------------------------------------------------------
// Senders do lado dos Flows.
//
// Antes da extração do seam, cada função aqui repetia a mesma sequência
// de ~60 linhas (lookup de contato, lookup de config, decrypt, retry de
// variante de telefone, insert em `messages`, update da conversa). Agora
// todas são a mesma chamada a `sendViaConnection` com uma
// `OutboundMessage` diferente.
// ------------------------------------------------------------

interface EngineSendBase {
  /** Chave de tenancy. Um flow escrito pelo usuário A ainda envia pelo
   *  número que o usuário B salvou na mesma conta. */
  accountId: string
  /** Autor do flow. Nunca consultado para tenancy; mantido porque os
   *  chamadores o passam. */
  userId: string
  conversationId: string
  contactId: string
}

/**
 * Ponte única para o núcleo. `previewText` é passado quando a regra de
 * resumo deste engine diverge do padrão do núcleo — ver cada chamador.
 */
async function engineSend(
  args: EngineSendBase & { aiGenerated?: boolean; previewText?: string },
  message: OutboundMessage,
): Promise<{ whatsapp_message_id: string }> {
  try {
    const result = await sendViaConnection(supabaseAdmin(), args.accountId, {
      conversationId: args.conversationId,
      contactId: args.contactId,
      message,
      senderType: 'bot',
      aiGenerated: args.aiGenerated,
      previewText: args.previewText,
    })
    return { whatsapp_message_id: result.providerMessageId }
  } catch (err) {
    throw toEngineError(err)
  }
}

interface SendTextEngineArgs extends EngineSendBase {
  text: string
  /** Marca a linha `ai_generated = true` para a inbox distinguir a
   *  resposta da IA. Só o auto-reply liga isso. */
  aiGenerated?: boolean
}

/**
 * Envia texto simples a partir do engine de Flows. Usado pelos nós
 * `send_message` e `collect_input`.
 */
export async function engineSendText(
  args: SendTextEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  // Sem `previewText`: o padrão do núcleo para texto já é o próprio
  // texto, que é o que este engine sempre gravou.
  return engineSend(args, { kind: 'text', text: args.text })
}

interface SendMediaEngineArgs extends EngineSendBase {
  kind: MediaKind
  /** URL pública que a Meta busca no envio. */
  link: string
  caption?: string
  /** Só para documento; a Meta ignora em image/video. */
  filename?: string
}

/**
 * Envia imagem / vídeo / documento / áudio a partir do engine de Flows.
 * Usado pelo nó `send_media`.
 */
export async function engineSendMedia(
  args: SendMediaEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return engineSend(
    {
      ...args,
      // O núcleo usaria a legenda crua; este engine sempre aparou os
      // espaços antes de cair no rótulo `[image]`.
      previewText: args.caption?.trim() || `[${args.kind}]`,
    },
    {
      kind: 'media',
      mediaKind: args.kind,
      link: args.link,
      caption: args.caption,
      filename: args.filename,
      // Sem `persistedMediaUrl`: este caminho nunca gravou `media_url`.
      // Preservado à risca na Onda 0 — ver Follow-ups.
    },
  )
}

interface SendInteractiveButtonsEngineArgs extends EngineSendBase {
  bodyText: string
  buttons: InteractiveButton[]
  headerText?: string
  footerText?: string
}

interface SendInteractiveListEngineArgs extends EngineSendBase {
  bodyText: string
  buttonLabel: string
  sections: InteractiveListSection[]
  headerText?: string
  footerText?: string
}

/**
 * Envia mensagem com até 3 botões de resposta. O payload estruturado é
 * persistido para que a thread da inbox re-renderize os botões; o
 * `interactive_reply_id` NÃO é escrito aqui — aquela coluna é do toque
 * do cliente, preenchida pelo webhook.
 */
export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const payload: InteractiveMessagePayload = {
    kind: 'buttons',
    body: args.bodyText,
    header: args.headerText,
    footer: args.footerText,
    buttons: args.buttons,
  }
  // O núcleo resumiria a conversa com `interactivePayloadPreviewText`;
  // este engine sempre gravou o corpo cru.
  return engineSend(
    { ...args, previewText: args.bodyText },
    { kind: 'interactive', payload },
  )
}

/**
 * Envia lista interativa. Usado quando o flow tem mais opções do que o
 * limite de 3 botões da Meta.
 */
export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const payload: InteractiveMessagePayload = {
    kind: 'list',
    body: args.bodyText,
    header: args.headerText,
    footer: args.footerText,
    button_label: args.buttonLabel,
    sections: args.sections,
  }
  return engineSend(
    { ...args, previewText: args.bodyText },
    { kind: 'interactive', payload },
  )
}
```

- [ ] **Step 4: Rodar a suíte alvo e confirmar paridade**

Run: `npm test -- src/lib/flows src/lib/ai/auto-reply.test.ts`
Expected: PASS, mesma contagem do Step 1, sem editar teste algum.

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/whatsapp/engine-error.ts src/lib/flows/meta-send.ts
git add src/lib/whatsapp/engine-error.ts src/lib/flows/meta-send.ts
git commit -m "refactor(flows): route the engine senders through the send core"
```

---

## Task 6: Religar `automations/meta-send.ts` ao núcleo

**Files:**
- Modify: `src/lib/automations/meta-send.ts`
- Test: `src/lib/automations/engine.test.ts` (**não editar**)

**Interfaces:**
- Consumes: `sendViaConnection`, `OutboundMessage` de
  `@/lib/whatsapp/send-core`; `toEngineError` de
  `@/lib/whatsapp/engine-error`; `resolveTemplateRow`,
  `templateContentText` de `@/lib/whatsapp/template-body`;
  `engineSendInteractiveButtons`, `engineSendInteractiveList` de
  `@/lib/flows/meta-send`; `supabaseAdmin` de `./admin-client`.
- Produces: assinaturas **inalteradas** de `engineSendText`,
  `engineSendTemplate`, `engineSendInteractive`.

> **Duas divergências deste call site que a Onda 0 preserva:** (1) ele
> manda no fio o `language` **cru** que o autor da automação escreveu,
> não o resolvido — por isso não passa `template` na `OutboundMessage`,
> só `params`; a linha local serve exclusivamente para reconstruir o
> texto persistido. (2) ele **tolera** uma linha de template malformada
> (segue enviando), enquanto a inbox aborta com 500.

- [ ] **Step 1: Baseline**

Run: `npm test -- src/lib/automations`
Expected: PASS. Anote a contagem.

- [ ] **Step 2: Substituir `sendViaMeta` pelas duas pontes finas**

Apague a função privada `sendViaMeta` e o tipo `SendInput` inteiros, com
todos os imports que só eles usavam (`sendTextMessage`,
`sendTemplateMessage`, `decrypt`, `sanitizePhoneForMeta`, `isValidE164`,
`phoneVariants`, `isRecipientNotAllowedError`). `engineSendInteractive`
**não muda uma linha** — ele já delega para os senders dos Flows.

Ponha no lugar:

```ts
import { toEngineError } from '@/lib/whatsapp/engine-error'
import { sendViaConnection } from '@/lib/whatsapp/send-core'
import {
  resolveTemplateRow,
  templateContentText,
} from '@/lib/whatsapp/template-body'
import { supabaseAdmin } from './admin-client'

export async function engineSendText(
  args: SendTextArgs,
): Promise<{ whatsapp_message_id: string }> {
  try {
    const result = await sendViaConnection(supabaseAdmin(), args.accountId, {
      conversationId: args.conversationId,
      contactId: args.contactId,
      message: { kind: 'text', text: args.text },
      senderType: 'bot',
    })
    return { whatsapp_message_id: result.providerMessageId }
  } catch (err) {
    throw toEngineError(err)
  }
}

export async function engineSendTemplate(
  args: SendTemplateArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  // Linha local lida SÓ para o corpo que persistimos — o payload que vai
  // para a Meta continua sendo `params` puro, deliberadamente. Uma linha
  // ausente ou malformada não impede o envio; só nos deixa sem como
  // reconstruir o texto que o cliente viu.
  const templateRow = (
    await resolveTemplateRow(db, args.accountId, args.templateName, args.language)
  ).row

  const persistedText = templateContentText(templateRow, args.params ?? [])

  try {
    const result = await sendViaConnection(db, args.accountId, {
      conversationId: args.conversationId,
      contactId: args.contactId,
      message: {
        kind: 'template',
        templateName: args.templateName,
        // Idioma cru do autor da automação, não o resolvido.
        language: args.language,
        params: args.params,
        persistedText,
      },
      senderType: 'bot',
      // O núcleo resumiria com `persistedText || '[template]'`; este
      // engine sempre usou o nome do template no fallback.
      previewText: persistedText ?? `[template:${args.templateName}]`,
    })
    return { whatsapp_message_id: result.providerMessageId }
  } catch (err) {
    throw toEngineError(err)
  }
}
```

- [ ] **Step 3: Rodar a suíte alvo e confirmar paridade**

Run: `npm test -- src/lib/automations`
Expected: PASS, mesma contagem do Step 1.

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
npx prettier --write src/lib/automations/meta-send.ts
git add src/lib/automations/meta-send.ts
git commit -m "refactor(automations): route the engine senders through the send core"
```

---

## Task 7: Religar `broadcast-core.ts` e `broadcast-resume.ts` ao transporte

**Files:**
- Modify: `src/lib/whatsapp/broadcast-core.ts`
- Modify: `src/lib/whatsapp/broadcast-resume.ts`
- Modify: `src/lib/whatsapp/broadcast-resume.test.ts` (**exatamente uma
  linha** — ver Step 4)
- Test: `src/lib/whatsapp/broadcast-core.test.ts` (**não editar**)

**Interfaces:**
- Consumes: `resolveConnection` de `@/lib/whatsapp/resolve-connection`;
  `createTransport`, `TransportConnection` de
  `@/lib/whatsapp/providers`.
- Produces: `BroadcastPlan` com `connection: TransportConnection` no
  lugar de `phoneNumberId: string` + `accessToken: string`. Todo o resto
  do tipo fica igual. `createBroadcast`, `deliverBroadcast` e
  `finalizeBroadcastStatus` mantêm assinatura.

> **O broadcast não passa pelo núcleo, e isso é proposital.** Ele tem
> duas fases (persistir/acusar rápido, entregar em `after()`) e grava em
> `broadcast_recipients`, não em `messages`. Usa `resolveConnection` +
> transporte direto — e é o único call site que **não** grava de volta o
> telefone normalizado, comportamento que a estrutura de
> `TransportResult` preserva de graça.
>
> **A única edição de teste autorizada nesta onda** é o Step 4. Ela é um
> rename de campo numa estrutura interna (`plan.accessToken` →
> `plan.connection.credential`), não uma mudança de comportamento: o
> valor asserido continua sendo o mesmo token decriptado. A regra "a
> suíte passa inalterada" existe para pegar regressão de comportamento;
> um teste que afirma o nome de um campo privado não é isso.

- [ ] **Step 1: Baseline**

Run: `npm test -- src/lib/whatsapp/broadcast-core.test.ts src/lib/whatsapp/broadcast-resume.test.ts`
Expected: PASS. Anote a contagem.

- [ ] **Step 2: `broadcast-core.ts` — trocar os campos do plano**

Em `BroadcastPlan`, troque as duas linhas

```ts
  phoneNumberId: string;
  accessToken: string;
```

por

```ts
  /** Conexão resolvida (credencial já decriptada). `deliverBroadcast`
   *  monta o transporte a partir dela. */
  connection: TransportConnection;
```

Em `createBroadcast`, troque o bloco de lookup de `whatsapp_config` +
`decrypt` por:

```ts
  // Conexão (falha rápido). O broadcast fala com o transporte direto:
  // ele persiste em `broadcast_recipients`, não em `messages`, então o
  // núcleo de envio não se aplica.
  let connection: TransportConnection;
  try {
    connection = await resolveConnection(db, accountId);
  } catch {
    throw new BroadcastError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }
```

E no objeto de retorno, `phoneNumberId: config.phone_number_id` +
`accessToken` viram `connection`.

Imports: saem `sendTemplateMessage` de `@/lib/whatsapp/meta-api`,
`decrypt` de `@/lib/whatsapp/encryption`, e `phoneVariants` +
`isRecipientNotAllowedError` de `@/lib/whatsapp/phone-utils`
(`sanitizePhoneForMeta` e `isValidE164` **ficam** — a validação de
destinatário na fase de planejamento não mudou). Entram
`resolveConnection` e `createTransport` + `TransportConnection`.

- [ ] **Step 3: `broadcast-core.ts` — simplificar `deliverBroadcast`**

Troque o corpo do laço `for (const recipient of plan.planned)` por:

```ts
export async function deliverBroadcast(
  db: SupabaseClient,
  plan: BroadcastPlan
): Promise<void> {
  const transport = createTransport(plan.connection);

  for (const recipient of plan.planned) {
    let sentMessageId: string | null = null;
    let lastError: string | null = null;

    try {
      // O retry de variantes de telefone vive dentro do transporte. O
      // `normalizedRecipient` que ele devolve é deliberadamente
      // ignorado: o broadcast nunca reescreveu o telefone do contato.
      const result = await transport.sendTemplate({
        to: recipient.phone,
        templateName: plan.templateName,
        language: plan.templateLanguage,
        template: plan.templateRow ?? undefined,
        params: recipient.params,
      });
      sentMessageId = result.providerMessageId;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error';
    }

    if (sentMessageId) {
      await db
        .from('broadcast_recipients')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          whatsapp_message_id: sentMessageId,
          error_message: null,
        })
        .eq('id', recipient.recipientRowId);
    } else {
      await db
        .from('broadcast_recipients')
        .update({
          status: 'failed',
          error_message: lastError || 'Unknown error',
        })
        .eq('id', recipient.recipientRowId);
    }
  }

  await finalizeBroadcastStatus(db, plan.broadcastId);
}
```

`finalizeBroadcastStatus` não muda.

- [ ] **Step 4: `broadcast-resume.ts` + a linha de teste**

Em `broadcast-resume.ts`, troque o lookup de `whatsapp_config` +
`decrypt` pelo mesmo bloco `try { resolveConnection } catch {
BroadcastError }` do Step 2, e no literal `const plan: BroadcastPlan =
{ … }` troque

```ts
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
```

por

```ts
    connection,
```

Remova o import de `decrypt` se ele ficar sem uso.

Em `src/lib/whatsapp/broadcast-resume.test.ts`, **uma linha**:

```diff
-    expect(plan.accessToken).toBe('decrypted:tok');
+    expect(plan.connection.credential).toBe('decrypted:tok');
```

Se o mock de `encryption` daquele arquivo usar um especificador
relativo, ele continua valendo — o Vitest resolve `./encryption` e
`@/lib/whatsapp/encryption` para o mesmo módulo, que é o que
`resolveConnection` importa.

- [ ] **Step 5: Rodar a suíte alvo e confirmar paridade**

Run: `npm test -- src/lib/whatsapp/broadcast-core.test.ts src/lib/whatsapp/broadcast-resume.test.ts src/lib/broadcast-retry.test.ts src/lib/broadcast-status.test.ts`
Expected: PASS, mesma contagem do Step 1.

Run: `npm run typecheck`
Expected: sem erros — em particular, nenhum consumidor sobrando de
`plan.phoneNumberId` / `plan.accessToken`.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/whatsapp/broadcast-core.ts src/lib/whatsapp/broadcast-resume.ts src/lib/whatsapp/broadcast-resume.test.ts
git add src/lib/whatsapp/broadcast-core.ts src/lib/whatsapp/broadcast-resume.ts src/lib/whatsapp/broadcast-resume.test.ts
git commit -m "refactor(broadcast): carry a resolved connection in the plan and send via the transport"
```

---

## Task 8: Religar `/api/whatsapp/react` ao transporte

**Files:**
- Modify: `src/app/api/whatsapp/react/route.ts`

**Interfaces:**
- Consumes: `resolveConnection` de `@/lib/whatsapp/resolve-connection`;
  `createTransport` de `@/lib/whatsapp/providers`.
- Produces: nada novo. Contrato HTTP da rota **inalterado**, incluindo as
  strings de erro `'WhatsApp not configured.'` e
  `` `Meta API error: ${message}` ``.

- [ ] **Step 1: Substituir o lookup de config + o envio**

Troque o bloco que vai de `// WhatsApp config + access token.` até o fim
do `try/catch` de `sendReactionMessage` por:

```ts
    // Conexão + transporte. A reação não passa pelo núcleo de envio:
    // ela grava em `message_reactions`, não em `messages`.
    let transport;
    try {
      const connection = await resolveConnection(supabase, accountId);
      transport = createTransport(connection);
    } catch {
      return NextResponse.json(
        { error: 'WhatsApp not configured.' },
        { status: 400 },
      );
    }

    const sanitizedPhone = sanitizePhoneForMeta(contact.phone);

    try {
      await transport.sendReaction({
        to: sanitizedPhone,
        targetProviderMessageId: targetMessage.message_id,
        emoji,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown Meta API error';
      console.error('[whatsapp/react] Meta send failed:', message);
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 502 },
      );
    }
```

Imports: saem `sendReactionMessage` de `@/lib/whatsapp/meta-api` e
`decrypt` de `@/lib/whatsapp/encryption`. Entram `resolveConnection` e
`createTransport`. `sanitizePhoneForMeta` fica.

- [ ] **Step 2: Verificar manualmente que o caminho compila e a rota
  mantém as respostas**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.

Confira à mão, lendo o arquivo, que as três respostas de erro seguem
byte a byte iguais: `'WhatsApp not configured.'` (400),
`` `Meta API error: ${message}` `` (502) e as de banco (500).

- [ ] **Step 3: Commit**

```bash
npx prettier --write src/app/api/whatsapp/react/route.ts
git add src/app/api/whatsapp/react/route.ts
git commit -m "refactor(whatsapp): send agent reactions through the transport seam"
```

---

## Task 9: Portão de aceite da onda

**Files:** nenhum novo. Esta task é a verificação que a spec §4.2 exige
antes do merge.

- [ ] **Step 1: Suíte inteira**

Run: `npm test`
Expected: PASS. Comparado com `main`, o diff da suíte é **uma linha**, a
do Step 4 da Task 7. Confirme:

```bash
git diff main --stat -- '*.test.ts' '*.test.tsx'
```

Expected: só `src/lib/whatsapp/broadcast-resume.test.ts` com
`1 insertion(+), 1 deletion(-)`, além dos três arquivos de teste **novos**
(`providers/meta-transport.test.ts`, `resolve-connection.test.ts`,
`send-core.test.ts`).

- [ ] **Step 2: Typecheck, lint, formatação**

Run: `npm run typecheck && npm run lint && npm run format:check`
Expected: sem erros.

- [ ] **Step 3: Confirmar que a duplicação sumiu**

Run:

```bash
git grep -n "phoneVariants" -- src/ | grep -v "phone-utils"
```

Expected: **uma única ocorrência**, em
`src/lib/whatsapp/providers/meta-transport.ts`. Antes da onda eram
quatro arquivos.

Run:

```bash
git grep -n "\.from('whatsapp_config')" -- src/lib/whatsapp src/lib/flows src/lib/automations
```

Expected: exatamente **duas** linhas —
`src/lib/whatsapp/resolve-connection.ts` (o caminho de envio, que é o
alvo desta onda) e `src/lib/whatsapp/resolve-conversation.ts` (que
resolve o dono da config ao criar conversa; caminho de inbound, fora do
escopo da Onda 0 e tratado na Onda 1). Antes da onda eram **seis**:
`send-message.ts`, `broadcast-core.ts`, `broadcast-resume.ts`,
`flows/meta-send.ts` (×3 no mesmo arquivo), `automations/meta-send.ts` e
`resolve-conversation.ts`.

`encryption.ts` e `meta-api.ts` citam `whatsapp_config` em comentário —
por isso o grep é por `.from('whatsapp_config')`, não pela string solta.
As rotas de config, templates, mídia e webhook, e os componentes de
settings, também seguem lendo a tabela: são superfícies de configuração
e inbound, das Ondas 1–2.

Run:

```bash
git grep -in "uazapi" -- src/
```

Expected: **duas** ocorrências — o membro `'uazapi'` da união
`ProviderName` em `src/lib/whatsapp/providers/types.ts` e o caso de
teste em `providers/meta-transport.test.ts` que verifica que
`createTransport` lança para um provider ainda não implementado. Nenhuma
outra: nenhum código de produção fala com a UAZAPI nesta onda.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: sucesso.

- [ ] **Step 5: Abrir o PR**

```bash
git push -u origin HEAD
gh pr create --title "refactor(whatsapp): extract the provider send seam (UAZAPI wave 0)" --body "$(cat <<'EOF'
Onda 0 do suporte a segundo provedor de WhatsApp.

Refactor puro: só Meta, zero comportamento novo. Extrai para um lugar só
a sequência que estava copiada em 5 arquivos — `send-message.ts`,
`broadcast-core.ts`, `flows/meta-send.ts`, `automations/meta-send.ts` e
`api/whatsapp/react/route.ts`.

- `providers/` — interface `WhatsAppTransport` + implementação Meta. O
  retry de variantes de telefone existia em 4 cópias e agora existe uma.
- `resolve-connection.ts` — único leitor de `whatsapp_config` no caminho
  de envio. É o arquivo cuja query muda na Onda 1 (migração 040).
- `send-core.ts` — capacidade → contato → envio → persistência → pausa
  de flow, compartilhado pelos três call sites que gravam em `messages`.

A suíte existente passa inalterada, exceto uma linha em
`broadcast-resume.test.ts` que asseria o nome de um campo interno do
`BroadcastPlan` (`plan.accessToken` → `plan.connection.credential`) — o
valor asserido é o mesmo.

Spec: `docs/superpowers/specs/2026-08-27-uazapi-provider-design.md`
Plano: `docs/superpowers/plans/2026-08-27-uazapi-onda-0-seam-de-envio.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Follow-ups (fora da Onda 0, registrar como issue)

1. **`flows/meta-send.ts` não grava `media_url`.** Descoberto ao
   extrair o seam: o nó `send_media` persiste a mensagem sem URL, então a
   inbox mostra uma bolha de mídia sem fonte. A correção é passar
   `persistedMediaUrl: args.link` na `OutboundMessage` — um one-liner.
   Deixado fora da Onda 0 porque é mudança de comportamento observável.
2. **Convergir `previewText`.** Os três chamadores resumem a conversa com
   regras ligeiramente diferentes por acidente histórico, não por
   desenho. Depois da Onda 2, escolher uma e apagar o override.
3. **Convergir as mensagens de erro dos engines.** `toEngineError` existe
   só para preservar strings legadas. Quando `automation_logs` passar a
   guardar `code` + `reason` estruturados, ele pode sumir.
4. **`resolveConnection` ainda ignora `connectionId` e `conversationId`.**
   Os três níveis da spec §4 entram na Onda 1, junto com a migração 040.

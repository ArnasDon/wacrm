'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  BATCH_SEND_ATTEMPTS,
  batchRetryDelayMs,
} from '@/lib/broadcast-retry';
import { normalizeKey } from '@/lib/contacts/dedupe';
import {
  buscarPaginado,
  type ErroDoPostgrest,
  type MotivoDaDesconfianca,
} from '@/lib/supabase/paginar';
import { Contact, MessageTemplate } from '@/types';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv';
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  /** Contacts carrying any of these tags are subtracted from the result. */
  excludeTagIds?: string[];
}

/**
 * Variable mapping — each template placeholder (by key, usually "1",
 * "2", …) is resolved at send time. `field` maps to a built-in contact
 * field (name/phone/email/company); `custom_field` maps to a
 * contact_custom_values.value row keyed by the custom_fields.id stored
 * in `value`.
 */
export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string };

interface BroadcastPayload {
  name: string;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
  /**
   * Media URL for an IMAGE/VIDEO/DOCUMENT header. Required at send
   * time for media-header templates — Meta rejects the send without
   * it. Passed through as `messageParams.headerMediaUrl`; the builder
   * falls back to the template's stored URL only when this is empty.
   */
  headerMediaUrl?: string;
  /**
   * Canal Meta de saída, escolhido no passo 1 do assistente. `null` deixa a
   * rota resolver (`resolveMetaChannel`: padrão se for Meta, senão o
   * primeiro Meta conectado). Gravado na linha de `broadcasts` para o
   * relatório dizer DE QUAL número a campanha saiu — sem isso, duas
   * campanhas por números diferentes ficam indistinguíveis depois.
   */
  channelId?: string | null;
}

interface UseBroadcastSendingReturn {
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
  isProcessing: boolean;
  progress: number;
}

/**
 * Meta rate-limit buffer. 10 per batch + 1 s pause matches the spec
 * and keeps us comfortably under Meta's per-phone-number messaging
 * rate so a large broadcast never trips the upstream limiter.
 *
 * Note this shape when touching `RATE_LIMITS.broadcast`: a campaign is
 * many calls to `/api/whatsapp/broadcast`, not one. A 1 000-recipient
 * send is ~100 calls over several minutes, and a bucket sized for
 * "one call per campaign" throttles most of it away (issue #472).
 */
const SEND_BATCH_SIZE = 10;
const SEND_BATCH_DELAY_MS = 1000;

/** `broadcast_recipients` inserts are independent of the send rate. */
const INSERT_BATCH_SIZE = 200;

/**
 * Quantos ids cabem num `.in(...)` sem estourar a linha de requisição.
 *
 * ⚠️ O PostgREST vai por GET e o `.in()` viaja na URL: cada UUID custa 37
 * caracteres, então 100 ids dão ~3,7 KB de query string — folgado sob os
 * ~8 KB que proxy e servidor aceitam. A audiência inteira num `.in()` só
 * (12.980 contatos depois da carga da Kommo) passaria de 480 KB, e a
 * requisição seria recusada com um erro que não fala de tamanho nenhum.
 */
export const IDS_POR_CONSULTA = 100;

/** Reparte uma lista em fatias de no máximo `tamanho`. A última é a sobra. */
export function emFatias<T>(lista: T[], tamanho: number): T[][] {
  const fatias: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) {
    fatias.push(lista.slice(i, i + tamanho));
  }
  return fatias;
}

/**
 * `linhas: null` de `buscarPaginado` é o contrato "NÃO CONFIE" — nunca uma
 * lista parcial. Num disparo isso tem de ABORTAR, e a ordem de gravidade é
 * esta: mandar de menos é ruim; mandar para quem a EXCLUSÃO deveria ter
 * poupado é pior; e gravar `broadcasts.total_recipients = 12.980` tendo
 * enviado para 1.000 é o pior dos três — a campanha fica com o relatório
 * mentindo para sempre, e não sobra como descobrir quem ficou de fora.
 *
 * A mensagem sobe crua para o `toast.error` do assistente
 * (`broadcasts/new/page.tsx`), então diz O QUE não foi lido e POR QUÊ:
 * "a consulta falhou" e "passou do teto" pedem providências diferentes.
 */
export function erroDeLeituraParcial(
  oQueFaltou: string,
  motivo: MotivoDaDesconfianca | null,
  erro: ErroDoPostgrest | null,
): Error {
  const porque: Record<MotivoDaDesconfianca, string> = {
    erro: 'a consulta ao banco falhou',
    sem_contagem: 'o banco não devolveu o total de linhas',
    incompleto: 'a lista mudou enquanto era lida',
    teto: 'passou do teto de 25.000 linhas por consulta',
  };
  const detalhe = erro?.message ? ` (${erro.message})` : '';
  return new Error(
    `Disparo cancelado: não foi possível ler ${oQueFaltou} por inteiro — ` +
      `${motivo ? porque[motivo] : 'motivo desconhecido'}${detalhe}. ` +
      'Nada foi enviado.',
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BroadcastApiResult {
  phone: string;
  status: 'sent' | 'failed';
  whatsapp_message_id?: string;
  error?: string;
}

/** contactId → (customFieldId → value). */
type CustomValueIndex = Map<string, Map<string, string>>;

/**
 * Per-contact resolution of custom-field placeholders. Static and
 * built-in-field mappings resolve synchronously; custom fields read
 * from a pre-built index to avoid N+1 queries during the send loop.
 */
export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: Contact,
  customValues?: Map<string, string>,
): string[] {
  // Keys are typically "1","2",... — numeric-aware sort keeps
  // {{1}} before {{10}}.
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });

  return keys.map((key) => {
    const v = variables[key];
    if (v.type === 'static') return v.value;

    if (v.type === 'field') {
      const fieldMap: Record<string, string | undefined> = {
        name: contact.name,
        phone: contact.phone ?? undefined,
        email: contact.email,
        company: contact.company,
      };
      return fieldMap[v.value] ?? '';
    }

    // custom_field
    return customValues?.get(v.value) ?? '';
  });
}

/**
 * UPDATE de destinatário conferido pelo RETORNO (achado #15 do plano de
 * 31/08): RLS barrando um update devolve **0 linhas sem erro** — a 964
 * fechou a escrita destas tabelas para admin, e um "sucesso" silencioso
 * aqui deixa o destinatário preso em `pending` para sempre, com os
 * contadores à deriva (a mesma classe do insert incompleto documentado no
 * laço de insert). `.select('id')` faz o PostgREST devolver as linhas
 * tocadas; quem chama conta as perdidas.
 *
 * ⚠️ NÃO lança de propósito: quando estes updates rodam a mensagem JÁ SAIU
 * para o cliente — um throw viraria "o disparo falhou" no wizard, que é o
 * convite a reenviar a campanha inteira.
 */
async function marcarDestinatario(
  supabase: ReturnType<typeof createClient>,
  recipientId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('broadcast_recipients')
    .update(patch)
    .eq('id', recipientId)
    .select('id');
  return !error && (data?.length ?? 0) > 0;
}

/**
 * Os contatos da conta. `ids === null` traz todos; uma lista traz só eles.
 *
 * ⚠️⚠️ PAGINADA, e aqui o corte silencioso de 1000 linhas do PostgREST não
 * deixa uma tela incompleta — deixa uma CAMPANHA incompleta que se declara
 * completa. A audiência "todos os contatos" já passa de mil HOJE (1.212
 * contatos, contra o teto de 1000), e depois da carga da Kommo são ~12.980:
 * a tela dizia "12.980 destinatários", `total_recipients` gravava 12.980 e
 * o envio saía para uma amostra ARBITRÁRIA de mil — sem erro, sem toast,
 * sem nada no console. O `.in()` por fatias é a segunda metade do conserto:
 * ver `IDS_POR_CONSULTA`.
 */
async function lerContatos(
  supabase: ReturnType<typeof createClient>,
  ids: string[] | null,
): Promise<Contact[]> {
  const fatias: (string[] | null)[] =
    ids === null ? [null] : emFatias(ids, IDS_POR_CONSULTA);
  const contatos: Contact[] = [];

  for (const fatia of fatias) {
    const { linhas, erro, motivo } = await buscarPaginado<Contact>(
      async (de, ate) => {
        const base = supabase.from('contacts').select('*', { count: 'exact' });
        // O `.in()` antes de `order`/`range`: depois deles o builder já não
        // aceita filtro, e a ordem tem de desempatar por coluna única.
        const { data, error, count } = await (fatia ? base.in('id', fatia) : base)
          .order('id', { ascending: true })
          .range(de, ate);
        return { data: (data ?? null) as Contact[] | null, error, count };
      },
    );
    if (!linhas) {
      throw erroDeLeituraParcial('a lista de contatos da audiência', motivo, erro);
    }
    contatos.push(...linhas);
  }

  return contatos;
}

/**
 * Os `contact_id` que carregam qualquer uma das etiquetas.
 *
 * ⚠️⚠️ A EXCLUSÃO depende desta paginação mais que a inclusão. A etiqueta
 * `kommo` é a rede de proteção da migração — vai estar em ~12.980 fichas —,
 * e cortada em 1000 ela conheceria 8% dos importados e deixaria a campanha
 * alcançar os outros 92%. Exclusão que enxerga 8% é PIOR que exclusão
 * nenhuma: a tela afirma que protegeu.
 */
async function contatosComAsEtiquetas(
  supabase: ReturnType<typeof createClient>,
  tagIds: string[],
): Promise<string[]> {
  const contactIds = new Set<string>();

  for (const fatia of emFatias(tagIds, IDS_POR_CONSULTA)) {
    const { linhas, erro, motivo } = await buscarPaginado<{ contact_id: string }>(
      async (de, ate) => {
        const { data, error, count } = await supabase
          .from('contact_tags')
          .select('contact_id', { count: 'exact' })
          .in('tag_id', fatia)
          .order('id', { ascending: true })
          .range(de, ate);
        return {
          data: (data ?? null) as { contact_id: string }[] | null,
          error,
          count,
        };
      },
    );
    if (!linhas) {
      throw erroDeLeituraParcial('os contatos das etiquetas', motivo, erro);
    }
    for (const linha of linhas) contactIds.add(linha.contact_id);
  }

  return [...contactIds];
}

/**
 * Bulk-fetch contact_custom_values for a set of contacts. Returns an
 * index keyed by contact_id → field_id → value.
 *
 * ⚠️⚠️ A fatia é de CONTATOS, mas a consulta devolve N LINHAS POR CONTATO —
 * uma por campo preenchido. Com os 500 contatos por volta da versão
 * anterior e ~15 campos no catálogo desta conta, cada volta pedia ~7.500
 * linhas e o PostgREST devolvia as primeiras mil, sem erro nenhum. O
 * estrago não aparece aqui: aparece no texto que chega ao CLIENTE, com a
 * variável vazia ("Olá , sobre sua dívida de "), ou num `failed` que a Meta
 * devolve depois. Por isso são DUAS defesas — fatia pequena E cada fatia
 * paginada até o fim.
 *
 * ⚠️ E a falha deixou de ser engolida (`const { data }` descartava o
 * `error`): índice incompleto é indistinguível de "o contato não tem esse
 * campo", e o disparo seguiria com placeholder vazio. Aborta.
 */
async function fetchCustomValueIndex(
  supabase: ReturnType<typeof createClient>,
  contactIds: string[],
): Promise<CustomValueIndex> {
  const index: CustomValueIndex = new Map();
  if (contactIds.length === 0) return index;

  for (const fatia of emFatias(contactIds, IDS_POR_CONSULTA)) {
    const { linhas, erro, motivo } = await buscarPaginado<{
      contact_id: string;
      custom_field_id: string;
      value: string | null;
    }>(async (de, ate) => {
      const { data, error, count } = await supabase
        .from('contact_custom_values')
        .select('contact_id, custom_field_id, value', { count: 'exact' })
        .in('contact_id', fatia)
        .order('id', { ascending: true })
        .range(de, ate);
      return {
        data: (data ?? null) as
          | { contact_id: string; custom_field_id: string; value: string | null }[]
          | null,
        error,
        count,
      };
    });
    if (!linhas) {
      throw erroDeLeituraParcial(
        'os valores dos campos personalizados',
        motivo,
        erro,
      );
    }

    for (const row of linhas) {
      const bucket = index.get(row.contact_id) ?? new Map<string, string>();
      bucket.set(row.custom_field_id, row.value ?? '');
      index.set(row.contact_id, bucket);
    }
  }
  return index;
}

export function useBroadcastSending(): UseBroadcastSendingReturn {
  const { accountId, ownerUserId } = useAuth();
  const tDetail = useTranslations('Broadcasts.detail');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function resolveAudience(audience: AudienceConfig): Promise<Contact[]> {
    const supabase = createClient();

    let contacts: Contact[] = [];

    if (audience.type === 'all') {
      contacts = await lerContatos(supabase, null);
    } else if (
      audience.type === 'tags' &&
      audience.tagIds &&
      audience.tagIds.length > 0
    ) {
      const uniqueContactIds = await contatosComAsEtiquetas(
        supabase,
        audience.tagIds,
      );
      if (uniqueContactIds.length > 0) {
        contacts = await lerContatos(supabase, uniqueContactIds);
      }
    } else if (audience.type === 'custom_field' && audience.customField) {
      contacts = await resolveCustomFieldAudience(supabase, audience.customField);
    } else if (audience.type === 'csv' && audience.csvContacts) {
      contacts = await upsertCsvContacts(supabase, audience.csvContacts);
    }

    // Disparo é WhatsApp. A ficha só do Instagram (989) não tem telefone:
    // a Meta não teria para onde mandar, e cada uma viraria um "failed" na
    // lista de destinatários. Fica de fora aqui, antes de virar linha.
    contacts = contacts.filter((c) => !!c.phone);

    // Apply exclude tags (works across all contact-derived audience
    // types). CSV contacts are synthetic so exclusion doesn't apply.
    //
    // ⚠️ A falha aqui também deixou de ser engolida (`const { data: excludeRows }`
    // descartava o `error`): exclusão que não foi lida vira conjunto vazio, e
    // conjunto vazio é indistinguível de "ninguém a poupar" — a campanha sai
    // para todo mundo achando que respeitou o filtro.
    if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
      const excludedIds = new Set(
        await contatosComAsEtiquetas(supabase, audience.excludeTagIds),
      );
      contacts = contacts.filter((c) => !excludedIds.has(c.id));
    }

    return contacts;
  }

  /**
   * CSV uploads arrive as raw phone/name pairs, not DB rows. Before we
   * can insert broadcast_recipients (whose contact_id FKs contacts.id),
   * we need real contacts.id UUIDs. So: look up each CSV phone in the
   * caller's contacts table; insert any that don't exist; return the
   * resolved set.
   *
   * Pre-existing implementation synthesized `csv-N` strings as
   * contact_id, which failed the UUID cast on insert — every CSV
   * broadcast silently created zero recipients.
   *
   * Matching is on the normalized number throughout, so it agrees with
   * the account-wide unique index rather than colliding with it.
   */
  async function upsertCsvContacts(
    supabase: ReturnType<typeof createClient>,
    csvRows: { phone: string; name?: string }[],
  ): Promise<Contact[]> {
    if (csvRows.length === 0) return [];

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      throw new Error('You are not signed in.');
    }
    if (!accountId) {
      throw new Error('Your profile is not linked to an account.');
    }

    // De-duplicate within the CSV on the NORMALIZED number — the same
    // key the DB's UNIQUE (account_id, phone_normalized) index uses
    // (migration 022). Keyed on the raw string instead, "+1 555-0100"
    // and "15550100" survived as two rows and the insert below died on
    // a 23505, failing the whole broadcast.
    const uniqueByKey = new Map<string, { phone: string; name?: string }>();
    for (const row of csvRows) {
      const key = normalizeKey(row.phone);
      if (key && !uniqueByKey.has(key)) uniqueByKey.set(key, row);
    }
    const keys = [...uniqueByKey.keys()];

    // Single round-trip lookup of existing contacts. Scoped by ACCOUNT, not
    // by who clicked: contacts born from ingestion (or from a teammate)
    // carry the account owner's user_id, and filtering by `user.id` missed
    // them — the re-insert then hit the unique index (migration 022) and
    // sank the whole broadcast with a raw 23505. Matched on the generated
    // `phone_normalized` column (upstream #532), the same digits-only key
    // as `normalizeKey`, so "+55 (11) 9..." in the CSV finds the contact
    // stored as "5511 9..." instead of trying to insert it again.
    //
    // ⚠️⚠️ ESTA CONSULTA CONTINUA SEM PAGINAR, e é o último buraco desta
    // família no arquivo: acima de mil chaves o PostgREST devolve as
    // primeiras mil, os contatos que não vieram são tratados como novos, o
    // insert abaixo bate no índice único da 022 e a campanha inteira morre
    // com um 23505 cru na tela. Um CSV de 12 mil linhas — o tamanho da base
    // depois da Kommo — cai nisso na primeira tentativa. Não foi consertada
    // junto com as outras porque `use-broadcast-sending.dono-do-csv.test.ts`
    // trava a FORMA deste trecho letra por letra (é a resolução do merge do
    // upstream de 2026-09-05), e fatiar a lista renomeia a variável que o
    // pino exige. Quem consertar mexe nos DOIS arquivos, na mesma passada.
    const { data: existing, error: lookupErr } = await supabase
      .from('contacts')
      .select('*')
      .eq('account_id', accountId)
      .in('phone_normalized', keys);
    if (lookupErr) {
      throw new Error(`Failed to look up CSV contacts: ${lookupErr.message}`);
    }

    const byKey = new Map<string, Contact>();
    for (const c of (existing ?? []) as Contact[]) {
      const key = normalizeKey(c.phone ?? '');
      if (key) byKey.set(key, c);
    }

    // Insert only missing contacts, in one batch per 200 rows (PostgREST
    // has a default payload cap — 200 keeps individual requests small).
    // `contacts.user_id` CASCADEia de `auth.users`: grava-se o dono da
    // conta, nunca quem clicou — senão o offboarding do operador (apagar o
    // login no dashboard) leva os contatos criados pelo CSV do broadcast,
    // com conversas e mensagens. Sem dono resolvido, falha fechado.
    // ⚠️ Merge do upstream: a versão deles grava `user.id` aqui — manter
    // `ownerUserId` (decisão registrada no CLAUDE.md, merge de 2026-09-05).
    if (!ownerUserId) {
      throw new Error('Account owner not resolved.');
    }
    const missing = keys
      .filter((k) => !byKey.has(k))
      .map((k) => uniqueByKey.get(k)!)
      .map((row) => ({
        user_id: ownerUserId,
        account_id: accountId,
        phone: row.phone,
        name: row.name ?? null,
      }));

    const INSERT_CHUNK = 200;
    for (let i = 0; i < missing.length; i += INSERT_CHUNK) {
      const chunk = missing.slice(i, i + INSERT_CHUNK);
      const { data: inserted, error: insertErr } = await supabase
        .from('contacts')
        .insert(chunk)
        .select();
      if (insertErr) {
        throw new Error(`Failed to create CSV contacts: ${insertErr.message}`);
      }
      for (const c of (inserted ?? []) as Contact[]) {
        const key = normalizeKey(c.phone ?? '');
        if (key) byKey.set(key, c);
      }
    }

    // Preserve input order so analytics roughly matches the CSV order.
    return keys
      .map((k) => byKey.get(k))
      .filter((c): c is Contact => Boolean(c));
  }

  async function resolveCustomFieldAudience(
    supabase: ReturnType<typeof createClient>,
    filter: CustomFieldFilter,
  ): Promise<Contact[]> {
    const { fieldId, operator, value } = filter;

    // Build the WHERE clause for the operator. PostgREST supports
    // eq/neq/ilike via the query builder — use ilike with wildcards
    // for "contains" so the match is case-insensitive.
    //
    // ⚠️ Paginada: este recorte casa a base inteira com facilidade — um
    // `is_not` sobre valor raro devolve quase todo mundo —, e o corte de
    // 1000 escolheria mil deles em silêncio.
    const { linhas, erro, motivo } = await buscarPaginado<{ contact_id: string }>(
      async (de, ate) => {
        let query = supabase
          .from('contact_custom_values')
          .select('contact_id', { count: 'exact' })
          .eq('custom_field_id', fieldId);

        if (operator === 'is') query = query.eq('value', value);
        else if (operator === 'is_not') query = query.neq('value', value);
        else if (operator === 'contains')
          query = query.ilike('value', `%${value}%`);

        const { data, error, count } = await query
          .order('id', { ascending: true })
          .range(de, ate);
        return {
          data: (data ?? null) as { contact_id: string }[] | null,
          error,
          count,
        };
      },
    );
    if (!linhas) {
      throw erroDeLeituraParcial(
        'o recorte por campo personalizado',
        motivo,
        erro,
      );
    }

    const contactIds = [...new Set(linhas.map((m) => m.contact_id))];
    if (contactIds.length === 0) return [];

    return lerContatos(supabase, contactIds);
  }

  async function createAndSendBroadcast(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true);
    setProgress(0);

    const supabase = createClient();

    try {
      // ── Step 0: Resolve current user ──────────────────────────────
      // broadcasts.user_id is NOT NULL + guarded by RLS
      // (auth.uid() = user_id). Without this, the INSERT below was
      // silently failing with 23502 / 42501 — the wizard would
      // no-op with no feedback.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        throw new Error('You are not signed in.');
      }
      if (!accountId) {
        throw new Error('Your profile is not linked to an account.');
      }

      // ── Step 1: Resolve audience contacts ─────────────────────────
      setProgress(5);
      const contacts = await resolveAudience(payload.audience);

      if (contacts.length === 0) {
        throw new Error('No contacts found for this audience.');
      }

      // ── Step 1b: Resolve template params ──────────────────────────
      // Custom values are fetched BEFORE the insert so each row can
      // carry its resolved template params. Those params are what makes
      // the campaign resumable server-side (issue #472): the send loop
      // below runs in this browser tab, and if the tab goes away the
      // only record of what {{1}} should be for each contact is this
      // column. Resolving once here also means the resume sends exactly
      // what this pass would have.
      //
      // ⚠️ E vem antes da linha de `broadcasts`, não depois, desde que
      // `fetchCustomValueIndex` passou a ABORTAR em leitura parcial (era
      // silencioso): criada a campanha primeiro, o aborto deixaria uma linha
      // `sending` com zero destinatários, que nada recolhe. É a mesma ordem
      // da agendada com anexo (932) — conferir ANTES de reivindicar a linha.
      setProgress(10);
      const customValueIndex = await fetchCustomValueIndex(
        supabase,
        contacts.map((c) => c.id),
      );
      const paramsByContact = new Map(
        contacts.map((contact) => [
          contact.id,
          resolveVariables(
            payload.variables,
            contact,
            customValueIndex.get(contact.id),
          ),
        ]),
      );

      // ── Step 2: Create broadcast row ──────────────────────────────
      setProgress(15);
      const { data: broadcast, error: broadcastError } = await supabase
        .from('broadcasts')
        .insert({
          user_id: user.id,
          account_id: accountId,
          name: payload.name,
          template_name: payload.template.name,
          template_language: payload.template.language ?? 'en_US',
          template_variables: payload.variables,
          audience_filter: {
            type: payload.audience.type,
            tagIds: payload.audience.tagIds,
            customField: payload.audience.customField,
            excludeTagIds: payload.audience.excludeTagIds,
          },
          channel_id: payload.channelId ?? null,
          status: 'sending',
          total_recipients: contacts.length,
          sent_count: 0,
          delivered_count: 0,
          read_count: 0,
          replied_count: 0,
          failed_count: 0,
        })
        .select()
        .single();

      if (broadcastError || !broadcast) {
        throw new Error(
          `Failed to create broadcast: ${broadcastError?.message ?? 'unknown error'}`,
        );
      }

      // ── Step 3: Insert recipient rows ─────────────────────────────
      // `paramsByContact` já foi resolvido no passo 1b, antes da linha de
      // `broadcasts` — ver o comentário de lá.
      setProgress(20);
      const recipientRows = contacts.map((contact) => ({
        broadcast_id: broadcast.id,
        contact_id: contact.id,
        status: 'pending' as const,
        template_params: paramsByContact.get(contact.id) ?? [],
      }));

      for (let i = 0; i < recipientRows.length; i += INSERT_BATCH_SIZE) {
        const batch = recipientRows.slice(i, i + INSERT_BATCH_SIZE);
        const { error: recipientError } = await supabase
          .from('broadcast_recipients')
          .insert(batch);
        if (recipientError) {
          // Previous impl logged and marched on — the broadcast then ran
          // with an incomplete recipient set, so webhook status updates
          // couldn't find some rows and the aggregate counts drifted.
          // Flip the broadcast to failed so the user sees the problem
          // immediately, then throw to abort the send loop.
          await supabase
            .from('broadcasts')
            .update({
              status: 'failed',
              failed_count: contacts.length,
            })
            .eq('id', broadcast.id);
          throw new Error(
            `Failed to insert recipient batch ${i / INSERT_BATCH_SIZE + 1}: ${recipientError.message}`,
          );
        }
      }

      // ── Step 4: Fetch recipients back (joined contact) ────────────
      //
      // ⚠️⚠️ PAGINADA também, e sem isto o conserto da audiência não valeria
      // de nada — só mudaria o lugar do defeito. É esta lista que o laço de
      // envio percorre: com 12.980 destinatários inseridos e o corte de 1000
      // aqui, a campanha gravaria 12.980, mandaria para mil e fecharia como
      // `sent`, deixando 11.980 linhas `pending` que ninguém recolhe — e o
      // `failedCount === totalRecipients` do passo 5 compararia contra mil.
      setProgress(30);
      type LinhaDeDestinatario = {
        id: string;
        template_params: unknown;
        contact: Contact | null;
      };
      const { linhas: recipients, erro: recipientsErr, motivo: recipientsMotivo } =
        await buscarPaginado<LinhaDeDestinatario>(async (de, ate) => {
          const { data, error, count } = await supabase
            .from('broadcast_recipients')
            .select('*, contact:contacts(*)', { count: 'exact' })
            .eq('broadcast_id', broadcast.id)
            .order('id', { ascending: true })
            .range(de, ate);
          return {
            data: (data ?? null) as LinhaDeDestinatario[] | null,
            error,
            count,
          };
        });

      if (!recipients) {
        // Aqui NADA saiu ainda — as linhas estão gravadas, mas o laço de
        // envio não rodou. A campanha vira `failed` para não ficar presa em
        // `sending` para sempre; o motivo sobe no toast.
        await supabase
          .from('broadcasts')
          .update({ status: 'failed' })
          .eq('id', broadcast.id);
        throw erroDeLeituraParcial(
          'a lista de destinatários da campanha',
          recipientsMotivo,
          recipientsErr,
        );
      }

      let failedCount = 0;
      // Escritas de status que voltaram com 0 linhas (ver `marcarDestinatario`).
      let escritasPerdidas = 0;
      const totalRecipients = recipients.length;

      // Media-header templates (image/video/document) require a media
      // URL on every send. Collected in the personalize step and applied
      // to all recipients; falls back to the template's stored URL on the
      // server when omitted.
      const headerType = payload.template.header_type;
      const isMediaHeader =
        headerType === 'image' ||
        headerType === 'video' ||
        headerType === 'document';
      const headerMediaUrl = payload.headerMediaUrl?.trim();
      const messageParams =
        isMediaHeader && headerMediaUrl ? { headerMediaUrl } : undefined;

      for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
        const batch = recipients.slice(i, i + SEND_BATCH_SIZE);

        const apiRecipients = batch
          .filter((r) => r.contact?.phone)
          .map((r) => ({
            phone: r.contact!.phone as string,
            // Read back off the row rather than re-resolved, so this
            // pass and any later resume send identical params.
            params: Array.isArray(r.template_params) ? r.template_params : [],
            ...(messageParams ? { messageParams } : {}),
          }));

        if (apiRecipients.length === 0) continue;

        try {
          // Send the batch, waiting out a 429 rather than writing the
          // whole batch off as failed. Only 429 is replayed — see
          // batchRetryDelayMs for why nothing else can be.
          let data: { error?: string; results?: BroadcastApiResult[] } = {};
          for (let attempt = 1; ; attempt++) {
            const res = await fetch('/api/whatsapp/broadcast', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                recipients: apiRecipients,
                template_name: payload.template.name,
                template_language: payload.template.language ?? 'en_US',
                // Multi-canal: por qual numero a campanha sai. Sem isto o
                // servidor cai no canal padrao e o relatorio mente a origem.
                channel_id: payload.channelId ?? null,
              }),
            });

            data = await res.json();
            if (res.ok) break;

            const retryIn =
              attempt < BATCH_SEND_ATTEMPTS
                ? batchRetryDelayMs(res.status, res.headers.get('Retry-After'))
                : null;
            if (retryIn === null) {
              throw new Error(data.error || 'Broadcast API request failed');
            }
            await sleep(retryIn);
          }

          const resultsByPhone = new Map<string, BroadcastApiResult>();
          for (const r of (data.results ?? []) as BroadcastApiResult[]) {
            resultsByPhone.set(r.phone, r);
          }

          for (const recipient of batch) {
            const phone = recipient.contact?.phone;
            const result = phone ? resultsByPhone.get(phone) : undefined;

            if (!result) {
              failedCount++;
              if (
                !(await marcarDestinatario(supabase, recipient.id, {
                  status: 'failed',
                  error_message: 'No phone number on contact',
                }))
              ) {
                escritasPerdidas++;
              }
              continue;
            }

            if (result.status === 'sent') {
              if (
                !(await marcarDestinatario(supabase, recipient.id, {
                  status: 'sent',
                  sent_at: new Date().toISOString(),
                  whatsapp_message_id: result.whatsapp_message_id ?? null,
                  error_message: null,
                }))
              ) {
                escritasPerdidas++;
              }
            } else {
              failedCount++;
              if (
                !(await marcarDestinatario(supabase, recipient.id, {
                  status: 'failed',
                  error_message: result.error ?? 'Unknown error',
                }))
              ) {
                escritasPerdidas++;
              }
            }
          }
        } catch (err) {
          for (const recipient of batch) {
            failedCount++;
            if (
              !(await marcarDestinatario(supabase, recipient.id, {
                status: 'failed',
                error_message: err instanceof Error ? err.message : 'Unknown error',
              }))
            ) {
              escritasPerdidas++;
            }
          }
        }

        const progressPct =
          30 + Math.round(((i + batch.length) / totalRecipients) * 60);
        setProgress(progressPct);

        if (i + SEND_BATCH_SIZE < recipients.length) {
          await sleep(SEND_BATCH_DELAY_MS);
        }
      }

      // ── Step 5: Finalize status ───────────────────────────────────
      // Aggregate counts are maintained by the DB trigger (migration
      // 003); we only flip the final status here.
      setProgress(95);
      const finalStatus = failedCount === totalRecipients ? 'failed' : 'sent';
      const { data: finalizado, error: finalErr } = await supabase
        .from('broadcasts')
        .update({ status: finalStatus })
        .eq('id', broadcast.id)
        .select('id');

      // As mensagens JÁ SAÍRAM: nada aqui pode virar "o disparo falhou" (o
      // wizard toastaria erro e convidaria a reenviar a campanha). Escrita de
      // status perdida vira AVISO — o relatório é quem pode estar defasado,
      // não o envio.
      const statusFinalPerdido = Boolean(finalErr) || !finalizado?.length;
      if (statusFinalPerdido || escritasPerdidas > 0) {
        console.error(
          `[broadcast] envio concluído, mas ${escritasPerdidas} status de destinatário` +
            (statusFinalPerdido ? ' e o status final da campanha' : '') +
            ' não gravaram (0 linhas/erro) — o relatório pode estar defasado.',
        );
        toast.warning(
          tDetail('toastStatusWritesLost', {
            count: escritasPerdidas + (statusFinalPerdido ? 1 : 0),
          }),
        );
      }

      setProgress(100);
      return broadcast.id;
    } finally {
      setIsProcessing(false);
    }
  }

  return { createAndSendBroadcast, isProcessing, progress };
}

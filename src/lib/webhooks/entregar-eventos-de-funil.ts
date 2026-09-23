// ============================================================
// Entrega dos eventos `deal.*` — a E/S de `eventos-de-funil.ts`.
//
// Quem chama é o DRENO da fila do funil (`drain-events.ts`), UMA vez por
// ciclo, com as linhas que ELE reivindicou. A reivindicação é o que garante
// que o mesmo movimento de card não sai duas vezes: o aviso imediato do
// navegador e o cron drenam ao mesmo tempo, e só quem carimbou a linha a
// entrega. Por isso o `id` do envelope é o id da linha — estável.
//
// Por conta, nesta ordem:
//   1. UMA consulta: há endpoint ativo assinando algum `deal.*`? Sem nenhum,
//      nada mais é lido — a conta que não integra não paga o catálogo.
//   2. Só as linhas cujo evento ALGUÉM assina viram aviso.
//   3. O catálogo é lido em LOTE (negócios, responsáveis, funis, etapas,
//      contatos com etiquetas e campos personalizados), sempre recortado pela
//      conta: service role ignora RLS.
//   4. Entrega pelo `dispatchWebhookEvent` de sempre, em ordem de
//      `criado_em`, no máximo 4 ao mesmo tempo.
//
// ⚠️ A ORDEM DE CHEGADA NÃO É GARANTIDA. As entregas COMEÇAM em ordem, mas
// quatro correm em paralelo e cada endpoint responde no seu tempo; um card
// movido duas vezes em segundos pode chegar "Proposta" antes de "Reunião".
// Quem recebe ordena pelo `occurred_at` (a hora do fato) — está na doc.
//
// ⚠️ Nunca lança: o dreno aguarda esta função, e uma exceção aqui derrubaria
// o arrastar do card (o aviso imediato) e o ciclo do cron.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { CONTACT_SELECT, serializeContact } from '@/lib/api/v1/contacts';
import { serializeCustomFields } from '@/lib/api/v1/custom-fields';
import { serializeDeal, type ApiDeal } from '@/lib/api/v1/deals';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import type { DealEventContact } from '@/lib/webhooks/dados-dos-eventos';
import { eventoDaLinha, montarAviso, type CatalogoDoAviso } from '@/lib/webhooks/eventos-de-funil';
import { DEAL_WEBHOOK_EVENTS, type DealWebhookEvent } from '@/lib/webhooks/events';
import type { CbAutomationEvent, CustomField } from '@/types';

/**
 * Entregas simultâneas. Quatro, e não "todas": cada uma pode segurar até
 * `DELIVERY_TIMEOUT_MS` (5 s), e o dreno inteiro espera por esta função —
 * inclusive a rota do aviso imediato, que o navegador aguarda depois de
 * arrastar o card. Com um endpoint lento, um lote de 50 avisos custa ~13
 * rodadas de 5 s no pior caso; um por vez custaria 50.
 */
const ENTREGAS_SIMULTANEAS = 4;

/**
 * Página das leituras que podem crescer além do teto de 1000 linhas do
 * PostgREST (que corta SEM avisar). `contact_custom_values` é a que morde:
 * 50 contatos × 20 campos já são 1000 linhas, e a leitura truncada tiraria
 * campos do aviso em silêncio — o receptor leria "campo vazio".
 */
const PAGINA = 1000;

/** Teto de páginas: passou disso, a leitura é tratada como FALHA, nunca como parcial. */
const TETO_DE_PAGINAS = 50;

/** Colunas de `serializeDeal` + o responsável (`assigned_to` → `profiles.id`). */
const COLUNAS_DO_NEGOCIO =
  'id, pipeline_id, stage_id, contact_id, conversation_id, channel_id, title, value, ' +
  'currency, status, source, expected_close_date, created_at, updated_at, assigned_to';

type Resposta<T> = { data: T[] | null; error: unknown };

/** Lê todas as páginas; `null` = falhou ou passou do teto (nunca meia lista). */
async function lerTudo<T>(
  pagina: (de: number, ate: number) => PromiseLike<Resposta<T>>
): Promise<T[] | null> {
  const tudo: T[] = [];
  for (let n = 0; n < TETO_DE_PAGINAS; n++) {
    const { data, error } = await pagina(n * PAGINA, (n + 1) * PAGINA - 1);
    if (error || !data) return null;
    tudo.push(...data);
    if (data.length < PAGINA) return tudo;
  }
  return null;
}

function unicos(valores: (string | null | undefined)[]): string[] {
  return [...new Set(valores.filter((v): v is string => typeof v === 'string' && v !== ''))];
}

/**
 * Lê o que os avisos de UMA conta precisam. `null` = alguma leitura falhou.
 *
 * ⚠️⚠️ Falha de leitura NUNCA vira aviso com `deal: null` ou `contact: null`:
 * para quem recebe, nulo quer dizer "apagado", e um n8n que limpa o registro
 * quando o negócio some apagaria dado bom por causa de um soluço do banco. O
 * nulo legítimo é só a AUSÊNCIA de linha numa leitura que deu certo.
 */
async function lerCatalogo(
  db: SupabaseClient,
  conta: string,
  linhas: CbAutomationEvent[]
): Promise<CatalogoDoAviso | null> {
  const idsDeNegocio = unicos(linhas.map((l) => l.deal_id));
  const idsDeContato = unicos(linhas.map((l) => l.contact_id));
  const idsDeFunil = unicos(linhas.flatMap((l) => [l.to_pipeline_id, l.from_pipeline_id]));
  const idsDeEtapa = unicos(linhas.flatMap((l) => [l.to_stage_id, l.from_stage_id]));

  const vazio = { data: [], error: null };

  // Quatro cadeias independentes em paralelo; dentro de cada uma, o segundo
  // passo depende do primeiro (o responsável sai do negócio; os valores de
  // campo, dos contatos que a CONTA devolveu).
  const [negocios, funis, etapas, contatos] = await Promise.all([
    (async () => {
      const r = idsDeNegocio.length
        ? await db.from('deals').select(COLUNAS_DO_NEGOCIO).eq('account_id', conta).in('id', idsDeNegocio)
        : vazio;
      if (r.error || !r.data) return null;
      const linhasDeNegocio = r.data as unknown as Record<string, unknown>[];
      const idsDePerfil = unicos(linhasDeNegocio.map((d) => d.assigned_to as string | null));
      const p = idsDePerfil.length
        ? await db
            .from('profiles')
            .select('id, user_id, full_name')
            .eq('account_id', conta)
            .in('id', idsDePerfil)
        : vazio;
      if (p.error || !p.data) return null;
      return { linhas: linhasDeNegocio, perfis: p.data as unknown as Record<string, unknown>[] };
    })(),
    (async () => {
      const r = idsDeFunil.length
        ? await db.from('pipelines').select('id, name').eq('account_id', conta).in('id', idsDeFunil)
        : vazio;
      return r.error || !r.data ? null : (r.data as unknown as Record<string, unknown>[]);
    })(),
    (async () => {
      // `pipeline_stages` NÃO tem `account_id` (a tenancy é pelo funil); o
      // recorte pela conta é feito abaixo, contra os funis que a CONTA
      // devolveu. Toda etapa de um evento vem em par com o funil dela (FK
      // composta de `deals`), então o funil está sempre em `idsDeFunil`.
      const r = idsDeEtapa.length
        ? await db.from('pipeline_stages').select('id, name, position, pipeline_id').in('id', idsDeEtapa)
        : vazio;
      return r.error || !r.data ? null : (r.data as unknown as Record<string, unknown>[]);
    })(),
    (async () => {
      if (!idsDeContato.length) return { linhas: [], campos: [], valores: [] };
      const r = await db.from('contacts').select(CONTACT_SELECT).eq('account_id', conta).in('id', idsDeContato);
      if (r.error || !r.data) return null;
      const linhasDeContato = r.data as unknown as Record<string, unknown>[];
      const daConta = linhasDeContato.map((c) => c.id as string);
      if (!daConta.length) return { linhas: linhasDeContato, campos: [], valores: [] };

      const [campos, valores] = await Promise.all([
        lerTudo<CustomField>((de, ate) =>
          db
            .from('custom_fields')
            .select('*')
            .eq('account_id', conta)
            .order('id')
            .range(de, ate) as unknown as PromiseLike<Resposta<CustomField>>
        ),
        // Sem `account_id` nesta tabela: o recorte é pelos contatos que a
        // consulta acima, filtrada pela conta, devolveu.
        lerTudo<Record<string, unknown>>((de, ate) =>
          db
            .from('contact_custom_values')
            .select('contact_id, custom_field_id, value')
            .in('contact_id', daConta)
            .order('contact_id')
            .order('custom_field_id')
            .range(de, ate) as unknown as PromiseLike<Resposta<Record<string, unknown>>>
        ),
      ]);
      if (!campos || !valores) return null;
      return { linhas: linhasDeContato, campos, valores };
    })(),
  ]);

  if (!negocios || !funis || !etapas || !contatos) return null;

  const catalogo: CatalogoDoAviso = {
    negocios: new Map(),
    responsaveis: new Map(),
    funis: new Map(),
    etapas: new Map(),
    contatos: new Map(),
  };

  const perfis = new Map(negocios.perfis.map((p) => [p.id as string, p]));
  for (const linha of negocios.linhas) {
    const negocio: ApiDeal = serializeDeal(linha);
    catalogo.negocios.set(negocio.id, negocio);
    const perfil = perfis.get(linha.assigned_to as string);
    if (perfil) {
      catalogo.responsaveis.set(negocio.id, {
        user_id: perfil.user_id as string,
        name: (perfil.full_name as string | null) ?? null,
      });
    }
  }

  for (const f of funis) catalogo.funis.set(f.id as string, f.name as string);

  for (const e of etapas) {
    if (!catalogo.funis.has(e.pipeline_id as string)) continue; // outra conta, ou funil apagado
    catalogo.etapas.set(e.id as string, { name: e.name as string, position: e.position as number });
  }

  const valoresPorContato = new Map<string, Record<string, string>>();
  for (const v of contatos.valores) {
    const contato = v.contact_id as string;
    const mapa = valoresPorContato.get(contato) ?? {};
    mapa[v.custom_field_id as string] = (v.value as string | null) ?? '';
    valoresPorContato.set(contato, mapa);
  }
  for (const linha of contatos.linhas) {
    const id = linha.id as string;
    const contato: DealEventContact = {
      ...serializeContact(linha),
      // O MESMO mapa chave → valor de `GET /api/v1/contacts/{id}/custom-fields`
      // (`values`): vazio sai `null`, e todo campo do catálogo aparece.
      custom_fields: serializeCustomFields(contatos.campos, valoresPorContato.get(id) ?? {}).values,
    };
    catalogo.contatos.set(id, contato);
  }

  return catalogo;
}

/** Roda `fn` sobre os itens, começando em ordem, com no máximo `limite` ao mesmo tempo. */
async function emParalelo<T>(itens: T[], limite: number, fn: (item: T) => Promise<void>): Promise<void> {
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const item = itens[proximo++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
}

async function entregarDaConta(
  db: SupabaseClient,
  conta: string,
  linhas: CbAutomationEvent[]
): Promise<void> {
  const { data: endpoints, error } = await db
    .from('webhook_endpoints')
    .select('events')
    .eq('account_id', conta)
    .eq('is_active', true)
    .overlaps('events', [...DEAL_WEBHOOK_EVENTS]);
  if (error) {
    console.error(`[webhooks] eventos de funil: leitura dos endpoints falhou — ${linhas.length} aviso(s) não entregue(s)`, error);
    return;
  }
  if (!endpoints || endpoints.length === 0) return;

  const assinados = new Set<DealWebhookEvent>();
  for (const e of endpoints as { events: string[] | null }[]) {
    for (const ev of e.events ?? []) {
      if ((DEAL_WEBHOOK_EVENTS as readonly string[]).includes(ev)) assinados.add(ev as DealWebhookEvent);
    }
  }
  // O dreno já lê em ordem de `criado_em`; reordenar aqui é para não depender
  // disso. `sort` é estável: empate (etapa e status do MESMO save têm o mesmo
  // carimbo) mantém a ordem em que a fila entregou.
  const aEntregar = linhas
    .filter((l) => assinados.has(eventoDaLinha(l)))
    .sort((a, b) => Date.parse(a.criado_em) - Date.parse(b.criado_em));
  if (aEntregar.length === 0) return;

  const catalogo = await lerCatalogo(db, conta, aEntregar);
  if (!catalogo) {
    // As linhas já foram reivindicadas pelo dreno: estes avisos não saem
    // mais. É a mesma régua de "uma tentativa, sem retentativa" do resto dos
    // webhooks — e é melhor que um aviso afirmando "apagado" sobre o que existe.
    console.error(
      `[webhooks] eventos de funil: leitura do catálogo falhou — ${aEntregar.length} aviso(s) da conta ${conta} não entregue(s)`
    );
    return;
  }

  await emParalelo(aEntregar, ENTREGAS_SIMULTANEAS, async (linha) => {
    const aviso = montarAviso(linha, catalogo);
    await dispatchWebhookEvent(db, conta, aviso.evento, aviso.data, {
      id: linha.id,
      occurredAt: linha.criado_em,
    });
  });
}

/**
 * Entrega aos endpoints `deal.*` as linhas da fila do funil que o dreno
 * reivindicou. Nunca lança.
 *
 * ⚠️ Recebe só o que o dreno reivindicou — ≤ `LOTE` (50) linhas —, e as
 * leituras em lote por `.in()` contam com isso (URL curta, resposta abaixo do
 * teto de 1000). Quem chamar com mais linhas reparte antes.
 */
export async function entregarEventosDeFunil(
  db: SupabaseClient,
  linhas: CbAutomationEvent[]
): Promise<void> {
  try {
    if (linhas.length === 0) return;
    const porConta = new Map<string, CbAutomationEvent[]>();
    for (const linha of linhas) {
      const lista = porConta.get(linha.account_id) ?? [];
      lista.push(linha);
      porConta.set(linha.account_id, lista);
    }
    for (const [conta, daConta] of porConta) {
      try {
        await entregarDaConta(db, conta, daConta);
      } catch (err) {
        // Uma conta que estoura não leva as outras junto.
        console.error(`[webhooks] eventos de funil: entrega da conta ${conta} falhou`, err);
      }
    }
  } catch (err) {
    console.error('[webhooks] eventos de funil: entrega falhou', err);
  }
}

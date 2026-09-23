// ============================================================
// Tags de um contato pela API pública (v1) — ADITIVO, e a leitura de
// "qual etiqueta foi pedida" que as TRÊS portas da v1 compartilham.
//
// `PATCH /api/v1/contacts/{id}` com `tags: []` SUBSTITUI o conjunto
// inteiro, e continua assim (é contrato publicado). Este módulo é o
// outro verbo: põe uma tag sem derrubar as demais, e tira uma tag
// específica.
//
// Nasceu da integração com o Typebot: o fluxo aplica "Typebot" no lead
// que acabou de chegar, e pelo caminho substitutivo isso apagaria
// "Bancário", "Cliente Fechado" e o que mais o escritório tivesse posto
// na ficha — em silêncio, porque a resposta seria 200.
//
// ⚠️ A régua de "mesma etiqueta" mora em `@/lib/contacts/chave-de-tag` —
// ela é compartilhada com o import de CSV e tem gêmeo em SQL (a coluna
// gerada `tags.name_key`, migration 983).
//
// ⚠️⚠️ Aceita NOME ou ID de etiqueta, e a régua é de FORMA
// (`pareceIdDeEtiqueta`): texto com formato de UUID é id; qualquer outro
// é nome. Até 22/09/2026 só havia nome — e `GET /api/v1/tags` (que existe
// desde a 983 justamente para o integrador descobrir o catálogo) devolve
// `id` e `name` lado a lado. Um integrador mandou o `id` da etiqueta
// "Typebot" onde a API lia nome, e ela CRIOU uma etiqueta chamada
// "32f2da4f-…", aplicou-a ao contato e disparou `tag_added`, com 200. No
// `PATCH` substitutivo era pior: o id não casava com a etiqueta real, e a
// real ia para a lista de remoção. Hoje:
// - id é conferido contra `tags.id` DA CONTA; id que não é daqui é 400
//   `unknown_tag_ids`, conferido ANTES de qualquer escrita, e id NUNCA
//   cria etiqueta — nem com `create_missing`;
// - a mesma etiqueta pedida por nome e por id na mesma chamada conta UMA
//   vez (a deduplicação é pelo id resolvido);
// - "a mesma nos dois lados" (add × remove) é conferida pelo id resolvido
//   também, então `add: ["Typebot"]` + `remove: ["<id do Typebot>"]` é
//   recusado como `add: ["Typebot"]` + `remove: ["typebot"]` sempre foi.
//
// ⚠️ Toda escrita passa pelos helpers centrais
// (`addContactTagAndDispatch` / `removeContactTag`): eles conferem a
// posse do contato E da tag (a tabela `contact_tags` não tem
// `account_id`, então a RLS sozinha não separa contas), tratam o
// 23505 como no-op, e disparam o gatilho `tag_added` uma vez por
// aplicação REAL. Já existem três escritores no repo que furam esses
// helpers; não somar um quarto.
//
// A trilha de auditoria sai de graça: o trigger da 912 grava
// `tag_added`/`tag_removed` em `cb_lead_events` a cada INSERT/DELETE.
// Vindo daqui (service-role, sem `auth.uid()`) ele registra com
// `origin = 'sistema'`. Não escrever log à mão.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { chaveDeTag } from '@/lib/contacts/chave-de-tag';
import { pareceIdDeEtiqueta } from '@/lib/contacts/id-de-etiqueta';
import {
  type CatalogoDeTags,
  lerCatalogoDeTags,
  resolveImportTagIds,
} from '@/lib/contacts/resolve-import-tags';
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import {
  ContactTagWriteError,
  removeContactTag,
} from '@/lib/contacts/tag-write';

/** Teto por chamada. Um corpo com centenas de nomes é engano, não uso. */
export const MAX_TAGS_POR_CHAMADA = 50;

/**
 * Recusa de uma referência de etiqueta — sempre 400, e sempre levantada
 * ANTES de qualquer escrita (no contato, no catálogo e em `contact_tags`).
 *
 * Não é `ApiError` porque o código da máquina (`unknown_tag_ids`) está fora
 * de `ApiErrorCode`, e não é `ContactError` porque este módulo não pode
 * importar `api/v1/contacts.ts` (é ele que importa daqui). As três rotas que
 * aceitam etiqueta têm o ramo próprio no `catch`.
 */
export class TagReferenceError extends Error {
  readonly code: 'unknown_tag_ids' | 'bad_request';
  readonly status = 400;

  constructor(code: 'unknown_tag_ids' | 'bad_request', message: string) {
    super(message);
    this.name = 'TagReferenceError';
    this.code = code;
  }
}

/** O 400 do id que não é etiqueta desta conta. Os ids vão como vieram. */
export function erroDeIdsDesconhecidos(ids: readonly string[]): TagReferenceError {
  return new TagReferenceError(
    'unknown_tag_ids',
    `Unknown tag ids for this account: ${ids.join(', ')}. ` +
      "Use the 'id' values from GET /api/v1/tags, or send the tag name."
  );
}

/** Um item pedido, já lido contra o catálogo. */
export interface ReferenciaCasada {
  /** O texto como veio no corpo, aparado. */
  pedido: string;
  /** Id da etiqueta na conta; `null` = NOME que (ainda) não existe. */
  id: string | null;
  /**
   * O nome GRAVADO da etiqueta quando ela existe — é o que a resposta
   * devolve, nunca o UUID cru. Para nome ainda inexistente, o pedido.
   */
  nome: string;
}

export interface CasamentoDeReferencias {
  /** Na ordem do pedido, sem repetição (pelo id resolvido). */
  itens: ReferenciaCasada[];
  /** Textos com forma de id que não são etiqueta desta conta. */
  idsDesconhecidos: string[];
}

/**
 * Lê uma lista de nomes e ids de etiqueta contra o catálogo da conta. Puro.
 *
 * ⚠️ A deduplicação é pelo ID RESOLVIDO quando há um: "Typebot" e o id do
 * Typebot na mesma lista são UMA etiqueta. Nome que não existe deduplica
 * por `chaveDeTag` (a régua da criação). Id desconhecido nunca vira item —
 * nem nome a criar.
 */
export function casarReferencias(
  textos: readonly string[],
  catalogo: CatalogoDeTags
): CasamentoDeReferencias {
  const itens: ReferenciaCasada[] = [];
  const idsDesconhecidos: string[] = [];
  const vistos = new Set<string>();
  const desconhecidosVistos = new Set<string>();

  for (const cru of textos) {
    const pedido = cru.trim();
    if (!pedido) continue;

    if (pareceIdDeEtiqueta(pedido)) {
      const id = pedido.toLowerCase();
      const nome = catalogo.nomePorId.get(id);
      if (nome === undefined) {
        if (!desconhecidosVistos.has(id)) {
          desconhecidosVistos.add(id);
          idsDesconhecidos.push(pedido);
        }
        continue;
      }
      if (vistos.has(id)) continue;
      vistos.add(id);
      itens.push({ pedido, id, nome });
      continue;
    }

    const chave = chaveDeTag(pedido);
    const id = catalogo.porChave.get(chave) ?? null;
    // O prefixo não colide com id: um uuid nunca começa com "nome:".
    const marca = id ?? `nome:${chave}`;
    if (vistos.has(marca)) continue;
    vistos.add(marca);
    itens.push({
      pedido,
      id,
      nome: (id && catalogo.nomePorId.get(id.toLowerCase())) || pedido,
    });
  }

  return { itens, idsDesconhecidos };
}

export interface MudancaDeTags {
  /** Nomes ou ids a acrescentar, aparados e sem repetição (pela chave). */
  add: string[];
  /** Nomes ou ids a retirar, aparados e sem repetição. */
  remove: string[];
  /** Criar tag que ainda não existe na conta (só vale para NOME em `add`). */
  criarFaltantes: boolean;
}

export type LeituraDaMudanca =
  { ok: true; mudanca: MudancaDeTags } | { ok: false; erro: string };

function lerLista(valor: unknown, campo: string): string[] | string {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor)) {
    return `'${campo}' must be an array of tag names or ids`;
  }

  const itens: string[] = [];
  const vistos = new Set<string>();
  for (const cru of valor) {
    if (typeof cru !== 'string') {
      return `'${campo}' must contain only strings`;
    }
    const item = cru.trim();
    if (!item) return `'${campo}' must not contain empty values`;
    // ⚠️ A deduplicação usa `chaveDeTag`, a MESMA régua da resolução —
    // nunca `toLowerCase()` sozinho. Elas divergiram por uma revisão:
    // `add: ["Bancário", "bancario"]` sobrevivia como dois nomes porque a
    // validação só rebaixava a caixa, e a resolução (que também tira o
    // acento) mandava os dois para a MESMA etiqueta. Para um id ela só
    // rebaixa a caixa, que é o certo (o uuid não tem acento). Nome e id da
    // MESMA etiqueta só se encontram depois do catálogo: `casarReferencias`.
    const chave = chaveDeTag(item);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    itens.push(item);
  }
  return itens;
}

/**
 * Lê e valida o corpo de `POST /api/v1/contacts/{id}/tags`. Puro.
 *
 * ⚠️ A mesma etiqueta em `add` e em `remove` é RECUSADA, não resolvida por
 * ordem: qualquer ordem que escolhêssemos seria uma convenção invisível
 * para quem integra, e o resultado (tem ou não tem a tag no fim) mudaria
 * conforme a leitura de quem escreveu o fluxo. Aqui a recusa pega o mesmo
 * TEXTO; a mesma etiqueta por nome de um lado e por id do outro só é
 * visível com o catálogo, e é recusada em `aplicarMudancaDeTags`, antes de
 * qualquer escrita.
 */
export function lerMudancaDeTags(corpo: unknown): LeituraDaMudanca {
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) {
    return { ok: false, erro: 'Request body must be a JSON object' };
  }
  const c = corpo as Record<string, unknown>;

  const add = lerLista(c.add, 'add');
  if (typeof add === 'string') return { ok: false, erro: add };
  const remove = lerLista(c.remove, 'remove');
  if (typeof remove === 'string') return { ok: false, erro: remove };

  if (add.length === 0 && remove.length === 0) {
    return {
      ok: false,
      erro: "provide at least one tag name or id in 'add' or 'remove'",
    };
  }
  if (add.length + remove.length > MAX_TAGS_POR_CHAMADA) {
    return {
      ok: false,
      erro: `at most ${MAX_TAGS_POR_CHAMADA} tags per request`,
    };
  }

  // ⚠️ `chaveDeTag`, e não `toLowerCase()`: com a régua fraca,
  // `{add:["Bancário"], remove:["bancario"]}` PASSAVA pela recusa e, na
  // aplicação, removia e reinseria a MESMA etiqueta — disparando o gatilho
  // `tag_added`, que pode mandar mensagem ao cliente por uma etiqueta que
  // ele já tinha antes e continua tendo depois. Toda comparação de nome de
  // etiqueta neste arquivo passa por `chaveDeTag` (ou, com o catálogo em
  // mãos, pelo id resolvido).
  const emAdd = new Set(add.map((n) => chaveDeTag(n)));
  const dosDois = remove.filter((n) => emAdd.has(chaveDeTag(n)));
  if (dosDois.length > 0) {
    return {
      ok: false,
      erro: `the same tag cannot be in both 'add' and 'remove': ${dosDois.join(', ')}`,
    };
  }

  if (c.create_missing !== undefined && typeof c.create_missing !== 'boolean') {
    return { ok: false, erro: "'create_missing' must be a boolean" };
  }

  return {
    ok: true,
    mudanca: {
      add,
      remove,
      // Padrão `true`: o caso de uso é um fluxo externo etiquetando lead
      // novo, e exigir que a tag já exista faria a integração falhar na
      // primeira execução, quando ninguém está olhando.
      criarFaltantes: c.create_missing !== false,
    },
  };
}

export interface ResultadoDaMudanca {
  /** Nomes GRAVADOS das etiquetas que passaram a valer agora. */
  adicionadas: string[];
  /** Nomes gravados das que deixaram de valer agora. */
  removidas: string[];
  /** Nomes gravados das que já estavam no estado pedido — nada foi escrito. */
  inalteradas: string[];
  /** Nomes (como enviados) que não existem nesta conta e não foram criados. */
  desconhecidas: string[];
}

/**
 * Aplica a mudança. Faz I/O; a validação do corpo é o `lerMudancaDeTags`
 * acima.
 *
 * ⚠️⚠️ TUDO é conferido antes da primeira escrita: id desconhecido e a mesma
 * etiqueta nos dois lados viram `TagReferenceError` (400) sem ter tocado em
 * nada. Até 22/09/2026 a remoção vinha antes da resolução do `add`, e uma
 * recusa no meio teria deixado o contato meio mudado.
 *
 * Depois disso: cria os NOMES que faltam (catálogo), remove, acrescenta. Não
 * há sobreposição possível entre remover e acrescentar (conferida acima),
 * então a ordem não muda o resultado — mas tirar primeiro é o que deixa a
 * conta no estado pedido mesmo se algo estourar no meio.
 *
 * ⚠️ Os baldes levam o NOME GRAVADO da etiqueta (o de `GET /api/v1/tags`),
 * nunca o id cru nem a grafia enviada: quem mandou o id do "Typebot" lê
 * "Typebot" na resposta, e quem mandou "bancario" lê "Bancário". Só
 * `desconhecidas` ecoa o que veio — não há nome gravado para o que não
 * existe.
 */
export async function aplicarMudancaDeTags(
  db: SupabaseClient,
  args: {
    accountId: string;
    auditUserId: string;
    contactId: string;
    mudanca: MudancaDeTags;
  }
): Promise<ResultadoDaMudanca> {
  const { accountId, auditUserId, contactId, mudanca } = args;
  const r: ResultadoDaMudanca = {
    adicionadas: [],
    removidas: [],
    inalteradas: [],
    desconhecidas: [],
  };

  // O catálogo, pela MESMA leitura que a criação usa — paginada e ordenada.
  // Duas cópias divergiriam na primeira mudança, e a ordem é o que decide
  // quem vence uma colisão de chave.
  let catalogo: CatalogoDeTags;
  try {
    catalogo = await lerCatalogoDeTags(db, accountId);
  } catch {
    throw new ContactTagWriteError("Failed to read the account's tags");
  }

  const add = casarReferencias(mudanca.add, catalogo);
  const remove = casarReferencias(mudanca.remove, catalogo);

  // ── Conferir tudo, antes de escrever qualquer coisa ────────
  const idsDesconhecidos = [...remove.idsDesconhecidos, ...add.idsDesconhecidos];
  if (idsDesconhecidos.length > 0) {
    throw erroDeIdsDesconhecidos(idsDesconhecidos);
  }
  const idsEmAdd = new Set(
    add.itens.flatMap((i) => (i.id ? [i.id] : []))
  );
  const dosDois = remove.itens.filter((i) => i.id !== null && idsEmAdd.has(i.id));
  if (dosDois.length > 0) {
    throw new TagReferenceError(
      'bad_request',
      `the same tag cannot be in both 'add' and 'remove': ${dosDois
        .map((i) => i.nome)
        .join(', ')}`
    );
  }

  // Retirar NUNCA cria: criar uma etiqueta para em seguida tentar removê-la
  // do contato é trabalho para produzir um no-op, e deixaria lixo no
  // catálogo do escritório a cada nome digitado errado.
  r.desconhecidas.push(
    ...remove.itens.filter((i) => i.id === null).map((i) => i.pedido)
  );

  // ── Criar os NOMES que faltam (só em `add`) ───────────────
  let aAcrescentar = add.itens;
  const faltantes = add.itens.filter((i) => i.id === null);
  if (faltantes.length > 0) {
    if (mudanca.criarFaltantes) {
      // A criação — e a CONVERGÊNCIA — moram no helper compartilhado desde
      // a 983: ele insere com `ON CONFLICT DO NOTHING` sobre o índice único
      // `(account_id, name_key)` e relê, então duas requisições concorrentes
      // com o mesmo nome novo terminam no MESMO id. Só nomes chegam lá: os
      // ids foram separados em `casarReferencias`, e o helper ainda recusa
      // criar nome com cara de UUID (a segunda linha de defesa).
      const { tagIdByKey, nomePorId, skippedNames } = await resolveImportTagIds(
        db,
        {
          accountId,
          userId: auditUserId,
          tagNames: faltantes.map((i) => i.pedido),
          canCreateTags: true,
        }
      );
      aAcrescentar = add.itens.map((i) => {
        if (i.id) return i;
        const id = tagIdByKey.get(chaveDeTag(i.pedido)) ?? null;
        if (!id) return i;
        return { ...i, id, nome: nomePorId.get(id.toLowerCase()) || i.pedido };
      });
      // ⚠️ Nome que pediu criação e mesmo assim não resolveu precisa APARECER
      // na resposta. Sem isto ele não entrava em NENHUM dos quatro baldes: o
      // integrador recebia 200, via o nome ausente de `adicionadas`, de
      // `inalteradas` e de `desconhecidas`, e não tinha como saber que a
      // etiqueta não foi aplicada. (Achado da revisão adversarial.)
      r.desconhecidas.push(...skippedNames);
    } else {
      r.desconhecidas.push(...faltantes.map((i) => i.pedido));
    }
  }

  // ── Retirar ────────────────────────────────────────────────
  for (const item of remove.itens) {
    if (!item.id) continue; // já em `desconhecidas`
    const saiu = await removeContactTag(db, {
      accountId,
      contactId,
      tagId: item.id,
    });
    (saiu ? r.removidas : r.inalteradas).push(item.nome);
  }

  // ── Acrescentar ────────────────────────────────────────────
  // O conjunto repete a deduplicação por id DEPOIS da criação: dois nomes
  // novos só colapsam no mesmo id se uma requisição concorrente os tiver
  // unido, e aplicar a mesma etiqueta duas vezes apareceria duas vezes na
  // resposta.
  const aplicadas = new Set<string>();
  for (const item of aAcrescentar) {
    // Sem id: já contabilizado em `desconhecidas` — pelo ramo do
    // `create_missing: false` acima, ou pelo `skippedNames` da criação.
    if (!item.id || aplicadas.has(item.id)) continue;
    aplicadas.add(item.id);
    // `added: false` = o 23505 agiu: a etiqueta já estava aplicada. Não é
    // erro, e o helper garante que o gatilho `tag_added` NÃO dispara nesse
    // caso.
    const { added } = await addContactTagAndDispatch({
      db,
      accountId,
      contactId,
      tagId: item.id,
    });
    (added ? r.adicionadas : r.inalteradas).push(item.nome);
  }

  return r;
}

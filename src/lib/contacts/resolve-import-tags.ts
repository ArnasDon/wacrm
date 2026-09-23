import type { SupabaseClient } from '@supabase/supabase-js';

import { chaveDeTag } from './chave-de-tag';
import { pareceIdDeEtiqueta } from './id-de-etiqueta';

const DEFAULT_TAG_COLOR = '#3b82f6';

/** O catálogo de etiquetas da conta, pelas duas perguntas que se fazem a ele. */
export interface CatalogoDeTags {
  /** `chaveDeTag(nome)` → id. Na colisão de chave, a etiqueta MAIS ANTIGA. */
  porChave: Map<string, string>;
  /**
   * id (em minúsculas) → nome GRAVADO, para TODA etiqueta da conta — inclusive
   * a que perdeu a colisão de chave. É por aqui que se confere que um id
   * pedido pela API é DESTA conta, e é o nome que a API devolve no lugar do
   * id cru.
   */
  nomePorId: Map<string, string>;
}

export interface ResolveImportTagsResult {
  /**
   * `chaveDeTag(nome)` → id da etiqueta: o catálogo inteiro da conta, mais
   * uma entrada por texto PEDIDO com forma de UUID que é id de etiqueta desta
   * conta (a chave é o próprio texto, `chaveDeTag(uuid)`, e o valor é o id
   * dele). Quem consulta o mapa pelo que pediu — `assignImportedContactTags`
   * — acha a etiqueta certa nos dois casos.
   */
  tagIdByKey: Map<string, string>;
  /** id → nome gravado, lido do mesmo catálogo (depois da criação). */
  nomePorId: Map<string, string>;
  /** Names that could not be matched and were not created. */
  skippedNames: string[];
}

/** Quantas linhas por página. Abaixo do teto de 1000 do PostgREST. */
const TAGS_POR_PAGINA = 500;

/**
 * O catálogo de etiquetas da conta, por chave de nome e por id.
 *
 * ⚠️ PAGINADO, e não é zelo prematuro: o PostgREST corta em 1000 linhas SEM
 * avisar, e este mapa é quem responde "esta etiqueta já existe?". Truncado,
 * ele diz "não existe" sobre etiqueta que existe — e daí sai criação
 * recusada pelo índice (23505 na cara do integrador) ou, no `remove`, um
 * "desconhecida" sobre etiqueta que está lá. É a mesma armadilha que a busca
 * de conversas (929) e o funil comercial já documentam. Vale igual para o
 * `nomePorId`: truncado, um id legítimo seria recusado como "não é desta
 * conta".
 *
 * ⚠️ Ordenado por `created_at, id`: na colisão de chave vence a MAIS ANTIGA,
 * a que o escritório vem usando. A ordem também é o que torna a paginação
 * estável — sem ela, duas páginas podem repetir ou pular linha.
 */
export async function lerCatalogoDeTags(
  supabase: SupabaseClient,
  accountId: string
): Promise<CatalogoDeTags> {
  const porChave = new Map<string, string>();
  const nomePorId = new Map<string, string>();
  for (let pagina = 0; ; pagina++) {
    const de = pagina * TAGS_POR_PAGINA;
    const { data, error } = await supabase
      .from('tags')
      .select('id, name')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(de, de + TAGS_POR_PAGINA - 1);
    if (error) throw error;

    for (const tag of data ?? []) {
      const id = tag.id as string;
      const nome = tag.name as string;
      // O Postgres devolve o uuid em minúsculas; quem compara um id PEDIDO
      // contra este mapa rebaixa a caixa do pedido antes (o integrador pode
      // mandar em maiúsculas, e o formato aceita).
      nomePorId.set(id.toLowerCase(), nome);
      const chave = chaveDeTag(nome);
      if (!porChave.has(chave)) porChave.set(chave, id);
    }
    if (!data || data.length < TAGS_POR_PAGINA) return { porChave, nomePorId };
  }
}

/**
 * Resolve nomes de etiqueta para ids. Usado pelas TRÊS portas que criam
 * etiqueta: o import de CSV, o `PATCH /api/v1/contacts/{id}` (substitutivo)
 * e o `POST /api/v1/contacts/{id}/tags` (aditivo). Nome que não existe é
 * criado quando `canCreateTags` é true (admin+); senão volta em
 * `skippedNames`.
 *
 * ⚠️ O casamento é por `chaveDeTag` — sem acento, além de sem caixa. Até a
 * migration 983 era só `toLowerCase()`, e a divergência entre as portas era
 * real: a API aditiva casava sem acento e esta função casava com, então
 * "bancario" num catálogo que tinha "Bancário" criava uma SEGUNDA etiqueta.
 * Hoje a régua é uma só nas três portas E no banco (a coluna gerada
 * `tags.name_key`).
 *
 * ⚠️ A criação é `upsert` com `ON CONFLICT DO NOTHING` sobre o índice único
 * `(account_id, name_key)`, seguida de RELEITURA — nunca ler-então-inserir.
 * Duas requisições concorrentes com o mesmo nome NOVO passavam as duas pela
 * leitura e inseriam as duas; pior, cada uma aplicava a SUA ao contato e o
 * gatilho `tag_added` disparava DUAS vezes, o que numa automação sem
 * etiqueta específica é a mensagem saindo em dobro para o cliente. Com o
 * índice, a segunda inserção não acontece; com a releitura, as duas
 * requisições convergem no MESMO id. (Achado do Codex no PR #150.)
 *
 * ⚠️⚠️ NUNCA cria etiqueta cujo nome tem o formato de UUID — ele volta em
 * `skippedNames`, mesmo com `canCreateTags`. Caso de produção (22/09/2026): um
 * integrador mandou o ID da etiqueta "Typebot" onde a API esperava o nome, e
 * esta função criou uma etiqueta NOVA chamada "32f2da4f-…", que foi aplicada
 * ao contato e disparou `tag_added`. As portas da API hoje separam id de nome
 * ANTES de chegar aqui (`casarReferencias`, em `api/v1/tags-do-contato.ts`), e
 * nunca mandam um id; esta recusa é a segunda linha, para qualquer chamador
 * — o import de CSV inclusive, cuja coluna de etiquetas pode vir de uma
 * planilha exportada com ids. Um nome com cara de UUID que JÁ existe no
 * catálogo continua casando (é a etiqueta que alguém criou à mão, e o import
 * não tem por que recusá-la); só a CRIAÇÃO é barrada.
 *
 * ⚠️⚠️ E o texto com forma de UUID que é o ID de uma etiqueta DESTA conta
 * resolve para ESSA etiqueta — a régua da API (`pareceIdDeEtiqueta`, lida
 * antes de qualquer nome). Sem isto, a planilha exportada com ids pulava a
 * etiqueta em silêncio no import de CSV, enquanto a mesma coluna mandada à
 * API a aplicava. ⚠️ O id VENCE o nome: o caso de 22/09 deixou no catálogo
 * uma etiqueta CHAMADA "32f2da4f-…", que é o id da "Typebot". Pelo nome, o
 * texto casaria com a etiqueta-lixo; pelo id, com a "Typebot", que é o que
 * quem escreveu o id queria (e o que a API faz com o mesmo texto). A queda
 * para o nome só vale quando o texto não é id de etiqueta nenhuma — e aí a
 * API, que não tem a queda, recusaria com `unknown_tag_ids`: é a única
 * divergência entre as portas, de propósito (o import não recusa o que já
 * existe no catálogo; ver o parágrafo acima).
 */
export async function resolveImportTagIds(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    userId: string;
    tagNames: string[];
    canCreateTags: boolean;
    defaultColor?: string;
  }
): Promise<ResolveImportTagsResult> {
  const { accountId, userId, tagNames, canCreateTags } = params;
  const defaultColor = params.defaultColor ?? DEFAULT_TAG_COLOR;

  const uniqueNames: string[] = [];
  const seen = new Set<string>();
  for (const raw of tagNames) {
    const name = raw.trim();
    if (!name) continue;
    // Mesma chave da resolução: "Bancário" e "bancario" na mesma lista
    // resolvem para a MESMA etiqueta, e sobreviverem como dois nomes faria a
    // segunda passagem parecer uma atribuição a mais.
    const key = chaveDeTag(name);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueNames.push(name);
  }

  if (uniqueNames.length === 0) {
    return { tagIdByKey: new Map(), nomePorId: new Map(), skippedNames: [] };
  }

  // ⚠️ ORDENADO: quando duas etiquetas colapsam na mesma chave — possível em
  // base anterior à 983, que RENOMEIA em vez de apagar —, vence a MAIS
  // ANTIGA. É a mesma régua do desempate da migration e da leitura de
  // catálogo da API aditiva. Sem o ORDER BY o PostgREST devolve em ordem não
  // determinística e duas chamadas iguais escolheriam etiquetas diferentes.
  let catalogo = await lerCatalogoDeTags(supabase, accountId);

  const skippedNames: string[] = [];
  const toCreate: string[] = [];
  // Textos com forma de UUID que são id de etiqueta da conta. Resolvidos pelo
  // id, nunca pelo nome — e fora da criação, que só conhece nome.
  const pedidosPorId: string[] = [];

  for (const name of uniqueNames) {
    if (pareceIdDeEtiqueta(name) && catalogo.nomePorId.has(name.toLowerCase())) {
      pedidosPorId.push(name);
      continue;
    }
    if (catalogo.porChave.has(chaveDeTag(name))) continue;
    // A recusa do nome-UUID vem ANTES de `canCreateTags`: sem permissão ele
    // já cairia aqui, e com permissão é justamente o caso de 22/09.
    if (canCreateTags && !pareceIdDeEtiqueta(name)) toCreate.push(name);
    else skippedNames.push(name);
  }

  if (toCreate.length > 0) {
    // `ignoreDuplicates` devolve SÓ as linhas realmente inseridas — quem
    // perdeu a corrida não volta aqui. Por isso o id sai da releitura
    // abaixo, e não do retorno: é ela que faz as duas requisições
    // convergirem no mesmo id.
    const { error: createError } = await supabase
      .from('tags')
      .upsert(
        // ⚠️ ORDENADO, e não é estética: com o índice único da 983/984, o
        // `ON CONFLICT DO NOTHING` passou a ESPERAR a transação concorrente
        // que já inseriu a chave conflitante. Duas requisições mandando as
        // MESMAS etiquetas novas em ordens diferentes fecham um ciclo de
        // espera e o Postgres aborta uma com 40P01. Antes da 983 não havia
        // índice, logo não havia espera nem ciclo — é regressão daquele PR.
        // Reproduzido pela revisão num Postgres real, e o controle com a
        // mesma ordem nos dois lados NÃO deadlocka: ordenar elimina a classe
        // inteira, porque todo mundo trava na mesma sequência.
        [...toCreate]
          .sort((a, b) => (chaveDeTag(a) < chaveDeTag(b) ? -1 : 1))
          .map((name) => ({
          user_id: userId,
          account_id: accountId,
          name,
          color: defaultColor,
        })),
        { onConflict: 'account_id,name_key', ignoreDuplicates: true }
      )
      .select('id');

    if (createError) throw createError;

    catalogo = await lerCatalogoDeTags(supabase, accountId);

    // Sobrou nome que nem existia nem foi criado? Reportar como pulado é
    // melhor que devolver um mapa incompleto em silêncio, que faria o
    // chamador atribuir menos etiquetas do que pediu e não perceber.
    //
    // ⚠️ NÃO é o caso de RLS. Uma versão anterior deste comentário dizia que
    // "inserção barrada por RLS devolve 0 linhas sem erro" — isso vale para
    // UPDATE e DELETE (a cláusula USING filtra as linhas), mas INSERT é
    // diferente: o WITH CHECK ESTOURA. Medido em 2026-09-09 com
    // `SET ROLE authenticated`: SQLSTATE 42501, "new row violates row-level
    // security policy for table \"tags\"". Esse caminho sai pelo `throw
    // createError` acima.
    //
    // O que sobra aqui é a releitura não enxergar o que acabou de ser
    // escrito — atraso de réplica, ou alguém apagando a etiqueta entre as
    // duas chamadas. Raro, e é justamente por ser raro que precisa aparecer
    // em vez de sumir.
    for (const name of toCreate) {
      if (!catalogo.porChave.has(chaveDeTag(name))) skippedNames.push(name);
    }
  }

  // O mapa devolvido é uma CÓPIA do catálogo, e é nela que o id pedido entra
  // — sobrescrevendo, na mesma chave, a etiqueta cujo NOME é aquele UUID (o
  // id vence o nome, ver acima). Mexer no `porChave` em si trocaria o que a
  // estrutura promete ("chave do NOME → id"). Sem id pedido, o catálogo sai
  // como veio: as portas da API nunca mandam um.
  let tagIdByKey = catalogo.porChave;
  if (pedidosPorId.length > 0) {
    tagIdByKey = new Map(catalogo.porChave);
    for (const name of pedidosPorId) {
      const id = name.toLowerCase();
      // Conferido de novo contra o catálogo FINAL: se houve criação, ele foi
      // relido, e a etiqueta pode ter sido apagada entre as duas leituras.
      // Aí o texto é pulado — nunca aplicado a um id que não existe mais.
      if (catalogo.nomePorId.has(id)) tagIdByKey.set(chaveDeTag(name), id);
      else skippedNames.push(name);
    }
  }

  return {
    tagIdByKey,
    nomePorId: catalogo.nomePorId,
    skippedNames,
  };
}

export interface ContactTagAssignment {
  contactId: string;
  tagNames: string[];
}

/**
 * Insert contact_tags rows for imported contacts (ignores duplicates).
 *
 * Returns the number of contact–tag pairs *requested* for upsert, not
 * rows actually inserted — `ignoreDuplicates` can drop pairs that already
 * exist without changing the returned count.
 */
export async function assignImportedContactTags(
  supabase: SupabaseClient,
  assignments: ContactTagAssignment[],
  tagIdByKey: Map<string, string>
): Promise<number> {
  const rows: { contact_id: string; tag_id: string }[] = [];

  for (const { contactId, tagNames } of assignments) {
    const assignedTagIds = new Set<string>();
    for (const name of tagNames) {
      const tagId = tagIdByKey.get(chaveDeTag(name));
      if (!tagId || assignedTagIds.has(tagId)) continue;
      assignedTagIds.add(tagId);
      rows.push({ contact_id: contactId, tag_id: tagId });
    }
  }

  if (rows.length === 0) return 0;

  const chunkSize = 100;
  let assigned = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from('contact_tags').upsert(chunk, {
      onConflict: 'contact_id,tag_id',
      ignoreDuplicates: true,
    });
    if (error) throw error;
    assigned += chunk.length;
  }

  return assigned;
}

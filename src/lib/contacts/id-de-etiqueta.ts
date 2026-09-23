// ============================================================
// Quando o texto que chega no lugar de uma etiqueta é um ID, e não um nome.
//
// A régua é UMA, e é de forma: texto com o formato de UUID é ID de etiqueta;
// qualquer outro texto é NOME (casado por `chaveDeTag`). Não há terceira via
// ("tenta como nome, senão como id") de propósito: a resposta dependeria do
// que existe no catálogo naquele instante, e o mesmo corpo mudaria de
// sentido quando alguém criasse ou apagasse uma etiqueta.
//
// Nasceu de um caso de produção (22/09/2026): um integrador pegou o id da
// etiqueta "Typebot" em `GET /api/v1/tags` e o mandou onde a API esperava o
// NOME. A API criou uma etiqueta NOVA chamada "32f2da4f-…", aplicou-a ao
// contato e disparou o gatilho `tag_added` — com 200 na resposta. No `PATCH`
// substitutivo era pior: o id não casava com a etiqueta real, e a real ia
// para a lista de REMOÇÃO.
//
// ⚠️ Só a forma canônica (hifenizada, a que `GET /api/v1/tags` devolve e a
// que o banco guarda). O Postgres aceita outras grafias de uuid (sem hífen,
// entre chaves); aqui elas continuam sendo nome. Quem copia o id da resposta
// da API copia a forma canônica, e aceitar as outras exigiria normalizá-las
// antes de comparar com o catálogo — trabalho para entrada que ninguém manda.
//
// Puro e sem dependência: é importado também pelo import de CSV, que roda
// no navegador (`resolveImportTagIds`).
// ============================================================

/** A forma canônica de um uuid — o que `tags.id` guarda. */
const FORMATO_DE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O texto (aparado) tem a forma de um id de etiqueta?
 *
 * ⚠️ Não diz se a etiqueta EXISTE — só como o texto deve ser lido. Um id que
 * não é de etiqueta nenhuma desta conta continua sendo id (e é recusado por
 * quem resolve), nunca vira nome a criar.
 */
export function pareceIdDeEtiqueta(texto: string): boolean {
  return FORMATO_DE_UUID.test(texto.trim());
}

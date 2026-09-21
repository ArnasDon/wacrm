// ============================================================
// Quem é a PESSOA na carga da Kommo, e se ela já existe aqui.
//
// ⚠️⚠️ É aqui que mora o defeito mais caro da migração, e ele é SILENCIOSO.
// A régua é a do NONO DÍGITO (`variantesDoNonoDigito`), nunca igualdade de
// `phone_normalized`. MEDIDO em 21/09/2026 rodando ESTE módulo sobre os
// 13.046 telefones distintos da Kommo: **821** casam com uma ficha daqui por
// igualdade e **outros 336** só pela variante — `553172090560` na Kommo é
// `5531972090560` aqui, a MESMA pessoa. Uma carga que resolva por igualdade
// cria 336 fichas novas para clientes que já estão no CRM, com o histórico
// repartido entre as duas, e o índice único da 022 não impede nada: são
// chaves diferentes.
//
// A conta fecha: 1.157 existem + 11.888 a criar + 1 a pular = 13.046.
//
// ⚠️ Quantas se perdem depende do que se chame de "igualdade", e as duas
// contas foram medidas: quem compara o telefone CRU da Kommo contra
// `phone_normalized` perde **336**; quem normaliza por `digitosDoTelefone` e
// então compara por igualdade perde **333** (os 3 de diferença são números
// escritos sem DDI, que casam só depois do `55`). O que não muda é o total:
// **1.157 já existem aqui**.
//
// ⚠️ Uma primeira estimativa feita à mão, só com `replace(/\D/g,'')` e sem o
// helper da casa, dizia 320 e "~1.150" — errava por não acrescentar o DDI.
// Usar `digitosDoTelefone`, e não uma régua própria, é o que faz a carga
// concordar com a ingestão.
//
// ⚠️ E NÃO é a régua dos ÚLTIMOS 8 DÍGITOS do `phonesMatch`. Medido no
// levantamento: por ela, 14 sufixos teriam mais de uma pessoa, 13 com DDD ou
// DDI diferente — a mensagem do cliente da Paraíba cairia na ficha do cliente
// de São Paulo. A tolerância do nono dígito é a certa: ela reconhece as duas
// GRAFIAS do mesmo número, não dois números parecidos.
// ============================================================

import { digitosDoTelefone, variantesDoNonoDigito } from "@/lib/contacts/telefone";

/**
 * A ÁREA reparte os cards: "um card por pessoa e por área" (decisão C).
 * Os dois funis do Trabalhista são a mesma área; os dois do Bancário também.
 */
export type AreaDaCarga = "trabalhista" | "bancario";

export interface PessoaDaKommo {
  /** Só dígitos, com DDI — o que `digitosDoTelefone` produz. */
  telefone: string;
  /** As grafias que significam esta mesma pessoa. */
  grafias: readonly string[];
}

/**
 * A pessoa por trás de um telefone escrito de qualquer jeito, ou `null`
 * quando não há telefone aproveitável.
 *
 * ⚠️ `null` NÃO é "pessoa nova": é "não dá para saber". A regra 18b manda
 * PULAR o lead — card com `contact_id` nulo é desenhado em branco no Kanban.
 * Medido: 32 leads da Kommo caem aqui (16 sem contato, 16 sem telefone).
 */
export function pessoaDoTelefone(texto: string | null | undefined): PessoaDaKommo | null {
  const digitos = digitosDoTelefone(texto ?? "");
  if (!digitos) return null;
  // ⚠️⚠️ O PISO DA CARGA É 10 DÍGITOS, e não os 8 de `digitosDoTelefone`
  // (Codex, PR #232). Aquele helper aceita 8–15 porque também serve a quem
  // digita um número sem DDD; a carga não. A função no banco
  // (`cb_kommo_carregar_pessoas`) confere `^[0-9]{10,15}$` na conferência de
  // forma — e um único telefone de 8 ou 9 dígitos classificado como "criar"
  // derrubava o LOTE INTEIRO, em vez de pular aquele lead com o motivo. O
  // `carga.py` já barrava (<10 = pular), então a carga de 21/09 não tropeçou;
  // o que se fecha aqui é a divergência no módulo que É a regra.
  if (digitos.length < MINIMO_DE_DIGITOS_DA_CARGA) return null;
  return { telefone: digitos, grafias: variantesDoNonoDigito(digitos) };
}

/** DDI + DDD + número: o mínimo que identifica uma pessoa sem adivinhar. */
export const MINIMO_DE_DIGITOS_DA_CARGA = 10;

/**
 * O índice das fichas que JÁ existem aqui, chaveado por TODAS as grafias.
 *
 * ⚠️ Indexar pelas grafias (e não só pelo número gravado) é o que faz a
 * consulta ser O(1) e, principalmente, é o que torna o acerto INDEPENDENTE de
 * qual das duas grafias cada lado guardou. Indexando só pelo gravado, a carga
 * teria de lembrar de expandir do OUTRO lado — e é exatamente esse "lembrar"
 * que produz os 336.
 */
export function indexarFichasExistentes(
  fichas: readonly { id: string; phone_normalized: string | null }[],
): Map<string, string> {
  const indice = new Map<string, string>();
  for (const ficha of fichas) {
    if (!ficha.phone_normalized) continue;
    for (const grafia of variantesDoNonoDigito(ficha.phone_normalized)) {
      // ⚠️ A PRIMEIRA vence, e a ordem é do chamador: ele entrega as fichas
      // por `created_at` crescente, porque a mais ANTIGA é a que o escritório
      // vem usando (a mesma régua do desempate do catálogo de etiquetas e do
      // `findExistingContact`). Sobrescrever aqui trocaria a ficha boa pela
      // recém-criada num empate.
      if (!indice.has(grafia)) indice.set(grafia, ficha.id);
    }
  }
  return indice;
}

/** O que a carga descobriu sobre uma pessoa da Kommo. */
export type Resolucao =
  | { tipo: "existe"; contactId: string; telefone: string }
  | { tipo: "criar"; telefone: string }
  | { tipo: "pular"; motivo: "sem_telefone" };

/**
 * ⚠️ Devolve `pular` — e não "criar com o telefone vazio" — porque criar é
 * irreversível na prática: a ficha entra na base do escritório, aparece em
 * "todos os contatos" do disparo, e não há como distingui-la de um cliente de
 * verdade depois.
 */
export function resolverPessoa(
  telefoneDaKommo: string | null | undefined,
  fichasAqui: Map<string, string>,
): Resolucao {
  const pessoa = pessoaDoTelefone(telefoneDaKommo);
  if (!pessoa) return { tipo: "pular", motivo: "sem_telefone" };

  for (const grafia of pessoa.grafias) {
    const id = fichasAqui.get(grafia);
    if (id) return { tipo: "existe", contactId: id, telefone: pessoa.telefone };
  }
  return { tipo: "criar", telefone: pessoa.telefone };
}

/**
 * A chave que reparte os cards. Duas pessoas distintas nunca colidem; a mesma
 * pessoa nas duas grafias sempre colide.
 *
 * ⚠️ A grafia escolhida é a PRIMEIRA de `variantesDoNonoDigito`, que é sempre
 * o número como veio — e não a "canônica com 9". Não importa qual seja, desde
 * que seja a MESMA para as duas grafias; o que importa é ser estável, e
 * ordenar as grafias garante isso mesmo se a função mudar de ordem um dia.
 */
export function chaveDoCard(telefone: string, area: AreaDaCarga): string {
  const grafias = [...variantesDoNonoDigito(telefone)].sort();
  return `${grafias[0]}:${area}`;
}

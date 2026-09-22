import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone, phonesMatch } from "@/lib/whatsapp/phone-utils";
import { telefoneCanonico } from "@/lib/contacts/telefone";

/**
 * Contact de-duplication helpers, shared by the WhatsApp webhook, the
 * manual contact form, and CSV import so all paths agree on what
 * "same number" means (issue #212).
 *
 * The canonical key is `normalizePhone` (digits-only) — the same form
 * the DB stores in the generated `contacts.phone_normalized` column
 * and enforces unique per account. `phonesMatch` adds trunk-prefix
 * tolerance (last-8-digit match) for the softer "possible duplicate"
 * surfaces.
 */

/** Canonical de-dup key for a phone string (digits only). */
export function normalizeKey(phone: string): string {
  return normalizePhone(phone);
}

/**
 * A chave de "MESMA PESSOA": a grafia canônica do nono dígito
 * (`telefoneCanonico`), que é a chave ÚNICA de `contacts` desde a 1024.
 * `normalizeKey` responde "mesma GRAFIA"; esta responde "o banco vai recusar
 * a segunda ficha". Deduplicar um lote por `normalizeKey` deixava passar as
 * duas grafias do mesmo celular — e, com o índice canônico, o INSERT do lote
 * inteiro levava 23505.
 */
export function chaveDePessoa(phone: string): string {
  return telefoneCanonico(phone);
}

/** Minimal shape we need back from a contacts lookup. */
export interface ExistingContact {
  id: string;
  phone: string;
  name?: string | null;
  [key: string]: unknown;
}

/** Resultado da busca: distingue "não achei" de "não consegui procurar". */
export interface BuscaDeContato {
  /** O contato encontrado, ou null quando NÃO HÁ contato com esse número. */
  contato: ExistingContact | null;
  /**
   * ⚠️ `true` = a CONSULTA falhou — "não sei", nunca "não achei". Colapsar
   * os dois em null era o que duplicava a ficha do cliente num blip de banco
   * (achado #04 do plano de 31/08). Quem chama decide:
   * — caminho de GENTE (abrir conversa, API v1, envio por telefone) responde
   *   erro 500 e deixa tentar de novo;
   * — a INGESTÃO (webhook Meta, Evolution) segue em frente com o `contato`
   *   nulo, de propósito: derrubá-la perderia a mensagem do cliente. Desde a
   *   1024 o índice CANÔNICO barra a ficha duplicada (inclusive a irmã do
   *   nono dígito) e o 23505 cai em `fichaQueVenceu`, que relê a vencedora.
   */
  falhou: boolean;
}

/**
 * Find an existing contact in `accountId` whose phone matches `phone`.
 * Pre-filters in SQL by the last-8-digit suffix (so we don't
 * pull every contact), then applies the strict `phonesMatch` in JS on
 * the small candidate set — the exact approach the webhook has used.
 *
 * ⚠️⚠️ **São DUAS passadas, e a ordem entre elas É o conserto: o casamento
 * EXATO vem ANTES do tolerante.** `phonesMatch` casa pelos ÚLTIMOS 8
 * DÍGITOS, então duas fichas de números DIFERENTES que terminam igual
 * casam as duas — e numa passada só a escolhida era a que o heap
 * entregasse primeiro. Medido na carga da Kommo: 4 pares assim, um deles
 * DDD 82 contra DDD 15, que são duas PESSOAS. A mensagem do cliente da
 * Paraíba ia para a conversa do cliente de São Paulo, e a escolha podia
 * INVERTER de um dia para o outro — qualquer UPDATE numa das linhas (a
 * carga grava `nome_fixado_em`; `avatar_checked_at` é recarimbado a cada
 * 30 dias) move a tupla no heap e troca a ordem do seq scan. Onde não há
 * colisão as duas passadas devolvem o MESMO candidato: o comportamento só
 * muda onde já estava errado. Exato há no máximo um — o índice único
 * `(account_id, phone_normalized)` da 022 não deixa existirem dois.
 *
 * ⚠️⚠️ **E a IRMÃ DO NONO DÍGITO vem antes do tolerante** (1024): mesma
 * grafia canônica = a MESMA pessoa, e é exatamente a ficha que o índice único
 * aponta como dona do número. Sem essa passada, a tolerante devolvia a ficha
 * MAIS ANTIGA com os mesmos 8 finais — que pode ser a de outro DDD, outra
 * pessoa — e a releitura depois de um 23505 entregava a mensagem na conversa
 * errada.
 *
 * ⚠️⚠️ **O LIKE é sobre `phone_normalized` (só dígitos), nunca sobre
 * `phone`** (1024). Sobre o texto cru, uma ficha gravada com separador
 * ("+55 83 98000-0016", do formulário ou de um CSV) não casava
 * `%80000016`: a busca não a achava, o INSERT levava 23505, a RELEITURA
 * falhava do mesmo jeito e a ingestão descartava a mensagem do cliente —
 * todas as dele, para sempre (a regra 18 do plano da Kommo). Os 8 finais
 * são os mesmos nas duas grafias do nono dígito (o 9 fica ANTES deles),
 * então a irmã sempre volta no mesmo lote de candidatos.
 *
 * ⚠️⚠️ **Mas a passada TOLERANTE não ganhou candidatos novos** (revisão
 * adversarial da 1024). Com o LIKE sobre os dígitos, a ficha de OUTRA pessoa
 * gravada com separador ("+55 15 98000-0016", outro DDD, mesmo final) passou
 * a voltar como candidata — e o casamento pelos 8 finais a entregaria à
 * mensagem de "5582980000016". Sobre o texto cru ela nem aparecia. Por isso
 * a tolerante só aceita a candidata que o LIKE antigo já traria (o texto
 * cru termina nos 8 dígitos) ou cujo prefixo é COMPATÍVEL (`prefixoCompativel`:
 * o mesmo, ou com um 0 de tronco a mais). Nada que casava antes
 * deixa de casar; o que é novo só entra se for o mesmo número.
 *
 * ⚠️ **O `order` é a outra metade**, para o caso fuzzy-PURO — o nono dígito
 * brasileiro, em que nenhum candidato é exato — também ser estável; sem ele
 * a resposta continuaria saindo da ordem física da tabela. `created_at`
 * primeiro porque a ficha MAIS ANTIGA é a que o escritório vem usando (a
 * mesma régua do catálogo de etiquetas), e `id` como desempate porque
 * `contacts.created_at` é NULLABLE (001) e empate é exatamente onde a ordem
 * volta a ser a do heap. ⚠️ Ele vem ANTES do `.like` de propósito: para o
 * PostgREST os dois são só parâmetros da mesma query e a posição não muda
 * nada, mas os dublês dos testes de outros módulos terminam a cadeia no
 * `.like` — pôr o `order` depois dele quebra aqueles testes sem quebrar
 * nada aqui.
 */
export async function findExistingContact(
  db: SupabaseClient,
  accountId: string,
  phone: string,
): Promise<BuscaDeContato> {
  const normalized = normalizePhone(phone);
  if (!normalized) return { contato: null, falhou: false };

  const suffix = normalized.length >= 8 ? normalized.slice(-8) : normalized;

  const { data, error } = await db
    .from("contacts")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true })
    .like("phone_normalized", `%${suffix}`);

  if (error || !data) return { contato: null, falhou: true };

  const candidatos = data as ExistingContact[];
  const canonica = chaveDePessoa(phone);

  return {
    contato:
      candidatos.find((c) => isExactMatch(c, phone)) ??
      candidatos.find((c) => chaveDePessoa(c.phone ?? "") === canonica) ??
      candidatos.find(
        (c) =>
          phonesMatch(c.phone ?? "", phone) &&
          ((c.phone ?? "").endsWith(suffix) || prefixoCompativel(c.phone ?? "", phone)),
      ) ??
      null,
    falhou: false,
  };
}

/**
 * O que vem ANTES dos 8 finais é o mesmo, com no máximo um 0 de TRONCO a mais
 * ("370" ~ "3700")? Prefixo vazio (número digitado curto) vale como curinga —
 * é o que o LIKE de sufixo sempre fez.
 *
 * ⚠️ O prefixo sai da grafia CANÔNICA, e nenhum 9 é descontado aqui (Codex,
 * PR #240): o nono dígito só existe no celular brasileiro, e `telefoneCanonico`
 * já o resolve pela regra inteira do número. Descontar um 9 final de qualquer
 * prefixo casava "+49 9 1234-5678" com "4912345678" — dois números alemães
 * diferentes. E o 0 de tronco só conta quando é o ÚNICO dígito a mais: por
 * regex, iria junto o 0 que é do código do país ("370" viraria "37").
 */
function prefixoCompativel(a: string, b: string): boolean {
  const prefixo = (t: string) => telefoneCanonico(t).slice(0, -8);
  const pa = prefixo(a);
  const pb = prefixo(b);
  return pa === "" || pb === "" || pa === pb || pa === `${pb}0` || pb === `${pa}0`;
}

/** Esperas entre as releituras de `fichaQueVenceu` (ms). */
export const ESPERAS_DA_RELEITURA_MS = [250, 750] as const;

/**
 * A ficha que VENCEU a corrida, depois de um INSERT em `contacts` levar
 * 23505. É o que todo escritor de ficha no servidor chama nesse ramo (há
 * teste estrutural cobrando).
 *
 * O 23505 só sai depois que a transação concorrente CONFIRMOU a ficha dela
 * (se ainda estivesse aberta, o INSERT teria esperado), então a vencedora já
 * está visível: `findExistingContact` a acha pela grafia exata ou pela irmã
 * do nono dígito. O que pode faltar é a LEITURA — um soluço do banco no
 * instante da releitura. Por isso a consulta que FALHA é repetida (até três
 * vezes, com as esperas acima); "não achei" com a consulta respondida não é
 * repetido, porque repetir não muda a resposta.
 *
 * Na ingestão isto é a diferença entre gravar a mensagem do cliente na ficha
 * dele e descartá-la: o provedor já recebeu 200 e não reenvia.
 */
export async function fichaQueVenceu(
  db: SupabaseClient,
  accountId: string,
  phone: string,
  esperar: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<BuscaDeContato> {
  let busca = await findExistingContact(db, accountId, phone);
  for (const ms of ESPERAS_DA_RELEITURA_MS) {
    if (!busca.falhou) return busca;
    await esperar(ms);
    busca = await findExistingContact(db, accountId, phone);
  }
  return busca;
}

/**
 * True when an existing contact is an *exact* normalized match for
 * `phone` (vs only a fuzzy trunk-variant match). The form hard-blocks
 * exact matches but only warns on fuzzy ones.
 */
export function isExactMatch(existing: ExistingContact, phone: string): boolean {
  return normalizeKey(existing.phone) === normalizeKey(phone);
}

/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505).
 * Used as the backstop when the DB unique index rejects a racing or
 * format-equal insert that slipped past the in-app check.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: string }).code === "23505";
}

/**
 * De-duplicate parsed CSV rows by PERSON (`chaveDePessoa`, a grafia canônica
 * do nono dígito), keeping the first occurrence of each. Rows with an empty
 * normalized phone are dropped (they can't be a valid contact). Returns the
 * unique rows plus the count removed as in-file duplicates.
 *
 * ⚠️ Por pessoa, não por grafia (1024): o mesmo celular escrito com e sem o 9
 * no mesmo arquivo passava pelo dedupe e caía no mesmo lote de INSERT — e,
 * com o índice canônico, o lote inteiro levava 23505.
 */
export function dedupeByPhone<T extends { phone: string }>(
  rows: T[],
): { unique: T[]; duplicates: number } {
  const seen = new Set<string>();
  const unique: T[] = [];
  let duplicates = 0;

  for (const row of rows) {
    const key = chaveDePessoa(row.phone);
    if (!key) {
      duplicates++;
      continue;
    }
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    unique.push(row);
  }

  return { unique, duplicates };
}

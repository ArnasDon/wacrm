/**
 * Nome APROXIMADO — puro. Duas perguntas, e nenhuma delas liga ninguém:
 *
 * 1. `sugerirPorNome`: para o cliente do Asaas SEM telefone nenhum (85 na
 *    conta em 12/09/2026), quais fichas do CRM PARECEM ser ele? É a única
 *    régua que alcança quem não tem telefone nem e-mail — e é a mais frouxa
 *    de todas: push name do WhatsApp contra nome legal, com 203 das 705
 *    fichas tendo o NÚMERO como nome. Por isso só SUGERE, com pontuação, e
 *    uma pessoa confirma (D5). Nunca devolve "liga".
 * 2. `nomesIncompativeis`: o sinal NEGATIVO da cerca do vínculo por telefone
 *    (§3.3): o telefone do cliente do Asaas pode ser o de OUTRA pessoa — a
 *    esposa que paga a conta do marido, o celular do escritório preenchido
 *    na recepção. Ficha com nome de gente (2+ tokens, não numérico) que não
 *    compartilha NENHUM token com o nome do Asaas vai para "Para confirmar"
 *    em vez de ligar. Não vale para ficha de nome numérico nem de um token
 *    ("Leo"), onde o nome não informa nada.
 *
 * A normalização: NFD, sem acento (`\p{Mn}`, nunca `\p{Diacritic}` — a
 * lição de `chaveDeTag`), minúsculas, sem pontuação, sem as partículas
 * (`de da do dos das e`), e token de UMA letra fora (inicial abreviada).
 */

const PARTICULAS = new Set(["de", "da", "do", "dos", "das", "e", "di", "du", "del", "della", "van", "von", "la", "le"]);

/** "5583980000016", "+55 (83) 9…" — nome que é só número/pontuação. */
export function ehNomeNumerico(nome: string | null | undefined): boolean {
  const aparado = (nome ?? "").trim();
  return aparado !== "" && !/\p{L}/u.test(aparado);
}

export function tokensDoNome(nome: string | null | undefined): string[] {
  return (nome ?? "")
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !PARTICULAS.has(t));
}

export interface Semelhanca {
  /** parece a mesma pessoa? (primeiro token igual E 2+ em comum, ou o mais curto contido no mais longo) */
  candidato: boolean;
  /** tokens em comum ÷ tokens do nome menor — 1 = o menor está inteiro no maior */
  pontuacao: number;
  emComum: number;
}

export function compararNomes(a: string | null | undefined, b: string | null | undefined): Semelhanca {
  const ta = tokensDoNome(a);
  const tb = tokensDoNome(b);
  // Nome de um token só nunca casa: "Maria" é meio escritório.
  if (ta.length < 2 || tb.length < 2) return { candidato: false, pontuacao: 0, emComum: 0 };
  const setB = new Set(tb);
  const emComum = new Set(ta.filter((t) => setB.has(t))).size;
  const menor = Math.min(new Set(ta).size, new Set(tb).size);
  const pontuacao = menor === 0 ? 0 : Math.round((emComum / menor) * 100) / 100;
  const primeiroIgual = ta[0] === tb[0];
  const contido = emComum === menor;
  return { candidato: (primeiroIgual && emComum >= 2) || contido, pontuacao, emComum };
}

export interface SugestaoPorNome {
  contactId: string;
  pontuacao: number;
}

/** Teto de sugestões por cliente — mais que isso é lista, não sugestão. */
export const SUGESTOES_MAX = 3;

/**
 * As fichas que PARECEM ser o cliente do Asaas, melhores primeiro. Fichas
 * de nome numérico ficam fora; nome de um token nunca casa (dos dois lados).
 */
export function sugerirPorNome(
  nomeDoAsaas: string | null | undefined,
  fichas: Iterable<{ id: string; nome: string | null }>,
  teto: number = SUGESTOES_MAX,
): SugestaoPorNome[] {
  if (tokensDoNome(nomeDoAsaas).length < 2) return [];
  const achadas: SugestaoPorNome[] = [];
  for (const f of fichas) {
    if (!f.nome || ehNomeNumerico(f.nome)) continue;
    const s = compararNomes(nomeDoAsaas, f.nome);
    if (s.candidato) achadas.push({ contactId: f.id, pontuacao: s.pontuacao });
  }
  achadas.sort((x, y) => y.pontuacao - x.pontuacao || (x.contactId < y.contactId ? -1 : 1));
  return achadas.slice(0, teto);
}

/**
 * O sinal NEGATIVO: a ficha tem nome de gente (2+ tokens, não numérico) e
 * ele não compartilha NENHUM token com o nome do Asaas. Nome do Asaas com
 * menos de dois tokens não diz nada — devolve `false`.
 */
export function nomesIncompativeis(nomeDoAsaas: string | null | undefined, nomeDaFicha: string | null | undefined): boolean {
  if (!nomeDaFicha || ehNomeNumerico(nomeDaFicha)) return false;
  const ta = tokensDoNome(nomeDoAsaas);
  const tf = tokensDoNome(nomeDaFicha);
  if (ta.length < 2 || tf.length < 2) return false;
  const setA = new Set(ta);
  return !tf.some((t) => setA.has(t));
}

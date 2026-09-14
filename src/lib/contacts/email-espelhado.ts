import type { CustomField } from "@/types";

/**
 * O campo personalizado "E-mail" ESPELHA `contacts.email` (1000).
 *
 * O espelho em si mora no banco — dois gatilhos, um em cada tabela —, então
 * qualquer escritor de um lado aparece no outro sem a tela fazer nada. O que
 * sobra para a tela é não DESFAZER o espelho com um valor velho.
 *
 * ⚠️⚠️ O caso que existe: a ficha de /contatos mostra o e-mail duas vezes —
 * no bloco de dados (com o botão "Salvar") e no campo espelhado (que salva
 * sozinho), em abas diferentes, com o estado sobrevivendo à troca de aba.
 * Quem edita o campo e depois salva os dados com o e-mail antigo ainda na
 * caixa gravaria o antigo por cima — e o gatilho levaria o antigo de volta ao
 * campo, desfazendo a edição em silêncio.
 */
export const ESPELHO_DO_EMAIL = "contacts.email";

/** Puro: o e-mail como o banco o guarda — aparado, e vazio é nulo. */
export function emailNormalizado(valor: string | null | undefined): string | null {
  const aparado = (valor ?? "").trim();
  return aparado === "" ? null : aparado;
}

/**
 * Puro: o e-mail digitado na caixa dos dados é DIFERENTE do que foi carregado?
 * Só então o "Salvar" pode mandar o e-mail — senão ele sobrescreveria a
 * edição feita pelo campo espelhado com o valor que estava na tela.
 */
export function emailMudou(carregado: string | null | undefined, digitado: string | null | undefined): boolean {
  return emailNormalizado(carregado) !== emailNormalizado(digitado);
}

/** Puro: o campo que espelha o e-mail, se a conta o tem. */
export function campoDoEmail(campos: readonly Pick<CustomField, "id" | "espelho">[]): string | null {
  return campos.find((c) => c.espelho === ESPELHO_DO_EMAIL)?.id ?? null;
}

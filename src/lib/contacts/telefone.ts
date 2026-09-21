/**
 * Telefone como GENTE o escreve — e como o CRM o guarda.
 *
 * Nasceu para o Calendly (977), que não tem campo "telefone": o número vem do lembrete por SMS
 * (`text_reminder_number`, sempre com DDI: "+55 96 99112-6767") ou do que o
 * cliente DIGITOU numa pergunta do formulário ("(96) 99112-6767",
 * "96991126767", "+55 96 9 9112-6767"…). Aqui tudo vira o formato de
 * `contacts.phone` (só dígitos, com DDI), que é o que `findExistingContact`
 * casa pelos últimos 8 dígitos.
 *
 * ⚠️ O `+` decide se o número JÁ tem DDI. Sem ele, 10 dígitos (fixo) ou 11
 * dígitos COM o nono dígito na 3ª posição (celular: DDD + 9 + 8) são lidos
 * como Brasil e ganham o 55 — é o que o cliente brasileiro digita. Com
 * ele, os dígitos entram como vieram.
 *
 * ⚠️ Por que a 3ª posição, e não "11 dígitos": um número americano em
 * dígitos ("14045551234") também tem 11, e ganhar o 55 o mandaria para
 * outro destinatário — com os dados do agendamento junto (achado do Codex
 * no PR #128). Na América do Norte o 2º dígito do código de área nunca é
 * 9 (N9X é reservado), então o "9" na 3ª posição separa os dois com
 * segurança. Número de outro país com 11 dígitos e 9 na 3ª posição
 * (Bulgária fixo: "3592…") ainda colide — escreva com `+`, que é o que a
 * dica do editor pede para número de fora.
 */

const MIN_DIGITOS = 8;
const MAX_DIGITOS = 15;

/** Dígitos do telefone no formato de `contacts.phone`, ou `null` se não parece um. */
export function digitosDoTelefone(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const aparado = texto.trim();
  const comDdi = aparado.startsWith("+") || aparado.startsWith("00");
  let digitos = aparado.replace(/\D/g, "");
  if (aparado.startsWith("00")) digitos = digitos.replace(/^00/, "");
  if (digitos.length < MIN_DIGITOS || digitos.length > MAX_DIGITOS) return null;
  if (!comDdi && digitos.length === 10) return `55${digitos}`;
  if (!comDdi && digitos.length === 11 && digitos[2] === "9") return `55${digitos}`;
  return digitos;
}

/**
 * O texto tem cara de telefone? Só dígitos e pontuação de telefone, com
 * 10 a 15 dígitos — "Rua 12, nº 340" tem dígitos e não passa (tem letras).
 */
export function pareceTelefone(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const aparado = texto.trim();
  if (!/^[\s()+\-.\d]+$/.test(aparado)) return false;
  const digitos = aparado.replace(/\D/g, "");
  return digitos.length >= 10 && digitos.length <= MAX_DIGITOS;
}

/** "5596991126767" → "(96) 99112-6767"; fora do Brasil, "+<dígitos>". */
export function formatarTelefone(digitos: string | null | undefined): string {
  if (!digitos) return "";
  if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) {
    const ddd = digitos.slice(2, 4);
    const numero = digitos.slice(4);
    const corte = numero.length - 4;
    return `(${ddd}) ${numero.slice(0, corte)}-${numero.slice(corte)}`;
  }
  return `+${digitos}`;
}

/**
 * As grafias de um celular brasileiro que o CRM pode ter guardado: a que veio
 * e a irmã com/sem o NONO DÍGITO.
 *
 * `contacts.phone` guarda só dígitos com DDI, e o mesmo cliente existe na
 * base ora como "5583988745316" (13 dígitos, com o 9), ora como
 * "558388745316" (12, sem) — depende de quem gravou: o WhatsApp entrega o
 * JID sem o 9 para número antigo, o CSV vem como o escritório digitou, o
 * Calendly como o cliente escreveu. `findExistingContact` já tolera isso ao
 * CASAR (últimos 8 dígitos); a busca da caixa de entrada não tolerava —
 * digitar o número com o 9 não achava a ficha gravada sem ele, e a leitura
 * do operador era que o cliente não estava no CRM (reportado em 09/09/2026).
 *
 * ⚠️ Só celular: o 9 foi acrescentado apenas aos números móveis, que
 * começam em 6, 7, 8 ou 9. Inserir um 9 num fixo fabricaria um número que
 * não existe — inofensivo para a busca, mas a regra escrita é a real.
 *
 * ⚠️ Só com DDI 55 na frente, porque é assim que a coluna guarda. Um número
 * sem DDI ou de outro país volta sozinho, sem irmã.
 *
 * A forma original vem SEMPRE primeiro; a irmã, só quando existe.
 */
export function variantesDoNonoDigito(digitos: string): string[] {
  if (!digitos.startsWith("55")) return [digitos];
  // 55 + DDD (2) + 9 + 8 dígitos = 13: a irmã é sem o 9.
  if (digitos.length === 13 && digitos[4] === "9" && /[6-9]/.test(digitos[5])) {
    return [digitos, digitos.slice(0, 4) + digitos.slice(5)];
  }
  // 55 + DDD (2) + 8 dígitos = 12: a irmã ganha o 9 depois do DDD.
  if (digitos.length === 12 && /[6-9]/.test(digitos[4])) {
    return [digitos, `${digitos.slice(0, 4)}9${digitos.slice(4)}`];
  }
  return [digitos];
}

/**
 * A grafia CANÔNICA de um telefone: só dígitos e, no celular brasileiro de 12
 * dígitos (55 + DDD + 8, começando em 6–9), COM o nono dígito depois do DDD.
 * As duas grafias que `variantesDoNonoDigito` devolve têm sempre a MESMA
 * canônica — é a chave de "mesma pessoa".
 *
 * ⚠️ ESPELHO da coluna gerada `contacts.telefone_canonico` (1024), que é a
 * chave ÚNICA por conta: mudar a régua num lado sem o outro faz o código
 * achar "pessoa nova" onde o banco vê a mesma (23505 na cara) ou o contrário.
 * Há teste lendo a migration.
 */
export function telefoneCanonico(telefone: string | null | undefined): string {
  const digitos = (telefone ?? "").replace(/\D/g, "");
  return /^55\d{2}[6-9]\d{7}$/.test(digitos)
    ? `${digitos.slice(0, 4)}9${digitos.slice(4)}`
    : digitos;
}

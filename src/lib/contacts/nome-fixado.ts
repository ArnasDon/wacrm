/**
 * Nome FIXADO da ficha (999): o nome que o WhatsApp não sobrescreve.
 *
 * `contacts.nome_fixado_em` preenchido quer dizer que uma fonte deliberada
 * escolheu o nome — hoje, o agendamento do Calendly. A partir daí os três
 * caminhos AUTOMÁTICOS que trocavam o nome pelo perfil do WhatsApp deixam a
 * ficha em paz: a ingestão da Evolution (`inbound-store.ts`), o webhook da
 * Meta e o envio por telefone da API v1 (`resolve-conversation.ts`). Cada um
 * leva `.is('nome_fixado_em', null)` no próprio UPDATE, e há teste
 * estrutural cobrando isso (`nome-fixado.chamadores.test.ts`).
 *
 * Quem escreve o nome à mão continua podendo trocá-lo: a marca protege contra
 * o automático, não contra gente.
 */

/**
 * Puro: o nome digitado numa fonte deliberada, pronto para gravar — ou `null`
 * quando não serve de nome.
 *
 * ⚠️ Número NÃO é nome. É a mesma régua que a ingestão da Evolution já usa
 * para não renomear "Leonardo Cabral" para "5583…": um formulário que devolve
 * o telefone no campo de nome faria a ficha perder o nome de verdade e, pior,
 * FIXÁ-LO assim — a próxima mensagem do cliente não teria mais como consertar.
 *
 * O espaço é aparado e colapsado (inclusive o não separável), e nada além
 * disso: maiúsculas e minúsculas ficam como a pessoa escreveu — o `capitalize`
 * já estragou nome de gente nesta base.
 */
export function nomeParaFixar(bruto: string | null | undefined): string | null {
  if (typeof bruto !== "string") return null;
  const nome = bruto.replace(/[\s ]+/g, " ").trim();
  if (!nome) return null;
  const semPontuacaoDeTelefone = nome.replace(/[\s().+-]/g, "");
  if (semPontuacaoDeTelefone === "" || /^\d+$/.test(semPontuacaoDeTelefone)) return null;
  return nome;
}

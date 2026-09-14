/**
 * Nome FIXADO da ficha (999): o nome que o WhatsApp não sobrescreve.
 *
 * `contacts.nome_fixado_em` preenchido quer dizer que uma fonte deliberada
 * escolheu o nome — o agendamento do Calendly, o passo de automação que
 * atualiza o nome, ou gente escrevendo o nome à mão. A partir daí os três
 * caminhos AUTOMÁTICOS que trocavam o nome pelo perfil do WhatsApp deixam a
 * ficha em paz: a ingestão da Evolution (`inbound-store.ts`), o webhook da
 * Meta e o envio por telefone da API v1 (`resolve-conversation.ts`). Cada um
 * leva `.is('nome_fixado_em', null)` no próprio UPDATE, e há teste
 * estrutural cobrando isso (`nome-fixado.chamadores.test.ts`).
 *
 * Quem escreve o nome à mão continua podendo trocá-lo: a marca protege contra
 * o automático, não contra gente. E a escrita à mão também FIXA o nome
 * (decisão do operador, 14/09/2026): quem corrige um nome no painel, na ficha
 * ou no formulário não o vê voltar na mensagem seguinte — `marcaDoNomeManual`.
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

/**
 * Puro: o pedaço do UPDATE (ou INSERT) que acompanha um nome escrito À MÃO.
 * Espalhe no objeto gravado: `.update({ name, ...marcaDoNomeManual(antes, name, agora) })`.
 *
 * ⚠️⚠️ SÓ mexe na marca quando o NOME mudou. A ficha e o formulário regravam o
 * nome em TODO salvamento, junto com telefone, e-mail e empresa: sem essa
 * régua, corrigir só o e-mail de um contato fixaria de tabela o nome que veio
 * do WhatsApp — e ninguém escolheu aquele nome.
 *
 * Nome trocado por um nome de verdade FIXA; nome apagado (ou trocado por um
 * número) SOLTA — quem esvaziou o campo está dizendo que não sabe o nome, e a
 * próxima mensagem do cliente volta a preenchê-lo pelo perfil.
 *
 * Na criação, passe `antes = null`: nome digitado fixa, campo vazio não grava
 * a chave (a coluna nasce nula).
 */
export function marcaDoNomeManual(
  antes: string | null | undefined,
  depois: string | null | undefined,
  agoraIso: string,
): { nome_fixado_em?: string | null } {
  const eraAntes = (antes ?? "").replace(/[\s ]+/g, " ").trim();
  const ficou = (depois ?? "").replace(/[\s ]+/g, " ").trim();
  if (eraAntes === ficou) return {};
  return { nome_fixado_em: nomeParaFixar(ficou) ? agoraIso : null };
}

/**
 * Puro: o pedaço do UPDATE de uma tela onde GENTE edita o nome — o NOME e a
 * marca juntos, ou NADA quando o nome não mudou. Espalhe no objeto gravado:
 * `.update({ ...escritaDoNomeManual(antes, digitado, agora), phone, … })`.
 *
 * ⚠️⚠️ Nome igual ao carregado NÃO é regravado. A tela abre sobre uma FOTO da
 * ficha (a lista de /contatos não tem realtime; a ficha carrega uma vez): se
 * o agendamento do Calendly trocou o nome enquanto ela estava aberta, regravar
 * o nome da foto devolveria à ficha o nome ANTIGO — e, como a marca só muda
 * quando o nome muda, ele ficaria FIXADO no lugar do que o cliente digitou,
 * sem mensagem nenhuma capaz de consertar (revisão do PR #208). Mandar só o
 * que mudou deixa no banco o valor mais novo.
 *
 * Nome apagado grava NULL e solta a marca, como `marcaDoNomeManual`. O nome
 * gravado é o colapsado (espaços repetidos viram um).
 */
export function escritaDoNomeManual(
  antes: string | null | undefined,
  depois: string | null | undefined,
  agoraIso: string,
): { name?: string | null; nome_fixado_em?: string | null } {
  const ficou = (depois ?? "").replace(/[\s ]+/g, " ").trim();
  const marca = marcaDoNomeManual(antes, ficou, agoraIso);
  if (!("nome_fixado_em" in marca)) return {};
  return { name: ficou || null, ...marca };
}

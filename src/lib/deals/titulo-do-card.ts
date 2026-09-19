// ============================================================
// O título do card é o NOME de quem está do outro lado — e `titulo_fixado_em`
// (1007) é a marca de "gente escolheu este título".
//
// O card nasce com o nome da ficha (`routeContactToPipeline`) e, dali em
// diante, quem o mantém em dia é um GATILHO no banco, não código: nome novo
// na ficha renomeia o card aberto mais recente daquele contato. `contacts.name`
// tem escritores demais (Evolution, Meta, API v1, CSV, ficha, formulário,
// passo de automação, Calendly, Asaas) para espelhar em TypeScript — é a
// lição da 1000.
//
// Este módulo cobre a OUTRA metade: o que acontece quando alguém digita o
// título. Marcado, nenhum caminho automático o troca.
//
// ⚠️ A régua do nome ("isto é nome ou é telefone?") NÃO mora aqui: é o
// `nomeParaFixar` de `contacts/nome-fixado.ts` (999), que o gatilho espelha em
// SQL (`cb_nome_para_titulo`). Uma segunda cópia divergiria na primeira
// mudança, e o sintoma seria o título discordando da ficha.
// ============================================================

/**
 * O rótulo de reserva do card que nasce sem nome NENHUM — sem nome na ficha,
 * sem telefone e sem `@usuario`. A coluna é NOT NULL e precisa de alguma
 * coisa; hoje isso só é alcançável pelo Instagram, quando o perfil ainda não
 * foi lido.
 *
 * ⚠️⚠️ O GATILHO DA 1008 CONHECE ESTE TEXTO, e tem de conhecer: para
 * `cb_nome_para_titulo` ele parece um nome de gente, então sem o caso especial
 * o card nasceria "Novo contato" e ficaria assim PARA SEMPRE — o gatilho o
 * leria como "este título já identifica alguém" e nunca o trocaria pelo nome
 * que chegasse depois (achado do Codex, PR #225). Trocar este texto exige
 * migration nova; há pino cobrando os dois lados
 * (`supabase/migrations/titulo-do-card-1007.test.ts`).
 */
export const TITULO_SEM_NOME = "Novo contato";

/**
 * Puro: o pedaço do INSERT/UPDATE que acompanha um título DIGITADO — o texto
 * e a marca juntos, ou NADA quando o título não mudou.
 *
 * ⚠️⚠️ Título igual ao carregado NÃO é regravado, e é a mesma razão do
 * `escritaDoNomeManual`: o formulário do card abre sobre uma FOTO do negócio
 * (o quadro carrega uma vez, sem realtime) e reenvia o título em TODO
 * salvamento. Sem esta régua, corrigir só o valor de um negócio fixaria de
 * tabela o título que o robô tinha acabado de escrever — e, pior, se o
 * gatilho o tivesse renomeado com a tela aberta, o salvamento devolveria o
 * título ANTIGO e o congelaria, sem nenhuma mensagem capaz de consertar.
 *
 * Na criação, passe `antes = null`: o título digitado entra e já nasce fixado.
 *
 * Título vazio não grava nada — a coluna é NOT NULL, e as duas telas que
 * chamam isto já barram o campo em branco antes. O espaço é colapsado com
 * `\s`, que em JavaScript já inclui o espaço não separável.
 */
export function escritaDoTituloManual(
  antes: string | null | undefined,
  depois: string | null | undefined,
  agoraIso: string,
): { title?: string; titulo_fixado_em?: string } {
  const ficou = (depois ?? "").replace(/\s+/g, " ").trim();
  if (!ficou) return {};
  const era = (antes ?? "").replace(/\s+/g, " ").trim();
  if (era === ficou) return {};
  return { title: ficou, titulo_fixado_em: agoraIso };
}

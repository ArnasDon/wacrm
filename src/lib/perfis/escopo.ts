// ============================================================
// "Esta conexão / este funil / esta conversa entra no escopo do perfil?"
//
// ⚠️ VAZIO = TUDO. É a convenção do projeto inteiro (`channelInScope`,
// `findEntryFlow`, escopo de automação), e a ÚNICA exceção deliberada em todo
// o código é `cb_channels.radar_enabled`, por privacidade. A tela precisa
// DIZER isso em palavras — "sem marcação = vê todas as conexões" —, senão o
// operador lê "nenhuma" e desconfigura o perfil achando que está restringindo.
// ============================================================

import { canalDaConversa } from '@/lib/inbox/filtros';
import type { Conversation } from '@/types';
import type { ContextoDeAcesso, PerfilDeAcesso } from './tipos';

/** Escopo irrestrito: sem perfil, dono, ou lista vazia. */
function semRecorteDeCanal(ctx: ContextoDeAcesso): boolean {
  if (ctx.papel === 'owner') return true;
  if (!ctx.perfil) return true;
  return ctx.perfil.channel_ids.length === 0;
}

function semRecorteDeFunil(ctx: ContextoDeAcesso): boolean {
  if (ctx.papel === 'owner') return true;
  if (!ctx.perfil) return true;
  return ctx.perfil.pipeline_ids.length === 0;
}

/**
 * Filtra uma lista de conexões pelo escopo do perfil.
 *
 * Genérico em `{ id }` para servir tanto ao `Channel` completo quanto a
 * qualquer projeção que a tela carregue — e para o teste não precisar montar
 * um canal inteiro.
 *
 * ⚠️ Id órfão (conexão apagada depois de marcada no perfil) simplesmente não
 * casa e some do resultado, sem erro. É a mesma regra que
 * `descrever-passo.ts` usa para tag apagada: o array não tem FK, então
 * limpeza é da próxima edição do perfil, não da leitura.
 */
export function canaisVisiveis<T extends { id: string }>(
  ctx: ContextoDeAcesso,
  todos: T[]
): T[] {
  if (semRecorteDeCanal(ctx)) return todos;
  const permitidos = new Set(ctx.perfil!.channel_ids);
  return todos.filter((c) => permitidos.has(c.id));
}

export function funisVisiveis<T extends { id: string }>(
  ctx: ContextoDeAcesso,
  todos: T[]
): T[] {
  if (semRecorteDeFunil(ctx)) return todos;
  const permitidos = new Set(ctx.perfil!.pipeline_ids);
  return todos.filter((p) => permitidos.has(p.id));
}

export function canalNoEscopo(
  ctx: ContextoDeAcesso,
  channelId: string
): boolean {
  if (semRecorteDeCanal(ctx)) return true;
  return ctx.perfil!.channel_ids.includes(channelId);
}

export function funilNoEscopo(
  ctx: ContextoDeAcesso,
  pipelineId: string
): boolean {
  if (semRecorteDeFunil(ctx)) return true;
  return ctx.perfil!.pipeline_ids.includes(pipelineId);
}

/**
 * A lista de canais do recorte, para montar CONSULTA — ou `null` quando não
 * há recorte nenhum (dono, sem perfil, ou lista vazia = todas).
 *
 * Existe porque nem todo consumidor filtra em JS: a tela de Agendadas pagina
 * no banco, e filtrar página carregada em JS mostraria menos linhas que o
 * `count: 'exact'` promete. Lá o recorte entra como `.in('channel_id', …)` NA
 * CONSULTA — o que é seguro naquela tabela porque `cb_scheduled_messages`
 * carrega o próprio `channel_id`, fixado no agendamento (925). ⚠️ NÃO usar
 * este helper para filtrar `conversations` na consulta: lá vale a armadilha
 * do embed/grupo documentada em `filtros.ts`, e o recorte é em JS via
 * `conversaNoEscopo`.
 */
export function recorteDeCanais(ctx: ContextoDeAcesso): string[] | null {
  if (semRecorteDeCanal(ctx)) return null;
  return ctx.perfil!.channel_ids;
}

/**
 * A lista de funis do recorte, para montar CONSULTA — ou `null` quando não
 * há recorte nenhum (dono, sem perfil, ou lista vazia = todos).
 *
 * Irmã de `recorteDeCanais`, e com a mesma ressalva: serve para consulta em
 * tabela que carrega o próprio `pipeline_id` (`deals`). Para decidir sobre
 * UM registro que já está em mão, use `funilNoEscopo`; para filtrar uma
 * lista carregada, `funisVisiveis`.
 */
export function recorteDeFunis(ctx: ContextoDeAcesso): string[] | null {
  if (semRecorteDeFunil(ctx)) return null;
  return ctx.perfil!.pipeline_ids;
}

/**
 * A conversa entra no escopo?
 *
 * ⚠️⚠️ USA `canalDaConversa`, NUNCA `conversation.channel_id` direto. Conversa
 * de grupo tem a coluna SEMPRE NULA — quem guarda o número é
 * `cb_groups.channel_id`. Ler a coluna crua aqui APAGARIA TODOS OS GRUPOS da
 * caixa de entrada de quem tem perfil restrito, em silêncio e sem erro. A
 * função importada já resolve os dois casos e está documentada em
 * `src/lib/inbox/filtros.ts`; reusá-la é o que impede esta armadilha de ter
 * duas implementações que divergem.
 *
 * ⚠️ Conversa SEM canal nenhum (1:1 anterior à 903, que nunca foi carimbada)
 * PASSA. Não sabemos por qual número ela veio, e escondê-la faria sumir
 * histórico legítimo para afirmar algo que ninguém sabe. Coerente com a
 * natureza deste recorte, que é organizar a visão e não conter adversário —
 * e com o filtro de canal do inbox, onde essas conversas também só aparecem
 * em "Todos".
 */
export function conversaNoEscopo(
  ctx: ContextoDeAcesso,
  conversa: Conversation
): boolean {
  if (semRecorteDeCanal(ctx)) return true;

  const canal = canalDaConversa(conversa);
  if (canal === null) return true;

  return ctx.perfil!.channel_ids.includes(canal);
}

/**
 * Resumo em texto do escopo, para a legenda da aba Membros (Fase 6).
 *
 * Devolve CONTAGENS e não frase pronta: quem monta a frase é a tela, com
 * `t()`. Frase montada aqui seria português cravado num módulo puro, e o
 * projeto tem dicionário exatamente para não ter isso.
 */
export function resumoDoEscopo(perfil: PerfilDeAcesso | null): {
  todasAsConexoes: boolean;
  todosOsFunis: boolean;
  conexoes: number;
  funis: number;
} {
  return {
    todasAsConexoes: !perfil || perfil.channel_ids.length === 0,
    todosOsFunis: !perfil || perfil.pipeline_ids.length === 0,
    conexoes: perfil?.channel_ids.length ?? 0,
    funis: perfil?.pipeline_ids.length ?? 0,
  };
}

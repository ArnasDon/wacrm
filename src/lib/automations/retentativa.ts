// ============================================================
// Quando vale tentar de novo um passo de automação que falhou.
//
// Até 13/09/2026 QUALQUER erro encerrava a execução: o passo falhava, o
// motor dava `break`, e os passos seguintes nunca rodavam. Medido em
// produção no caso que motivou isto — a automação do Calendly falhou no
// aviso ao advogado ("Connection Closed", um soluço da conexão) e, por
// causa disso, o card do cliente NÃO foi movido para "Reunião Agendada".
// O trabalho que faltou não tinha nada a ver com a mensagem que não saiu.
//
// ⚠️⚠️ A RÉGUA É O ERRO, NÃO O PASSO — e a primeira versão errou nisso.
// Ela repetia todo passo que "mexe só em dado do CRM", e um teste do motor
// mostrou o buraco: `add_tag` sem `tag_id` estoura por CONFIGURAÇÃO, e
// repetir três vezes um erro determinístico não conserta nada — só adia o
// aviso em cinco minutos, que é o oposto do que o operador precisa.
//
// Então o que se repete é ESTREITO: falha do PROVEDOR DE MENSAGENS
// (`EvolutionApiError`) num passo de ENVIO, e só com a RECUSA COMPROVADA
// (4xx: ele processou o pedido e disse não — nada saiu). Erro lançado pelo
// próprio motor (configuração, contato sem telefone, card que não existe)
// nunca volta à fila: ele vai falhar igual daqui a cinco minutos, e quem
// resolve é gente.
//
// ⚠️⚠️ E o 4xx não é burocracia: entre "a Evolution recusou" e "o WhatsApp
// pode ter aceitado e a resposta se perdeu" não há diferença no texto do
// erro, e repetir o segundo manda a mesma mensagem DUAS VEZES ao cliente.
// É a distinção que a agendada aprendeu na 932 (`evolution_rejected` ×
// `evolution_error`), e o `entrega_incerta` existe porque ela não pode ser
// adivinhada.
// ============================================================

/**
 * Os passos que falam com o provedor. Só eles podem receber uma
 * `EvolutionApiError`, e só eles entram na retentativa.
 *
 * ⚠️ Lista de ALTA (allowlist): passo novo no motor nasce FORA dela — sem
 * retentativa, como sempre foi — até alguém decidir por escrito que
 * repeti-lo é seguro. Uma lista de exclusão faria o passo novo herdar o
 * retry por esquecimento, que é como se manda mensagem repetida a cliente.
 *
 * `send_webhook` fica de fora de propósito: ele fala com o endpoint do
 * escritório (n8n), que pode já ter recebido e criado o registro.
 */
export const PASSOS_DE_ENVIO: ReadonlySet<string> = new Set([
  'send_message',
  'send_buttons',
  'send_list',
  'send_template',
  'send_media',
  'send_to_number',
]);

/**
 * Quantas vezes o passo roda ao todo, contando a primeira.
 *
 * Três, e não mais: o que o retry cobre é soluço de conexão, que passa em
 * segundos ou não passa. Insistir dez vezes só adia o aviso — e o aviso é
 * o que faz alguém consertar.
 */
export const TENTATIVAS_MAX = 3;

/**
 * Quanto esperar antes de cada retentativa, em ordem.
 *
 * ⚠️ A primeira é CURTA (30 s) de propósito: instância da Evolution que
 * cai costuma voltar no mesmo minuto, e há um cliente do outro lado
 * esperando. A segunda dá tempo de um reinício de verdade.
 * ⚠️ O agendador tem laço próprio (~1 min no rápido), então a espera real
 * é esta MAIS o tique — nunca menos que o intervalo do cron.
 */
export const ESPERAS_MS: readonly number[] = [30_000, 5 * 60_000];

export interface PedidoDeRetentativa {
  stepType: string;
  /** Quantas vezes este passo já rodou (1 na primeira falha). */
  tentativa: number;
  /**
   * O que o PROVEDOR respondeu, ou `null` quando o erro não veio dele —
   * configuração, banco, contato sem telefone. Nesses casos não se repete:
   * o erro é determinístico e vai acontecer igual na próxima vez.
   */
  provedor: { recusou: boolean } | null;
}

export type Retentativa =
  | {
      repetir: false;
      motivo: 'teto' | 'passo' | 'nao_e_do_provedor' | 'entrega_incerta';
    }
  | { repetir: true; esperaMs: number };

/**
 * ⚠️ A ordem dos testes importa. O TETO vem primeiro: passo que já gastou
 * as tentativas não volta à fila, e inverter faria o motor reenfileirar
 * para sempre um provedor que recusa sempre (uma conexão apagada, por
 * exemplo), queimando ciclo do agendador e nunca mostrando a falha.
 */
export function decidirRetentativa(p: PedidoDeRetentativa): Retentativa {
  if (p.tentativa >= TENTATIVAS_MAX) return { repetir: false, motivo: 'teto' };
  if (!PASSOS_DE_ENVIO.has(p.stepType))
    return { repetir: false, motivo: 'passo' };
  if (p.provedor === null) {
    return { repetir: false, motivo: 'nao_e_do_provedor' };
  }
  if (!p.provedor.recusou) {
    return { repetir: false, motivo: 'entrega_incerta' };
  }

  // `tentativa` é 1 na primeira falha, e a primeira espera é a do índice 0.
  const esperaMs =
    ESPERAS_MS[p.tentativa - 1] ?? ESPERAS_MS[ESPERAS_MS.length - 1];
  return { repetir: true, esperaMs };
}

/**
 * A chave do contador dentro do `context` da execução.
 *
 * ⚠️ Mora no `context` (jsonb) e NÃO em coluna: a fila
 * `automation_pending_executions` já carrega o contexto de uma ponta à
 * outra da execução, e uma coluna nova exigiria migration para guardar um
 * número que só o motor lê. O sublinhado segue a convenção das outras
 * chaves internas do contexto (`_cadeia`, `_tag_chain_depth`).
 */
export const CHAVE_DA_TENTATIVA = '_tentativa';

/** Lê o contador do contexto — qualquer coisa estranha vale zero. */
export function tentativasJaFeitas(context: unknown): number {
  if (!context || typeof context !== 'object') return 0;
  const bruto = (context as Record<string, unknown>)[CHAVE_DA_TENTATIVA];
  return typeof bruto === 'number' && Number.isInteger(bruto) && bruto > 0
    ? bruto
    : 0;
}

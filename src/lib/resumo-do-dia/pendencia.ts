// ============================================================
// "O Meu dia precisa aparecer AGORA?" — a trava da tela de entrada, pura.
//
// O registro fica no `localStorage` do navegador, POR USUÁRIO, e guarda três
// coisas: a sessão de login que confirmou, o dia em que confirmou e o
// instante. A regra de exibição é "sessão nova OU primeiro acesso do dia",
// avaliada UMA vez por carga de página, na porta de entrada
// (`src/components/entrada/porta-de-entrada.tsx`). O instante serve ao
// bloco de novidades: "o que chegou desde a sua última entrada".
//
// ⚠️ Por que sessão E dia, e não só o logout: o logout por inatividade (F2 do
// plano) não garante "um resumo por dia" — quem mexe no CRM de hora em hora
// nunca desloga. A regra do dia cobre isso sem depender de ninguém sair.
//
// ⚠️ `lerRegistro` é PARSE, nunca `as`: a linha pode ter sido gravada por uma
// versão que não conhecia um campo de hoje, e um cast entregaria `undefined`
// à régua. Forma estranha = registro ausente = a tela aparece, que é o lado
// seguro (mostrar um resumo a mais é barato; esconder uma pendência não é).
// ============================================================

export interface RegistroDeEntrada {
  /** `session_id` do token que confirmou; nulo quando o token não o trazia. */
  sessao: string | null;
  /** `YYYY-MM-DD` no fuso de quem confirmou (`diaLocal`). */
  dia: string;
  /** ISO 8601 do clique em "Continuar". */
  confirmadoEm: string;
}

/** A chave no `localStorage`, uma por pessoa — dois logins no mesmo navegador não se confundem. */
export function chaveDoRegistro(userId: string): string {
  return `cb-meu-dia:${userId}`;
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

export function lerRegistro(
  bruto: string | null | undefined
): RegistroDeEntrada | null {
  if (!bruto) return null;
  let valor: unknown;
  try {
    valor = JSON.parse(bruto);
  } catch {
    return null;
  }
  if (!valor || typeof valor !== 'object') return null;
  const r = valor as Record<string, unknown>;
  if (typeof r.dia !== 'string' || !DIA.test(r.dia)) return null;
  if (
    typeof r.confirmadoEm !== 'string' ||
    Number.isNaN(Date.parse(r.confirmadoEm))
  )
    return null;
  const sessao =
    typeof r.sessao === 'string' && r.sessao.length > 0 ? r.sessao : null;
  return { sessao, dia: r.dia, confirmadoEm: r.confirmadoEm };
}

/**
 * A régua. Sem registro → mostra. Outro dia → mostra. Outra sessão → mostra.
 *
 * ⚠️ `sessionId` NULO (token sem a claim, ou ainda não lido) decide SÓ pelo
 * dia: comparar `null === null` e chamar de "mesma sessão" faria um registro
 * gravado sem sessão valer para todo login futuro sem sessão.
 */
export function precisaMostrar(
  registro: RegistroDeEntrada | null,
  sessionId: string | null,
  hoje: string
): boolean {
  if (!registro) return true;
  if (registro.dia !== hoje) return true;
  if (sessionId !== null && registro.sessao !== sessionId) return true;
  return false;
}

export function novoRegistro(
  sessionId: string | null,
  hoje: string,
  agora: Date
): RegistroDeEntrada {
  return { sessao: sessionId, dia: hoje, confirmadoEm: agora.toISOString() };
}

/** Janela das novidades quando não há confirmação anterior neste aparelho. */
export const JANELA_SEM_REGISTRO_MS = 24 * 60 * 60_000;

export interface InicioDasNovidades {
  desdeMs: number;
  /**
   * A âncora é a confirmação anterior (true) ou a janela de 24 h (false).
   * A TELA lê isto para o rótulo — "desde a sua última entrada" só quando é
   * verdade; a régua e o rótulo saem do MESMO ramo, senão o cabeçalho
   * afirma uma âncora que a régua acabou de rejeitar.
   */
  daConfirmacao: boolean;
}

/**
 * Desde quando contar "novidades": a confirmação anterior neste aparelho,
 * ou as últimas 24 h quando não há nenhuma. Registro com instante no futuro
 * (relógio ajustado) cai na janela de 24 h — contar a partir do futuro
 * devolveria "nada de novo" sobre avisos que chegaram.
 */
export function inicioDasNovidades(
  registro: RegistroDeEntrada | null,
  agoraMs: number
): InicioDasNovidades {
  const padrao = {
    desdeMs: agoraMs - JANELA_SEM_REGISTRO_MS,
    daConfirmacao: false,
  };
  if (!registro) return padrao;
  const confirmado = Date.parse(registro.confirmadoEm);
  if (Number.isNaN(confirmado) || confirmado > agoraMs) return padrao;
  return { desdeMs: confirmado, daConfirmacao: true };
}

/**
 * A decisão INTEIRA da porta, pura: mostra o Meu dia nesta carga?
 *
 * - conta que não resolveu (`accountStatus !== 'ready'`) PULA a tela — as
 *   consultas falhariam ou mentiriam, e o `AccountAccessAlert` narra;
 * - quem já passou pela porta nesta carga de página não volta a vê-la
 *   (remontagem pelo "Ver como", pelo spinner do shell);
 * - o resto é `precisaMostrar`.
 */
export function decidirEntrada(args: {
  registro: RegistroDeEntrada | null;
  sessionId: string | null;
  hoje: string;
  accountStatus: string;
  jaLiberadoNestaCarga: boolean;
  /** A guarda de 4 h diz que a aba voltou de uma pausa longa (F2a): mostra, mesmo já liberada. */
  inatividadeExpirou?: boolean;
}): boolean {
  if (args.accountStatus !== 'ready') return false;
  if (args.inatividadeExpirou) return true;
  if (args.jaLiberadoNestaCarga) return false;
  return precisaMostrar(args.registro, args.sessionId, args.hoje);
}

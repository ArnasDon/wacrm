import type { DateFieldTriggerConfig } from '@/types'

// ------------------------------------------------------------
// Gatilho de LEMBRETE por data de campo personalizado (migration 935).
//
// "24 horas antes da reunião, mande a confirmação." A hora vem de um campo do
// CONTATO, e é isso que dá alvo ao gatilho — o `time_based` do upstream nunca
// disparou em parte porque "todo dia às 9h" não diz para quem.
//
// A aritmética mora aqui, pura e testável, porque errar por algumas horas é
// exatamente o modo de falha desta feature: o cliente recebe "sua reunião é
// amanhã" depois da reunião, e ninguém percebe que foi o código.
// ------------------------------------------------------------

/**
 * Janela varrida num ciclo: `(de, ate]`.
 *
 * `ate` é o instante-alvo mais recente que ainda deve disparar (agora), e `de`
 * é o mais antigo. A largura é a guarda de atraso — ver `LARGURA_MS`.
 */
export interface Janela {
  de: string
  ate: string
}

/**
 * Quanto para trás o ciclo aceita disparar.
 *
 * ⚠️ É a GUARDA DE ATRASO, no molde da mensagem agendada (925), e o número
 * grande é de propósito: o ciclo normal é de minutos, então 1 hora cobre
 * folgadamente um agendador que tropeçou. O que ela impede é o oposto —
 * agendador fora do ar a noite toda e religado de manhã despejando os
 * lembretes de madrugada inteira de uma vez, cada um chegando ao cliente
 * horas depois de perder a utilidade.
 *
 * Lembrete perdido é ruim; lembrete de uma reunião que já aconteceu é pior,
 * porque afirma algo falso ao cliente.
 */
export const LARGURA_MS = 60 * 60 * 1000

/**
 * Que valores do campo devem ser buscados neste ciclo.
 *
 * O contato deve receber quando `valor + deslocamento` cai na janela.
 * Invertendo: `valor` tem de estar entre `agora - largura - deslocamento` e
 * `agora - deslocamento`.
 *
 * ⚠️ `antes` é deslocamento NEGATIVO. "24 horas antes" quer dizer que o
 * disparo acontece 24h ANTES do valor, logo procuramos valores 24h À FRENTE
 * de agora. Trocar o sinal aqui manda a confirmação de reunião 24h DEPOIS
 * dela — o defeito mais provável desta feature inteira, e o mais silencioso.
 */
export function deslocamentoEmMs(cfg: DateFieldTriggerConfig): number {
  const horas = Number(cfg.offset_hours)
  const minutos = Number(cfg.offset_minutes)
  return (
    (Number.isFinite(horas) ? horas : 0) * 3_600_000 +
    (Number.isFinite(minutos) ? minutos : 0) * 60_000
  )
}

/**
 * Piso da janela de um "antes" curto (e do "na hora").
 *
 * O laço rápido do agendador roda a cada ~60s (docker-stack.yml), então 5
 * minutos cobrem folgado a cadência com tropeço. É o teto de atraso que um
 * "na hora da reunião" aceita: disparar até 5 min depois do início, nunca a
 * 1 hora da guarda cheia — "sua reunião é agora" com ela na metade é
 * exatamente a afirmação falsa que este módulo existe para impedir.
 */
export const PISO_ANTES_MS = 5 * 60 * 1000

/**
 * A largura da janela deste gatilho.
 *
 * ⚠️ `antes`: NUNCA MUITO MAIOR QUE O PRÓPRIO DESLOCAMENTO, e é isso que
 * torna o lembrete de minutos possível. Com a largura fixa de 1 hora, um
 * gatilho de "10 minutos antes" aceitaria disparar até 50 minutos DEPOIS de
 * a reunião começar — a guarda contra atraso viraria a causa do atraso, e o
 * cliente receberia "sua reunião é em 10 minutos" com ela já em curso. O
 * PISO existe porque a cadência do laço é ~1 min: janela menor que o ciclo
 * abriria buracos entre varreduras. E o deslocamento ZERO ("na hora") entra
 * na MESMA régua — antes ele caía na guarda cheia e um agendador religado
 * mandava "sua reunião é agora" até 1 hora depois do início.
 *
 * ⚠️ `depois` usa a guarda CHEIA, sempre. Encolher aqui não protege nada —
 * o follow-up é depois da reunião por definição, atraso não afirma nada de
 * falso — e custava caro: com "30 minutos depois", qualquer queda do
 * agendador maior que 30 min perdia os follow-ups do buraco EM SILÊNCIO
 * (a varredura simplesmente não os achava mais). Achado do ledger da
 * revisão 48h (r2).
 *
 * Para os deslocamentos longos (24h, 4h) nada muda: continua 1 hora.
 */
export function larguraDaJanela(cfg: DateFieldTriggerConfig): number {
  if (cfg.direction === 'depois') return LARGURA_MS
  const deslocamento = deslocamentoEmMs(cfg)
  return Math.min(LARGURA_MS, Math.max(deslocamento, PISO_ANTES_MS))
}

export function janelaDeBusca(cfg: DateFieldTriggerConfig, agoraMs: number): Janela {
  const deslocamentoMs = deslocamentoEmMs(cfg)
  // `antes`: alvo = valor - deslocamento  →  valor = alvo + deslocamento
  // `depois`: alvo = valor + deslocamento →  valor = alvo - deslocamento
  const sinal = cfg.direction === 'depois' ? -1 : 1
  const ate = agoraMs + sinal * deslocamentoMs
  const de = ate - larguraDaJanela(cfg)
  return { de: new Date(de).toISOString(), ate: new Date(ate).toISOString() }
}

/**
 * A config está utilizável?
 *
 * Devolve o motivo quando não — o cron o registra, para a próxima pessoa não
 * ter de adivinhar por que o lembrete não saiu.
 */
export function motivoDeConfigInvalida(cfg: DateFieldTriggerConfig): string | null {
  // ⚠️ Com a fonte `reuniao` NÃO há campo de data para escolher — a data vem de
  // `cb_meetings.starts_at`. Exigir o campo aqui deixaria o gatilho novo
  // permanentemente inválido, e o cron registraria "sem campo escolhido" para
  // uma configuração correta.
  const fonte = cfg?.fonte ?? 'campo'
  if (fonte === 'campo' && !cfg?.custom_field_id) {
    return 'gatilho sem campo de data escolhido'
  }
  if (fonte !== 'campo' && fonte !== 'reuniao') return 'fonte de data desconhecida'

  // ⚠️ PELO MENOS UM DOS DOIS TEM DE VIR — e "vir" exclui `null` e `''`.
  // Antes da 947 o deslocamento era só `offset_hours`, e a ausência caía em
  // `Number(undefined) = NaN`, que a checagem recusava. Ao dividir em horas +
  // minutos eu troquei a condição por `!== undefined` e abri a porta: config
  // sem deslocamento nenhum passava a ser aceita, com deslocamento ZERO — e a
  // janela `[agora-piso, agora]` avisaria sobre reuniões que JÁ COMEÇARAM, em
  // vez de a automação ser recusada com motivo no log. E `undefined` não
  // basta: campo "limpo" chega como `null` ou `''`, e os dois viram `0` no
  // `Number()` — o mesmo zero disfarçado. O `0` NUMÉRICO explícito continua
  // aceito ("na hora da reunião" é configuração legítima). Pela tela não
  // acontece (o formulário manda 24 por padrão), mas acontece por API, por
  // importação de modelo, ou se alguém limpar os dois campos.
  // `' '` incluído: `Number(' ')` também é 0 — o trim pega a família toda.
  const ausente = (v: unknown) =>
    v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
  if (ausente(cfg.offset_hours) && ausente(cfg.offset_minutes)) {
    return 'gatilho sem deslocamento (informe horas ou minutos)'
  }

  const horas = Number(cfg.offset_hours)
  const minutos = Number(cfg.offset_minutes)
  if (!ausente(cfg.offset_hours) && (!Number.isFinite(horas) || horas < 0)) {
    return 'deslocamento inválido'
  }
  if (!ausente(cfg.offset_minutes) && (!Number.isFinite(minutos) || minutos < 0)) {
    return 'deslocamento inválido'
  }

  // Teto de um ano: o deslocamento é digitado à mão, e um zero a mais faria a
  // janela cair num passado/futuro sem sentido — buscando valores que nunca
  // existirão e escondendo o erro de digitação.
  if (deslocamentoEmMs(cfg) > 365 * 24 * 3_600_000) {
    return 'deslocamento maior que um ano'
  }
  if (cfg.direction !== 'antes' && cfg.direction !== 'depois') {
    return 'direção inválida (use "antes" ou "depois")'
  }
  return null
}

/**
 * Depois do disparo: a trava deve ser DEVOLVIDA (apagada)?
 *
 * ⚠️⚠️ A trava da 935 é gravada ANTES do disparo — o INSERT é a própria
 * reivindicação, e tem de ser, senão dois ciclos sobrepostos mandam a mesma
 * mensagem duas vezes. Só que o disparo ainda passa pelos RECORTES do motor
 * (conexão, gatilho, escopo de etapa), e um lembrete recusado ali ficava com
 * a trava gravada e NUNCA MAIS saía: a poda é de 90 dias, muito depois da
 * reunião, e a varredura contava o caso como "repetido". Silencioso e
 * definitivo.
 *
 * Medido em 20/09/2026: os quatro lembretes do escritório têm escopo de
 * etapa ("Reunião Agendada"), e o card só chega lá no 5º passo da automação
 * do Calendly — depois de uma chamada de rede. Um ciclo do cron caindo nessa
 * janela de segundos perdia os quatro lembretes daquele cliente.
 *
 * A régua é "NADA rodou, e o disparo não estourou no meio":
 *   - `executadas === 0` garante que nenhuma automação chegou a rodar, logo
 *     nenhuma mensagem saiu — devolver a trava é seguro e o ciclo seguinte
 *     tenta de novo, dentro da mesma janela.
 *   - `erro` preenchido é o catch do dispatch, que pode ter estourado DEPOIS
 *     de uma automação já ter mandado alguma coisa. Ali a trava FICA:
 *     lembrete perdido é ruim, lembrete em dobro é pior.
 */
export function travaDeveSerDevolvida(r: { erro?: string; executadas: number }): boolean {
  return !r.erro && r.executadas === 0
}

/**
 * Tira da lista de alvos os horários que um CANCELAMENTO já travou.
 *
 * ⚠️⚠️ A trava de cancelamento vale para QUALQUER lembrete daquele
 * (contato, valor) — inclusive os criados DEPOIS do cancelamento (Codex, PR
 * #235). O desarme do Calendly pré-arma uma linha por automação EXISTENTE, e
 * a data continua na ficha de propósito; sem esta varredura, uma automação de
 * lembrete criada no intervalo entre o cancelamento e o horário da reunião
 * nasceria sem trava e mandaria o aviso de um evento desmarcado.
 *
 * O par é (contato, valor) porque é isso que identifica O HORÁRIO — a
 * automação é justamente o que não se pode exigir que já exista.
 */
export function semOsCancelados<T extends { contact_id: string; valor: string }>(
  alvos: readonly T[],
  cancelados: readonly { contact_id: string; valor: string }[],
): T[] {
  if (cancelados.length === 0) return [...alvos]
  const mortos = new Set(cancelados.map((c) => `${c.contact_id}\u0000${c.valor}`))
  return alvos.filter((a) => !mortos.has(`${a.contact_id}\u0000${a.valor}`))
}

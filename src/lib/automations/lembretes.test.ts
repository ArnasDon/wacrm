import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  LARGURA_MS,
  semOsCancelados,
  PISO_ANTES_MS,
  deslocamentoEmMs,
  janelaDeBusca,
  larguraDaJanela,
  motivoDeConfigInvalida, travaDeveSerDevolvida } from './lembretes';
import { paraEntradaLocal, deEntradaLocal } from '@/lib/contacts/campo-data';
import type { DateFieldTriggerConfig } from '@/types';

// Uma quinta-feira qualquer, às 12h UTC.
const AGORA = new Date('2026-08-06T12:00:00.000Z').getTime();

describe('janelaDeBusca', () => {
  it('CRÍTICO: "24h antes" procura valores 24h À FRENTE de agora', () => {
    // O erro mais provável desta feature inteira é o sinal invertido — e ele
    // é silencioso: a confirmação de reunião chegaria 24h DEPOIS dela.
    const j = janelaDeBusca(
      { custom_field_id: 'f1', offset_hours: 24, direction: 'antes' },
      AGORA,
    );
    expect(j.ate).toBe('2026-08-07T12:00:00.000Z');
    expect(j.de).toBe('2026-08-07T11:00:00.000Z');
  });

  it('"2h depois" procura valores 2h ATRÁS de agora', () => {
    // Follow-up: "2 horas depois da reunião, pergunte como foi".
    const j = janelaDeBusca(
      { custom_field_id: 'f1', offset_hours: 2, direction: 'depois' },
      AGORA,
    );
    expect(j.ate).toBe('2026-08-06T10:00:00.000Z');
    expect(j.de).toBe('2026-08-06T09:00:00.000Z');
  });

  it('deslocamento zero é "na hora exata"', () => {
    const j = janelaDeBusca(
      { custom_field_id: 'f1', offset_hours: 0, direction: 'antes' },
      AGORA,
    );
    expect(j.ate).toBe('2026-08-06T12:00:00.000Z');
  });

  it('a janela tem exatamente a largura da guarda de atraso', () => {
    // É ela que impede o agendador religado de manhã de despejar os lembretes
    // da noite inteira de uma vez.
    const j = janelaDeBusca(
      { custom_field_id: 'f1', offset_hours: 24, direction: 'antes' },
      AGORA,
    );
    expect(new Date(j.ate).getTime() - new Date(j.de).getTime()).toBe(LARGURA_MS);
  });

  it('deslocamento não numérico não explode a janela', () => {
    const j = janelaDeBusca(
      { custom_field_id: 'f1', offset_hours: NaN, direction: 'antes' },
      AGORA,
    );
    expect(j.ate).toBe('2026-08-06T12:00:00.000Z');
  });
});

describe('motivoDeConfigInvalida', () => {
  it('config completa passa', () => {
    expect(
      motivoDeConfigInvalida({
        custom_field_id: 'f1',
        offset_hours: 24,
        direction: 'antes',
      }),
    ).toBeNull();
  });

  it('sem campo de data não há alvo nem instante', () => {
    expect(motivoDeConfigInvalida({ offset_hours: 24, direction: 'antes' })).toContain(
      'campo de data',
    );
  });

  it('deslocamento negativo é recusado — a direção já é quem dá o sinal', () => {
    expect(
      motivoDeConfigInvalida({
        custom_field_id: 'f1',
        offset_hours: -5,
        direction: 'antes',
      }),
    ).toContain('inválido');
  });

  it('deslocamento absurdo é recusado (zero a mais na digitação)', () => {
    expect(
      motivoDeConfigInvalida({
        custom_field_id: 'f1',
        offset_hours: 24 * 400,
        direction: 'antes',
      }),
    ).toContain('um ano');
  });

  it('direção inválida é recusada', () => {
    expect(
      motivoDeConfigInvalida({
        custom_field_id: 'f1',
        offset_hours: 24,
        direction: 'quando der' as never,
      }),
    ).toContain('direção');
  });
});

// ------------------------------------------------------------
// Fuso do campo de data.
//
// O contêiner roda em UTC e quem digita está em Brasília. Sem estas duas
// conversões, todo lembrete erraria por 3 horas — sem erro nenhum, só
// chegando na hora errada.
// ------------------------------------------------------------

describe('campo de data — ida e volta', () => {
  it('CRÍTICO: o que sai do input volta igual pelo banco', () => {
    // A propriedade que importa: gravar e reler não pode deslocar a hora.
    const digitado = '2026-08-06T14:30';
    const noBanco = deEntradaLocal(digitado);
    expect(paraEntradaLocal(noBanco)).toBe(digitado);
  });

  it('o banco recebe ISO absoluto, com fuso', () => {
    const iso = deEntradaLocal('2026-08-06T14:30');
    // Termina em Z: é instante, não "14:30 em algum lugar".
    expect(iso.endsWith('Z')).toBe(true);
    expect(new Date(iso).getTime()).toBe(
      new Date('2026-08-06T14:30').getTime(),
    );
  });

  it('texto que não é data devolve vazio, não quebra a ficha', () => {
    // O campo é TEXT livre e pode ter qualquer coisa escrita antes de virar
    // data — exatamente o caso que `cb_para_timestamp` também tolera.
    expect(paraEntradaLocal('amanhã de tarde')).toBe('');
    expect(paraEntradaLocal(null)).toBe('');
    expect(deEntradaLocal('')).toBe('');
  });
});

// ============================================================
// Fonte "reunião" e deslocamento em minutos (migration 947).
// ============================================================

describe('deslocamento em minutos (947)', () => {
  it('soma horas e minutos', () => {
    expect(deslocamentoEmMs({ offset_hours: 1, offset_minutes: 30 })).toBe(
      90 * 60_000,
    )
  })

  it('aceita só minutos', () => {
    expect(deslocamentoEmMs({ offset_minutes: 10 })).toBe(10 * 60_000)
  })

  it('config antiga, só com horas, continua valendo', () => {
    expect(deslocamentoEmMs({ offset_hours: 24 })).toBe(24 * 3_600_000)
  })

  it('config vazia é zero, não NaN', () => {
    expect(deslocamentoEmMs({})).toBe(0)
    expect(deslocamentoEmMs({ offset_hours: NaN })).toBe(0)
  })
})

describe('⚠️ largura da janela x deslocamento curto (947)', () => {
  it('deslocamento longo mantém a guarda de 1 hora', () => {
    expect(larguraDaJanela({ offset_hours: 24 })).toBe(LARGURA_MS)
    expect(larguraDaJanela({ offset_hours: 4 })).toBe(LARGURA_MS)
  })

  it('⚠️ deslocamento de 10 min encolhe a janela para 10 min', () => {
    // Com a largura fixa de 1h, este gatilho aceitaria disparar até 50 minutos
    // DEPOIS de a reunião começar — a guarda contra atraso virando a causa do
    // atraso, e o cliente lendo "sua reunião é em 10 minutos" com ela em curso.
    expect(larguraDaJanela({ offset_minutes: 10 })).toBe(10 * 60_000)
  })

  it('a janela de um lembrete de 10 min nunca alcança o passado do alvo', () => {
    const agora = new Date('2026-09-02T12:00:00.000Z').getTime()
    const { de, ate } = janelaDeBusca(
      { offset_minutes: 10, direction: 'antes' },
      agora,
    )
    // O alvo é 12:10; a janela vai de 12:00 a 12:10 — nunca antes de agora.
    expect(ate).toBe('2026-09-02T12:10:00.000Z')
    expect(de).toBe('2026-09-02T12:00:00.000Z')
    expect(new Date(de).getTime()).toBeGreaterThanOrEqual(agora)
  })

  it('⚠️ deslocamento zero usa o PISO, nunca a guarda cheia', () => {
    // "Na hora da reunião" com a guarda de 1h: um agendador religado após
    // uma queda mandava "sua reunião é agora" até 1 HORA depois do início —
    // a afirmação falsa que este módulo existe para impedir. O piso de 5min
    // cobre a cadência real do laço (~60s) e limita o atraso a isso.
    expect(larguraDaJanela({ offset_hours: 0 })).toBe(PISO_ANTES_MS)
    expect(larguraDaJanela({})).toBe(PISO_ANTES_MS)
  })

  it('deslocamento menor que o piso sobe até o piso', () => {
    // Janela menor que o ciclo do agendador (~60-110s com o -m 50 do curl)
    // abriria buracos entre varreduras: "1 minuto antes" nunca dispararia.
    // O preço declarado: um "2 minutos antes" pode chegar até 3 min depois
    // do início — melhor que nunca chegar.
    expect(larguraDaJanela({ offset_minutes: 2 })).toBe(PISO_ANTES_MS)
  })

  it('⚠️ "depois" mantém a guarda CHEIA — encolher perdia follow-up', () => {
    // Follow-up é depois da reunião por definição: atraso não afirma nada
    // de falso ao cliente. Encolhida para o deslocamento, qualquer queda do
    // agendador maior que 30 min perdia os follow-ups do buraco EM SILÊNCIO
    // (a varredura simplesmente não os achava mais). Ledger 48h, r2.
    expect(larguraDaJanela({ offset_minutes: 30, direction: 'depois' })).toBe(
      LARGURA_MS,
    )
    expect(larguraDaJanela({ offset_hours: 0, direction: 'depois' })).toBe(
      LARGURA_MS,
    )
  })
})

describe('validação com a fonte (947)', () => {
  it('⚠️ fonte "reuniao" NÃO exige campo de data', () => {
    // Exigir o campo aqui deixaria o gatilho novo permanentemente inválido.
    expect(
      motivoDeConfigInvalida({
        fonte: 'reuniao',
        offset_hours: 24,
        direction: 'antes',
      }),
    ).toBeNull()
  })

  it('fonte "campo" (e a ausente) continuam exigindo o campo', () => {
    expect(
      motivoDeConfigInvalida({ fonte: 'campo', offset_hours: 24, direction: 'antes' }),
    ).toMatch(/campo de data/)
    expect(
      motivoDeConfigInvalida({ offset_hours: 24, direction: 'antes' }),
    ).toMatch(/campo de data/)
  })

  it('recusa fonte desconhecida', () => {
    expect(
      motivoDeConfigInvalida({
        fonte: 'astrologia' as 'campo',
        offset_hours: 1,
        direction: 'antes',
      }),
    ).toMatch(/fonte/)
  })

  it('aceita só minutos, sem horas', () => {
    expect(
      motivoDeConfigInvalida({
        fonte: 'reuniao',
        offset_minutes: 10,
        direction: 'antes',
      }),
    ).toBeNull()
  })

  it('recusa minutos negativos e mantém o teto de um ano', () => {
    expect(
      motivoDeConfigInvalida({
        fonte: 'reuniao',
        offset_minutes: -5,
        direction: 'antes',
      }),
    ).toMatch(/inválido/)
    expect(
      motivoDeConfigInvalida({
        fonte: 'reuniao',
        offset_hours: 24 * 366,
        direction: 'antes',
      }),
    ).toMatch(/um ano/)
  })
})

describe('⚠️ deslocamento ausente (regressão achada na revisão da 947)', () => {
  it('recusa config sem horas E sem minutos', () => {
    // Antes da 947 isto era recusado por `Number(undefined) = NaN`. Ao dividir
    // o deslocamento em dois campos, a checagem passou a ignorar o caso — e a
    // automação dispararia com deslocamento zero, avisando sobre reuniões que
    // já começaram.
    expect(motivoDeConfigInvalida({ fonte: 'reuniao', direction: 'antes' })).toMatch(
      /sem deslocamento/,
    )
    expect(
      motivoDeConfigInvalida({ custom_field_id: 'x', direction: 'antes' }),
    ).toMatch(/sem deslocamento/)
  })

  it('mas ZERO explícito continua valendo — é "na hora exata"', () => {
    expect(
      motivoDeConfigInvalida({ fonte: 'reuniao', offset_hours: 0, direction: 'antes' }),
    ).toBeNull()
    expect(
      motivoDeConfigInvalida({ fonte: 'reuniao', offset_minutes: 0, direction: 'antes' }),
    ).toBeNull()
  })
})

describe('⚠️ deslocamento "limpo" — null e string vazia (952)', () => {
  // `Number(null)` e `Number('')` são 0 — o zero disfarçado que a guarda de
  // `undefined` deixava passar: config sem deslocamento nenhum era aceita e a
  // janela virava [agora-1h, agora], avisando sobre reunião que JÁ começou.
  // O 0 NUMÉRICO explícito continua válido (teste acima).
  const solto = (cfg: Record<string, unknown>) =>
    motivoDeConfigInvalida(cfg as DateFieldTriggerConfig)

  it('os dois ausentes como null/"" são recusados, como o undefined', () => {
    expect(
      solto({ fonte: 'reuniao', offset_hours: null, offset_minutes: null, direction: 'antes' }),
    ).toMatch(/deslocamento/)
    expect(
      solto({ fonte: 'reuniao', offset_hours: '', offset_minutes: '', direction: 'antes' }),
    ).toMatch(/deslocamento/)
    expect(solto({ fonte: 'reuniao', direction: 'antes' })).toMatch(/deslocamento/)
    // `Number(' ')` também é 0 — espaço não é deslocamento.
    expect(
      solto({ fonte: 'reuniao', offset_hours: '  ', direction: 'antes' }),
    ).toMatch(/deslocamento/)
  })

  it('um null com o outro preenchido vale — null é ausência, não zero inválido', () => {
    expect(
      solto({ fonte: 'reuniao', offset_hours: null, offset_minutes: 30, direction: 'antes' }),
    ).toBeNull()
  })

  it('valor não numérico continua recusado', () => {
    expect(solto({ fonte: 'reuniao', offset_hours: 'abc', direction: 'antes' })).toMatch(
      /inválido/,
    )
  })
})

describe('travaDeveSerDevolvida', () => {
  const r = (x: Partial<{ erro: string; executadas: number }>) => ({ executadas: 0, ...x })

  it('CRÍTICO: recusado pelo recorte devolve a trava — senão o lembrete se perde para sempre', () => {
    // O escopo de etapa dos quatro lembretes do escritório barra o disparo
    // enquanto o card não chegou a "Reunião Agendada". A trava já está
    // gravada nesse ponto, e a poda dela é de 90 dias.
    expect(travaDeveSerDevolvida(r({ executadas: 0 }))).toBe(true)
  })

  it('alguma automação rodou: a trava FICA (lembrete em dobro é pior que perdido)', () => {
    expect(travaDeveSerDevolvida(r({ executadas: 1 }))).toBe(false)
  })

  it('CRÍTICO: disparo que estourou no meio mantém a trava', () => {
    // `erro` é o catch do dispatch, que pode vir DEPOIS de uma automação já
    // ter mandado mensagem. Devolver a trava aqui mandaria de novo.
    expect(travaDeveSerDevolvida(r({ erro: 'banco fora', executadas: 0 }))).toBe(false)
    expect(travaDeveSerDevolvida(r({ erro: 'banco fora', executadas: 2 }))).toBe(false)
  })
})

describe('semOsCancelados', () => {
  const alvo = (contact_id: string, valor: string) => ({ contact_id, valor })

  it('CRÍTICO: tira o horário de uma reunião cancelada, seja de qual automação for', () => {
    // A fonte é o EVENTO do cancelamento, não a trava por automação: aquela
    // é `ON DELETE CASCADE` em `automations`, então apagar o lembrete
    // apagaria a prova de que a reunião foi desmarcada (Codex, PR #235).
    const alvos = [alvo('c1', '2026-09-25T17:00:00.000000Z'), alvo('c2', '2026-09-25T18:00:00.000000Z')]
    const cancelados = [{ contact_id: 'c1', inicio: '2026-09-25 17:00:00+00' }]
    expect(semOsCancelados(alvos, cancelados)).toEqual([alvos[1]])
  })

  it('CRÍTICO: compara INSTANTE, não texto', () => {
    // O campo do contato guarda "…T17:00:00.000000Z" e o PostgREST devolve
    // "… 17:00:00+00". Comparando string, nada casaria e a correção seria
    // enfeite.
    expect(
      semOsCancelados(
        [alvo('c1', '2026-09-25T14:00:00-03:00')],
        [{ contact_id: 'c1', inicio: '2026-09-25 17:00:00+00' }],
      ),
    ).toEqual([])
  })

  it('mesmo contato, OUTRO horário, continua valendo — é o reagendamento', () => {
    const alvos = [alvo('c1', '2026-10-02T17:00:00.000000Z')]
    expect(semOsCancelados(alvos, [{ contact_id: 'c1', inicio: '2026-09-25 17:00:00+00' }])).toEqual(alvos)
  })

  it('mesmo horário, OUTRO contato, continua valendo', () => {
    const alvos = [alvo('c2', '2026-09-25T17:00:00.000000Z')]
    expect(semOsCancelados(alvos, [{ contact_id: 'c1', inicio: '2026-09-25 17:00:00+00' }])).toEqual(alvos)
  })

  it('cancelamento sem horário não tira ninguém', () => {
    const alvos = [alvo('c1', '2026-09-25T17:00:00.000000Z')]
    expect(semOsCancelados(alvos, [{ contact_id: 'c1', inicio: null }])).toEqual(alvos)
  })

  it('sem cancelamento nenhum, a lista passa inteira', () => {
    const alvos = [alvo('c1', 'T17')]
    expect(semOsCancelados(alvos, [])).toEqual(alvos)
  })
})

describe('poda das travas', () => {
  it('uma regra só, 90 dias — o cancelamento não depende mais da trava', () => {
    // A regra especial de 400 dias existia porque a marca do cancelamento
    // morava na trava. Agora a prova é o EVENTO, que não é podado: a poda
    // volta a ser a de sempre (Codex, PR #235).
    const fonte = readFileSync('src/lib/automations/varrer-lembretes.ts', 'utf-8')
    expect(fonte).not.toContain('PODA_DO_CANCELAMENTO_MS')
    expect(fonte).toMatch(/90 \* 86_400_000/)
  })
})

describe('a leitura dos cancelamentos é PAGINADA', () => {
  it('CRÍTICO: a busca de invitee.canceled passa por buscarPaginado e falha fechada', () => {
    // Os eventos de cancelamento nunca são podados, e o PostgREST corta em
    // ~1000 linhas sem avisar (`error` nulo, lista com cara de inteira). Sem
    // o laço paginado, o cancelamento que casa com o alvo do ciclo pode não
    // vir e o lembrete da reunião CANCELADA sai para o cliente (Codex, PR
    // #236). `null` do laço é "não confie" e tem de cair na falha fechada.
    const fonte = readFileSync('src/lib/automations/varrer-lembretes.ts', 'utf-8')
    // Recorte SEMÂNTICO — do laço paginado até quem consome o resultado —, e
    // não por número de caracteres: um comentário a mais empurrava o `if`
    // para fora da janela e o pino reprovava código correto.
    const inicio = fonte.indexOf('buscarPaginado<')
    const fim = fonte.indexOf('semOsCancelados(encontrados')
    expect(inicio).toBeGreaterThan(-1)
    expect(fim).toBeGreaterThan(inicio)
    const trecho = fonte.slice(inicio, fim)
    expect(trecho).toContain("'invitee.canceled'")
    expect(trecho).toContain('buscarPaginado')
    // ⚠️ Ordem de INSERÇÃO: `id` é uuid aleatório, e paginar só por ele deixa
    // uma linha nova entrar numa página já lida (Codex, PR #237).
    expect(trecho).toMatch(/\.order\('recebido_em'/)
    expect(trecho.indexOf(".order('recebido_em'")).toBeLessThan(trecho.indexOf(".order('id'"))
    expect(trecho).toMatch(/\.range\(/)
    expect(trecho).toMatch(/count: 'exact'/)
    expect(trecho).toMatch(/if \(!cancelados\)/)
  })
})

describe('o filtro do cancelamento é só do lembrete por CAMPO', () => {
  it('CRÍTICO: lembrete de AGENDA não passa pelo filtro do Calendly', async () => {
    // Com `fonte: 'reuniao'` o alvo vem de `cb_meetings`. Um cancelamento do
    // Calendly no mesmo instante mataria o lembrete de uma reunião do CRM
    // que continua de pé — e a RPC da agenda já exclui a `cancelada`, que é
    // o caminho dela (Codex, PR #236).
    const fonte = readFileSync('src/lib/automations/varrer-lembretes.ts', 'utf-8')
    expect(fonte).toMatch(/if \(!daAgenda && encontrados\.length > 0\)/)
  })
})

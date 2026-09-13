import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { AVISAR_EXPIRACAO_EM_DIAS, CODIGOS_DO_ASAAS, ESTADOS_DO_WEBHOOK, ORIGENS_DO_VINCULO, cartaoDoAsaas, codigoConhecido, diasAte, reguaDoCartao, type ConfigDoAsaas } from './cartao'
import { NOMES_DAS_LISTAS } from './listas'
import { MOTIVOS_DO_CANDIDATO } from './vinculo'

// ============================================================
// O BURACO QUE A METADE DE i18n DESTE TESTE FECHA
//
// O cartão pede o motivo do erro por chave MONTADA
// (`t(\`asaas.motivo.${codigo}\`)`), e chave montada está FORA do alcance do
// portão de i18n do CI — `scripts/i18n-chaves-usadas.mjs` declara isso no
// próprio cabeçalho. É exatamente assim que o cartão do tl;dv ficou com a
// lista de códigos DENTRO do componente e sem ninguém cobrando o dicionário:
// acrescentar um código novo deixaria o CI verde e poria
// `Settings.integracoes.asaas.motivo.x` — cru — na tela do operador.
//
// Por isso a lista mora em `cartao.ts` (perto do tipo do erro) e é ela que
// este teste itera, nos DOIS dicionários.
// ============================================================

const MOTIVOS_DO_VINCULO = [
  'telefone_igual',
  'nono_digito',
  'sufixo_8',
  'email_da_ficha',
  'email_do_calendly',
  'nome',
  'ambiguo',
  'sem_candidato',
] as const

function asaasDoDicionario(arquivo: string): Record<string, Record<string, unknown>> {
  const bruto = JSON.parse(readFileSync(`messages/${arquivo}`, 'utf8'))
  return bruto.Settings.integracoes.asaas
}

describe.each(['pt-BR.json', 'en.json'])('dicionário %s', (arquivo) => {
  const asaas = asaasDoDicionario(arquivo)

  it('CRÍTICO: todo código de erro tem frase', () => {
    const semFrase = CODIGOS_DO_ASAAS.filter((c) => typeof asaas.motivo?.[c] !== 'string')
    expect(semFrase).toEqual([])
  })

  it('CRÍTICO: todo motivo do vínculo tem frase', () => {
    const semFrase = MOTIVOS_DO_VINCULO.filter((m) => typeof asaas.vinculoMotivo?.[m] !== 'string')
    expect(semFrase).toEqual([])
  })

  // As listas do cartão (994) pedem mais quatro famílias de chave montada:
  // o nome de cada lista, a frase de vazio de cada uma, a origem do vínculo
  // e o motivo de cada candidato — e a faixa de atraso dos inadimplentes.
  it('CRÍTICO: toda lista tem nome e frase de vazio', () => {
    expect(NOMES_DAS_LISTAS.filter((n) => typeof asaas.listas?.[n] !== 'string')).toEqual([])
    expect(NOMES_DAS_LISTAS.filter((n) => typeof asaas.vazio?.[n] !== 'string')).toEqual([])
  })

  it('CRÍTICO: toda origem de vínculo e todo motivo de candidato têm frase', () => {
    expect(ORIGENS_DO_VINCULO.filter((o) => typeof asaas.origem?.[o] !== 'string')).toEqual([])
    expect(MOTIVOS_DO_CANDIDATO.filter((m) => typeof asaas.candidatoMotivo?.[m] !== 'string')).toEqual([])
  })

  // O bloco do webhook (997) pede o estado por chave montada
  // (`asaas.webhook.estado.<estado>`); a lista mora em `cartao.ts`.
  it('CRÍTICO: todo estado do webhook tem frase, e o estado nulo também', () => {
    const webhook = asaas.webhook as Record<string, unknown> | undefined
    const estados = (webhook?.estado ?? {}) as Record<string, unknown>
    expect(ESTADOS_DO_WEBHOOK.filter((e) => typeof estados[e] !== 'string')).toEqual([])
    expect(typeof webhook?.nunca).toBe('string')
  })

  it('CRÍTICO: as faixas de atraso têm frase', () => {
    expect(['todas', 'ate_5', 'de_6_a_30', 'mais_de_30'].filter((f) => typeof asaas.faixa?.[f] !== 'string')).toEqual([])
  })
})

describe('codigoConhecido', () => {
  it('reconhece os da lista e recusa o resto', () => {
    expect(codigoConhecido('chave_invalida')).toBe(true)
    expect(codigoConhecido('ambiente_errado')).toBe(true)
    expect(codigoConhecido('inventado')).toBe(false)
  })
})

describe('diasAte', () => {
  // ⚠️ O pino é sobre a armadilha da coluna DATE: `new Date("2026-09-13")` é
  // meia-noite UTC e, no Brasil, cai no dia 12 — a chave pareceria expirar um
  // dia antes do que expira.
  it('conta em dias LOCAIS, não em UTC', () => {
    const agora = new Date(2026, 8, 12, 21, 30) // 12/09/2026, 21:30 local
    expect(diasAte('2026-09-12', agora)).toBe(0)
    expect(diasAte('2026-09-13', agora)).toBe(1)
    expect(diasAte('2026-09-11', agora)).toBe(-1)
  })

  it('devolve null para data que não é AAAA-MM-DD', () => {
    expect(diasAte('12/09/2026', new Date())).toBeNull()
  })
})

describe('cartaoDoAsaas', () => {
  const base: ConfigDoAsaas = {
    chave_nome: 'CRM — produção',
    ambiente: 'producao',
    chave_expira_em: null,
    status: 'conectado',
    last_sync_at: null,
    last_sync_attempt_at: null,
    vencidas_listadas_em: null,
    last_full_sync_at: null,
    sincronizando_desde: null,
    last_error: null,
    created_at: '2026-09-12T10:00:00Z',
  }

  it('sem linha, o cartão não está conectado — e não afirma mais nada', () => {
    const c = cartaoDoAsaas(null)
    expect(c.estado).toBe('nao_conectado')
    expect(c.chaveNome).toBeNull()
    expect(c.sandbox).toBe(false)
    expect(c.diasAteExpirar).toBeNull()
  })

  it('conectado leva o nome da chave e a data da conexão', () => {
    const c = cartaoDoAsaas(base)
    expect(c.estado).toBe('conectado')
    expect(c.chaveNome).toBe('CRM — produção')
    expect(c.conectadoEm).toBe('2026-09-12T10:00:00Z')
  })

  it('o erro só aparece quando o status é erro — senão seria erro velho na tela', () => {
    expect(cartaoDoAsaas({ ...base, last_error: 'limite' }).erro).toBeNull()
    expect(cartaoDoAsaas({ ...base, status: 'erro', last_error: 'limite' }).erro).toBe('limite')
  })

  it('marca o sandbox: os números de lá não são os do escritório', () => {
    expect(cartaoDoAsaas({ ...base, ambiente: 'sandbox' }).sandbox).toBe(true)
  })

  it('"nunca sincronizado" só sem sucesso E sem listagem — a tentativa que falhou não conta', () => {
    expect(cartaoDoAsaas(base).nuncaSincronizado).toBe(true)
    expect(cartaoDoAsaas({ ...base, last_sync_attempt_at: '2026-09-12T11:00:00Z' }).nuncaSincronizado).toBe(true)
    expect(cartaoDoAsaas({ ...base, vencidas_listadas_em: '2026-09-12T11:00:00Z' }).nuncaSincronizado).toBe(false)
    expect(cartaoDoAsaas(null).nuncaSincronizado).toBe(true)
  })

  it('o cadeado do ciclo (995) aparece como "sincronizando desde"', () => {
    expect(cartaoDoAsaas(base).sincronizandoDesde).toBeNull()
    expect(cartaoDoAsaas({ ...base, sincronizando_desde: '2026-09-12T11:00:00Z' }).sincronizandoDesde).toBe('2026-09-12T11:00:00Z')
  })

  it('o webhook (997): linha anterior à migration = nunca tentado; estado desconhecido vira nulo, nunca `as`', () => {
    expect(cartaoDoAsaas(base).webhook).toEqual({ estado: null, erro: null, email: null, religadoPeloCrm: false, conferidoEm: null, ultimoEvento: null, registrado: false })
    const c = cartaoDoAsaas({ ...base, webhook_state: 'ativo', webhook_asaas_id: 'wh_1', webhook_email: 'a@b.c', last_event_at: '2026-09-13T10:00:00Z', webhook_religado_em: '2026-09-12T10:00:00Z' })
    expect(c.webhook.estado).toBe('ativo')
    expect(c.webhook.registrado).toBe(true)
    expect(c.webhook.religadoPeloCrm).toBe(true)
    expect(c.webhook.ultimoEvento).toBe('2026-09-13T10:00:00Z')
    expect(cartaoDoAsaas({ ...base, webhook_state: 'inventado' }).webhook.estado).toBeNull()
    expect(cartaoDoAsaas(null).webhook.estado).toBeNull()
  })

  it('conta os dias até a validade que o operador digitou', () => {
    const agora = new Date(2026, 8, 12)
    const c = cartaoDoAsaas({ ...base, chave_expira_em: '2026-10-01' }, agora)
    expect(c.diasAteExpirar).toBe(19)
    expect(c.diasAteExpirar!).toBeLessThanOrEqual(AVISAR_EXPIRACAO_EM_DIAS)
  })
})

describe('reguaDoCartao (998)', () => {
  const ligada = (trigger_type: string, dias?: number, is_active = true) => ({ trigger_type, trigger_config: dias === undefined ? {} : { dias_de_atraso: dias }, is_active })

  it('linha anterior à migration (ou sem config): desligada, intervalo padrão, nenhuma automação', () => {
    expect(reguaDoCartao(null, [])).toEqual({ ativa: false, ativadaEm: null, intervaloDias: 3, automacoesTotal: 0, automacoesLigadas: 0, marcosRepetidos: [], lembreteRepetido: false })
    expect(reguaDoCartao({}, []).ativa).toBe(false)
  })

  it('conta só as automações dos DOIS gatilhos do Asaas, e as ligadas à parte', () => {
    const r = reguaDoCartao({ regua_ativa: true, regua_ativada_em: '2026-09-13T12:00:00Z', regua_intervalo_dias: 5 }, [
      ligada('asaas_cobranca_vencida', 1),
      ligada('asaas_cobranca_vencida', 5, false),
      ligada('asaas_cobranca_vence_hoje'),
      ligada('keyword', undefined),
    ])
    expect(r).toMatchObject({ ativa: true, ativadaEm: '2026-09-13T12:00:00Z', intervaloDias: 5, automacoesTotal: 3, automacoesLigadas: 2, marcosRepetidos: [], lembreteRepetido: false })
  })

  it('marco repetido é o de duas automações LIGADAS — a desligada não disputa a trava; o lembrete em dobro tem aviso próprio', () => {
    const r = reguaDoCartao({ regua_ativa: false }, [
      ligada('asaas_cobranca_vencida', 5),
      ligada('asaas_cobranca_vencida', 5),
      ligada('asaas_cobranca_vencida', 1),
      ligada('asaas_cobranca_vencida', 1, false),
      ligada('asaas_cobranca_vencida', 30),
      ligada('asaas_cobranca_vencida', 30),
      ligada('asaas_cobranca_vence_hoje'),
      ligada('asaas_cobranca_vence_hoje'),
    ])
    expect(r.marcosRepetidos).toEqual([5, 30])
    expect(r.lembreteRepetido).toBe(true)
  })
})

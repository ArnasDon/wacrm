import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { AVISAR_EXPIRACAO_EM_DIAS, CODIGOS_DO_ASAAS, cartaoDoAsaas, codigoConhecido, diasAte, type ConfigDoAsaas } from './cartao'

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

  it('conta os dias até a validade que o operador digitou', () => {
    const agora = new Date(2026, 8, 12)
    const c = cartaoDoAsaas({ ...base, chave_expira_em: '2026-10-01' }, agora)
    expect(c.diasAteExpirar).toBe(19)
    expect(c.diasAteExpirar!).toBeLessThanOrEqual(AVISAR_EXPIRACAO_EM_DIAS)
  })
})

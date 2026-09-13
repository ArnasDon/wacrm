import { describe, expect, it } from 'vitest'

import type { ClienteDoAsaas, CobrancaDoAsaas } from './leitura'
import {
  contarClientes,
  contarCobrancas,
  decidirVinculo,
  diasDeAtraso,
  faixaDeAtraso,
  fimDoTelefone,
  formatoDoTelefone,
  indicesDoCrm,
  primeiroNome,
  type ContatoDoCrm,
} from './levantamento'

function cliente(p: Partial<ClienteDoAsaas> = {}): ClienteDoAsaas {
  return {
    id: 'cus_1',
    nome: '',
    email: null,
    celular: null,
    telefone: null,
    cpfCnpj: null,
    tipoDePessoa: null,
    apagado: false,
    referenciaExterna: null,
    notificacoesDesligadas: false,
    ...p,
  }
}

function cobranca(p: Partial<CobrancaDoAsaas> = {}): CobrancaDoAsaas {
  return {
    id: 'pay_1',
    clienteId: 'cus_1',
    status: 'OVERDUE',
    valor: 100,
    jurosEMulta: null,
    vencimento: '2026-09-01',
    vencimentoOriginal: null,
    pagoEm: null,
    forma: 'BOLETO',
    descricao: null,
    parcelamentoId: null,
    parcelaNumero: null,
    assinaturaId: null,
    linkFatura: null,
    linkBoleto: null,
    podePagarAposVencimento: null,
    diasAteCancelarRegistro: null,
    apagado: false,
    ...p,
  }
}

const SEM_CALENDLY = new Map<string, Set<string>>()

describe('mascaramento', () => {
  // O relatório é lido por gente e pode acabar colado num chat: nome
  // completo e número inteiro não entram nele.
  it('só o primeiro nome e os 4 últimos dígitos', () => {
    expect(primeiroNome('Maria Aparecida da Silva')).toBe('Maria')
    expect(primeiroNome('   ')).toBe('—')
    expect(primeiroNome(null)).toBe('—')
    expect(fimDoTelefone('5583988745316')).toBe('…5316')
    expect(fimDoTelefone('12')).toBe('—')
    expect(fimDoTelefone(null)).toBe('—')
  })

  it('do telefone sai a FORMA, nunca o número (C1)', () => {
    expect(formatoDoTelefone('5583988745316')).toBe('13 dígitos, com 55')
    expect(formatoDoTelefone('8388745316')).toBe('10 dígitos, sem 55')
    expect(formatoDoTelefone(null)).toBe('vazio')
  })
})

describe('diasDeAtraso e faixaDeAtraso', () => {
  // ⚠️ `new Date("2026-09-01")` é meia-noite UTC e no Brasil cai em 31/08 —
  // o atraso sairia um dia maior.
  it('conta em dias LOCAIS', () => {
    const agora = new Date(2026, 8, 12, 23, 0)
    expect(diasDeAtraso('2026-09-12', agora)).toBe(0)
    expect(diasDeAtraso('2026-09-11', agora)).toBe(1)
    expect(diasDeAtraso('não é dia', agora)).toBeNull()
  })

  it('as faixas são as do pedido: 1 dia, 5 dias, 30 dias "e assim por diante"', () => {
    expect(faixaDeAtraso(-1)).toBe('ainda não venceu')
    expect(faixaDeAtraso(1)).toBe('até 1 dia')
    expect(faixaDeAtraso(5)).toBe('2 a 5 dias')
    expect(faixaDeAtraso(30)).toBe('6 a 30 dias')
    expect(faixaDeAtraso(400)).toBe('mais de um ano')
  })
})

describe('decidirVinculo', () => {
  const contatos: ContatoDoCrm[] = [
    { id: 'k1', nome: 'Maria Silva', telefone: '5583988745316', email: null },
    // A MESMA pessoa, gravada sem o nono dígito — é como o WhatsApp entrega
    // número antigo, e 380 dos 589 da base estão assim.
    { id: 'k2', nome: 'João Pereira', telefone: '558332215544', email: 'joao@exemplo.com' },
    { id: 'k3', nome: 'Ana Souza', telefone: '5511977778888', email: null },
  ]
  const crm = indicesDoCrm(contatos)

  it('telefone idêntico é telefone idêntico', () => {
    expect(decidirVinculo(cliente({ celular: '5583988745316' }), crm, SEM_CALENDLY)).toEqual({
      motivo: 'telefone_igual',
      contactId: 'k1',
    })
  })

  // ⚠️ A distinção existe para a D5: o que casa a menos do 9 não é "idêntico".
  it('a irmã do nono dígito NÃO se disfarça de telefone idêntico', () => {
    // ficha com 13 dígitos, cliente do Asaas com 12
    expect(decidirVinculo(cliente({ celular: '558388745316' }), crm, SEM_CALENDLY)).toEqual({
      motivo: 'nono_digito',
      contactId: 'k1',
    })
    // e o contrário: ficha com o 9, cliente do Asaas sem ele
    expect(decidirVinculo(cliente({ celular: '551177778888' }), crm, SEM_CALENDLY)).toEqual({
      motivo: 'nono_digito',
      contactId: 'k3',
    })
  })

  it('e-mail da ficha casa quando o telefone não casa', () => {
    expect(decidirVinculo(cliente({ celular: '5599999999999', email: 'joao@exemplo.com' }), crm, SEM_CALENDLY)).toEqual({
      motivo: 'email_da_ficha',
      contactId: 'k2',
    })
  })

  // A ponte que salvou o vínculo do tl;dv: só 1 das 588 fichas tem e-mail,
  // mas os agendamentos do Calendly guardam e-mail JÁ ligado a um contato.
  it('o e-mail visto num agendamento do Calendly vale como ponte', () => {
    const ponte = new Map([['ana@exemplo.com', new Set(['k3'])]])
    expect(decidirVinculo(cliente({ email: 'ana@exemplo.com' }), crm, ponte)).toEqual({
      motivo: 'email_do_calendly',
      contactId: 'k3',
    })
  })

  it('só o sufixo de 8 dígitos é um degrau à parte (D5: vira sugestão)', () => {
    // mesmo final, DDD diferente: não é o mesmo número
    expect(decidirVinculo(cliente({ celular: '5511988745316' }), crm, SEM_CALENDLY)).toEqual({
      motivo: 'sufixo_8',
      contactId: 'k1',
    })
  })

  it('nome é o último degrau, e só sem telefone e sem e-mail que casem', () => {
    expect(decidirVinculo(cliente({ nome: 'ana souza' }), crm, SEM_CALENDLY)).toEqual({ motivo: 'nome', contactId: 'k3' })
  })

  it('sem nada que case, não inventa', () => {
    expect(decidirVinculo(cliente({ celular: '5521999990000', nome: 'Quem Nunca' }), crm, SEM_CALENDLY)).toEqual({
      motivo: 'sem_candidato',
      contactId: null,
    })
  })

  // ⚠️ Duas fichas possíveis PARA a ali, sem descer para o degrau seguinte:
  // lá a régua é mais frouxa, e escolher por ela trocaria uma dúvida por uma
  // afirmação sobre quem deve dinheiro.
  it('mais de um candidato é ambíguo, e não continua procurando', () => {
    const doisIguais = indicesDoCrm([
      { id: 'a', nome: 'Xis', telefone: '5583988745316', email: null },
      { id: 'b', nome: 'Xis', telefone: '5583988745316', email: null },
    ])
    expect(decidirVinculo(cliente({ celular: '5583988745316', nome: 'Xis' }), doisIguais, SEM_CALENDLY)).toEqual({
      motivo: 'ambiguo',
      contactId: null,
    })
  })
})

describe('contarClientes', () => {
  it('separa CPF de CNPJ pelo tamanho e acha documento repetido', () => {
    const c = contarClientes([
      cliente({ id: '1', cpfCnpj: '12345678909', celular: '5583988745316', email: 'a@b.c' }),
      cliente({ id: '2', cpfCnpj: '12345678909', celular: '5583988745316' }),
      cliente({ id: '3', cpfCnpj: '12345678000199' }),
      cliente({ id: '4', apagado: true, notificacoesDesligadas: true, referenciaExterna: 'erp-77' }),
    ])
    expect(c).toMatchObject({
      total: 4,
      apagados: 1,
      comEmail: 1,
      comCpf: 2,
      comCnpj: 1,
      semDocumento: 1,
      semTelefoneNenhum: 2,
      documentosRepetidos: 1,
      telefonesRepetidos: 1,
      notificacoesDesligadas: 1,
      comReferenciaExterna: 1,
    })
  })
})

describe('contarCobrancas', () => {
  const agora = new Date(2026, 8, 12)

  it('soma valores, acha o vencimento mais antigo e conta quem tem ficha', () => {
    const c = contarCobrancas(
      [
        cobranca({ id: 'p1', clienteId: 'cus_1', valor: 100.1, jurosEMulta: 1.5, vencimento: '2026-09-01' }),
        cobranca({ id: 'p2', clienteId: 'cus_2', valor: 200.2, vencimento: '2026-05-01', podePagarAposVencimento: false }),
      ],
      new Set(['cus_1']),
      agora,
    )
    expect(c.vencidas).toBe(2)
    expect(c.clientesComVencida).toBe(2)
    expect(c.clientesComVencidaEFicha).toBe(1)
    expect(c.valorVencido).toBe(300.3)
    expect(c.jurosAcumulado).toBe(1.5)
    expect(c.vencimentoMaisAntigo).toBe('2026-05-01')
    expect(c.boletoJaNaoPagavel).toBe(1)
    expect(c.porFaixaDeAtraso).toEqual({ '6 a 30 dias': 1, '91 a 365 dias': 1 })
  })

  // É o que decide a D11: duas parcelas no mesmo dia viram UMA mensagem.
  it('acha o cliente com duas parcelas vencendo no mesmo dia', () => {
    const c = contarCobrancas(
      [
        cobranca({ id: 'p1', clienteId: 'cus_1', vencimento: '2026-09-01' }),
        cobranca({ id: 'p2', clienteId: 'cus_1', vencimento: '2026-09-01' }),
        cobranca({ id: 'p3', clienteId: 'cus_2', vencimento: '2026-09-01' }),
      ],
      new Set(),
      agora,
    )
    expect(c.clientesComDoisVencimentosNoMesmoDia).toBe(1)
  })
})

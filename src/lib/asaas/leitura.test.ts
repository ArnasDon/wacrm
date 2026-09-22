import { describe, expect, it } from 'vitest'

import { diaParaData, inteiro, lerCliente, lerCobranca, soDigitos } from './leitura'

describe('lerCliente', () => {
  it('normaliza telefone, e-mail e documento', () => {
    const c = lerCliente({
      id: 'cus_1',
      name: 'Maria Silva',
      email: '  Maria@Exemplo.COM ',
      mobilePhone: '(83) 98000-0016',
      phone: '8332215544',
      cpfCnpj: '123.456.789-09',
      personType: 'FISICA',
    })
    expect(c).toMatchObject({
      id: 'cus_1',
      email: 'maria@exemplo.com',
      celular: '5583980000016',
      telefone: '558332215544',
      cpfCnpj: '12345678909',
      tipoDePessoa: 'FISICA',
      apagado: false,
      notificacoesDesligadas: false,
    })
  })

  it('sem id não há o que guardar', () => {
    expect(lerCliente({ name: 'Sem id' })).toBeNull()
    expect(lerCliente(null)).toBeNull()
    expect(lerCliente('texto')).toBeNull()
  })

  it('campo desconhecido é ignorado, campo faltando não derruba a linha', () => {
    const c = lerCliente({ id: 'cus_2', campoQueNaoExistiaOntem: true })
    expect(c).toMatchObject({ id: 'cus_2', nome: '', email: null, celular: null, cpfCnpj: null })
  })

  it('deleted e notificationDisabled só são verdade quando vêm true', () => {
    expect(lerCliente({ id: 'c', deleted: 'true' })?.apagado).toBe(false)
    expect(lerCliente({ id: 'c', deleted: true })?.apagado).toBe(true)
    expect(lerCliente({ id: 'c', notificationDisabled: true })?.notificacoesDesligadas).toBe(true)
  })
})

describe('lerCobranca', () => {
  it('lê os campos que a inadimplência usa', () => {
    const cob = lerCobranca({
      id: 'pay_1',
      customer: 'cus_1',
      status: 'OVERDUE',
      value: 1500.5,
      interestValue: 12.34,
      dueDate: '2026-08-10',
      originalDueDate: '2026-08-01',
      installment: 'ins_1',
      installmentNumber: 3,
      billingType: 'BOLETO',
      canBePaidAfterDueDate: false,
      daysAfterDueDateToRegistrationCancellation: 30,
      invoiceUrl: 'https://www.asaas.com/i/abc',
    })
    expect(cob).toMatchObject({
      id: 'pay_1',
      clienteId: 'cus_1',
      status: 'OVERDUE',
      valor: 1500.5,
      jurosEMulta: 12.34,
      vencimento: '2026-08-10',
      vencimentoOriginal: '2026-08-01',
      parcelamentoId: 'ins_1',
      parcelaNumero: 3,
      podePagarAposVencimento: false,
      diasAteCancelarRegistro: 30,
    })
  })

  // ⚠️ A doc devolve vários numéricos como TEXTO, conforme o campo.
  it('installmentNumber vale como número ou como texto', () => {
    expect(lerCobranca({ id: 'p', installmentNumber: '7' })?.parcelaNumero).toBe(7)
    expect(lerCobranca({ id: 'p', installmentNumber: 7 })?.parcelaNumero).toBe(7)
    expect(lerCobranca({ id: 'p', installmentNumber: null })?.parcelaNumero).toBeNull()
  })

  // A data que o CLIENTE reconhece vem primeiro.
  it('pagoEm prefere clientPaymentDate a paymentDate', () => {
    expect(lerCobranca({ id: 'p', clientPaymentDate: '2026-08-11', paymentDate: '2026-08-12' })?.pagoEm).toBe('2026-08-11')
    expect(lerCobranca({ id: 'p', paymentDate: '2026-08-12' })?.pagoEm).toBe('2026-08-12')
  })

  // ⚠️ `canBePaidAfterDueDate` ausente NÃO é `false`: seria afirmar que o
  // boleto já não pode ser pago sobre um dado que não veio.
  it('booleano ausente fica null, não false', () => {
    expect(lerCobranca({ id: 'p' })?.podePagarAposVencimento).toBeNull()
  })
})

describe('soDigitos e inteiro', () => {
  it('soDigitos devolve null quando não sobra dígito', () => {
    expect(soDigitos('123.456.789-09')).toBe('12345678909')
    expect(soDigitos('   ')).toBeNull()
    expect(soDigitos('abc')).toBeNull()
    expect(soDigitos(undefined)).toBeNull()
  })

  it('inteiro recusa texto que não é número', () => {
    expect(inteiro('abc')).toBeNull()
    expect(inteiro('')).toBeNull()
    expect(inteiro(3.9)).toBe(3)
  })
})

describe('diaParaData', () => {
  // ⚠️ A armadilha da coluna DATE deste projeto, aplicada ao `dueDate`.
  it('lê AAAA-MM-DD como meia-noite LOCAL, nunca UTC', () => {
    const d = diaParaData('2026-09-01')
    expect(d?.getFullYear()).toBe(2026)
    expect(d?.getMonth()).toBe(8)
    expect(d?.getDate()).toBe(1)
  })

  it('recusa o que não é AAAA-MM-DD', () => {
    expect(diaParaData('01/09/2026')).toBeNull()
  })
})

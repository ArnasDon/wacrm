import { describe, expect, it } from 'vitest'
import {
  approvalTipoLabel,
  isTextReplyTipo,
  readTextReplyDetails,
  readMeetingSlotDetails,
  readEscalationDetails,
  readBatchDetails,
  formatConfidence,
  formatLeadLabel,
} from './aisdr-live-presentation'

describe('approvalTipoLabel', () => {
  it('labels every documented tipo in PT-PT', () => {
    expect(approvalTipoLabel('reply')).toBe('Resposta proposta')
    expect(approvalTipoLabel('whatsapp_reply')).toBe('Resposta WhatsApp proposta')
    expect(approvalTipoLabel('followup')).toBe('Follow-up proposto')
    expect(approvalTipoLabel('meeting_slot')).toBe('Proposta de horário de reunião')
    expect(approvalTipoLabel('escalation')).toBe('Escalada para revisão humana')
    expect(approvalTipoLabel('invite_batch')).toBe('Lote de convites')
    expect(approvalTipoLabel('whatsapp_batch')).toBe('Lote de mensagens WhatsApp')
  })
})

describe('isTextReplyTipo', () => {
  it('is true for reply/whatsapp_reply/followup only', () => {
    expect(isTextReplyTipo('reply')).toBe(true)
    expect(isTextReplyTipo('whatsapp_reply')).toBe(true)
    expect(isTextReplyTipo('followup')).toBe(true)
    expect(isTextReplyTipo('meeting_slot')).toBe(false)
    expect(isTextReplyTipo('escalation')).toBe(false)
    expect(isTextReplyTipo('invite_batch')).toBe(false)
    expect(isTextReplyTipo('whatsapp_batch')).toBe(false)
  })
})

describe('readTextReplyDetails', () => {
  it('reads all fields when present', () => {
    const result = readTextReplyDetails({
      textoProposto: 'Olá, obrigado pelo contacto.',
      mensagemRecebida: 'Quero saber mais.',
      confidence: 0.87,
      escalationReasons: ['baixa confiança', 'tema sensível'],
    })
    expect(result).toEqual({
      textoProposto: 'Olá, obrigado pelo contacto.',
      mensagemRecebida: 'Quero saber mais.',
      confidence: 0.87,
      escalationReasons: ['baixa confiança', 'tema sensível'],
    })
  })

  it('defaults missing/malformed fields safely', () => {
    const result = readTextReplyDetails({})
    expect(result).toEqual({
      textoProposto: '',
      mensagemRecebida: '',
      confidence: null,
      escalationReasons: [],
    })
  })

  it('filters non-string entries out of escalationReasons', () => {
    const result = readTextReplyDetails({ escalationReasons: ['ok', 5, null, 'outro'] })
    expect(result.escalationReasons).toEqual(['ok', 'outro'])
  })
})

describe('readMeetingSlotDetails', () => {
  it('reads all fields', () => {
    const result = readMeetingSlotDetails({
      textoProposto: 'Fica bem terça às 10h?',
      mensagemRecebida: 'Prefiro de manhã.',
      horarioEscolhido: '2026-08-18T10:00:00Z',
      email: 'lead@example.com',
    })
    expect(result).toEqual({
      textoProposto: 'Fica bem terça às 10h?',
      mensagemRecebida: 'Prefiro de manhã.',
      horarioEscolhido: '2026-08-18T10:00:00Z',
      email: 'lead@example.com',
    })
  })

  it('defaults missing fields to empty strings', () => {
    expect(readMeetingSlotDetails({})).toEqual({
      textoProposto: '',
      mensagemRecebida: '',
      horarioEscolhido: '',
      email: '',
    })
  })
})

describe('readEscalationDetails', () => {
  it('keeps a string rawBrainOutput as-is', () => {
    const result = readEscalationDetails({
      mensagemRecebida: 'Isto é urgente.',
      rawBrainOutput: 'raw text output',
    })
    expect(result.rawBrainOutput).toBe('raw text output')
  })

  it('stringifies an object rawBrainOutput instead of leaving it as [object Object]', () => {
    const result = readEscalationDetails({ rawBrainOutput: { reason: 'ambiguous', score: 0.4 } })
    expect(result.rawBrainOutput).toContain('"reason": "ambiguous"')
    expect(result.rawBrainOutput).not.toContain('[object Object]')
  })

  it('defaults a missing rawBrainOutput to an empty string', () => {
    expect(readEscalationDetails({}).rawBrainOutput).toBe('')
  })
})

describe('readBatchDetails', () => {
  it('reads a full batch with empresas', () => {
    const result = readBatchDetails({
      batchDate: '2026-08-16',
      totalConvites: 12,
      totalEmpresas: 3,
      empresas: [
        { nome: 'Acme Lda', nicho: 'retalho' },
        { nome: 'Beta SA' },
      ],
    })
    expect(result).toEqual({
      batchDate: '2026-08-16',
      totalConvites: 12,
      totalEmpresas: 3,
      empresas: [
        { nome: 'Acme Lda', nicho: 'retalho' },
        { nome: 'Beta SA', nicho: null },
      ],
    })
  })

  it('defaults a missing/malformed batch safely', () => {
    expect(readBatchDetails({})).toEqual({
      batchDate: '',
      totalConvites: null,
      totalEmpresas: null,
      empresas: [],
    })
  })

  it('gives an unnamed empresa entry a PT-PT fallback name', () => {
    const result = readBatchDetails({ empresas: [{ nicho: 'saúde' }] })
    expect(result.empresas).toEqual([{ nome: 'Empresa sem nome', nicho: 'saúde' }])
  })
})

describe('formatConfidence', () => {
  it('formats a high confidence as a percentage with tier "alta"', () => {
    expect(formatConfidence(0.92)).toEqual({ label: '92% de confiança', tier: 'alta' })
  })

  it('formats a mid confidence with tier "media"', () => {
    expect(formatConfidence(0.6)).toEqual({ label: '60% de confiança', tier: 'media' })
  })

  it('formats a low confidence with tier "baixa"', () => {
    expect(formatConfidence(0.2)).toEqual({ label: '20% de confiança', tier: 'baixa' })
  })

  it('returns the unknown-confidence label for null', () => {
    expect(formatConfidence(null)).toEqual({
      label: 'Confiança desconhecida',
      tier: 'desconhecida',
    })
  })

  it('clamps out-of-range values instead of producing a nonsense percentage', () => {
    expect(formatConfidence(1.5)).toEqual({ label: '100% de confiança', tier: 'alta' })
    expect(formatConfidence(-0.5)).toEqual({ label: '0% de confiança', tier: 'baixa' })
  })
})

describe('formatLeadLabel', () => {
  it('combines nome and empresa when both exist', () => {
    expect(formatLeadLabel({ nome: 'Maria Silva', empresa: 'Acme Lda' })).toBe(
      'Maria Silva · Acme Lda',
    )
  })

  it('falls back to just nome without an empresa', () => {
    expect(formatLeadLabel({ nome: 'Maria Silva' })).toBe('Maria Silva')
  })

  it('returns the PT-PT no-contact fallback for a null lead', () => {
    expect(formatLeadLabel(null)).toBe('Sem contacto associado')
  })
})

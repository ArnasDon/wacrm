// ============================================================
// Pure presentation helpers for the "SDR ao vivo" page — no I/O, no
// React, so these are cheap to unit test in isolation from the page's
// fetch/polling wiring. Everything here maps the AI SDR worker's
// `detalhes` shape (which varies by `tipo`) into strings the page can
// render directly, in PT-PT.
// ============================================================

import type { ApprovalDetalhes, ApprovalTipo } from './aisdr-live-client'

/** Human label for each `tipo`, PT-PT. */
export function approvalTipoLabel(tipo: ApprovalTipo): string {
  switch (tipo) {
    case 'reply':
      return 'Resposta proposta'
    case 'whatsapp_reply':
      return 'Resposta WhatsApp proposta'
    case 'followup':
      return 'Follow-up proposto'
    case 'meeting_slot':
      return 'Proposta de horário de reunião'
    case 'escalation':
      return 'Escalada para revisão humana'
    case 'invite_batch':
      return 'Lote de convites'
    case 'whatsapp_batch':
      return 'Lote de mensagens WhatsApp'
    default: {
      // Exhaustiveness guard — a new `tipo` added on the AI SDR side
      // without a matching case here falls back to a readable label
      // instead of throwing, so the page degrades gracefully.
      const _exhaustive: never = tipo
      return String(_exhaustive)
    }
  }
}

/** `tipo` values whose `detalhes` includes `textoProposto` +
 *  `mensagemRecebida` (+ optionally `confidence` and
 *  `escalationReasons`) — reply, whatsapp_reply, followup. */
export function isTextReplyTipo(tipo: ApprovalTipo): boolean {
  return tipo === 'reply' || tipo === 'whatsapp_reply' || tipo === 'followup'
}

export interface TextReplyDetails {
  textoProposto: string
  mensagemRecebida: string
  confidence: number | null
  escalationReasons: string[]
}

export function readTextReplyDetails(detalhes: ApprovalDetalhes): TextReplyDetails {
  return {
    textoProposto: typeof detalhes.textoProposto === 'string' ? detalhes.textoProposto : '',
    mensagemRecebida:
      typeof detalhes.mensagemRecebida === 'string' ? detalhes.mensagemRecebida : '',
    confidence: typeof detalhes.confidence === 'number' ? detalhes.confidence : null,
    escalationReasons: Array.isArray(detalhes.escalationReasons)
      ? detalhes.escalationReasons.filter((r): r is string => typeof r === 'string')
      : [],
  }
}

export interface MeetingSlotDetails {
  textoProposto: string
  mensagemRecebida: string
  horarioEscolhido: string
  email: string
}

export function readMeetingSlotDetails(detalhes: ApprovalDetalhes): MeetingSlotDetails {
  return {
    textoProposto: typeof detalhes.textoProposto === 'string' ? detalhes.textoProposto : '',
    mensagemRecebida:
      typeof detalhes.mensagemRecebida === 'string' ? detalhes.mensagemRecebida : '',
    horarioEscolhido:
      typeof detalhes.horarioEscolhido === 'string' ? detalhes.horarioEscolhido : '',
    email: typeof detalhes.email === 'string' ? detalhes.email : '',
  }
}

export interface EscalationDetails {
  mensagemRecebida: string
  rawBrainOutput: string
}

/** `rawBrainOutput` may arrive as a string or an arbitrary JSON value —
 *  always rendered as a readable string, never left as `[object Object]`. */
export function readEscalationDetails(detalhes: ApprovalDetalhes): EscalationDetails {
  const raw = detalhes.rawBrainOutput
  let rawBrainOutput = ''
  if (typeof raw === 'string') {
    rawBrainOutput = raw
  } else if (raw !== undefined && raw !== null) {
    try {
      rawBrainOutput = JSON.stringify(raw, null, 2)
    } catch {
      rawBrainOutput = String(raw)
    }
  }
  return {
    mensagemRecebida:
      typeof detalhes.mensagemRecebida === 'string' ? detalhes.mensagemRecebida : '',
    rawBrainOutput,
  }
}

export interface BatchEmpresa {
  nome: string
  nicho: string | null
}

export interface BatchDetails {
  batchDate: string
  totalConvites: number | null
  totalEmpresas: number | null
  empresas: BatchEmpresa[]
}

export function readBatchDetails(detalhes: ApprovalDetalhes): BatchDetails {
  const empresasRaw = Array.isArray(detalhes.empresas) ? detalhes.empresas : []
  const empresas: BatchEmpresa[] = empresasRaw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      nome: typeof e.nome === 'string' ? e.nome : 'Empresa sem nome',
      nicho: typeof e.nicho === 'string' ? e.nicho : null,
    }))
  return {
    batchDate: typeof detalhes.batchDate === 'string' ? detalhes.batchDate : '',
    totalConvites: typeof detalhes.totalConvites === 'number' ? detalhes.totalConvites : null,
    totalEmpresas: typeof detalhes.totalEmpresas === 'number' ? detalhes.totalEmpresas : null,
    empresas,
  }
}

/** Confidence (0..1) as a PT-PT percentage label with a qualitative tier,
 *  used for badge styling. */
export function formatConfidence(confidence: number | null): {
  label: string
  tier: 'alta' | 'media' | 'baixa' | 'desconhecida'
} {
  if (confidence === null || Number.isNaN(confidence)) {
    return { label: 'Confiança desconhecida', tier: 'desconhecida' }
  }
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100)
  const tier = pct >= 80 ? 'alta' : pct >= 50 ? 'media' : 'baixa'
  return { label: `${pct}% de confiança`, tier }
}

/** Short PT-PT label for a lead, falling back gracefully when the
 *  approval has no associated lead (batches never do). */
export function formatLeadLabel(lead: { nome: string; empresa?: string | null } | null): string {
  if (!lead) return 'Sem contacto associado'
  return lead.empresa ? `${lead.nome} · ${lead.empresa}` : lead.nome
}

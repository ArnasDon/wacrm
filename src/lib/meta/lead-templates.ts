// ============================================================
// lead-templates.ts — os três templates de WhatsApp (um por persona)
// que abrem a janela de 24h assim que um lead entra pelo formulário
// nativo da Meta (Lead Ads).
//
// Por que três variantes: o anúncio de Lead Ads é segmentado por
// persona (CEO / director comercial / empresário — mesma segmentação
// já usada na abertura por persona do Click to WhatsApp, ver
// src/lib/ai/commercial.ts). `pickPersonaTemplate` mapeia o `ad_id`
// do lead à variante certa; sem mapeamento conhecido cai no genérico.
//
// Texto: sem travessão, trata o lead por "você", nome como variável
// {{1}}. Corpo aprovado pelo Ricardo em 24/09/2026 (ver a tarefa que
// introduziu este ficheiro) — qualquer alteração ao texto depois de
// submetido implica nova aprovação da Meta (10 edições/30 dias).
// ============================================================

import type { MetaTemplateSubmitPayload } from '../whatsapp/template-components'

export type LeadPersona = 'ceo' | 'diretor_comercial' | 'empresario' | 'generico'

export interface LeadTemplateDefinition {
  /** Nome do template tal como submetido à Meta — snake_case, sem
   *  acentos (exigência da Meta). */
  name: string
  persona: LeadPersona
  language: string
  bodyText: string
  buttons: [string, string]
}

const BODY_TEXT =
  'Olá {{1}}, aqui é o agente de IA da Eter Growth. Deixou o contacto no nosso anúncio sobre responder a clientes no WhatsApp em segundos. Quer que lhe explique como funciona na sua empresa?'

export const LEAD_TEMPLATES: Record<LeadPersona, LeadTemplateDefinition> = {
  ceo: {
    name: 'eter_lead_ads_ceo',
    persona: 'ceo',
    language: 'pt_PT',
    bodyText: BODY_TEXT,
    buttons: ['Sim, explique', 'Agora não'],
  },
  diretor_comercial: {
    name: 'eter_lead_ads_diretor_comercial',
    persona: 'diretor_comercial',
    language: 'pt_PT',
    bodyText: BODY_TEXT,
    buttons: ['Sim, explique', 'Agora não'],
  },
  empresario: {
    name: 'eter_lead_ads_empresario',
    persona: 'empresario',
    language: 'pt_PT',
    bodyText: BODY_TEXT,
    buttons: ['Sim, explique', 'Agora não'],
  },
  // Sem correspondência de ad_id conhecida, ou lead vindo de um
  // formulário/anúncio ainda não mapeado em AD_ID_TO_PERSONA abaixo.
  generico: {
    name: 'eter_lead_ads_generico',
    persona: 'generico',
    language: 'pt_PT',
    bodyText: BODY_TEXT,
    buttons: ['Sim, explique', 'Agora não'],
  },
}

/**
 * Mapa ad_id → persona. Vazio até a campanha de Lead Ads ser criada
 * (fora do âmbito desta tarefa — ver o relatório). Preencher assim
 * que os conjuntos de anúncios por persona existirem; até lá todo o
 * lead cai em `generico`, o que é seguro (mesmo texto, sem menção ao
 * cargo).
 */
export const AD_ID_TO_PERSONA: Record<string, LeadPersona> = {}

export function pickPersonaTemplate(adId: string | null | undefined): LeadTemplateDefinition {
  const persona = (adId && AD_ID_TO_PERSONA[adId]) || 'generico'
  return LEAD_TEMPLATES[persona]
}

/**
 * Traduz uma definição de template local para o payload que
 * POST /{waba_id}/message_templates espera — mesma forma que
 * buildMetaSubmitPayload (template-components.ts) produz a partir de
 * uma linha de `message_templates`, mas construída directamente aqui
 * porque estes três templates nunca passam pela tabela local (não são
 * geridos pelo utilizador na UI, só existem para este fluxo).
 */
export function buildLeadTemplateSubmitPayload(
  def: LeadTemplateDefinition,
): MetaTemplateSubmitPayload {
  return {
    name: def.name,
    category: 'MARKETING',
    language: def.language,
    components: [
      {
        type: 'BODY',
        text: def.bodyText,
        example: { body_text: [['Ricardo']] },
      },
      {
        type: 'BUTTONS',
        buttons: def.buttons.map((text) => ({ type: 'QUICK_REPLY', text })),
      },
    ],
  }
}

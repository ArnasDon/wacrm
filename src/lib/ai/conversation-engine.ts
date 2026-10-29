import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MAX_AI_MEDIA_PER_TURN,
  type AiConfig,
  type AiDecision,
  type AiMediaSendAction,
  type AiUsage,
  type BoundaryType,
  type ChatMessage,
  type PropertyMediaSummary,
} from './types';
import { HANDOFF_SENTINEL, aiRequestTimeoutMs } from './defaults';
import { generateOpenAi } from './providers/openai';
import { generateAnthropic } from './providers/anthropic';
import { generateDeepSeek } from './providers/deepseek';
import { retrievePropertyKnowledge } from './knowledge';
import { latestUserMessage } from './query';
import { getLeadContext, type FormattedLeadContext } from './lead-context';
import {
  getBusinessHoursContext,
  sanitizeOffHoursHandoffResponse,
  type BusinessHoursContext,
} from './business-hours';
import { buildConversationalSystemPrompt } from './prompt-builder';
import {
  getAvailablePropertyMedia,
  validateAndResolveMediaToSend,
  type ResolvedMediaToSend,
} from './property-media-service';
import { retrieveScopedMemories, formatMemoriesForPrompt, loadAgentNames } from './memory';
import { runSecurityGuard, buildSecuritySafeResponse, sanitizeTeamMemberNames, type SecurityViolation } from './security-guard';
import { STAGE_LABELS, type PropertyStage } from '@/types';

export interface ConversationalTurnArgs {
  db: SupabaseClient;
  accountId: string;
  config: AiConfig;
  conversationId?: string | null;
  contactId?: string | null;
  propertyId?: string | null;
  messages: ChatMessage[];
  currentDate?: Date;
  simulatedHours?: 'business_hours' | 'off_hours' | 'real_time';
  simulatedLeadContext?: FormattedLeadContext | null;
  replyCount?: number;
  mode?: 'draft' | 'auto_reply';
}

export interface ConversationalTurnResult {
  responseText: string;
  handoff: boolean;
  decision: AiDecision;
  usage: AiUsage | null;
  retrievedKnowledgeCount: number;
  retrievedKnowledge: string[];
  systemPrompt: string;
  propertyInfo: { id: string; name: string; stage?: string | null; status?: string | null } | null;
  availableMedia: PropertyMediaSummary[];
  validatedMediaToSend: ResolvedMediaToSend[];
  businessHoursContext: BusinessHoursContext;
  leadContext: FormattedLeadContext | null;
  mediaSendAllowed?: boolean;
  /** Non-empty only when the deterministic security guard rewrote the
   *  response — see security-guard.ts. Never null'd out silently: a
   *  blocked turn always still returns a (safe) responseText. */
  securityGuardViolations?: SecurityViolation[];
}

const VALID_BOUNDARIES = new Set<string>([
  'price',
  'payment_terms',
  'discount_negotiation',
  'availability_check',
  'visit_request',
  'financing_inquiry',
  'reservation',
  'commercial_decision',
  'knowledge_limit',
  'incompatible_demand',
  'human_requested',
  'safety_limit_reached',
  'custom_never_rule',
]);

function normalizeBoundaryType(val: unknown, transferRequired: boolean): BoundaryType {
  if (typeof val === 'string' && VALID_BOUNDARIES.has(val)) {
    return val as BoundaryType;
  }
  return transferRequired ? 'commercial_decision' : null;
}

const HANDOFF_TEXT_PATTERNS: RegExp[] = [
  /(?:vou\s+(?:j[aá]\s+)?(?:te\s+)?(?:direcionar|transferir|conectar|passar|chamar|pedir|encaminhar))/i,
  /(?:j[aá]\s+(?:deixei|vou\s+deixar|estou\s+deixando)\s+(?:(?:o|a|nosso|nossa|seu)\s+)?(?:conversa|atendimento)?\s*(?:direcionad[oa]|registrad[oa]|anotad[oa]|com\s+a\s+nossa\s+equipe))/i,
  /(?:deixei\s+seu\s+atendimento\s+direcionado)/i,
  /(?:vou\s+direcionar\s+seu\s+atendimento)/i,
  /(?:nossa\s+equipe\s+(?:vai|dar[aá]|j[aá]\s+(?:assume|d[aá]))\s+(?:sequ[eê]ncia|seguimento|continuidade|te\s+atender|te\s+detalhar|te\s+passar|te\s+explicar))/i,
  /(?:(?:para|pra)\s+eles\s+(?:darem|seguirem|dar|seguir)\s+(?:seguimento|sequ[eê]ncia|por\s+aqui))/i,
  /(?:eles\s+(?:darem\s+seguimento|darem\s+sequ[eê]ncia|seguirem\s+por\s+aqui))/i,
  /(?:deixo\s+(?:essa\s+parte|isso|valores)?\s*(?:com|para)\s+a?\s*nossa\s+equipe)/i,
  /(?:vale\s+nossa\s+equipe\s+te\s+detalhar)/i,
  /(?:nossa\s+equipe\s+vai\s+te\s+detalhar)/i,
  /(?:transferir\s+nossa\s+conversa)/i,
  /(?:conectar\s+voc[eê]\s+com\s+nossa\s+equipe)/i,
  /(?:passar\s+seu\s+atendimento)/i,
  /(?:passar\s+para\s+o\s+corretor)/i,
  /(?:passar\s+para\s+a\s+nossa\s+equipe)/i,
  /(?:passar\s+pra\s+nossa\s+equipe)/i,
  /(?:(?:especialista|corretor|equipe)\s+vai\s+(?:falar\s+com\s+voc[eê]|entrar\s+em\s+contato|te\s+atender|dar\s+sequ[eê]ncia|dar\s+seguimento))/i,
  /(?:(?:j[aá]\s+vou\s+chamar|vou\s+chamar)\s+(?:o|a|um|uma|nossa)\s+(?:equipe|corretor|especialista))/i,
  /(?:vou\s+pedir\s+pra\s+nossa\s+equipe|vou\s+pedir\s+para\s+a\s+equipe)/i,
  /(?:vou\s+direcionar\s+pra\s+nossa\s+equipe)/i,
  /(?:nossa\s+equipe\s+(?:pode|vai)\s+te\s+passar\s+essas\s+informa[cç][oõ]es)/i,
  /(?:nossa\s+equipe\s+já\s+vai\s+te\s+atender)/i,
  /(?:nossa\s+equipe\s+já\s+assume)/i,
];

/**
 * Detects if the assistant's response text declared that it is transferring,
 * delegating or routing the conversation to a human / the team / the broker.
 */
export function isHandoffDeclaredInText(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  return HANDOFF_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Infers the boundary type from the generated response text or user message.
 */
export function inferBoundaryTypeFromText(responseText: string, userMessage?: string): BoundaryType {
  const combined = `${userMessage || ''} ${responseText || ''}`.toLowerCase();

  if (/pre[çc]o|valor|quanto\s+custa|tabela|investimento|desconto/i.test(combined)) {
    return 'price';
  }
  if (/parcel|fluxo|financiament|entrada|condi[çc][oõ]es?\s+de\s+pagamento|fgts|banco/i.test(combined)) {
    return 'payment_terms';
  }
  if (/visita|agend|conhecer\s+pessoalmente|decorado/i.test(combined)) {
    return 'visit_request';
  }
  if (/disponib|tem\s+unidade|resta|sobrou|vendeu\s+tudo/i.test(combined)) {
    return 'availability_check';
  }
  if (/humano|falar\s+com\s+(?:algu[eé]m|atendente|corretor|pessoa)/i.test(combined)) {
    return 'human_requested';
  }
  if (/construtora|quem\s+constr[oó]i|quem\s+construiu|quem\s+t[aá]\s+construindo/i.test(combined)) {
    return 'custom_never_rule';
  }
  return 'commercial_decision';
}

/**
 * Checks whether the user asked a question on a rigid boundary topic
 * (e.g. price or builder) that requires mandatory handoff.
 */
export function isRigidBoundaryInquiry(userMsg: string): { matches: boolean; boundary: BoundaryType } {
  if (!userMsg || typeof userMsg !== 'string') return { matches: false, boundary: 'commercial_decision' };
  const msg = userMsg.toLowerCase().trim();

  // Price inquiry
  if (
    /(?:qual\s+(?:[eé]\s+)?(?:o\s+)?valor|quanto\s+custa|qual\s+(?:[eé]\s+)?(?:o\s+)?pre[çc]o|tem\s+pre[çc]o|tabela\s+de\s+pre[çc]os?|qual\s+(?:o\s+)?desconto|condi[çc][oõ]es?\s+de\s+pagamento)/i.test(
      msg,
    )
  ) {
    return { matches: true, boundary: 'price' };
  }

  // Builder inquiry
  if (
    /(?:qual\s+(?:[eé]\s+)?(?:a\s+)?construtora|quem\s+(?:[eé]\s+)?(?:a\s+)?construtora|quem\s+constr[oó]i|quem\s+construiu|quem\s+t[aá]\s+construindo)/i.test(
      msg,
    )
  ) {
    return { matches: true, boundary: 'custom_never_rule' };
  }

  return { matches: false, boundary: 'commercial_decision' };
}

/**
 * Parses the raw output from the model, supporting JSON structured decision
 * or graceful fallback to plaintext and [[HANDOFF]] sentinel.
 */
export function parseStructuredDecision(rawText: string): AiDecision {
  if (!rawText || typeof rawText !== 'string') {
    return {
      response_text: '',
      transfer_required: false,
      boundary_type: null,
      reason: null,
      context_summary: null,
      suggested_next_action: null,
    };
  }

  // 1. Try to extract JSON from code block or raw string
  let candidateJson = rawText.trim();

  const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch && fenceMatch[1]) {
    candidateJson = fenceMatch[1].trim();
  } else {
    const firstBrace = rawText.indexOf('{');
    const lastBrace = rawText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      candidateJson = rawText.slice(firstBrace, lastBrace + 1).trim();
    }
  }

  try {
    const parsed = JSON.parse(candidateJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const rec = parsed as Record<string, unknown>;

      const response_text =
        typeof rec.response_text === 'string'
          ? rec.response_text.trim()
          : typeof rec.responseText === 'string'
            ? rec.responseText.trim()
            : typeof rec.reply === 'string'
              ? rec.reply.trim()
              : typeof rec.message === 'string'
                ? rec.message.trim()
                : typeof rec.text === 'string'
                  ? rec.text.trim()
                  : typeof rec.content === 'string'
                    ? rec.content.trim()
                    : typeof rec.resposta === 'string'
                      ? rec.resposta.trim()
                      : typeof rec.texto === 'string'
                        ? rec.texto.trim()
                        : '';

      let transfer_required =
        rec.transfer_required === true ||
        rec.transferRequired === true ||
        rec.transfer === true ||
        rec.handoff === true ||
        (typeof rec.boundary_type === 'string' && rec.boundary_type.length > 0 && rec.boundary_type !== 'none');

      // ARCHITECTURAL BACKSTOP: If the response text declared a handoff,
      // force transfer_required to true to prevent false handoffs ("saying it transfers without transferring").
      if (!transfer_required && isHandoffDeclaredInText(response_text)) {
        transfer_required = true;
      }

      const rawVal = rec.boundary_type ?? rec.boundaryType;
      let boundary_type = normalizeBoundaryType(rawVal, transfer_required);
      if (transfer_required && !rawVal) {
        boundary_type = inferBoundaryTypeFromText(response_text);
      }

      const reason =
        typeof rec.reason === 'string' && rec.reason.trim().length > 0
          ? rec.reason.trim()
          : typeof rec.motivo === 'string' && rec.motivo.trim().length > 0
            ? rec.motivo.trim()
            : transfer_required
              ? 'Transferência para equipe humana indicada no atendimento'
              : null;

      const context_summary =
        typeof rec.context_summary === 'string'
          ? rec.context_summary.trim()
          : typeof rec.contextSummary === 'string'
            ? rec.contextSummary.trim()
            : typeof rec.resumo === 'string'
              ? rec.resumo.trim()
              : null;

      const suggested_next_action =
        typeof rec.suggested_next_action === 'string'
          ? rec.suggested_next_action.trim()
          : typeof rec.suggestedNextAction === 'string'
            ? rec.suggestedNextAction.trim()
            : typeof rec.proxima_acao === 'string'
              ? rec.proxima_acao.trim()
              : null;

      const rawMedia =
        rec.send_media ??
        rec.sendMedia ??
        rec.send_property_media ??
        rec.sendPropertyMedia ??
        rec.media ??
        null;

      let send_media: AiMediaSendAction[] | null = null;
      if (Array.isArray(rawMedia)) {
        send_media = rawMedia
          .filter((m): m is Record<string, unknown> => Boolean(m && typeof m === 'object'))
          .map((m) => ({
            property_id: typeof m.property_id === 'string' ? m.property_id : undefined,
            media_id:
              typeof m.media_id === 'string'
                ? m.media_id.trim()
                : typeof m.id === 'string'
                  ? m.id.trim()
                  : '',
            caption:
              typeof m.caption === 'string'
                ? m.caption.trim()
                : typeof m.description === 'string'
                  ? m.description.trim()
                  : null,
          }))
          .filter((m) => Boolean(m.media_id))
          .slice(0, MAX_AI_MEDIA_PER_TURN);
        if (send_media.length === 0) send_media = null;
      } else if (rawMedia && typeof rawMedia === 'object') {
        const m = rawMedia as Record<string, unknown>;
        const media_id =
          typeof m.media_id === 'string'
            ? m.media_id.trim()
            : typeof m.id === 'string'
              ? m.id.trim()
              : '';
        if (media_id) {
          send_media = [
            {
              property_id: typeof m.property_id === 'string' ? m.property_id : undefined,
              media_id,
              caption:
                typeof m.caption === 'string'
                  ? m.caption.trim()
                  : typeof m.description === 'string'
                    ? m.description.trim()
                    : null,
            },
          ];
        }
      }

      return {
        response_text:
          response_text ||
          (transfer_required
            ? 'Vou conectar você com nossa equipe de especialistas.'
            : rawText.split(HANDOFF_SENTINEL).join('').trim()),
        transfer_required,
        boundary_type,
        reason,
        context_summary,
        suggested_next_action,
        send_media,
      };
    }
  } catch {
    // Fallback if model responded in free text
  }

  const hasSentinel = rawText.includes(HANDOFF_SENTINEL);
  const textDeclaredHandoff = isHandoffDeclaredInText(rawText);
  const isTransfer = hasSentinel || textDeclaredHandoff;
  const cleanText = rawText.split(HANDOFF_SENTINEL).join('').trim();
  const inferredBoundary = isTransfer ? inferBoundaryTypeFromText(cleanText) : null;

  return {
    response_text: cleanText,
    transfer_required: isTransfer,
    boundary_type: inferredBoundary,
    reason: isTransfer ? 'Limite ou transferência identificada no atendimento' : null,
    context_summary: null,
    suggested_next_action: isTransfer ? 'Atendimento humano para continuidade' : null,
  };
}

export type MediaFilterTopic = 'lazer' | 'fachada' | 'planta' | 'piscina' | 'decorado' | 'geral';

export interface MediaAuthorizationResult {
  authorized: boolean;
  reason: string;
  filterTopic?: MediaFilterTopic;
  /** Set only when the triggering text unambiguously named one kind ("foto"/"imagem" vs "vídeo") — lets 8c's auto-resolve avoid mixing a video into a reply that only asked for photos (or vice-versa). Left undefined for generic/visual-target requests, which keep today's untyped behavior. */
  filterKind?: 'image' | 'video';
}

/**
 * Detects which media kind a piece of text unambiguously names — 'image'
 * for foto(s)/imagem(ns), 'video' for vídeo(s). Returns undefined when
 * both, neither, or a generic visual reference ("mostra a área de
 * lazer") is used, so callers fall back to the untyped/mixed behavior
 * that already existed before video support.
 */
function detectMediaKind(text: string): 'image' | 'video' | undefined {
  if (!text) return undefined;
  const mentionsVideo = /\bv[ií]deos?\b/i.test(text);
  const mentionsPhoto = /\b(fotos?|fotografia|imagens?|imagem)\b/i.test(text);
  if (mentionsVideo && !mentionsPhoto) return 'video';
  if (mentionsPhoto && !mentionsVideo) return 'image';
  return undefined;
}

/**
 * Checks whether user explicitly requested media (photos, videos, floorplans, etc.)
 */
export function isExplicitMediaRequest(
  text: string,
): { requested: boolean; topic?: MediaFilterTopic; kind?: 'image' | 'video' } {
  if (!text || typeof text !== 'string') return { requested: false };
  const trimmed = text.trim();

  // Negative check: If user says "não precisa de fotos" or "sem fotos"
  const negativeRegex = /\b(n[aã]o|sem)\s+(?:precisa\s+)?(?:me\s+)?(?:de\s+)?(?:enviar|mandar|compartilhar)?\s*(?:fotos?|imagens?|v[ií]deos?|plantas?)\b/i;
  if (negativeRegex.test(trimmed)) {
    return { requested: false };
  }

  // Direct media noun keywords:
  const directMediaNoun = /\b(fotos?|fotografia|imagens?|imagem|v[ií]deos?|plantas?(?:\s+baixas?)?|perspectivas?|renders?|panor[aâ]micas?)\b/i.test(trimmed);

  // Visual action verbs targeted at specific visual aspects:
  // e.g., "quero ver a área de lazer", "mostra a piscina", "quero ver o apartamento decorado", "mostra a fachada"
  const visualTargetMatch = trimmed.match(
    /\b(ver|olhar|mostr(?:ar?|a|e)|conhecer\s+visualmente)\b.*?(\b(?:[aá]rea\s+de\s+lazer|lazer|piscina|fachada|apartamento(?:\s+decorado)?|decorado|interna|espa[cç]o\s+gourmet|academia|vista|varanda)\b)/i
  );

  if (!directMediaNoun && !visualTargetMatch) {
    return { requested: false };
  }

  // Determine specific topic if present
  let topic: MediaFilterTopic = 'geral';
  if (/\b(fachada|frontal|externa)\b/i.test(trimmed)) {
    topic = 'fachada';
  } else if (/\b(lazer|[aá]rea\s+de\s+lazer|gourmet|quadra|recrea|playground)\b/i.test(trimmed)) {
    topic = 'lazer';
  } else if (/\b(piscina|deck)\b/i.test(trimmed)) {
    topic = 'piscina';
  } else if (/\b(planta|plantas|planta\s+baixa)\b/i.test(trimmed)) {
    topic = 'planta';
  } else if (/\b(decorado|interna|apartamento\s+decorado)\b/i.test(trimmed)) {
    topic = 'decorado';
  }

  return { requested: true, topic, kind: detectMediaKind(trimmed) };
}

// Hoisted to module scope (instead of re-created per call, and shared
// with detectOfferedMediaKind below) — the article group before the
// noun also accepts "um/uma/uns/umas" (not just "algumas"), since a
// video offer is naturally phrased in the singular ("mostrar UM vídeo
// da área de lazer"), unlike photos. An optional "também" is allowed
// right after the verb too — the natural way to offer a second kind of
// media after already showing the first ("Quer que eu te envie também
// um vídeo?").
const MEDIA_OFFER_REGEX = /(?:quer(?: que eu)?|posso|gostaria que eu|deseja que eu|posso te|se quiser(?:,)? posso(?: te)?|posso enviar|posso mandar)\s+(?:te\s+)?(?:envi(?:ar|e|asse)|mand(?:ar|e|asse)|compartilh(?:ar|e)|mostr(?:ar|e))\s+(?:(?:tamb[eé]m|mais|outras?)\s+)?(?:(?:algumas?|um|uma|uns|umas|mais)\s+)?(?:fotos?|imagens?|plantas?|v[ií]deos?)/i;
const MEDIA_QUESTION_OFFER_REGEX = /(?:fotos?|imagens?|plantas?|v[ií]deos?).*?\b(?:quer|gostaria|deseja|posso|te envio|te mando)\b.*?\?/i;
const MEDIA_DIRECT_OFFER_REGEX = /(?:posso te enviar|quer que eu mande|quer ver)\s+(?:as\s+|algumas?\s+|mais\s+)?(?:fotos?|imagens?|plantas?)/i;

/**
 * Checks if the assistant offered media in the immediately preceding turn
 */
export function didAssistantOfferMedia(lastAssistantText: string): boolean {
  if (!lastAssistantText) return false;
  return (
    MEDIA_OFFER_REGEX.test(lastAssistantText) ||
    MEDIA_QUESTION_OFFER_REGEX.test(lastAssistantText) ||
    MEDIA_DIRECT_OFFER_REGEX.test(lastAssistantText)
  );
}

/**
 * Detects which media kind Clara's offer was actually about, using the
 * matched offer clause and respecting whether the turn already delivered photos or videos.
 * When the previous turn already sent photos and the text offered a video
 * (e.g. "Tenho fotos... Se quiser, também posso te mostrar um vídeo."),
 * the pending unfulfilled offer is unambiguously 'video'.
 */
export function detectOfferedMediaKind(
  text: string,
  options?: { alreadySentImagesInTurn?: boolean; alreadySentVideosInTurn?: boolean },
): 'image' | 'video' | undefined {
  if (!text) return undefined;

  // Contextual priority: if images were already sent in this turn, any video offer is the pending one
  if (options?.alreadySentImagesInTurn && /\bv[ií]deos?\b/i.test(text)) {
    return 'video';
  }
  // If videos were already sent in this turn, any photo offer is the pending one
  if (options?.alreadySentVideosInTurn && /\b(fotos?|fotografia|imagens?|imagem|plantas?)\b/i.test(text)) {
    return 'image';
  }

  // Scan offers from last to first (the trailing offer represents the active pending question)
  const patterns = [MEDIA_OFFER_REGEX, MEDIA_QUESTION_OFFER_REGEX, MEDIA_DIRECT_OFFER_REGEX];
  for (const pattern of patterns) {
    const globalPattern = new RegExp(pattern.source, 'gi');
    const matches = Array.from(text.matchAll(globalPattern));
    if (matches.length > 0) {
      const lastMatch = matches[matches.length - 1][0];
      const kind = detectMediaKind(lastMatch);
      if (kind) return kind;
    }
  }
  return detectMediaKind(text);
}

// Closed vocabulary for isAffirmativeConfirmation: only used once
// didAssistantOfferMedia() already confirmed the previous turn was a photo
// offer, so this only has to recognize "yes, that offer" — not judge
// arbitrary positive sentences ("gostei", "legal") as consent, which would
// reopen the old bug of sending photos on any vague sign of interest.
const CONFIRMATION_AFFIRMATIVE =
  '(?:sim|ok|okay|certo|claro|com\\s*certeza|perfeito|beleza|blz|t[aá]\\s*bom|tudo\\s*bem|fechado|gostaria|quero\\s*ver|quero(?:\\s*sim)?|aguardo|fico\\s*no\\s*aguardo|por\\s*favor|fique\\s*[aà]\\s*vontade)';
const CONFIRMATION_ACTION =
  '(?:pode(?:\\s*(?:mandar|enviar|ser|mostrar|sim))?|manda(?:r)?(?:\\s*(?:a[ií]|sim|por\\s*favor))?|envia(?:r)?(?:\\s*(?:a[ií]|sim|por\\s*favor))?|mostr(?:a|e|ar)|mande)';
const CONFIRMATION_TOKEN = `(?:${CONFIRMATION_AFFIRMATIVE}|${CONFIRMATION_ACTION})`;
const CONFIRMATION_REGEX = new RegExp(
  `^${CONFIRMATION_TOKEN}(?:\\s*[,e]?\\s*${CONFIRMATION_TOKEN})*(?:\\s*(?:as\\s*)?fotos?)?$`,
  'i',
);

const RESEND_REGEX = /\b(?:reenvi(?:ar?|e|em)|manda(?:r)?\s+(?:de\s+novo|novamente)|mostra(?:r)?\s+(?:de\s+novo|novamente)|ver\s+(?:de\s+novo|novamente)|mandar?\s+(?:aquelas?|essas?)\s+(?:fotos?|imagens?|v[ií]deos?)\s+(?:novamente|de\s+novo)|pode\s+(?:mandar|enviar|mostrar)\s+(?:essas?|aquelas?)\s+(?:fotos?|imagens?|v[ií]deos?)\s+(?:novamente|de\s+novo))\b/i;

const MORE_MEDIA_REGEX = /\b(?:mais|outras?|adicionais?)\s+(?:fotos?|imagens?|v[ií]deos?)\b|\b(?:quero\s+ver\s+mais|mostra\s+mais(?:\s+do\s+projeto)?|tem\s+mais\s+(?:fotos?|imagens?|v[ií]deos?)|manda\s+mais)\b/i;

/**
 * Checks if the user explicitly requested to resend previously sent media.
 */
export function isExplicitResendRequest(userText: string): boolean {
  if (!userText) return false;
  return RESEND_REGEX.test(userText.trim());
}

/**
 * Checks if the user requested "more photos/media" or additional images.
 */
export function isMoreMediaRequest(userText: string): boolean {
  if (!userText) return false;
  const trimmed = userText.trim();
  if (isExplicitResendRequest(trimmed)) return false;
  return MORE_MEDIA_REGEX.test(trimmed);
}

/**
 * Checks if the user gave an affirmative confirmation (e.g. to a previous media offer)
 */
export function isAffirmativeConfirmation(userText: string): boolean {
  if (!userText) return false;
  const trimmed = userText.trim().toLowerCase().replace(/[.!?]+$/g, '').trim();
  return CONFIRMATION_REGEX.test(trimmed);
}

/**
 * Scans conversation history to extract media IDs and filenames of media
 * that the assistant has already sent in this conversation.
 */
export function getSentMediaIdsFromHistory(
  messages: ChatMessage[],
  availableMedia: PropertyMediaSummary[],
): Set<string> {
  const sentIds = new Set<string>();
  const assistantMessages = messages.filter((m) => m.role === 'assistant');
  let genericImageCount = 0;
  let genericVideoCount = 0;

  for (const msg of assistantMessages) {
    const text = msg.content;
    const idMatch = text.match(/\(id:\s*([a-zA-Z0-9_-]+)\)/i);
    if (idMatch && idMatch[1]) {
      sentIds.add(idMatch[1]);
      continue;
    }

    let matchedSpecific = false;
    for (const media of availableMedia) {
      if (media.file_name && text.includes(media.file_name)) {
        sentIds.add(media.id);
        matchedSpecific = true;
      } else if (media.url && text.includes(media.url)) {
        sentIds.add(media.id);
        matchedSpecific = true;
      }
    }

    if (!matchedSpecific) {
      if (/\[(?:Assistente|Clara|Cliente)\s+enviou\s+(?:uma?\s+)?(?:imagem|foto)/i.test(text)) {
        genericImageCount++;
      } else if (/\[(?:Assistente|Clara|Cliente)\s+enviou\s+(?:um\s+)?v[ií]deo/i.test(text)) {
        genericVideoCount++;
      }
    }
  }

  // Fallback for generic untyped markers without IDs/filenames
  if (sentIds.size === 0) {
    const images = availableMedia.filter((m) => m.type === 'image');
    for (let i = 0; i < Math.min(genericImageCount, images.length); i++) {
      sentIds.add(images[i].id);
    }
    const videos = availableMedia.filter((m) => m.type === 'video');
    for (let i = 0; i < Math.min(genericVideoCount, videos.length); i++) {
      sentIds.add(videos[i].id);
    }
  }

  return sentIds;
}

/**
 * Low-level Architectural Guard for property media dispatch.
 */
export function isMediaSendAuthorized(args: {
  messages: ChatMessage[];
  isInitialContact: boolean;
  userMessageCount: number;
}): MediaAuthorizationResult {
  const { messages, isInitialContact, userMessageCount } = args;

  // 1. Get user messages for the current turn (all user messages after the last assistant response)
  const lastAssistantIndex = messages.map((m) => m.role).lastIndexOf('assistant');
  const currentTurnUserMessages = messages
    .slice(lastAssistantIndex + 1)
    .filter((m) => m.role === 'user');

  // 2. Check if the user explicitly requested media in any message of the current turn
  let explicitCheck: { requested: boolean; topic?: MediaFilterTopic; kind?: 'image' | 'video' } = { requested: false };
  for (const uMsg of currentTurnUserMessages) {
    const check = isExplicitMediaRequest(uMsg.content);
    if (check.requested) {
      explicitCheck = check;
      break;
    }
  }

  // 3. Absolute First Turn Gate:
  // If isInitialContact is true or userMessageCount <= 1:
  // Media is ONLY allowed if the user explicitly requested photos/media.
  if (isInitialContact || userMessageCount <= 1) {
    if (explicitCheck.requested) {
      return {
        authorized: true,
        reason: 'Lead explicitou pedido de mídia no primeiro contato.',
        filterTopic: explicitCheck.topic,
        filterKind: explicitCheck.kind,
      };
    }
    return {
      authorized: false,
      reason: 'Primeiro contato sem solicitação explícita de mídia. Envio proibido.',
    };
  }

  // 4. Ongoing Turns:
  // 4a. If user explicitly requested media in this turn (including explicit resend request)
  const isResend = currentTurnUserMessages.some((uMsg) => isExplicitResendRequest(uMsg.content));
  if (explicitCheck.requested || isResend) {
    return {
      authorized: true,
      reason: isResend
        ? 'Lead solicitou reenvio explícito de mídia.'
        : 'Lead explicitou pedido de mídia na conversa.',
      filterTopic: explicitCheck.topic,
      filterKind: explicitCheck.kind,
    };
  }

  // 4b. If Clara offered media in the previous assistant message and lead gave an affirmative confirmation
  const assistantMessages = messages.filter((m) => m.role === 'assistant');
  const latestUserText = currentTurnUserMessages.length > 0 ? currentTurnUserMessages[currentTurnUserMessages.length - 1].content : '';

  // Identify assistant messages belonging to the turn that made the offer (contiguous block ending at lastAssistantIndex)
  const previousTurnAssistantMessages: ChatMessage[] = [];
  for (let i = lastAssistantIndex; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      previousTurnAssistantMessages.unshift(messages[i]);
    } else {
      break;
    }
  }

  // Find the conversational text message of the assistant in that turn (skipping media markers)
  const previousTurnTextMsg = previousTurnAssistantMessages.find((m) => !m.content.startsWith('['));
  const lastAssistantText = previousTurnTextMsg
    ? previousTurnTextMsg.content
    : assistantMessages.length > 0
      ? assistantMessages[assistantMessages.length - 1].content
      : '';

  if (didAssistantOfferMedia(lastAssistantText) && isAffirmativeConfirmation(latestUserText)) {
    // Check if media was already sent in this previous turn
    const sentImagesInTurn = previousTurnAssistantMessages.some((m) =>
      /\[(?:Assistente|Clara|Cliente)\s+enviou\s+(?:uma?\s+)?(?:imagem|foto)/i.test(m.content)
    );
    const sentVideosInTurn = previousTurnAssistantMessages.some((m) =>
      /\[(?:Assistente|Clara|Cliente)\s+enviou\s+(?:um\s+)?v[ií]deo/i.test(m.content)
    );
    const sentDocumentsInTurn = previousTurnAssistantMessages.some((m) =>
      /\[(?:Assistente|Clara|Cliente)\s+enviou\s+(?:um\s+)?documento/i.test(m.content)
    );

    const offeredKind = detectOfferedMediaKind(lastAssistantText, {
      alreadySentImagesInTurn: sentImagesInTurn,
      alreadySentVideosInTurn: sentVideosInTurn,
    });

    const alreadySentOfferedMedia =
      offeredKind === 'video'
        ? sentVideosInTurn
        : offeredKind === 'image'
          ? sentImagesInTurn
          : (sentImagesInTurn || sentVideosInTurn || sentDocumentsInTurn);

    if (alreadySentOfferedMedia) {
      return {
        authorized: false,
        reason: 'Mídia oferecida já foi efetivamente enviada no turno anterior; confirmação afirmativa do lead não autoriza duplicidade.',
      };
    }

    return {
      authorized: true,
      reason: 'Lead confirmou afirmativamente oferta de fotos/vídeo feita pela Clara no turno anterior.',
      filterTopic: 'geral',
      filterKind: offeredKind,
    };
  }

  return {
    authorized: false,
    reason: 'Nenhuma solicitação ou confirmação de mídia identificada neste turno.',
  };
}

/**
 * Execute a complete conversational turn using Stage 4 behavioral architecture.
 */
export async function executeConversationalTurn(
  args: ConversationalTurnArgs,
): Promise<ConversationalTurnResult> {
  const {
    db,
    accountId,
    config,
    conversationId,
    contactId,
    propertyId,
    messages,
    currentDate = new Date(),
    simulatedHours = 'real_time',
    simulatedLeadContext = null,
    replyCount = 0,
    mode = 'auto_reply',
  } = args;

  // Determine effective date/time based on simulated hours
  let effectiveDate = currentDate;
  if (simulatedHours === 'business_hours') {
    // 14:30 on a Wednesday (America/Sao_Paulo)
    effectiveDate = new Date('2026-09-09T14:30:00-03:00');
  } else if (simulatedHours === 'off_hours') {
    // 22:30 on a Wednesday (America/Sao_Paulo)
    effectiveDate = new Date('2026-09-09T22:30:00-03:00');
  }

  const limitA = typeof config.safetyMessageLimit === 'number' && config.safetyMessageLimit > 0 ? config.safetyMessageLimit : Infinity;
  const limitB = typeof config.autoReplyMaxPerConversation === 'number' && config.autoReplyMaxPerConversation > 0 ? config.autoReplyMaxPerConversation : Infinity;
  const effectiveLimit = Math.min(limitA, limitB);
  const safetyLimit = Number.isFinite(effectiveLimit) ? effectiveLimit : 8;
  const businessHours: BusinessHoursContext = getBusinessHoursContext(config, effectiveDate);

  // 1. Check Safety Message Limit threshold
  if (replyCount >= safetyLimit) {
    const isHours = businessHours.isBusinessHours;
    const fallbackText = isHours
      ? 'Para garantir o melhor atendimento e tirar todas as suas dúvidas com precisão, vou transferir nossa conversa para a nossa equipe, que já dá sequência ao seu atendimento.'
      : 'Para garantir o melhor atendimento com precisão, já deixei nossa conversa registrada para que nossa equipe dê continuidade ao seu atendimento logo no início do nosso expediente.';

    const decision: AiDecision = {
      response_text: fallbackText,
      transfer_required: true,
      boundary_type: 'safety_limit_reached',
      reason: `Limite de segurança de mensagens atingido (${safetyLimit} mensagens).`,
      context_summary: 'Conversa atingiu o limite de mensagens do atendimento automático.',
      suggested_next_action: 'Assumir conversa humana no Inbox.',
    };

    return {
      responseText: decision.response_text,
      handoff: true,
      decision,
      usage: null,
      retrievedKnowledgeCount: 0,
      retrievedKnowledge: [],
      systemPrompt: 'System prompt omitted for safety limit early-out.',
      propertyInfo: null,
      availableMedia: [],
      validatedMediaToSend: [],
      businessHoursContext: businessHours,
      leadContext: null,
    };
  }

  // 2. Load Property Details & Media if propertyId is provided
  let propertyInfo: { id: string; name: string; stage?: string | null; status?: string | null } | null = null;
  let propertyStyleInstructions: string[] = [];
  let availableMedia: PropertyMediaSummary[] = [];
  if (propertyId) {
    try {
      const [propRes, ctxRes, mediaList] = await Promise.all([
        db.from('properties').select('id, name, status').eq('id', propertyId).maybeSingle(),
        db
          .from('property_ai_contexts')
          .select('stage, response_style_instructions')
          .eq('property_id', propertyId)
          .maybeSingle(),
        getAvailablePropertyMedia(db, accountId, propertyId),
      ]);

      if (propRes.data) {
        const rawStage = (ctxRes.data?.stage as PropertyStage) || 'lancamento';
        propertyInfo = {
          id: propRes.data.id,
          name: propRes.data.name,
          stage: STAGE_LABELS[rawStage] || rawStage,
          status: (propRes.data.status as string | null) ?? 'ativo',
        };
      }
      propertyStyleInstructions = Array.isArray(ctxRes.data?.response_style_instructions)
        ? ctxRes.data.response_style_instructions
        : [];
      availableMedia = mediaList;
    } catch (err) {
      console.error('[conversation engine] error loading property info:', err);
    }
  }

  // 2b. Resolve the ad this conversation came from (Meta CTWA referral)
  // and scoped memories (GLOBAL/STYLE/PROPERTY/AD/CONVERSATION) — each
  // group fetched pre-filtered by its own scope+id (see memory.ts), never
  // a single "fetch everything" query, so a bug in one branch can only
  // ever return zero rows for that branch, never someone else's data.
  let adId: string | null = null;
  let adContext: { headline?: string | null; body?: string | null; campaignName?: string | null } | null = null;
  if (conversationId) {
    try {
      const { data: convRow } = await db
        .from('conversations')
        .select('ctwa_referral')
        .eq('id', conversationId)
        .maybeSingle();
      adId = (convRow?.ctwa_referral as { source_id?: string } | null)?.source_id ?? null;
      if (adId) {
        const { data: mapping } = await db
          .from('property_ad_mappings')
          .select('creative_headline, creative_body, campaign_name')
          .eq('account_id', accountId)
          .eq('ad_source_id', adId)
          .maybeSingle();
        if (mapping) {
          adContext = {
            headline: mapping.creative_headline ?? null,
            body: mapping.creative_body ?? null,
            campaignName: mapping.campaign_name ?? null,
          };
        }
      }
    } catch (err) {
      console.error('[conversation engine] error loading ad context:', err);
    }
  }

  const scopedMemories = await retrieveScopedMemories(db, accountId, {
    propertyId,
    adId,
    conversationId,
  }).catch((err) => {
    console.error('[conversation engine] error loading scoped memories:', err);
    return { global: [], style: [], property: [], ad: [], conversation: [] };
  });
  const agentIds = [...scopedMemories.style, ...scopedMemories.global, ...scopedMemories.property]
    .map((m) => m.agentId)
    .filter((v): v is string => Boolean(v));
  const agentNameById = await loadAgentNames(db, agentIds);

  // 3. Load pre-extracted Lead Context (simulated or real DB)
  let leadContext: FormattedLeadContext | null = simulatedLeadContext;
  if (!leadContext && contactId) {
    leadContext = await getLeadContext(db, accountId, contactId);
  }

  // 4. Retrieve isolated RAG Knowledge
  const lastUserMsg = latestUserMessage(messages);
  const rawKnowledge = await retrievePropertyKnowledge(
    db,
    accountId,
    config,
    propertyId,
    lastUserMsg,
    5,
  );

  const knowledgeResult = Array.isArray(rawKnowledge)
    ? {
        propertyChunks: propertyId ? (rawKnowledge as string[]) : [],
        globalChunks: propertyId ? [] : (rawKnowledge as string[]),
        allChunks: rawKnowledge as string[],
        chunks: [],
      }
    : (rawKnowledge || {
        propertyChunks: [],
        globalChunks: [],
        allChunks: [],
        chunks: [],
      });

  // 5. Determine Greeting State (Initial Contact vs Ongoing Conversation)
  const previousAssistantMessages = messages.filter((m) => m.role === 'assistant');
  const userMessages = messages.filter((m) => m.role === 'user');
  const isInitialContact = (replyCount === 0 && previousAssistantMessages.length === 0);
  const userMessageCount = userMessages.length;
  const totalTurns = previousAssistantMessages.length;
  const communicatedContent = previousAssistantMessages
    .map((m) => m.content.trim())
    .filter((txt) => txt.length > 0);

  // 5b. Compute Media Authorization & History State for Prompt and Guard
  const lastAssistantIndex = messages.map((m) => m.role).lastIndexOf('assistant');
  const currentTurnUserMessages = messages
    .slice(lastAssistantIndex + 1)
    .filter((m) => m.role === 'user');
  const isResend = currentTurnUserMessages.some((m) => isExplicitResendRequest(m.content));
  const isMoreMedia = currentTurnUserMessages.some((m) => isMoreMediaRequest(m.content));
  const sentMediaIds = getSentMediaIdsFromHistory(messages, availableMedia);

  const mediaAuth = isMediaSendAuthorized({
    messages,
    isInitialContact,
    userMessageCount,
  });

  // 6. Build Modular System Prompt with structured decision requirement.
  // Every knowledge/memory group is named here once and reused verbatim
  // by the security guard below (§8a-3) — the guard must see EXACTLY
  // what the prompt saw, never a re-derived approximation of it.
  const propertyKnowledgeChunks = propertyId ? knowledgeResult.propertyChunks : [];
  const globalKnowledgeChunks = knowledgeResult.globalChunks;
  const styleMemoriesText = formatMemoriesForPrompt(scopedMemories.style, agentNameById);
  const globalMemoriesText = formatMemoriesForPrompt(scopedMemories.global, agentNameById);
  const propertyMemoriesText = propertyId ? formatMemoriesForPrompt(scopedMemories.property) : [];
  const adMemoriesText = formatMemoriesForPrompt(scopedMemories.ad);
  const conversationMemoriesText = formatMemoriesForPrompt(scopedMemories.conversation);

  const systemPrompt = buildConversationalSystemPrompt({
    config,
    mode: mode || 'auto_reply',
    isInitialContact,
    property: propertyInfo,
    propertyKnowledge: propertyKnowledgeChunks,
    propertyMedia: availableMedia,
    propertyStyleInstructions: propertyId ? propertyStyleInstructions : [],
    globalKnowledge: globalKnowledgeChunks,
    styleMemories: styleMemoriesText,
    globalMemories: globalMemoriesText,
    propertyMemories: propertyMemoriesText,
    adContext,
    adMemories: adMemoriesText,
    conversationMemories: conversationMemoriesText,
    leadContext,
    businessHours,
    structuredOutputRequired: true,
    userMessageCount,
    totalTurns,
    communicatedContent,
    sentMediaIds,
    mediaAuth,
    isMoreMedia,
  });

  // 7. Invoke Provider
  const timeoutMs = aiRequestTimeoutMs();
  const activeKey =
    config.provider === 'deepseek'
      ? (config.deepseekApiKey || config.apiKey)
      : config.apiKey;
  const providerArgs = {
    apiKey: activeKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
  };

  let rawResult;
  if (config.provider === 'openai') {
    rawResult = await generateOpenAi(providerArgs);
  } else if (config.provider === 'deepseek') {
    rawResult = await generateDeepSeek(providerArgs);
  } else {
    rawResult = await generateAnthropic(providerArgs);
  }

  // 8. Parse Decision
  const decision = parseStructuredDecision(rawResult.text);

  // Deterministic Coherence Backstop:
  // If the assistant declared in text that it is transferring / delegating to the team,
  // force transfer_required = true and infer boundary if missing.
  const currentTurnUserMsg = lastUserMsg || ([...messages].reverse().find((m) => m.role === 'user')?.content ?? '');
  if (!decision.transfer_required && isHandoffDeclaredInText(decision.response_text)) {
    decision.transfer_required = true;
    decision.boundary_type = inferBoundaryTypeFromText(decision.response_text, currentTurnUserMsg);
    decision.reason = 'Handoff declarado no texto da assistente';
  }

  // Defensive Post-Processing: Strip accidental greeting formula on ongoing conversations
  if (!isInitialContact && decision.response_text) {
    const stripped = decision.response_text
      .replace(/^(?:boa\s*(?:tarde|noite|madrugada)|bom\s*dia|ol[aá]|oi)[!.,\s-]*/i, '')
      .trim();
    if (stripped.length > 0) {
      decision.response_text = stripped.charAt(0).toUpperCase() + stripped.slice(1);
    }
  }

  // 8a-2. Off-Hours Handoff Architectural Guard (HARD BLOCK against immediate promises at night)
  if (
    !businessHours.isBusinessHours &&
    decision.transfer_required &&
    decision.response_text
  ) {
    const nextPeriodFormatted =
      businessHours.nextBusinessHourFormatted || 'no próximo horário comercial';
    decision.response_text = sanitizeOffHoursHandoffResponse(
      decision.response_text,
      nextPeriodFormatted,
    );
  }

  // 8b. Media Authorization & Deduplication Architectural Guard (HARD BLOCK)
  if (!mediaAuth.authorized) {
    // Hard block: Strip any media that LLM hallucinates or suggests
    decision.send_media = null;

    // Defensive Sanitization: If LLM generated text claiming to attach/send photos when unauthorized,
    // sanitize to avoid confusing the lead.
    if (decision.response_text) {
      decision.response_text = decision.response_text
        .replace(/(?:estou\s+te\s+enviando|aqui\s+est[aã]o|seguem|segue|vou\s+te\s+(?:enviar|mostrar|mandar)|vou\s+(?:enviar|mostrar|mandar|separar))\s+(?:algumas?\s+)?(?:fotos?|imagens?|as\s+fotos?)[^.!?]*[.!?]/gi, '')
        .trim();
    }
  } else {
    // 8c. Media Auto-Resolution / Topic Filtering / Deduplication when authorized:
    const getTopicRegex = (topic?: MediaFilterTopic): RegExp | null => {
      if (!topic || topic === 'geral') return null;
      switch (topic) {
        case 'lazer':
          return /lazer|[aá]rea\s+de\s+lazer|piscina|deck|churrasqueira|gourmet|quadra|recrea|playground/i;
        case 'piscina':
          return /piscina|deck|molhado/i;
        case 'fachada':
          return /fachada|frontal|externa|perspectiva|render/i;
        case 'planta':
          return /planta|layout|baixa/i;
        case 'decorado':
          return /decorado|interna|apartamento|sala|quarto|su[ií]te/i;
        default:
          return null;
      }
    };

    const topicRegex = getTopicRegex(mediaAuth.filterTopic);

    // Deduplication Pool: exclude already-sent media unless lead explicitly requested resend
    const candidateMediaPool = isResend
      ? availableMedia
      : availableMedia.filter((m) => !sentMediaIds.has(m.id));

    // Kind (foto vs vídeo) filter on the candidate pool
    const kindFilteredMedia = mediaAuth.filterKind
      ? candidateMediaPool.filter((m) => m.type === mediaAuth.filterKind)
      : candidateMediaPool;

    const AUTO_RESOLVE_BATCH_SIZE = mediaAuth.filterKind === 'video' ? 1 : 3;

    if (decision.send_media && decision.send_media.length > 0) {
      // Model returned media items — defensively sanitize and enforce kind/resend rules:
      let filtered = decision.send_media;

      // Filter out already sent media if not an explicit resend request
      if (!isResend && sentMediaIds.size > 0) {
        filtered = filtered.filter((sm) => !sentMediaIds.has(sm.media_id));
      }

      // Filter by required kind if mediaAuth has a specific kind
      if (mediaAuth.filterKind && availableMedia.length > 0) {
        const mediaById = new Map(availableMedia.map((m) => [m.id, m]));
        filtered = filtered.filter((sm) => {
          const item = mediaById.get(sm.media_id);
          return item ? item.type === mediaAuth.filterKind : true;
        });
      }

      // Filter by topic if applicable
      if (topicRegex) {
        const matchingTopicIds = new Set(
          candidateMediaPool
            .filter((m) => (m.description && topicRegex.test(m.description)) || topicRegex.test(m.file_name))
            .map((m) => m.id),
        );
        if (matchingTopicIds.size > 0) {
          const topicFiltered = filtered.filter((sm) => matchingTopicIds.has(sm.media_id));
          if (topicFiltered.length > 0) {
            filtered = topicFiltered;
          }
        }
      }

      if (filtered.length > 0) {
        decision.send_media = filtered;
      } else if (kindFilteredMedia.length > 0) {
        // Model returned wrong kind (e.g. photos when video was required) or only already-sent items:
        // Auto-resolve from the compliant candidate pool
        console.log(`[conversation engine] Overriding invalid model send_media with compliant candidate pool for property ${propertyId} (kind=${mediaAuth.filterKind || 'any'})`);
        decision.send_media = kindFilteredMedia.slice(0, AUTO_RESOLVE_BATCH_SIZE).map((m) => ({
          property_id: propertyId!,
          media_id: m.id,
          caption: null,
        }));
      } else {
        // No remaining unsent items of required kind (album exhausted)
        decision.send_media = null;
      }
    } else if (propertyId && availableMedia.length > 0) {
      // Model did not attach media — auto-resolve from kindFilteredMedia:
      let filteredMedia = kindFilteredMedia;
      if (topicRegex) {
        const matches = kindFilteredMedia.filter(
          (m) => (m.description && topicRegex.test(m.description)) || topicRegex.test(m.file_name),
        );
        if (matches.length > 0) {
          filteredMedia = matches;
        }
      }

      if (filteredMedia.length > 0) {
        console.log(`[conversation engine] Auto-resolving send_media for property ${propertyId} (${filteredMedia.length} filtered items, sending first ${Math.min(filteredMedia.length, AUTO_RESOLVE_BATCH_SIZE)}, topic=${mediaAuth.filterTopic || 'geral'}, kind=${mediaAuth.filterKind || 'any'})`);
        decision.send_media = filteredMedia.slice(0, AUTO_RESOLVE_BATCH_SIZE).map((m) => ({
          property_id: propertyId,
          media_id: m.id,
          caption: null,
        }));
      } else {
        decision.send_media = null;
      }
    }

    // Defensive Text Alignment:
    // If video was required and sent, but model erroneously wrote "fotos" in response_text, align text:
    if (mediaAuth.filterKind === 'video' && decision.send_media && decision.send_media.length > 0 && decision.response_text) {
      decision.response_text = decision.response_text.replace(
        /(?:mais\s+)?(?:algumas?\s+)?fotos?(?:\s+do\s+projeto|\s+do\s+empreendimento)?/gi,
        'um vídeo',
      );
    }
  }

  // 8d. Security Guard (HARD BLOCK — memory/knowledge can never override
  // a protected rule). Runs LAST, after every other text/media
  // transformation, so it always gets the final say: it inspects only
  // the fully-resolved outgoing text, so it catches a leak regardless of
  // whether the fact came from ai_memories, the legacy RAG (Book/Visão
  // do Corretor), or a model hallucination, and any violation
  // unconditionally clears send_media too — a blocked turn never ships
  // with photos attached. See security-guard.ts for the categories it
  // checks and why.
  const officialPriceKnowledgeTexts = knowledgeResult.chunks
    .filter((c) => c.sourceType === 'pdf_book')
    .map((c) => c.content);

  const allKnowledgeAndMemoryTexts = [
    ...propertyKnowledgeChunks,
    ...globalKnowledgeChunks,
    ...styleMemoriesText,
    ...globalMemoriesText,
    ...propertyMemoriesText,
    ...adMemoriesText,
    ...conversationMemoriesText,
    ...(adContext ? [adContext.headline, adContext.body, adContext.campaignName] : []),
    ...(leadContext?.promptExcerpts ? [leadContext.promptExcerpts] : []),
  ].filter((t): t is string => Boolean(t && t.trim()));

  const securityGuardResult = runSecurityGuard({
    responseText: decision.response_text,
    transferRequired: decision.transfer_required,
    property: propertyInfo,
    allKnowledgeAndMemoryTexts,
    officialPriceKnowledgeTexts,
  });

  if (securityGuardResult.violated) {
    console.error(
      `[conversation engine] SECURITY GUARD blocked response (conv=${conversationId || 'n/a'}, account=${accountId}):`,
      JSON.stringify(securityGuardResult.violations),
    );
    decision.response_text = buildSecuritySafeResponse(businessHours.isBusinessHours);
    decision.transfer_required = true;
    decision.boundary_type = 'custom_never_rule';
    decision.reason = `Bloqueio de segurança determinístico (${securityGuardResult.violations
      .map((v) => v.category)
      .join(', ')})`;
    decision.suggested_next_action =
      'Revisar manualmente o que a IA tentou responder antes de continuar o atendimento — bloqueio automático de segurança acionado.';
    decision.send_media = null;
  }

  // 9. Validate and Resolve any media items requested by the model (strictly when authorized,
  // and never when the security guard just blocked this turn)
  const validatedMediaToSend = mediaAuth.authorized && !securityGuardResult.violated
    ? await validateAndResolveMediaToSend(
        db,
        accountId,
        propertyId || null,
        decision.send_media,
      )
    : [];

  // Deterministic backstop: ensure no personal broker names (Ronaldo, Thatianna) ever leak into outgoing messages
  decision.response_text = sanitizeTeamMemberNames(decision.response_text);

  return {
    responseText: decision.response_text,
    handoff: decision.transfer_required,
    decision,
    usage: rawResult.usage,
    retrievedKnowledgeCount: knowledgeResult.allChunks.length,
    retrievedKnowledge: knowledgeResult.allChunks,
    systemPrompt,
    propertyInfo,
    availableMedia,
    validatedMediaToSend,
    businessHoursContext: businessHours,
    leadContext,
    mediaSendAllowed: mediaAuth.authorized && !securityGuardResult.violated,
    securityGuardViolations: securityGuardResult.violated ? securityGuardResult.violations : undefined,
  };
}

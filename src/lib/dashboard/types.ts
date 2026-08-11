// Shared result shapes the dashboard components consume. Centralised
// here so each component stays thin and the page-level loader wires
// them up without type gymnastics.

export interface MetricDelta {
  current: number
  previous: number
}

export interface MetricsBundle {
  activeConversations: MetricDelta
  newContactsToday: MetricDelta
  openDealsValue: number
  openDealsCount: number
  messagesSentToday: MetricDelta
}

export interface ConversationsSeriesPoint {
  day: string // YYYY-MM-DD local
  incoming: number
  outgoing: number
}

export interface PipelineStageSlice {
  id: string
  name: string
  color: string
  dealCount: number
  totalValue: number
}

export interface PipelineDonutData {
  stages: PipelineStageSlice[]
  totalValue: number
}

export interface ResponseTimeBucket {
  /** 0 = Mon … 6 = Sun (Monday-first). */
  dow: number
  /** Average first-response time in minutes. Null means no samples. */
  avgMinutes: number | null
  samples: number
}

export interface ResponseTimeSummary {
  buckets: ResponseTimeBucket[]
  thisWeekAvg: number | null
  lastWeekAvg: number | null
}

export type ActivityKind =
  | 'message'
  | 'deal'
  | 'broadcast'
  | 'automation'
  | 'contact'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  /** Primary line of text rendered in the feed. Pre-formatted. */
  text: string
  /** ISO timestamp the item happened at, drives relative-time + sort. */
  at: string
  /** Optional deep-link for the whole row (not all items have a target). */
  href?: string
}

// --- 6. Cola de Hoy (DAD §7.4) -----------------------------------------

/** Contacto denormalizado para la tarjeta de la cola. */
export interface TodayQueueContact {
  id: string
  name: string | null
  phone: string
  email: string | null
}

/** Última interacción del deal — vive en conversations (YA existe). */
export interface TodayQueueConversation {
  id: string | null
  last_message_at: string | null
  last_message_text: string | null
}

/** Deal ya normalizado (PostgREST embebe 1:1 como array; aquí nunca es array).
 *  Es lo que consumen los componentes. */
export interface TodayQueueDeal {
  id: string
  title: string
  value: number | null
  currency: string | null
  status: string | null
  stage_id?: string | null
  pipeline_id?: string | null
  /** NO se muestra numéricamente (DAD §7.4: "nada de score numérico"),
   *  pero la query lo trae para derivar chips/secciones. */
  score: number | null
  priority: string | null
  tags: {
    intencion?: number
    respuesta?: number
    documentos?: number
    urgencia?: number
    valor?: number
  } | null
  expected_close_date: string | null
  assignee?: { id: string; full_name: string | null } | null
  contact: TodayQueueContact | null
  conversation: TodayQueueConversation | null
  /** Última automatización ejecutada para este contacto o null. */
  lastAutomation?: { name: string; trigger_event: string } | null
}

/** Forma cruda que devuelve PostgREST (relaciones anidadas como array 1:1).
 *  Solo existe como entrada de `partitionTodayQueue`. */
export type TodayQueueDealRaw = Omit<TodayQueueDeal, 'contact' | 'conversation'> & {
  contact: TodayQueueContact | TodayQueueContact[] | null
  conversation: TodayQueueConversation | TodayQueueConversation[] | null
}

export type TodayQueueSectionKey = 'hot' | 'docs' | 'nurture'

export interface TodayQueueSection {
  key: TodayQueueSectionKey
  deals: TodayQueueDeal[]
}

export interface TodayQueueData {
  /** 🔥 urgencia=2 · ⏳ documentos!=2 · 💤 resto. Ya ordenado dentro de cada
   *  sección (prioridad desc, luego último contacto más reciente). */
  sections: TodayQueueSection[]
  total: number
}

/** Actividad de correo y llamadas del panel de inicio (antes dos pestañas de /reports). */
export interface ChannelActivity {
  days: number
  email: { sent: number; delivered: number; bounced: number }
  calls: { total: number; missed: number; answered: number; totalMinutes: number }
}

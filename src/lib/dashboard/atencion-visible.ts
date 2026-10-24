// Atención del dashboard recalculada en el cliente para el asesor restringido
// (VIS.2, R26/R27). Mismas reglas que la RPC dashboard_overview, pero solo
// sobre las conversaciones visibles. La RPC no se toca (solo interfaz).
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  FailedMessage,
  OverviewAttention,
  QueueItem,
} from '@/lib/dashboard/overview'
import { acotarConsulta } from '@/modulos/visibilidad/consultas'
import type { Visibilidad } from '@/modulos/visibilidad/visibilidad'

const HORA = 3_600_000

export interface ConversacionEnEspera {
  id: string
  contactName: string | null
  contactPhone: string | null
  avatarUrl: string | null
  preview: string | null
  assignedAgentId: string | null
  lastInboundAt: string
  lastReplyAt: string | null
  handedOff: boolean
}

export interface EntradaAtencion {
  conversaciones: ConversacionEnEspera[]
  /** Mensajes del cliente de esas conversaciones. */
  entrantes: { conversationId: string; createdAt: string }[]
  fallidos: FailedMessage[]
  ahora: number
  objetivoMin: number
}

export const ATENCION_VACIA: OverviewAttention = {
  waiting: 0,
  oldestWaitingSince: null,
  waitingOverTarget: 0,
  unassigned: 0,
  windowsClosing: 0,
  failed: 0,
  failedMessages: [],
  queue: [],
}

export function calcularAtencion(e: EntradaAtencion): OverviewAttention {
  const { ahora, objetivoMin } = e

  const enEspera = e.conversaciones
    .filter(
      (c) =>
        c.lastReplyAt === null ||
        Date.parse(c.lastReplyAt) < Date.parse(c.lastInboundAt),
    )
    .map((c) => {
      const desde = c.lastReplyAt === null ? -Infinity : Date.parse(c.lastReplyAt)
      let primero: string | null = null
      for (const m of e.entrantes) {
        if (m.conversationId !== c.id || Date.parse(m.createdAt) <= desde) continue
        if (primero === null || Date.parse(m.createdAt) < Date.parse(primero)) {
          primero = m.createdAt
        }
      }
      return { c, waitingSince: primero ?? c.lastInboundAt }
    })
    .sort((a, b) => Date.parse(a.waitingSince) - Date.parse(b.waitingSince))

  const limiteObjetivo = ahora - objetivoMin * 60_000
  const queue: QueueItem[] = enEspera.slice(0, 6).map(({ c, waitingSince }) => ({
    conversationId: c.id,
    contactName: c.contactName,
    contactPhone: c.contactPhone,
    avatarUrl: c.avatarUrl,
    preview: c.preview ? c.preview.slice(0, 120) : c.preview,
    waitingSince,
    windowClosesAt: new Date(Date.parse(c.lastInboundAt) + 24 * HORA).toISOString(),
    assignedAgentId: c.assignedAgentId,
    handedOff: c.handedOff,
  }))

  const fallidos = [...e.fallidos].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at),
  )

  return {
    waiting: enEspera.length,
    oldestWaitingSince: enEspera[0]?.waitingSince ?? null,
    waitingOverTarget: enEspera.filter(
      (x) => Date.parse(x.waitingSince) < limiteObjetivo,
    ).length,
    // R29: el asesor no ve las conversaciones sin asignar.
    unassigned: 0,
    windowsClosing: enEspera.filter((x) => {
      const t = Date.parse(x.c.lastInboundAt)
      return t > ahora - 24 * HORA && t <= ahora - 22 * HORA
    }).length,
    failed: fallidos.length,
    failedMessages: fallidos.slice(0, 10),
    queue,
  }
}

type Fila = Record<string, unknown>
type Una<T> = T | T[] | null | undefined
const una = <T>(v: Una<T>): T | null | undefined => (Array.isArray(v) ? v[0] : v)

export async function cargarAtencionVisible(
  db: SupabaseClient,
  vis: Visibilidad,
  opts: { ahora: number; objetivoMin: number },
): Promise<OverviewAttention> {
  const baseConv = db
    .from('conversations')
    .select(
      'id, assigned_agent_id, last_message_text, last_inbound_at, last_reply_at, ai_autoreply_disabled, ai_handoff_summary, contact:contacts(name, phone, avatar_url)',
    )
    .neq('status', 'closed')
    .not('last_inbound_at', 'is', null)
  const convQ = acotarConsulta(baseConv, vis)
  if (!convQ) return { ...ATENCION_VACIA }

  const baseFallidos = db
    .from('messages')
    .select(
      'id, conversation_id, content_text, error_code, error_title, created_at, conversations!inner(assigned_agent_id, contacts(name, phone))',
    )
    .neq('sender_type', 'customer')
    .eq('status', 'failed')
    .gte('created_at', new Date(opts.ahora - 24 * HORA).toISOString())
  const fallidosQ = acotarConsulta(
    baseFallidos,
    vis,
    'conversations.assigned_agent_id',
  )

  const [convRes, fallidosRes] = await Promise.all([
    convQ,
    fallidosQ ?? Promise.resolve({ data: [] as Fila[] }),
  ])

  // Un error de consulta no debe verse como "cero pendientes": se propaga y el
  // dashboard muestra su estado de fallo.
  const errorConsulta =
    (convRes as { error?: { message: string } | null }).error ??
    (fallidosRes as { error?: { message: string } | null }).error
  if (errorConsulta) throw new Error(errorConsulta.message)

  type FilaConv = Fila & { id: string; assigned_agent_id: string | null }
  const convs = vis.filtrar((convRes.data ?? []) as FilaConv[])

  const conversaciones: ConversacionEnEspera[] = convs
    .filter(
      (f) =>
        f.last_reply_at == null ||
        Date.parse(f.last_reply_at as string) <
          Date.parse(f.last_inbound_at as string),
    )
    .map((f) => {
      const contacto = una(
        f.contact as Una<{
          name: string | null
          phone: string | null
          avatar_url: string | null
        }>,
      )
      return {
        id: f.id,
        contactName: contacto?.name ?? null,
        contactPhone: contacto?.phone ?? null,
        avatarUrl: contacto?.avatar_url ?? null,
        preview: (f.last_message_text as string | null) ?? null,
        assignedAgentId: f.assigned_agent_id,
        lastInboundAt: f.last_inbound_at as string,
        lastReplyAt: (f.last_reply_at as string | null) ?? null,
        handedOff: Boolean(
          f.ai_autoreply_disabled && f.ai_handoff_summary != null,
        ),
      }
    })

  let entrantes: EntradaAtencion['entrantes'] = []
  if (conversaciones.length > 0) {
    const { data, error } = await db
      .from('messages')
      .select('conversation_id, created_at')
      .eq('sender_type', 'customer')
      .in(
        'conversation_id',
        conversaciones.map((c) => c.id),
      )
    if (error) throw new Error(error.message)
    entrantes = ((data ?? []) as Fila[]).map((m) => ({
      conversationId: m.conversation_id as string,
      createdAt: m.created_at as string,
    }))
  }

  const fallidos: FailedMessage[] = ((fallidosRes.data ?? []) as Fila[])
    .filter((m) => {
      const conv = una(m.conversations as Una<{ assigned_agent_id?: string | null }>)
      return vis.puedeVer({
        id: m.conversation_id as string,
        assigned_agent_id: conv?.assigned_agent_id,
      })
    })
    .map((m) => {
      const conv = una(
        m.conversations as Una<{
          contacts: Una<{ name: string | null; phone: string | null }>
        }>,
      )
      const contacto = una(conv?.contacts)
      const texto = m.content_text as string | null
      return {
        id: m.id as string,
        conversationId: m.conversation_id as string,
        contactName: contacto?.name ?? null,
        contactPhone: contacto?.phone ?? null,
        preview: texto ? texto.slice(0, 120) : texto,
        errorCode: (m.error_code as number | null) ?? null,
        errorTitle: (m.error_title as string | null) ?? null,
        at: m.created_at as string,
      }
    })

  return calcularAtencion({
    conversaciones,
    entrantes,
    fallidos,
    ahora: opts.ahora,
    objetivoMin: opts.objetivoMin,
  })
}

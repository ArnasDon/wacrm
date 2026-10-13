/**
 * Client onboarding forms — the single source of truth for the questions.
 *
 * The Google Apps Script in `scripts/onboarding/alta-formularios.gs` reads
 * this spec from `GET /api/onboarding/form-spec`, builds one Google Form
 * per vertical, and posts every response back to
 * `POST /api/onboarding/intake`. `apply.ts` turns the stored answers into
 * the account's knowledge base, prompt and settings.
 *
 * `target` says where an answer lands:
 *  - `kb`       → a knowledge-base document named by the section's `doc`.
 *  - `prompt`   → the "reglas del negocio" block of the AI prompt (`promptLine`).
 *  - `internal` → only the onboarding report (prices to load in the
 *                 catalog, people to invite, numbers to mute, settings).
 * Price lists are `internal` on purpose: the AI quotes from the catalog,
 * never from free text (VSR price-integrity incident, 2026-09-20).
 */

export type FormVertical = 'hotel' | 'clinica' | 'comercio'
export const FORM_VERTICALS: readonly FormVertical[] = ['hotel', 'clinica', 'comercio']

export const FORM_LABELS: Record<FormVertical, string> = {
  hotel: 'Hotel',
  clinica: 'Clínica',
  comercio: 'Comercio y servicios',
}

/** Account `industry_vertical` each form configures. */
export const FORM_TO_ACCOUNT_VERTICAL: Record<FormVertical, 'hotel' | 'clinica' | 'generic'> = {
  hotel: 'hotel',
  clinica: 'clinica',
  comercio: 'generic',
}

export type QuestionType = 'text' | 'paragraph' | 'choice' | 'checkbox' | 'hour'

export interface Question {
  key: string
  title: string
  help?: string
  type: QuestionType
  options?: string[]
  required?: boolean
  target: 'kb' | 'prompt' | 'internal'
  /** For `prompt` questions: the rule written into the prompt. */
  promptLine?: (answer: string) => string
}

export interface Section {
  title: string
  description?: string
  /** Knowledge-base document title for this section's `kb` answers. */
  doc?: string
  questions: Question[]
}

/** Title of the prefilled code field every form starts with. */
export const CODE_TITLE = 'Código de alta'

const HOURS = Array.from({ length: 18 }, (_, i) => `${i + 6}:00`) // 6:00 … 23:00

const COMMON_START: Section[] = [
  {
    title: 'Tu negocio',
    doc: 'Ficha del negocio',
    questions: [
      { key: 'negocio_nombre', title: 'Nombre comercial', type: 'text', required: true, target: 'kb' },
      {
        key: 'negocio_descripcion',
        title: '¿Qué hace tu negocio?',
        help: 'En 2 o 3 líneas, como se lo explicarías a un cliente.',
        type: 'paragraph',
        required: true,
        target: 'kb',
      },
      { key: 'negocio_direccion', title: 'Dirección y cómo llegar', help: 'Con referencias, como se las dirías a alguien por teléfono.', type: 'paragraph', required: true, target: 'kb' },
      { key: 'negocio_maps', title: 'Enlace de Google Maps', type: 'text', target: 'kb' },
      { key: 'negocio_web', title: 'Sitio web y redes sociales', type: 'paragraph', target: 'kb' },
      {
        key: 'negocio_fotos',
        title: 'Enlace a una carpeta con tu logo y fotos',
        help: 'Google Drive, Dropbox o similar. Si no tienes, envíalas por WhatsApp a tu asesor de SANDÍA.',
        type: 'text',
        target: 'internal',
      },
    ],
  },
  {
    title: 'Tu asistente de IA',
    description: 'Así se va a presentar y comportar la IA que atiende a tus clientes.',
    questions: [
      {
        key: 'ia_nombre',
        title: '¿Con qué nombre se presenta la IA?',
        help: 'Un nombre de persona (ej. "Ana") o "el asistente de [tu negocio]".',
        type: 'text',
        required: true,
        target: 'prompt',
        promptLine: (a) => `Te presentas como ${a}.`,
      },
      {
        key: 'ia_trato',
        title: '¿Cómo trata a los clientes?',
        type: 'choice',
        options: ['De usted', 'De tú'],
        required: true,
        target: 'prompt',
        promptLine: (a) => `Tratas a los clientes ${a.toLowerCase()}.`,
      },
      {
        key: 'ia_tono',
        title: '¿Qué tono prefieres?',
        type: 'choice',
        options: ['Formal y elegante', 'Cálido y cercano', 'Juvenil y relajado'],
        required: true,
        target: 'prompt',
        promptLine: (a) => `Tu tono es ${a.toLowerCase()}.`,
      },
      {
        key: 'ia_nunca',
        title: 'Temas que la IA nunca debe tocar o frases que no quieres que use',
        type: 'paragraph',
        target: 'prompt',
        promptLine: (a) => `Nunca hablas de esto ni usas estas frases: ${a}`,
      },
      {
        key: 'ia_pasar',
        title: '¿Cuándo debe pasar la conversación a una persona de tu equipo?',
        type: 'checkbox',
        options: [
          'Si el cliente se queja',
          'Si pide un descuento o precio especial',
          'Si pide algo fuera de lo normal',
          'Si escribe en otro idioma',
          'Si pide hablar con una persona',
        ],
        target: 'prompt',
        promptLine: (a) => `Pasas la conversación al equipo en estos casos: ${a}.`,
      },
    ],
  },
  {
    title: 'Tu equipo',
    questions: [
      { key: 'equipo_hora_inicio', title: '¿A qué hora empieza a responder tu equipo?', type: 'hour', required: true, target: 'internal' },
      { key: 'equipo_hora_fin', title: '¿A qué hora deja de responder tu equipo?', type: 'hour', required: true, target: 'internal' },
      {
        key: 'equipo_dias',
        title: '¿Qué días atiende tu equipo?',
        type: 'checkbox',
        options: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
        required: true,
        target: 'prompt',
        promptLine: (a) => `El equipo atiende estos días: ${a}.`,
      },
      {
        key: 'equipo_tiempo',
        title: 'Cuando la IA le pasa algo a tu equipo, ¿en cuánto tiempo le pueden responder al cliente?',
        type: 'choice',
        options: ['En menos de 15 minutos', 'En menos de 1 hora', 'El mismo día'],
        required: true,
        target: 'prompt',
        promptLine: (a) => `Cuando pasas algo al equipo, le dices al cliente que le responderán ${a.toLowerCase()} si es en horario de atención; fuera de horario, al inicio del siguiente horario.`,
      },
      {
        key: 'equipo_personas',
        title: 'Personas de tu equipo que van a usar SANDÍA',
        help: 'Nombre, correo y si debe recibir avisos de nuevas solicitudes. Una persona por línea.',
        type: 'paragraph',
        required: true,
        target: 'internal',
      },
      {
        key: 'equipo_telefonos',
        title: 'Números a los que la IA debe dirigir a ciertas personas',
        help: 'Ej. "Proveedores → 5555-0000", "Emergencias → 5555-1111". Uno por línea.',
        type: 'paragraph',
        target: 'prompt',
        promptLine: (a) => `Diriges a estas personas a estos números:\n${a}`,
      },
      {
        key: 'equipo_sin_ia',
        title: 'Números que la IA NO debe contestar',
        help: 'Familia, empleados, proveedores… Esos chats los atiende solo tu equipo.',
        type: 'paragraph',
        target: 'internal',
      },
    ],
  },
]

const COMMON_END: Section[] = [
  {
    title: 'Pagos',
    doc: 'Pagos y facturación',
    description: 'No escribas números de cuenta bancaria: la IA no debe conocerlos. Tu equipo los comparte cuando haga falta.',
    questions: [
      {
        key: 'pago_formas',
        title: 'Formas de pago que aceptas',
        type: 'checkbox',
        options: ['Efectivo', 'Tarjeta', 'Transferencia', 'Depósito', 'Enlace de pago'],
        required: true,
        target: 'kb',
      },
      { key: 'pago_anticipo', title: '¿Pides anticipo? ¿De cuánto y cuándo?', type: 'text', target: 'kb' },
      { key: 'pago_confirmacion', title: '¿Cómo confirma el cliente que ya pagó?', type: 'paragraph', target: 'kb' },
      { key: 'pago_factura', title: '¿Das factura? ¿Qué datos necesitas (NIT, nombre)?', type: 'text', target: 'kb' },
    ],
  },
  {
    title: 'Preguntas frecuentes',
    doc: 'Preguntas frecuentes',
    questions: [
      {
        key: 'faq_lista',
        title: 'Las preguntas que más te hacen y su respuesta',
        help: 'Una por línea: Pregunta → Respuesta.',
        type: 'paragraph',
        required: true,
        target: 'kb',
      },
      {
        key: 'faq_no_ofrecemos',
        title: 'Cosas que NO ofreces pero la gente pregunta',
        help: 'Ej. "No tenemos piscina", "No hacemos envíos al extranjero".',
        type: 'paragraph',
        target: 'kb',
      },
    ],
  },
]

const HOTEL: Section[] = [
  {
    title: 'Habitaciones',
    doc: 'Habitaciones',
    questions: [
      {
        key: 'hotel_habitaciones',
        title: 'Tipos de habitación',
        help: 'Nombre, camas y una descripción corta. Una habitación por línea.',
        type: 'paragraph',
        required: true,
        target: 'kb',
      },
      { key: 'hotel_capacidad', title: 'Capacidad máxima de personas de cada habitación', type: 'paragraph', required: true, target: 'kb' },
      {
        key: 'hotel_precios',
        title: 'Precios por noche de cada habitación',
        help: 'Entre semana y fin de semana, por 1, 2, 3, 4 y 5 personas. Si ya tienes una lista de precios, pégala tal cual: la cargamos en el catálogo para que la IA cotice exacto.',
        type: 'paragraph',
        required: true,
        target: 'internal',
      },
      { key: 'hotel_ninos', title: 'Niños: ¿hasta qué edad pagan como niño, cuánto pagan y hay cunas?', type: 'paragraph', target: 'kb' },
      { key: 'hotel_temporada', title: 'Fechas de temporada alta y cómo cambian los precios', type: 'paragraph', target: 'internal' },
    ],
  },
  {
    title: 'Paquetes y servicios',
    doc: 'Paquetes y servicios',
    questions: [
      { key: 'hotel_paquetes', title: 'Paquetes (romántico, Day Pass, grupos…): qué incluyen y precio', type: 'paragraph', target: 'kb' },
      { key: 'hotel_servicios', title: 'Spa, tours y actividades: precio y duración', type: 'paragraph', target: 'kb' },
      { key: 'hotel_desayuno', title: '¿El desayuno está incluido? ¿En qué horario?', type: 'text', target: 'kb' },
      {
        key: 'hotel_eventos',
        title: 'Eventos y grupos grandes',
        type: 'choice',
        options: ['La IA toma los datos y pasa al equipo', 'Pasan directo al equipo'],
        required: true,
        target: 'prompt',
        promptLine: (a) =>
          a.startsWith('La IA')
            ? 'Para eventos y grupos grandes tomas fecha, número de personas y tipo de evento, y pasas al equipo para la cotización.'
            : 'Las solicitudes de eventos y grupos grandes las pasas directo al equipo, sin cotizar.',
      },
    ],
  },
  {
    title: 'Políticas del hotel',
    doc: 'Políticas del hotel',
    questions: [
      { key: 'hotel_checkin', title: 'Hora de check-in y de check-out', type: 'text', required: true, target: 'kb' },
      { key: 'hotel_early_late', title: '¿Se puede llegar antes o salir más tarde? ¿Cuánto cuesta?', type: 'paragraph', target: 'kb' },
      { key: 'hotel_cancelacion', title: 'Política de cancelación', type: 'paragraph', required: true, target: 'kb' },
      { key: 'hotel_mascotas', title: '¿Aceptan mascotas?', type: 'choice', options: ['Sí', 'No', 'Sí, con costo adicional'], required: true, target: 'kb' },
      { key: 'hotel_extra', title: 'Persona adicional: ¿se acepta y cuánto cuesta?', type: 'text', target: 'kb' },
      {
        key: 'hotel_especiales',
        title: 'Tarifas especiales que la IA NO debe cotizar',
        help: 'Empresas, convenios, vales, tarjetas de regalo… Esas solicitudes pasan directo a tu equipo.',
        type: 'paragraph',
        target: 'prompt',
        promptLine: (a) => `No cotizas estas tarifas especiales; las pasas al equipo: ${a}`,
      },
    ],
  },
]

const CLINICA: Section[] = [
  {
    title: 'Servicios',
    questions: [
      {
        key: 'clinica_servicios',
        title: 'Servicios con precio y duración',
        help: 'Uno por línea. Los cargamos en el catálogo para que la IA dé precios exactos.',
        type: 'paragraph',
        required: true,
        target: 'internal',
      },
      {
        key: 'clinica_sin_precio',
        title: 'Servicios cuyo precio la IA NO debe dar',
        help: 'Los que requieren valoración previa.',
        type: 'paragraph',
        target: 'prompt',
        promptLine: (a) => `No das precio de estos servicios (requieren valoración); ofreces agendar una cita: ${a}`,
      },
    ],
  },
  {
    title: 'Doctores y horarios',
    doc: 'Doctores y horarios',
    questions: [
      { key: 'clinica_doctores', title: 'Doctores: nombre, especialidad, días y horas que atiende', help: 'Uno por línea.', type: 'paragraph', required: true, target: 'kb' },
      { key: 'clinica_duracion', title: 'Duración normal de una cita', type: 'text', target: 'kb' },
      { key: 'clinica_seguros', title: 'Seguros o convenios que aceptan', type: 'paragraph', target: 'kb' },
    ],
  },
  {
    title: 'Citas',
    doc: 'Políticas de citas',
    questions: [
      {
        key: 'clinica_recordatorio',
        title: '¿Cuándo enviamos el recordatorio de la cita?',
        type: 'choice',
        options: ['24 horas antes', '48 horas antes', 'No enviar recordatorio'],
        required: true,
        target: 'internal',
      },
      { key: 'clinica_cancelacion', title: 'Política de cancelación y cambio de cita', type: 'paragraph', required: true, target: 'kb' },
      { key: 'clinica_primera', title: 'Qué debe traer o hacer el paciente en su primera consulta', type: 'paragraph', target: 'kb' },
      {
        key: 'clinica_urgencias',
        title: 'En una urgencia, ¿a qué número o lugar debe dirigir la IA al paciente?',
        type: 'text',
        required: true,
        target: 'prompt',
        promptLine: (a) => `Si el paciente describe una urgencia, le indicas de inmediato: ${a}`,
      },
    ],
  },
]

const COMERCIO: Section[] = [
  {
    title: 'Catálogo',
    questions: [
      {
        key: 'comercio_catalogo',
        title: 'Productos o servicios con precio',
        help: 'Pega tu lista o un enlace a ella. La cargamos en el catálogo.',
        type: 'paragraph',
        required: true,
        target: 'internal',
      },
      {
        key: 'comercio_precios',
        title: '¿La IA puede dar precios?',
        type: 'choice',
        options: ['Sí, los del catálogo', 'No, solo envía el catálogo; los precios los da el equipo'],
        required: true,
        target: 'prompt',
        promptLine: (a) =>
          a.startsWith('Sí')
            ? 'Puedes dar los precios del catálogo, nunca otros.'
            : 'No das precios: envías el catálogo y el equipo cotiza.',
      },
      {
        key: 'comercio_descuentos',
        title: '¿La IA puede ofrecer descuentos?',
        type: 'choice',
        options: ['No, nunca', 'Solo los promocionados en el catálogo'],
        required: true,
        target: 'prompt',
        promptLine: (a) =>
          a.startsWith('No')
            ? 'Nunca ofreces descuentos; si los piden, pasas al equipo.'
            : 'Solo mencionas descuentos que estén publicados en el catálogo.',
      },
      {
        key: 'comercio_envio_catalogo',
        title: '¿Cómo prefieres enviar el catálogo?',
        type: 'choice',
        options: ['Enlace web', 'PDF', 'Fotos'],
        required: true,
        target: 'internal',
      },
    ],
  },
  {
    title: 'Ventas y envíos',
    doc: 'Ventas y envíos',
    questions: [
      {
        key: 'comercio_datos',
        title: 'Datos que la IA debe pedir para cotizar',
        help: 'Ej. medidas, cantidades, colores, fecha en que lo necesita.',
        type: 'paragraph',
        target: 'prompt',
        promptLine: (a) => `Para cotizar pides estos datos, uno o dos por mensaje: ${a}`,
      },
      { key: 'comercio_envios', title: 'Envíos: zonas, costo y tiempo de entrega', type: 'paragraph', target: 'kb' },
      { key: 'comercio_garantia', title: 'Garantía, cambios y devoluciones', type: 'paragraph', target: 'kb' },
      { key: 'comercio_tienda', title: 'Tienda física: dirección y horario', type: 'paragraph', target: 'kb' },
    ],
  },
]

const SPECIFIC: Record<FormVertical, Section[]> = { hotel: HOTEL, clinica: CLINICA, comercio: COMERCIO }

export function formSections(vertical: FormVertical): Section[] {
  return [...COMMON_START, ...SPECIFIC[vertical], ...COMMON_END]
}

export function isFormVertical(v: unknown): v is FormVertical {
  return typeof v === 'string' && (FORM_VERTICALS as readonly string[]).includes(v)
}

export function formTitle(vertical: FormVertical): string {
  return `SANDÍA — Alta de ${FORM_LABELS[vertical].toLowerCase()}`
}

/** JSON the Apps Script builds the Google Form from (no functions). */
export function publicFormSpec(vertical: FormVertical) {
  return {
    vertical,
    title: formTitle(vertical),
    description:
      'Con estas respuestas configuramos tu asistente de SANDÍA. Puedes dejar en blanco lo que no aplique. Toma entre 20 y 40 minutos.',
    codeTitle: CODE_TITLE,
    sections: formSections(vertical).map((s) => ({
      title: s.title,
      description: s.description ?? null,
      questions: s.questions.map((q) => ({
        title: q.title,
        help: q.help ?? null,
        type: q.type,
        options: q.type === 'hour' ? HOURS : (q.options ?? null),
        required: Boolean(q.required),
      })),
    })),
  }
}

/** Map `{ question title: answer }` (what Google Forms gives) to `{ key: answer }`. */
export function answersByKey(vertical: FormVertical, byTitle: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const section of formSections(vertical)) {
    for (const q of section.questions) {
      const raw = byTitle[q.title]
      const value = Array.isArray(raw) ? raw.map(String).join(', ') : raw == null ? '' : String(raw)
      if (value.trim()) out[q.key] = value.trim()
    }
  }
  return out
}

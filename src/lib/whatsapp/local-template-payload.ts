import type {
  MessageTemplate,
  TemplateButton,
  TemplateSampleValues,
} from '@/types'
import {
  validateBody,
  validateButtons,
  validateFooter,
  validateHeader,
  validateTemplateName,
} from '@/lib/whatsapp/template-validators'

const CATEGORIES = new Set<MessageTemplate['category']>([
  'Marketing',
  'Utility',
  'Authentication',
])

const HEADER_TYPES = new Set<NonNullable<MessageTemplate['header_type']>>([
  'text',
  'image',
  'video',
  'document',
])

const BUTTON_TYPES = new Set<TemplateButton['type']>([
  'QUICK_REPLY',
  'URL',
  'PHONE_NUMBER',
  'COPY_CODE',
])

export interface LocalTemplatePayload {
  name: string
  category: MessageTemplate['category']
  language: string
  header_type?: MessageTemplate['header_type']
  header_content?: string
  header_media_url?: string
  body_text: string
  footer_text?: string
  buttons?: TemplateButton[]
  sample_values?: TemplateSampleValues
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function requiredString(value: unknown, field: string): string {
  const normalized = optionalString(value)
  if (!normalized) throw new Error(`${field} is required.`)
  return normalized
}

function normalizeButtons(value: unknown): TemplateButton[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new Error('buttons must be an array.')

  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`Button #${index + 1} must be an object.`)
    }
    const button = raw as Record<string, unknown>
    const type = button.type
    if (typeof type !== 'string' || !BUTTON_TYPES.has(type as TemplateButton['type'])) {
      throw new Error(`Button #${index + 1} has an unsupported type.`)
    }
    return button as unknown as TemplateButton
  })
}

function normalizeSamples(value: unknown): TemplateSampleValues | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  const samples: TemplateSampleValues = {}

  if (Array.isArray(input.body)) {
    const body = input.body
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
    if (body.length > 0) samples.body = body
  }

  if (Array.isArray(input.header)) {
    const header = input.header
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
    if (header.length > 0) samples.header = header
  }

  return Object.keys(samples).length > 0 ? samples : undefined
}

export function normalizeLocalTemplatePayload(raw: unknown): LocalTemplatePayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Template payload must be an object.')
  }

  const input = raw as Record<string, unknown>
  const name = requiredString(input.name, 'Template name')
  validateTemplateName(name)

  const category = requiredString(input.category, 'Category') as MessageTemplate['category']
  if (!CATEGORIES.has(category)) throw new Error('Unsupported template category.')
  if (category === 'Authentication') {
    throw new Error('Authentication templates are not supported by the local Z-API template builder yet.')
  }

  const language = optionalString(input.language) || 'en_US'
  const headerType = optionalString(input.header_type)
  if (headerType && !HEADER_TYPES.has(headerType as NonNullable<MessageTemplate['header_type']>)) {
    throw new Error('Unsupported header_type.')
  }

  const payload: LocalTemplatePayload = {
    name,
    category,
    language,
    header_type: headerType as MessageTemplate['header_type'] | undefined,
    body_text: requiredString(input.body_text, 'Body text'),
    footer_text: optionalString(input.footer_text),
    buttons: normalizeButtons(input.buttons),
    sample_values: normalizeSamples(input.sample_values),
  }

  if (payload.header_type === 'text') {
    payload.header_content = requiredString(input.header_content, 'Header text')
  } else if (payload.header_type) {
    payload.header_media_url = requiredString(input.header_media_url, 'Header media URL')
  }

  validateBody(payload.body_text)
  validateFooter(payload.footer_text)
  validateHeader(payload)
  validateButtons(payload.buttons)

  return payload
}

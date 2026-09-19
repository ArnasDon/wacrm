import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getPreset } from '@/lib/ai/presets'
import { scopedCollection } from '@/lib/db/scoped'
import type { AIProviderDoc } from '@/lib/db/types'
import { readJson, ValidationError } from '@/lib/http/errors'
import { optStr, str } from '@/lib/http/validate'
import { encrypt } from '@/lib/security/secrets'
import { shapeProvider, validateBaseUrl } from '@/lib/ai/provider-admin'

/** GET — configured AI providers (keys masked). Admin+. */
export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const providers = await scopedCollection<AIProviderDoc>(ctx, 'ai_providers')
    const rows = await providers.find({}).sort({ createdAt: 1 }).toArray()
    return NextResponse.json({ providers: rows.map(shapeProvider) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST { preset, label?, apiKey?, model?, baseUrl? } — add a provider. Admin+. */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = await readJson(request)
    const preset = getPreset(str(body.preset, 'preset', { max: 40 }))
    if (!preset) throw new ValidationError('Unknown provider preset')
    const apiKey = optStr(body.apiKey, 'apiKey', 400)
    if (preset.requiresKey && !apiKey) throw new ValidationError(`${preset.label} needs an API key`)
    const model = optStr(body.model, 'model', 120) ?? preset.defaultModel
    if (!model) throw new ValidationError('Model name is required')
    if (!/^[\w.:/@-]{1,120}$/.test(model)) throw new ValidationError('Model name has invalid characters')
    const baseUrl = preset.customBaseUrl ? await validateBaseUrl(optStr(body.baseUrl, 'baseUrl', 300) ?? preset.baseUrl) : null
    if (preset.customBaseUrl && !baseUrl) throw new ValidationError('Base URL is required')

    const providers = await scopedCollection<AIProviderDoc>(ctx, 'ai_providers')
    if ((await providers.countDocuments({})) >= 20) throw new ValidationError('Too many AI providers')
    const isFirst = (await providers.countDocuments({})) === 0
    const created = await providers.insertOne({
      label: optStr(body.label, 'label', 80) ?? preset.label,
      kind: preset.kind,
      preset: preset.id,
      baseUrl,
      apiKeyEnc: apiKey ? encrypt(apiKey) : null,
      model,
      isDefault: isFirst,
      lastTestAt: null,
      lastTestOk: null,
    })
    return NextResponse.json({ provider: shapeProvider(created) }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}

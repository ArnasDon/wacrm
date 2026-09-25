import 'server-only'
import type { AIProviderDoc } from '@/lib/db/types'
import { getPreset } from './presets'
import { canTranscribe, filenameFor, transcriptionModel } from './speech-formats'
import { AIProviderError, providerErrorDetail } from './client'
import { decrypt } from '@/lib/security/secrets'

export { canTranscribe, transcriptionModel } from './speech-formats'

// ============================================================
// Voice notes → text.
//
// Customers talk rather than type, especially in a hurry. WhatsApp
// delivers that as an audio file, which the sales rep used to file
// under "[audio]" and ignore. We send it to an OpenAI-compatible
// /audio/transcriptions endpoint (Groq and OpenAI both serve Whisper
// there) and feed the text into the normal pipeline.
//
// Transcription is deliberately a separate provider choice: the model
// answering chat may be one that cannot hear, and Groq's Whisper is
// free-tier friendly and fast enough for a WhatsApp reply.
// ============================================================

const TIMEOUT_MS = 45_000
/** WhatsApp caps voice notes at 16MB; anything larger isn't ours to send. */
const MAX_BYTES = 20 * 1024 * 1024

export async function transcribeAudio(
  provider: AIProviderDoc,
  audio: { bytes: Uint8Array; mime: string | null },
): Promise<string> {
  if (!canTranscribe(provider)) {
    throw new AIProviderError(`${provider.label} cannot transcribe audio — use an OpenAI or Groq key`)
  }
  if (audio.bytes.byteLength > MAX_BYTES) throw new AIProviderError('Voice note is too large to transcribe')
  const preset = getPreset(provider.preset)
  const base = (preset?.baseUrl ?? provider.baseUrl ?? '').replace(/\/+$/, '')
  if (!base) throw new AIProviderError('Base URL is missing')
  const apiKey = provider.apiKeyEnc ? decrypt(provider.apiKeyEnc) : null
  if (!apiKey) throw new AIProviderError('API key is missing')

  const form = new FormData()
  form.set('model', transcriptionModel(provider))
  form.set('response_format', 'json')
  form.set(
    'file',
    new Blob([audio.bytes as unknown as BlobPart], { type: audio.mime ?? 'audio/ogg' }),
    filenameFor(audio.mime),
  )

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      const detail = providerErrorDetail(text)
      throw new AIProviderError(
        `Could not transcribe the voice note (${res.status})${detail ? ` — ${detail}` : ''}`,
        res.status === 429 ? 'quota' : res.status === 401 || res.status === 403 ? 'auth' : 'other',
      )
    }
    const parsed = JSON.parse(text) as { text?: string }
    const transcript = (parsed.text ?? '').trim()
    if (!transcript) throw new AIProviderError('The voice note came back empty')
    return transcript.slice(0, 2000)
  } catch (err) {
    if (err instanceof AIProviderError) throw err
    throw new AIProviderError(
      (err as Error).name === 'AbortError'
        ? `Transcription took longer than ${TIMEOUT_MS / 1000}s`
        : 'Could not reach the transcription provider',
      'timeout',
    )
  } finally {
    clearTimeout(timer)
  }
}

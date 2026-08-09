// ============================================================
// Voice-note transcription.
//
// Converts inbound WhatsApp audio into text so the existing message
// pipeline can use it for the inbox, flows, automations, keyword matching,
// and AI auto-replies. The helper is deliberately best-effort: provider
// or network failures return null and never block webhook persistence.
// ============================================================

const OPENAI_TRANSCRIPTION_URL = 'https://api.openai.com/v1/audio/transcriptions'
const DEFAULT_TIMEOUT_MS = 25_000

export interface TranscribeAudioArgs {
  apiKey: string
  audio: Buffer
  /** WhatsApp MIME type, e.g. "audio/ogg; codecs=opus". */
  mimeType: string
  /** Optional ISO-639-1 language hint, e.g. "pt". */
  language?: string
  timeoutMs?: number
}

export async function transcribeAudio(
  args: TranscribeAudioArgs,
): Promise<string | null> {
  const {
    apiKey,
    audio,
    mimeType,
    language,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = args

  if (!apiKey.trim() || audio.length === 0) return null

  const baseMimeType = mimeType.split(';')[0]?.trim() || 'audio/ogg'
  const ext = baseMimeType.split('/')[1] || 'ogg'
  const form = new FormData()

  form.append(
    'file',
    new Blob([new Uint8Array(audio)], { type: baseMimeType }),
    `voice-note.${ext}`,
  )
  form.append('model', 'whisper-1')
  if (language) form.append('language', language)

  let response: Response
  try {
    response = await fetch(OPENAI_TRANSCRIPTION_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    console.error(
      '[transcription] network error:',
      error instanceof Error ? error.message : error,
    )
    return null
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error(
      `[transcription] OpenAI error ${response.status}:`,
      detail.slice(0, 300),
    )
    return null
  }

  const data = (await response.json().catch(() => null)) as {
    text?: string
  } | null

  const text = data?.text?.trim()
  return text || null
}

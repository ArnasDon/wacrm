// Pure facts about speech-to-text providers and audio files. No
// network and no server-only imports, so they can be unit-tested.

import type { AIProviderDoc } from '@/lib/db/types'

/** Presets whose API exposes /audio/transcriptions. */
const SPEECH_PRESETS = new Set(['groq', 'openai'])

/** Default model per preset — both are Whisper behind the scenes. */
const DEFAULT_MODEL: Record<string, string> = {
  groq: 'whisper-large-v3-turbo',
  openai: 'whisper-1',
}

export function canTranscribe(provider: Pick<AIProviderDoc, 'preset' | 'kind'>): boolean {
  return provider.kind === 'openai_compatible' && SPEECH_PRESETS.has(provider.preset)
}

export function transcriptionModel(provider: Pick<AIProviderDoc, 'preset'>): string {
  return DEFAULT_MODEL[provider.preset] ?? 'whisper-1'
}

/** WhatsApp sends opus in ogg; the APIs want a filename they recognise. */
export function filenameFor(mime: string | null): string {
  if (!mime) return 'voice.ogg'
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'voice.mp3'
  if (mime.includes('mp4') || mime.includes('m4a')) return 'voice.m4a'
  if (mime.includes('wav')) return 'voice.wav'
  if (mime.includes('webm')) return 'voice.webm'
  return 'voice.ogg'
}


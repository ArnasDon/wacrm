/**
 * Bracketed markers `buildConversationContext` (./context.ts) uses to
 * describe past media/interactive WhatsApp messages to the model — e.g.
 * "[Opção interactiva no WhatsApp]". They exist purely so the model can
 * read its own history; a real production incident showed the model
 * echoing one back as if it were reply content, so `guardrails.ts` checks
 * output against this same list to catch that.
 *
 * Kept in its own module (not exported from context.ts) so importing it
 * from guardrails.ts doesn't pull in the rest of context.ts's surface —
 * tests that mock the `./context` module wholesale would otherwise lose
 * this list along with it.
 */

export const INTERACTIVE_PLACEHOLDER = '[Opção interactiva no WhatsApp]'
export const IMAGE_PLACEHOLDER = '[Imagem enviada no WhatsApp]'
export const IMAGE_NO_CAPTION_PLACEHOLDER = '[Imagem enviada no WhatsApp sem legenda]'

/** Placeholder shown when a media message has no caption/transcript text. */
export const MEDIA_PLACEHOLDER: Record<string, string> = {
  video: '[Vídeo enviado no WhatsApp]',
  document: '[Documento enviado no WhatsApp]',
  audio: '[Nota de voz enviada no WhatsApp]',
  location: '[Localização partilhada no WhatsApp]',
  sticker: '[Sticker enviado no WhatsApp]',
}

export const HISTORY_ANNOTATION_MARKERS: readonly string[] = [
  INTERACTIVE_PLACEHOLDER,
  IMAGE_PLACEHOLDER,
  IMAGE_NO_CAPTION_PLACEHOLDER,
  ...Object.values(MEDIA_PLACEHOLDER),
]

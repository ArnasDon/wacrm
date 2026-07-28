/**
 * Provider-agnostic sending interface.
 *
 * `meta-api.ts` stays the low-level Meta HTTP client, unchanged.
 * `WhatsAppProvider` is what every call site (inbox composer,
 * automations, flows, reactions, broadcasts) is refactored to depend
 * on instead of importing `meta-api.ts` directly — each method takes
 * normalized args (no `phoneNumberId`/`accessToken`; a concrete
 * provider closes over its own credentials at construction time via
 * `getProviderForAccount` in `send-core.ts`).
 *
 * Message templates are NOT part of this interface. Pre-approved
 * templates are a Meta-only concept (Meta's own policy requires them
 * for business-initiated messages outside the 24h session window;
 * uazapi rides a personal number and has no approval pipeline at
 * all). Modeling `sendTemplate` as a method every provider must
 * implement would force `UazapiProvider` to either fake support or
 * throw — instead it's an optional capability, exposed only via
 * `isMetaProvider()`. Callers that need to send a template (the
 * broadcast wizard, for now) type-guard first and never reach the
 * uazapi branch, because the UI never offers templates on a uazapi
 * account in the first place (see broadcast-core.ts).
 */

import type { MessageTemplate } from '@/types'
import type { SendTimeParams } from './template-send-builder'

export interface ProviderMessageResult {
  messageId: string
}

export type ProviderMediaKind = 'image' | 'video' | 'document' | 'audio'

export interface ProviderInteractiveButton {
  /** Stable id returned in the inbound reply webhook when tapped. */
  id: string
  title: string
}

export interface ProviderInteractiveListRow {
  id: string
  title: string
  description?: string
}

export interface ProviderInteractiveListSection {
  title?: string
  rows: ProviderInteractiveListRow[]
}

export interface SendTextArgs {
  to: string
  text: string
  /** External id of the message being replied to (quote preview). */
  contextMessageId?: string
}

export interface SendMediaArgs {
  to: string
  kind: ProviderMediaKind
  /** Public URL the provider fetches at send time. */
  link: string
  caption?: string
  /** Document-only; ignored by other kinds. */
  filename?: string
  contextMessageId?: string
}

export interface SendReactionArgs {
  to: string
  /** External id of the message being reacted to. */
  targetMessageId: string
  /** Single emoji, or empty string to remove an existing reaction. */
  emoji: string
}

export interface SendInteractiveButtonsArgs {
  to: string
  bodyText: string
  headerText?: string
  footerText?: string
  /** 1–3 buttons. */
  buttons: ProviderInteractiveButton[]
  contextMessageId?: string
}

export interface SendInteractiveListArgs {
  to: string
  bodyText: string
  /** Label of the tap-to-expand button on the message bubble. */
  buttonLabel: string
  headerText?: string
  footerText?: string
  sections: ProviderInteractiveListSection[]
  contextMessageId?: string
}

export interface WhatsAppProvider {
  readonly kind: 'meta' | 'uazapi' | 'zapi'
  sendText(args: SendTextArgs): Promise<ProviderMessageResult>
  sendMedia(args: SendMediaArgs): Promise<ProviderMessageResult>
  sendReaction(args: SendReactionArgs): Promise<ProviderMessageResult>
  sendInteractiveButtons(args: SendInteractiveButtonsArgs): Promise<ProviderMessageResult>
  sendInteractiveList(args: SendInteractiveListArgs): Promise<ProviderMessageResult>
}

// ============================================================
// Meta-only capability: message templates
// ============================================================

export interface SendTemplateArgs {
  to: string
  templateName: string
  language?: string
  /** Legacy body-only params. */
  params?: string[]
  /** The local template row — needed to build header/button components. */
  template?: MessageTemplate
  messageParams?: SendTimeParams
  contextMessageId?: string
}

export interface MetaTemplateCapability {
  sendTemplate(args: SendTemplateArgs): Promise<ProviderMessageResult>
}

/**
 * Type guard for the Meta-only `sendTemplate` capability. Callers
 * that need to send a template (currently only the broadcast
 * delivery path) must narrow with this before calling — there is no
 * fallback branch, because the UI never lets a uazapi account reach
 * a template-send call in the first place.
 */
export function isMetaProvider(
  provider: WhatsAppProvider,
): provider is WhatsAppProvider & MetaTemplateCapability {
  return provider.kind === 'meta'
}

// ============================================================
// Resolved, decrypted config — what `resolveProviderConfig` in
// send-core.ts produces from a `whatsapp_config` row before
// constructing a concrete provider instance.
// ============================================================

export type ProviderConfig =
  | { provider: 'meta'; phoneNumberId: string; accessToken: string }
  | { provider: 'uazapi'; instanceId: string; token: string; baseUrl: string }
  | { provider: 'zapi'; instanceId: string; token: string; clientToken?: string }

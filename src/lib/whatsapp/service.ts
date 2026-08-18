// ============================================================
// WhatsAppService — the provider abstraction §2/§3 require.
//
// One interface, two implementations (`MetaWhatsAppService`,
// `DemoWhatsAppService`), selected by `resolveWhatsAppService` at a
// single chokepoint: an account with a saved `whatsapp_config` row
// gets the real Meta-backed service; an account with none gets the
// demo one. That's the entire "zero Meta credentials" story — no
// call site decides demo-vs-real itself, and no call site imports
// `@/lib/whatsapp/meta-api` directly any more (mirrors the existing
// AI-provider pattern in `src/lib/ai/`: routes/engines depend on this
// interface, never a provider SDK).
//
// Every send method takes `toVariants` (not a single `to`) because
// several callers already retry across phone-number formats when Meta
// rejects a recipient as "not in the allowed list" (a sandbox/E.164
// quirk) — that retry is Meta-specific behaviour, so it now lives
// once, inside `MetaWhatsAppService`, instead of being duplicated at
// every call site. `DemoWhatsAppService` has nothing to retry; it
// always "succeeds" against `toVariants[0]`.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MessageTemplate } from '@/types';
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';
import type {
  MediaKind,
  InteractiveButton,
  InteractiveListSection,
} from '@/lib/whatsapp/meta-api';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import { MetaWhatsAppService } from '@/lib/whatsapp/providers/meta-whatsapp-service';
import { DemoWhatsAppService } from '@/lib/whatsapp/providers/demo-whatsapp-service';

export interface WhatsAppSendResult {
  /** Provider message id — a real Meta `wamid`, or a `demo-...` id. */
  messageId: string;
  /** Which entry of `toVariants` actually worked; persist this back
   *  onto the contact when it differs from the first variant tried. */
  workingPhone: string;
}

export interface SendTextInput {
  toVariants: string[];
  text: string;
  contextMessageId?: string;
}

export interface SendTemplateInput {
  toVariants: string[];
  templateName: string;
  language?: string;
  /** Legacy positional body params. */
  params?: string[];
  /** Local template row — enables header/button components. */
  template?: MessageTemplate;
  /** Structured per-send values (header/body/button variables). */
  messageParams?: SendTimeParams;
  contextMessageId?: string;
}

export interface SendMediaInput {
  toVariants: string[];
  kind: MediaKind;
  link: string;
  caption?: string;
  filename?: string;
  contextMessageId?: string;
}

export interface SendInteractiveButtonsInput {
  toVariants: string[];
  bodyText: string;
  headerText?: string;
  footerText?: string;
  buttons: InteractiveButton[];
  contextMessageId?: string;
}

export interface SendInteractiveListInput {
  toVariants: string[];
  bodyText: string;
  buttonLabel: string;
  headerText?: string;
  footerText?: string;
  sections: InteractiveListSection[];
  contextMessageId?: string;
}

export interface SendReactionInput {
  /** Already-resolved recipient phone — reacting to a message in an
   *  existing conversation never needs the variant retry a first-touch
   *  send might. */
  to: string;
  /** Provider message id of the message being reacted to. */
  targetMessageId: string;
  /** Single emoji, or '' to remove a previously-sent reaction. */
  emoji: string;
}

export interface WhatsAppService {
  readonly isDemo: boolean;
  sendText(input: SendTextInput): Promise<WhatsAppSendResult>;
  sendTemplate(input: SendTemplateInput): Promise<WhatsAppSendResult>;
  sendMedia(input: SendMediaInput): Promise<WhatsAppSendResult>;
  sendInteractiveButtons(
    input: SendInteractiveButtonsInput
  ): Promise<WhatsAppSendResult>;
  sendInteractiveList(
    input: SendInteractiveListInput
  ): Promise<WhatsAppSendResult>;
  sendReaction(input: SendReactionInput): Promise<WhatsAppSendResult>;
}

export interface ResolvedWhatsAppService {
  service: WhatsAppService;
  isDemo: boolean;
}

/**
 * Resolve the WhatsApp service for an account: real Meta-backed when
 * `whatsapp_config` exists, demo otherwise. This is the ONLY place in
 * the app that should query `whatsapp_config` for send purposes — call
 * sites ask this for a service and never touch the config row
 * themselves, so "does this account have Meta creds?" has one answer,
 * not one per call site.
 *
 * Was previously `.single()` at every call site, which *errors* on a
 * missing config — that's exactly the "zero Meta credentials" case
 * §3 requires to work, not a failure, so this uses `.maybeSingle()`
 * and treats a missing row as "use the demo service" instead of
 * throwing. `whatsapp_config` carries `UNIQUE(account_id)`, so the
 * >=2-row ambiguity `.single()` is normally guarded against can't
 * occur here regardless.
 */
export async function resolveWhatsAppService(
  db: SupabaseClient,
  accountId: string
): Promise<ResolvedWhatsAppService> {
  const { data: config, error } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load whatsapp_config: ${error.message}`);
  }

  if (!config) {
    return { service: new DemoWhatsAppService(), isDemo: true };
  }

  const accessToken = decrypt(config.access_token);

  // Self-heal legacy CBC ciphertexts. Fire-and-forget; idempotent.
  // Previously only the manual-send route did this upgrade; centralizing
  // config access here means every send path benefits, not just one.
  if (isLegacyFormat(config.access_token)) {
    void db
      .from('whatsapp_config')
      .update({ access_token: encrypt(accessToken) })
      .eq('id', config.id)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          console.warn(
            '[whatsapp service] access_token GCM upgrade failed:',
            error.message
          );
        }
      });
  }

  return {
    service: new MetaWhatsAppService({
      phoneNumberId: config.phone_number_id,
      accessToken,
    }),
    isDemo: false,
  };
}

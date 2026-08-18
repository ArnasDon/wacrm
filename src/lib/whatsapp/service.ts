// ============================================================
// WhatsAppService — the provider abstraction §2/§3 require.
//
// One interface, two implementations (`MetaWhatsAppService`,
// `DemoWhatsAppService`), selected by `resolveWhatsAppService` at a
// single chokepoint. That's the entire "zero Meta credentials" story
// — no call site decides demo-vs-real itself, and no call site
// imports `@/lib/whatsapp/meta-api` directly any more (mirrors the
// existing AI-provider pattern in `src/lib/ai/`: routes/engines depend
// on this interface, never a provider SDK).
//
// Which service an account gets is driven by the explicit
// `accounts.demo_mode_enabled` Settings toggle (§15), NOT inferred
// from whether `whatsapp_config` happens to exist:
//
//   demo_mode_enabled = true  -> DemoWhatsAppService, always. This is
//     a deliberate override, so it wins even if real config is also
//     saved (an admin may want to demo/train without risking a real
//     send despite having credentials configured).
//   demo_mode_enabled = false -> MetaWhatsAppService if config exists;
//     otherwise `resolveWhatsAppService` THROWS `WhatsAppNotConfiguredError`
//     rather than silently falling back to a simulated send. An
//     account that has explicitly gone "live" must fail loudly, not
//     quietly pretend to send.
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
import {
  MetaWhatsAppService,
  type MetaWhatsAppServiceConfig,
} from '@/lib/whatsapp/providers/meta-whatsapp-service';
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
 * Thrown when an account needs `MetaWhatsAppService` (Demo Mode is
 * off) but has no usable `whatsapp_config`. Every call site maps this
 * to its own error shape (`SendMessageError`, `BroadcastError`, a
 * 400 response, ...) — `resolveWhatsAppService` itself stays
 * transport-agnostic about how the failure gets surfaced.
 */
export class WhatsAppNotConfiguredError extends Error {
  constructor(
    message = 'WhatsApp is not configured for this account and Demo Mode is off. Enable Demo Mode in Settings, or add your WhatsApp integration, before sending.'
  ) {
    super(message);
    this.name = 'WhatsAppNotConfiguredError';
  }
}

/**
 * Load + decrypt `whatsapp_config` for an account, or `null` if none
 * is saved. Shared by both resolvers below so the config lookup,
 * decrypt, and legacy-ciphertext self-heal happen in exactly one
 * place regardless of which resolution path is in play.
 */
async function loadMetaServiceConfig(
  db: SupabaseClient,
  accountId: string
): Promise<MetaWhatsAppServiceConfig | null> {
  const { data: config, error } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load whatsapp_config: ${error.message}`);
  }
  if (!config) return null;

  const accessToken = decrypt(config.access_token);

  // Self-heal legacy CBC ciphertexts. Fire-and-forget; idempotent.
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

  return { phoneNumberId: config.phone_number_id, accessToken };
}

function metaOrThrow(
  config: MetaWhatsAppServiceConfig | null
): ResolvedWhatsAppService {
  if (!config) throw new WhatsAppNotConfiguredError();
  return { service: new MetaWhatsAppService(config), isDemo: false };
}

/**
 * Resolve the WhatsApp service for an account from its CURRENT
 * settings. This is the entry point every fresh send goes through
 * (a manual send, an automation/Flow send, creating a new broadcast).
 *
 * `accounts.demo_mode_enabled` (§15's Settings toggle, migration 052)
 * decides everything:
 *   - true  -> DemoWhatsAppService, unconditionally.
 *   - false -> MetaWhatsAppService if `whatsapp_config` exists,
 *     otherwise throws {@link WhatsAppNotConfiguredError} — Demo Mode
 *     being off means the account has declared it wants real sends,
 *     so a missing config must fail loudly, never silently simulate.
 */
export async function resolveWhatsAppService(
  db: SupabaseClient,
  accountId: string
): Promise<ResolvedWhatsAppService> {
  const { data: account, error } = await db
    .from('accounts')
    .select('demo_mode_enabled')
    .eq('id', accountId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load account: ${error.message}`);
  }

  // Defensive fallback if the row is somehow missing the column (a
  // schema-cache race right after this migration lands) — matches the
  // migration's own DEFAULT true, not a silent "assume real Meta".
  const demoModeEnabled = account?.demo_mode_enabled ?? true;

  if (demoModeEnabled) {
    return { service: new DemoWhatsAppService(), isDemo: true };
  }

  return metaOrThrow(await loadMetaServiceConfig(db, accountId));
}

/**
 * Resolve the WhatsApp service for an EXISTING broadcast being
 * resumed. Deliberately does NOT re-derive from the account's current
 * `demo_mode_enabled` — a broadcast must never switch between demo
 * and real mid-flight just because an admin flipped the account
 * setting between the original send and a later resume pass. Callers
 * pass the broadcast's own persisted `is_demo` flag (set once, at
 * creation, by {@link resolveWhatsAppService} via `createBroadcast`).
 */
export async function resolveWhatsAppServiceForBroadcast(
  db: SupabaseClient,
  accountId: string,
  wasDemo: boolean
): Promise<ResolvedWhatsAppService> {
  if (wasDemo) {
    return { service: new DemoWhatsAppService(), isDemo: true };
  }
  return metaOrThrow(await loadMetaServiceConfig(db, accountId));
}

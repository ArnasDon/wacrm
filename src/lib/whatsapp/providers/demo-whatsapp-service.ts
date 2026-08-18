// ============================================================
// DemoWhatsAppService — the zero-Meta-credentials implementation of
// WhatsAppService (§3). Every send "succeeds" instantly against a
// synthetic `demo-...` provider id and the first phone variant
// offered — there is no real recipient to validate or retry against,
// so unlike `MetaWhatsAppService` there's nothing Meta-specific to
// simulate here (no rate limits, no template approval, no "recipient
// not allowed").
//
// This class only covers the SEND half of "simulated send, delivery,
// read, reaction, inbound" from §3. Simulated delivery/read/reaction
// are a separate concern — see `simulateDemoDeliveryAndRead` /
// `simulateDemoReaction` below — because they act on a *persisted*
// `messages` row (status transitions, `broadcast_recipients`
// mirroring, webhook fan-out) that doesn't exist yet at the moment
// `sendX()` returns; callers persist the message first, exactly as
// they already do for a real Meta send, then call the simulator.
// Keeping send() itself free of DB access keeps this class symmetric
// with `MetaWhatsAppService` (pure transport, no persistence) and
// keeps demo-only logic out of the interface's contract.
//
// Simulated inbound (a synthetic customer reply) is intentionally not
// wired up here — full-funnel demo wiring (customer_request creation,
// etc.) is Phase 3/4 work per docs/RIMULA_BUILD_SPEC.md §23, not this
// pass. `src/lib/whatsapp/inbound-events.ts`'s `handleReaction` and
// the webhook's inbound-message pipeline are what that later phase
// will drive with a synthetic event, the same way this file already
// does for status updates.
// ============================================================

import { randomUUID } from 'node:crypto';
import type {
  WhatsAppService,
  WhatsAppSendResult,
  SendTextInput,
  SendTemplateInput,
  SendMediaInput,
  SendInteractiveButtonsInput,
  SendInteractiveListInput,
  SendReactionInput,
} from '@/lib/whatsapp/service';

function demoMessageId(): string {
  return `demo-${randomUUID()}`;
}

export class DemoWhatsAppService implements WhatsAppService {
  readonly isDemo = true as const;

  private instantResult(toVariants: string[]): WhatsAppSendResult {
    return { messageId: demoMessageId(), workingPhone: toVariants[0] };
  }

  async sendText(input: SendTextInput): Promise<WhatsAppSendResult> {
    return this.instantResult(input.toVariants);
  }

  async sendTemplate(input: SendTemplateInput): Promise<WhatsAppSendResult> {
    return this.instantResult(input.toVariants);
  }

  async sendMedia(input: SendMediaInput): Promise<WhatsAppSendResult> {
    return this.instantResult(input.toVariants);
  }

  async sendInteractiveButtons(
    input: SendInteractiveButtonsInput
  ): Promise<WhatsAppSendResult> {
    return this.instantResult(input.toVariants);
  }

  async sendInteractiveList(
    input: SendInteractiveListInput
  ): Promise<WhatsAppSendResult> {
    return this.instantResult(input.toVariants);
  }

  async sendReaction(input: SendReactionInput): Promise<WhatsAppSendResult> {
    return { messageId: demoMessageId(), workingPhone: input.to };
  }
}

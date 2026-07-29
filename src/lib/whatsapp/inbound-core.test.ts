import { describe, it, expect, beforeEach, vi } from "vitest";

// Shared mock state, hoisted so the vi.mock factories below can close
// over it. Mirrors the pattern already used in
// src/lib/automations/engine.test.ts for mocking the service-role
// client, extended here to also track conversations/messages/
// message_reactions/broadcast_recipients since inbound-core.ts spans
// all of them.
const h = vi.hoisted(() => ({
  state: {
    existingContact: null as Record<string, unknown> | null,
    existingConversation: null as Record<string, unknown> | null,
    inserted: { contacts: [], conversations: [], messages: [] } as Record<
      string,
      Record<string, unknown>[]
    >,
    updated: [] as { table: string; payload: unknown; filters: [string, string, unknown][] }[],
    upserted: [] as { table: string; payload: unknown }[],
    deleted: [] as { table: string; filters: [string, string, unknown][] }[],
    messageReactionRows: [] as Record<string, unknown>[],
    messagesTable: [] as Record<string, unknown>[],
    broadcastRecipients: [] as Record<string, unknown>[],
    flowConsumed: false,
    dispatchedWebhookEvents: [] as { eventType: string; payload: unknown }[],
    dispatchedAutomationTriggers: [] as string[],
    aiReplyDispatched: false,
  },
}));

vi.mock("@/lib/flows/admin-client", () => {
  const { state } = h;

  function builder(table: string) {
    const ops: {
      table: string;
      type: string;
      payload?: unknown;
      filters: [string, string, unknown][];
    } = { table, type: "select", filters: [] };

    function resolve() {
      if (ops.type === "insert") {
        const row = { id: `${table}-${state.inserted[table]?.length ?? 0}`, ...(ops.payload as object) };
        (state.inserted[table] ??= []).push(row);
        if (table === "messages") state.messagesTable.push(row);
        return { data: row, error: null };
      }
      if (ops.type === "update") {
        state.updated.push({ table, payload: ops.payload, filters: ops.filters });
        if (table === "messages") {
          const idFilter = ops.filters.find(([, k]) => k === "message_id");
          for (const row of state.messagesTable) {
            if (!idFilter || row.message_id === idFilter[2]) {
              Object.assign(row, ops.payload as object);
            }
          }
        }
        if (table === "broadcast_recipients") {
          const idFilter = ops.filters.find(([, k]) => k === "id");
          for (const row of state.broadcastRecipients) {
            if (!idFilter || row.id === idFilter[2]) Object.assign(row, ops.payload as object);
          }
        }
        return { data: null, error: null };
      }
      if (ops.type === "upsert") {
        state.upserted.push({ table, payload: ops.payload });
        if (table === "message_reactions") state.messageReactionRows.push(ops.payload as Record<string, unknown>);
        return { data: null, error: null };
      }
      if (ops.type === "delete") {
        state.deleted.push({ table, filters: ops.filters });
        return { data: null, error: null };
      }
      // select
      if (table === "conversations") {
        return { data: state.existingConversation ? [state.existingConversation] : [], error: null };
      }
      if (table === "broadcast_recipients") {
        const idFilter = ops.filters.find(([, k]) => k === "whatsapp_message_id");
        if (idFilter) {
          const match = state.broadcastRecipients.find(
            (r) => r.whatsapp_message_id === idFilter[2],
          );
          return { data: match ?? null, error: null };
        }
        return { data: state.broadcastRecipients, error: null };
      }
      if (table === "messages") {
        const idFilter = ops.filters.find(([, k]) => k === "message_id");
        const match = state.messagesTable.find((r) => !idFilter || r.message_id === idFilter[2]);
        return { data: match ?? null, count: state.messagesTable.length, error: null };
      }
      return { data: null, error: null };
    }

    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((ops.type = "insert"), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = "update"), (ops.payload = p), b),
      delete: () => ((ops.type = "delete"), b),
      upsert: (p: unknown) => ((ops.type = "upsert"), (ops.payload = p), b),
      eq: (k: string, v: unknown) => (ops.filters.push(["eq", k, v]), b),
      in: (k: string, v: unknown) => (ops.filters.push(["in", k, v]), b),
      order: () => b,
      limit: () => b,
      single: () => Promise.resolve(resolve()),
      maybeSingle: () => Promise.resolve(resolve()),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    };
    return b;
  }

  return { supabaseAdmin: () => ({ from: (t: string) => builder(t) }) };
});

vi.mock("@/lib/contacts/dedupe", () => ({
  findExistingContact: async () => h.state.existingContact,
  isUniqueViolation: () => false,
}));

vi.mock("@/lib/automations/engine", () => ({
  runAutomationsForTrigger: async (args: { triggerType: string }) => {
    h.state.dispatchedAutomationTriggers.push(args.triggerType);
    return { status: "success" };
  },
}));

vi.mock("@/lib/flows/engine", () => ({
  dispatchInboundToFlows: async () => ({ consumed: h.state.flowConsumed }),
}));

vi.mock("@/lib/ai/auto-reply", () => ({
  dispatchInboundToAiReply: async () => {
    h.state.aiReplyDispatched = true;
  },
}));

vi.mock("@/lib/webhooks/deliver", () => ({
  dispatchWebhookEvent: async (_db: unknown, _accountId: string, eventType: string, payload: unknown) => {
    h.state.dispatchedWebhookEvents.push({ eventType, payload });
  },
}));

import { processInboundMessage, mirrorAgentSentMessage, handleStatusUpdate } from "./inbound-core";

function resetState() {
  h.state.existingContact = null;
  h.state.existingConversation = null;
  h.state.inserted = { contacts: [], conversations: [], messages: [] };
  h.state.updated = [];
  h.state.upserted = [];
  h.state.deleted = [];
  h.state.messageReactionRows = [];
  h.state.messagesTable = [];
  h.state.broadcastRecipients = [];
  h.state.flowConsumed = false;
  h.state.dispatchedWebhookEvents = [];
  h.state.dispatchedAutomationTriggers = [];
  h.state.aiReplyDispatched = false;
}

describe("processInboundMessage", () => {
  beforeEach(resetState);

  it("creates contact + conversation for a brand-new sender and dispatches the relationship triggers", async () => {
    await processInboundMessage({
      accountId: "acc-1",
      configOwnerUserId: "user-1",
      contactName: "Maria",
      message: {
        externalId: "wamid.AAA",
        from: "5511999999999",
        timestampMs: 1700000000000,
        contentType: "text",
        text: "Olá!",
        mediaUrl: null,
        interactiveReplyId: null,
        replyToExternalId: null,
      },
    });

    expect(h.state.inserted.contacts).toHaveLength(1);
    expect(h.state.inserted.conversations).toHaveLength(1);
    expect(h.state.inserted.messages).toHaveLength(1);
    expect(h.state.inserted.messages[0]).toMatchObject({
      sender_type: "customer",
      content_type: "text",
      content_text: "Olá!",
      message_id: "wamid.AAA",
      status: "delivered",
    });

    // New contact + first-ever message → both relationship triggers,
    // plus the content-level triggers since no flow consumed it.
    expect(h.state.dispatchedAutomationTriggers).toEqual(
      expect.arrayContaining([
        "new_contact_created",
        "first_inbound_message",
        "new_message_received",
        "keyword_match",
      ]),
    );

    expect(
      h.state.dispatchedWebhookEvents.map((e) => e.eventType),
    ).toEqual(expect.arrayContaining(["conversation.created", "message.received"]));

    expect(h.state.aiReplyDispatched).toBe(true);
  });

  it("saves the contact's avatar URL when the provider supplies one on a new contact", async () => {
    await processInboundMessage({
      accountId: "acc-1",
      configOwnerUserId: "user-1",
      contactName: "Maria",
      contactAvatarUrl: "https://pps.whatsapp.net/v/photo.jpg",
      message: {
        externalId: "wamid.AVATAR1",
        from: "5511999999999",
        timestampMs: 1700000000500,
        contentType: "text",
        text: "Oi",
        mediaUrl: null,
        interactiveReplyId: null,
        replyToExternalId: null,
      },
    });

    expect(h.state.inserted.contacts[0]).toMatchObject({
      avatar_url: "https://pps.whatsapp.net/v/photo.jpg",
    });
  });

  it("refreshes an existing contact's avatar URL when the provider supplies a new one", async () => {
    h.state.existingContact = {
      id: "contact-1",
      phone: "5511999999999",
      name: "Maria",
      avatar_url: "https://old.example.com/photo.jpg",
    };
    h.state.existingConversation = { id: "conv-1", account_id: "acc-1", contact_id: "contact-1", unread_count: 0 };

    await processInboundMessage({
      accountId: "acc-1",
      configOwnerUserId: "user-1",
      contactName: "Maria",
      contactAvatarUrl: "https://new.example.com/photo.jpg",
      message: {
        externalId: "wamid.AVATAR2",
        from: "5511999999999",
        timestampMs: 1700000000600,
        contentType: "text",
        text: "Oi de novo",
        mediaUrl: null,
        interactiveReplyId: null,
        replyToExternalId: null,
      },
    });

    const contactUpdate = h.state.updated.find((u) => u.table === "contacts");
    expect(contactUpdate?.payload).toMatchObject({ avatar_url: "https://new.example.com/photo.jpg" });
  });

  it("does not touch avatar_url when the provider supplies none (e.g. Meta)", async () => {
    h.state.existingContact = {
      id: "contact-1",
      phone: "5511999999999",
      name: "Maria",
      avatar_url: "https://old.example.com/photo.jpg",
    };
    h.state.existingConversation = { id: "conv-1", account_id: "acc-1", contact_id: "contact-1", unread_count: 0 };

    await processInboundMessage({
      accountId: "acc-1",
      configOwnerUserId: "user-1",
      contactName: "Maria",
      message: {
        externalId: "wamid.NOAVATAR",
        from: "5511999999999",
        timestampMs: 1700000000700,
        contentType: "text",
        text: "Sem foto",
        mediaUrl: null,
        interactiveReplyId: null,
        replyToExternalId: null,
      },
    });

    const contactUpdate = h.state.updated.find((u) => u.table === "contacts");
    expect(contactUpdate).toBeUndefined();
  });

  it("does not re-create a conversation for a known contact with an existing thread", async () => {
    h.state.existingContact = { id: "contact-1", phone: "5511999999999", name: "Maria" };
    h.state.existingConversation = { id: "conv-1", account_id: "acc-1", contact_id: "contact-1", unread_count: 2 };
    // A prior customer message already exists — this inbound is not
    // the contact's first-ever, so first_inbound_message must not fire.
    h.state.messagesTable.push({
      id: "prior-msg",
      conversation_id: "conv-1",
      sender_type: "customer",
      message_id: "wamid.PRIOR",
    });

    await processInboundMessage({
      accountId: "acc-1",
      configOwnerUserId: "user-1",
      contactName: "Maria",
      message: {
        externalId: "wamid.BBB",
        from: "5511999999999",
        timestampMs: 1700000001000,
        contentType: "text",
        text: "De novo",
        mediaUrl: null,
        interactiveReplyId: null,
        replyToExternalId: null,
      },
    });

    expect(h.state.inserted.contacts).toHaveLength(0);
    expect(h.state.inserted.conversations).toHaveLength(0);
    // No conversation.created for an existing thread.
    expect(h.state.dispatchedWebhookEvents.map((e) => e.eventType)).not.toContain(
      "conversation.created",
    );
    // Not the contact's first-ever message and not a new contact.
    expect(h.state.dispatchedAutomationTriggers).not.toContain("new_contact_created");
    expect(h.state.dispatchedAutomationTriggers).not.toContain("first_inbound_message");
  });

  it("suppresses content-level automation triggers when a flow consumes the message", async () => {
    h.state.existingContact = { id: "contact-1", phone: "5511999999999", name: "Maria" };
    h.state.existingConversation = { id: "conv-1", account_id: "acc-1", contact_id: "contact-1", unread_count: 0 };
    h.state.flowConsumed = true;

    await processInboundMessage({
      accountId: "acc-1",
      configOwnerUserId: "user-1",
      contactName: "Maria",
      message: {
        externalId: "wamid.CCC",
        from: "5511999999999",
        timestampMs: 1700000002000,
        contentType: "text",
        text: "1",
        mediaUrl: null,
        interactiveReplyId: null,
        replyToExternalId: null,
      },
    });

    expect(h.state.dispatchedAutomationTriggers).not.toContain("new_message_received");
    expect(h.state.dispatchedAutomationTriggers).not.toContain("keyword_match");
    // AI never runs when a flow already consumed the message.
    expect(h.state.aiReplyDispatched).toBe(false);
  });

  it("short-circuits a reaction: no messages row, only a message_reactions upsert", async () => {
    h.state.existingContact = { id: "contact-1", phone: "5511999999999", name: "Maria" };
    h.state.existingConversation = { id: "conv-1", account_id: "acc-1", contact_id: "contact-1", unread_count: 0 };
    // The reaction's target must already exist in `messages` for the
    // internal-id lookup to resolve.
    h.state.messagesTable.push({ id: "internal-msg-1", message_id: "wamid.TARGET", conversation_id: "conv-1" });

    await processInboundMessage({
      accountId: "acc-1",
      configOwnerUserId: "user-1",
      contactName: "Maria",
      message: {
        externalId: "wamid.REACT",
        from: "5511999999999",
        timestampMs: 1700000003000,
        contentType: "reaction",
        text: null,
        mediaUrl: null,
        interactiveReplyId: null,
        replyToExternalId: null,
        reaction: { targetExternalId: "wamid.TARGET", emoji: "👍" },
      },
    });

    expect(h.state.inserted.messages).toHaveLength(0);
    expect(h.state.upserted).toHaveLength(1);
    expect(h.state.upserted[0].table).toBe("message_reactions");
    expect(h.state.messageReactionRows[0]).toMatchObject({
      message_id: "internal-msg-1",
      actor_type: "customer",
      emoji: "👍",
    });
  });
});

describe("mirrorAgentSentMessage", () => {
  beforeEach(resetState);

  it("records a message sent from the agent's own phone as sender_type 'agent', without re-sending it", async () => {
    h.state.existingContact = { id: "contact-1", phone: "5511999999999", name: "Maria" };
    h.state.existingConversation = { id: "conv-1", account_id: "acc-1", contact_id: "contact-1", unread_count: 3 };

    await mirrorAgentSentMessage({
      accountId: "acc-1",
      configOwnerUserId: "user-1",
      contactName: "Maria",
      message: {
        externalId: "wamid.PHONE1",
        from: "5511999999999",
        timestampMs: 1700000004000,
        contentType: "text",
        text: "Já te atendi por aqui",
        mediaUrl: null,
        interactiveReplyId: null,
        replyToExternalId: null,
      },
    });

    // No customer-reaction/automation/flow/AI side effects — the agent
    // already handled this from their phone.
    expect(h.state.dispatchedAutomationTriggers).toEqual([]);
    expect(h.state.aiReplyDispatched).toBe(false);

    expect(h.state.inserted.messages).toHaveLength(1);
    expect(h.state.inserted.messages[0]).toMatchObject({
      sender_type: "agent",
      content_type: "text",
      content_text: "Já te atendi por aqui",
      message_id: "wamid.PHONE1",
      status: "sent",
    });

    // unread_count resets to 0 — the human already answered from their phone.
    const convUpdate = h.state.updated.find((u) => u.table === "conversations");
    expect(convUpdate?.payload).toMatchObject({ unread_count: 0 });
  });

  it("creates the contact + conversation when the agent messages a brand-new number from their phone", async () => {
    await mirrorAgentSentMessage({
      accountId: "acc-1",
      configOwnerUserId: "user-1",
      contactName: "5511988887777",
      message: {
        externalId: "wamid.PHONE2",
        from: "5511988887777",
        timestampMs: 1700000005000,
        contentType: "text",
        text: "Oi, aqui é da loja",
        mediaUrl: null,
        interactiveReplyId: null,
        replyToExternalId: null,
      },
    });

    expect(h.state.inserted.contacts).toHaveLength(1);
    expect(h.state.inserted.conversations).toHaveLength(1);
    expect(h.state.dispatchedWebhookEvents.map((e) => e.eventType)).toContain("conversation.created");
    // No relationship-trigger automations — those only fire for customer messages.
    expect(h.state.dispatchedAutomationTriggers).not.toContain("new_contact_created");
    expect(h.state.dispatchedAutomationTriggers).not.toContain("first_inbound_message");
  });

  it("skips reactions sent from the phone instead of writing a wrongly-shaped row", async () => {
    h.state.existingContact = { id: "contact-1", phone: "5511999999999", name: "Maria" };
    h.state.existingConversation = { id: "conv-1", account_id: "acc-1", contact_id: "contact-1", unread_count: 0 };
    h.state.messagesTable.push({ id: "internal-msg-1", message_id: "wamid.TARGET", conversation_id: "conv-1" });

    await mirrorAgentSentMessage({
      accountId: "acc-1",
      configOwnerUserId: "user-1",
      contactName: "Maria",
      message: {
        externalId: "wamid.PHONEREACT",
        from: "5511999999999",
        timestampMs: 1700000006000,
        contentType: "reaction",
        text: null,
        mediaUrl: null,
        interactiveReplyId: null,
        replyToExternalId: null,
        reaction: { targetExternalId: "wamid.TARGET", emoji: "👍" },
      },
    });

    expect(h.state.inserted.messages).toHaveLength(0);
    expect(h.state.upserted).toHaveLength(0);
  });
});

describe("handleStatusUpdate", () => {
  beforeEach(resetState);

  it("advances a recipient forward on the status ladder", async () => {
    h.state.broadcastRecipients.push({ id: "rec-1", status: "sent", whatsapp_message_id: "wamid.X" });

    await handleStatusUpdate({ externalId: "wamid.X", status: "delivered", timestampMs: 1700000000000 });

    expect(h.state.broadcastRecipients[0].status).toBe("delivered");
  });

  it("refuses to regress a recipient backward on the ladder", async () => {
    h.state.broadcastRecipients.push({ id: "rec-1", status: "read", whatsapp_message_id: "wamid.X" });

    await handleStatusUpdate({ externalId: "wamid.X", status: "sent", timestampMs: 1700000000000 });

    // 'read' must not regress to 'sent' — the update call is skipped.
    expect(h.state.broadcastRecipients[0].status).toBe("read");
  });

  it("refuses a 'failed' status once the recipient already reached 'delivered'", async () => {
    h.state.broadcastRecipients.push({ id: "rec-1", status: "delivered", whatsapp_message_id: "wamid.X" });

    await handleStatusUpdate({ externalId: "wamid.X", status: "failed", timestampMs: 1700000000000 });

    expect(h.state.broadcastRecipients[0].status).toBe("delivered");
  });
});

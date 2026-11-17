import { describe, expect, it, vi } from "vitest";
import {
  contactTemplateSendBody,
  sendContactTemplate,
} from "./contact-template-send";

const TEMPLATE = { name: "order_update", language: "en_US" };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("contactTemplateSendBody", () => {
  it("targets the contact and carries every template value", () => {
    expect(
      contactTemplateSendBody("contact-1", TEMPLATE, {
        body: ["Ana"],
        headerText: "Hi",
        buttonParams: { 0: "abc" },
      }),
    ).toEqual({
      contact_id: "contact-1",
      message_type: "template",
      template_name: "order_update",
      template_language: "en_US",
      template_message_params: {
        body: ["Ana"],
        headerText: "Hi",
        buttonParams: { 0: "abc" },
      },
      template_params: ["Ana"],
    });
  });

  it("never sends a conversation_id so the route find-or-creates the thread", () => {
    expect(
      contactTemplateSendBody("contact-1", TEMPLATE, { body: [] }),
    ).not.toHaveProperty("conversation_id");
  });
});

describe("sendContactTemplate", () => {
  it("posts to the send route and returns the conversation id", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { success: true, conversation_id: "conv-1" }),
    );

    const result = await sendContactTemplate(
      "contact-1",
      TEMPLATE,
      { body: [] },
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toEqual({ ok: true, conversationId: "conv-1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/whatsapp/send");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      contact_id: "contact-1",
      template_name: "order_update",
    });
  });

  it("returns a null conversation id when the route omits it", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { success: true }));

    const result = await sendContactTemplate(
      "contact-1",
      TEMPLATE,
      { body: [] },
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toEqual({ ok: true, conversationId: null });
  });

  it("surfaces the route error message", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(404, { error: "Contact not found" }),
    );

    const result = await sendContactTemplate(
      "contact-1",
      TEMPLATE,
      { body: [] },
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toEqual({ ok: false, reason: "Contact not found" });
  });

  it("falls back to the HTTP status when the body is not JSON", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("bad gateway", { status: 502 }),
    );

    const result = await sendContactTemplate(
      "contact-1",
      TEMPLATE,
      { body: [] },
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toEqual({ ok: false, reason: "HTTP 502" });
  });
});

import { describe, expect, it } from "vitest";
import { plainReplyFrom } from "./reply-text";

// When an open model forgets the JSON wrapper it usually still wrote a
// sentence meant for the customer. We send that rather than nothing —
// but only when it really is a message, not the model's scratch work.
describe("plainReplyFrom", () => {
  it("accepts a normal reply the model wrote without the wrapper", () => {
    const real = "Got it—please send your artwork file here and let me know if you need any special paper or finish.";
    expect(plainReplyFrom(real)).toBe(real);
  });

  it("trims surrounding whitespace", () => {
    expect(plainReplyFrom("  Sure, we can do that.\n")).toBe("Sure, we can do that.");
  });

  it("rejects half-written JSON", () => {
    expect(plainReplyFrom('{"reply": "Sure, we can do that."')).toBeNull();
    expect(plainReplyFrom('"reply": "hi", "items": []')).toBeNull();
  });

  it("rejects the model talking about the schema", () => {
    expect(plainReplyFrom("I should respond with a JSON object containing reply and intent.")).toBeNull();
    expect(plainReplyFrom("The intent here is price_list.")).toBeNull();
  });

  it("rejects reasoning written about the customer", () => {
    expect(plainReplyFrom("We need to ask how many copies they want.")).toBeNull();
    expect(plainReplyFrom("The user wants flyers printed.")).toBeNull();
    expect(plainReplyFrom("Okay, they asked about delivery.")).toBeNull();
  });

  it("rejects anything too long to be a WhatsApp reply", () => {
    expect(plainReplyFrom("a".repeat(601))).toBeNull();
    expect(plainReplyFrom("")).toBeNull();
  });

  it("keeps a reply that merely mentions a product name", () => {
    const reply = "Our plastic card printing starts at ₦3,000 — how many cards do you need?";
    expect(plainReplyFrom(reply)).toBe(reply);
  });
});

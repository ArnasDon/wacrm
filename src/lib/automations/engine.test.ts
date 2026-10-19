import { describe, it, expect, beforeEach, vi } from "vitest";

// Shared mock state for the service-role client. Lives in a hoisted block
// so the vi.mock factory below can close over it.
const h = vi.hoisted(() => ({
  state: {
    owned: null as { id: string } | null,
    ownedCustomField: null as { id: string } | null,
    /** Row the account-scoped `conversations` lookup resolves. */
    ownedConversation: null as { id: string } | null,
    automations: [] as Record<string, unknown>[],
    steps: [] as Record<string, unknown>[],
    fromCalls: [] as string[],
    updateCalls: [] as { table: string; filters: [string, string, unknown][] }[],
    upsertCalls: [] as { table: string; payload: unknown }[],
    logInserts: [] as Record<string, unknown>[],
    logUpdates: [] as Record<string, unknown>[],
    // automation_pending_executions rows, mutated in place by updates.
    pending: [] as Record<string, unknown>[],
    pendingUpdateError: null as { message: string } | null,
    pendingInsertError: null as { message: string } | null,
  },
}));

vi.mock("./admin-client", () => {
  const { state } = h;

  type Filter = [string, string, unknown];

  // Applies the recorded filters to an in-memory row, so scoped reads
  // (branch children, a contact's parked run) behave like the real query.
  function matches(row: Record<string, unknown>, filters: Filter[]) {
    return filters.every(([op, k, v]) => {
      const cell = row[k] ?? null;
      if (op === "eq") return cell === v;
      if (op === "is") return cell === v;
      if (op === "gte") return (cell as number | string) >= (v as number | string);
      if (op === "gt") return (cell as number | string) > (v as number | string);
      if (op === "lte") return (cell as number | string) <= (v as number | string);
      if (op === "lt") return cell !== null && (cell as number | string) < (v as number | string);
      return true;
    });
  }

  function resolve(ops: {
    table: string;
    type: string;
    payload?: unknown;
    filters: Filter[];
    single: boolean;
  }) {
    const { table, type } = ops;
    const one = <T,>(rows: T[]) => (ops.single ? rows[0] ?? null : rows);
    if (table === "automation_pending_executions") {
      if (type === "insert" && state.pendingInsertError) {
        return { data: null, error: state.pendingInsertError };
      }
      if (type === "insert") {
        const row = {
          id: `p${state.pending.length + 1}`,
          created_at: new Date(Date.now() + state.pending.length).toISOString(),
          ...(ops.payload as Record<string, unknown>),
        };
        state.pending.push(row);
        return { data: row, error: null };
      }
      if (type === "update" && state.pendingUpdateError) {
        return { data: null, error: state.pendingUpdateError };
      }
      const hit = state.pending.filter((r) => matches(r, ops.filters));
      if (type === "update") {
        hit.forEach((r) => Object.assign(r, ops.payload as Record<string, unknown>));
      }
      return { data: one(hit), error: null };
    }
    if (table === "contacts") {
      if (type === "update") {
        state.updateCalls.push({ table, filters: ops.filters });
        return { data: null, error: null };
      }
      // ownership guard / condition read
      return { data: state.owned, error: null };
    }
    if (table === "conversations") {
      return { data: state.ownedConversation, error: null };
    }
    if (table === "custom_fields") {
      // account-scoped ownership lookup for a custom field definition
      return { data: state.ownedCustomField, error: null };
    }
    if (table === "contact_custom_values") {
      if (type === "upsert") {
        state.upsertCalls.push({ table, payload: ops.payload });
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
    if (table === "automations") {
      // The dispatch list query (no id filter) keeps returning every row,
      // as it always has; a by-id lookup (resume) gets the matching row.
      const byId = ops.filters.some(([, k]) => k === "id");
      if (!byId) return { data: state.automations, error: null };
      return { data: one(state.automations.filter((r) => matches(r, ops.filters))), error: null };
    }
    if (table === "automation_logs") {
      if (type === "insert") {
        state.logInserts.push(ops.payload as Record<string, unknown>);
        return { data: { id: "log1" }, error: null };
      }
      if (type === "update") {
        state.logUpdates.push(ops.payload as Record<string, unknown>);
        return { data: null, error: null };
      }
      return { data: { steps_executed: [], status: "success" }, error: null };
    }
    if (table === "automation_steps") {
      const rows = state.steps
        .filter((r) => matches(r, ops.filters))
        .sort((a, b) => (a.position as number) - (b.position as number));
      return { data: one(rows), error: null };
    }
    return { data: null, error: null };
  }

  function builder(table: string) {
    const ops = {
      table,
      type: "select",
      payload: undefined as unknown,
      filters: [] as [string, string, unknown][],
      single: false,
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((ops.type = "insert"), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = "update"), (ops.payload = p), b),
      delete: () => ((ops.type = "delete"), b),
      upsert: (p: unknown) => ((ops.type = "upsert"), (ops.payload = p), b),
      eq: (k: string, v: unknown) => (ops.filters.push(["eq", k, v]), b),
      is: (k: string, v: unknown) => (ops.filters.push(["is", k, v]), b),
      gte: (k: string, v: unknown) => (ops.filters.push(["gte", k, v]), b),
      gt: (k: string, v: unknown) => (ops.filters.push(["gt", k, v]), b),
      lte: (k: string, v: unknown) => (ops.filters.push(["lte", k, v]), b),
      lt: (k: string, v: unknown) => (ops.filters.push(["lt", k, v]), b),
      order: () => b,
      limit: () => b,
      single: () => ((ops.single = true), Promise.resolve(resolve(ops))),
      maybeSingle: () => ((ops.single = true), Promise.resolve(resolve(ops))),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    };
    return b;
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => {
        state.fromCalls.push(t);
        return builder(t);
      },
      rpc: () => Promise.resolve({ error: null }),
    }),
  };
});

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendTemplate: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendInteractive: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
}));

import {
  STALLED_CLAIM_MS,
  claimPendingExecution,
  expireAwaitingReplies,
  requeueStalledExecutions,
  resumeAwaitingReply,
  resumePendingExecution,
  runAutomationsForTrigger,
  triggerMatches,
} from "./engine";
import { engineSendInteractive, engineSendText } from "./meta-send";
import type { Automation, KeywordMatchTriggerConfig } from "@/types";

const ACCOUNT = "acct-1";

beforeEach(() => {
  h.state.owned = null;
  h.state.ownedCustomField = null;
  h.state.ownedConversation = null;
  h.state.automations = [];
  h.state.steps = [];
  h.state.fromCalls = [];
  h.state.updateCalls = [];
  h.state.upsertCalls = [];
  h.state.logInserts = [];
  h.state.logUpdates = [];
  h.state.pending = [];
  h.state.pendingUpdateError = null;
  h.state.pendingInsertError = null;
  vi.clearAllMocks();
});

describe("runAutomationsForTrigger — tenant isolation", () => {
  it("refuses to dispatch when the contact is not in the account (GHSA-63cv-2c49-m5v3)", async () => {
    // Ownership lookup returns nothing — the contact belongs to another tenant.
    h.state.owned = null;
    // If the guard failed, this automation would run an update_contact_field step.
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "victim-contact-uuid",
      context: { message_text: "manual trigger" },
    });

    // Bailed at the guard: never fetched automations, never wrote a contact.
    expect(h.state.fromCalls).toContain("contacts");
    expect(h.state.fromCalls).not.toContain("automations");
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it("proceeds past the guard when the contact belongs to the account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = []; // no matching automations; just prove we got past the guard

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.fromCalls).toContain("automations");
  });

  it("refuses a caller-supplied conversation_id from another account (GHSA-m4fx-g6pr-hrw8)", async () => {
    // POST /api/automations/engine copies `body.context` verbatim into
    // the run, so this id is attacker-controlled. The contact is the
    // caller's own — only the conversation is foreign, which is exactly
    // what made this a cross-tenant message-injection primitive.
    h.state.owned = { id: "c1" };
    h.state.ownedConversation = null; // not in this account
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { conversation_id: "victim-conversation-uuid" },
    });

    expect(h.state.fromCalls).toContain("conversations");
    expect(h.state.fromCalls).not.toContain("automations");
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it("proceeds when the conversation belongs to the account", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedConversation = { id: "conv-1" };
    h.state.automations = [];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { conversation_id: "conv-1" },
    });

    expect(h.state.fromCalls).toContain("automations");
  });

  it("scopes the update_contact_field write to the automation's account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.updateCalls).toHaveLength(1);
    const filters = h.state.updateCalls[0].filters;
    expect(filters).toContainEqual(["eq", "id", "c1"]);
    expect(filters).toContainEqual(["eq", "account_id", ACCOUNT]);
  });
});

describe("automation_logs — status is seeded pessimistically (issue #409)", () => {
  it("writes the log row as 'failed' before any step runs", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // The insert happens before execution, so a run killed mid-flight must
    // not leave behind a row that claims it succeeded.
    expect(h.state.logInserts).toHaveLength(1);
    expect(h.state.logInserts[0]).toMatchObject({
      status: "failed",
      steps_executed: [],
    });
  });

  it("still promotes the log to 'success' once the steps complete", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // The seed is only a floor — the outermost scope still writes the real
    // verdict, so a completed run reports success as it always did.
    const withStatus = h.state.logUpdates.filter((u) => "status" in u);
    expect(withStatus.at(-1)).toMatchObject({ status: "success" });
  });
});

describe("update_contact_field — custom fields", () => {
  it("upserts contact_custom_values when the field is account-owned", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = { id: "cf1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:cf1", "Premium")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // No direct contacts column write for a custom field.
    expect(h.state.updateCalls).toHaveLength(0);
    expect(h.state.upsertCalls).toHaveLength(1);
    expect(h.state.upsertCalls[0].payload).toEqual({
      contact_id: "c1",
      custom_field_id: "cf1",
      value: "Premium",
    });
  });

  it("interpolates {{ vars.* }} into the custom value", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = { id: "cf1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:cf1", "{{ vars.source }}")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { vars: { source: "WhatsApp Ad" } },
    });

    expect(h.state.upsertCalls).toHaveLength(1);
    expect(
      (h.state.upsertCalls[0].payload as { value: string }).value,
    ).toBe("WhatsApp Ad");
  });

  it("refuses to write a custom field from another account", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = null; // account-scoped lookup finds nothing
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:foreign-cf", "x")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.upsertCalls).toHaveLength(0);
    expect(h.state.updateCalls).toHaveLength(0);
  });
});

describe("send_webhook — SSRF guard (GHSA-8jqh-598v-rfxc)", () => {
  it("refuses a private / link-local destination and never calls fetch", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    // Aimed at the cloud metadata endpoint — the classic SSRF target.
    h.state.steps = [webhookStep("http://169.254.169.254/latest/meta-data/")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // The automation matched and its steps were loaded (so we genuinely
    // reached the send_webhook case)...
    expect(h.state.fromCalls).toContain("automation_steps");
    // ...yet the guard blocked it before any outbound request left the box.
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

function webhookStep(url: string) {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "send_webhook",
    position: 0,
    parent_step_id: null,
    step_config: { url, headers: { "Metadata-Flavor": "Google" }, body_template: "{}" },
  };
}

function automationWithUpdateStep() {
  return {
    id: "a1",
    account_id: ACCOUNT,
    user_id: "u1",
    trigger_type: "new_message_received",
    trigger_config: {},
    is_active: true,
  };
}

function updateStep() {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "update_contact_field",
    position: 0,
    parent_step_id: null,
    step_config: { field: "company", value: "pwned-by-automation" },
  };
}

function customStep(field: string, value: string) {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "update_contact_field",
    position: 0,
    parent_step_id: null,
    step_config: { field, value },
  };
}

describe("triggerMatches — interactive_reply", () => {
  function automation(reply_ids: string[]): Automation {
    return {
      id: "a1",
      account_id: ACCOUNT,
      user_id: "u1",
      name: "menu step",
      trigger_type: "interactive_reply",
      trigger_config: { reply_ids },
      is_active: true,
      execution_count: 0,
      created_at: "",
      updated_at: "",
    };
  }

  it("matches when the tapped id is in reply_ids (exact)", () => {
    expect(
      triggerMatches(automation(["yes", "no"]), { interactive_reply_id: "yes" }),
    ).toBe(true);
  });

  it("does not match a different id", () => {
    expect(
      triggerMatches(automation(["yes"]), { interactive_reply_id: "maybe" }),
    ).toBe(false);
  });

  it("does not match on a substring (exact only)", () => {
    expect(
      triggerMatches(automation(["yes"]), { interactive_reply_id: "yes_please" }),
    ).toBe(false);
  });

  it("does not match when no reply id is present or config is empty", () => {
    expect(triggerMatches(automation(["yes"]), {})).toBe(false);
    expect(triggerMatches(automation([]), { interactive_reply_id: "yes" })).toBe(false);
  });
});

describe("triggerMatches — tag_added", () => {
  function automation(tagId?: string): Automation {
    return {
      id: "a1",
      account_id: ACCOUNT,
      user_id: "u1",
      name: "tag follow-up",
      trigger_type: "tag_added",
      trigger_config: tagId ? { tag_id: tagId } : {},
      is_active: true,
      execution_count: 0,
      created_at: "",
      updated_at: "",
    };
  }

  it("matches only the exact tag id", () => {
    expect(triggerMatches(automation("tag-a"), { tag_id: "tag-a" })).toBe(true);
    expect(triggerMatches(automation("tag-a"), { tag_id: "tag-ab" })).toBe(false);
  });

  it("fails closed when the config or event tag is missing", () => {
    expect(triggerMatches(automation(), { tag_id: "tag-a" })).toBe(false);
    expect(triggerMatches(automation("tag-a"), {})).toBe(false);
    expect(triggerMatches(automation("tag-a"), undefined)).toBe(false);
  });
});

describe("tag_added — conversation policy", () => {
  it("records a clear failed step when the contact has no conversation", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [{
      id: "a1",
      account_id: ACCOUNT,
      user_id: "u1",
      name: "tag outreach",
      trigger_type: "tag_added",
      trigger_config: { tag_id: "tag-a" },
      is_active: true,
    }];
    h.state.steps = [{
      id: "s1",
      automation_id: "a1",
      step_type: "send_message",
      position: 0,
      parent_step_id: null,
      step_config: { text: "Hello" },
    }];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "tag_added",
      contactId: "c1",
      context: { tag_id: "tag-a" },
    });

    expect(h.state.logUpdates).toContainEqual(expect.objectContaining({
      status: "failed",
      error_message: "tag_added automation cannot send: contact has no existing conversation",
    }));
  });
});

describe("triggerMatches — keyword_match", () => {
  function automation(
    cfg: Partial<KeywordMatchTriggerConfig> & { keywords: string[] },
  ): Automation {
    return {
      id: "a1",
      account_id: ACCOUNT,
      user_id: "u1",
      name: "kw",
      trigger_type: "keyword_match",
      trigger_config: { match_type: "contains", ...cfg },
      is_active: true,
    } as unknown as Automation;
  }

  const on = (a: Automation, text: string) =>
    triggerMatches(a, { message_text: text });

  it("keeps `contains` as a raw substring test", () => {
    // Issue #409 asked for this to become word-boundary matching. It
    // deliberately did NOT change: existing automations relying on
    // substring behaviour ("cat" firing on "category") must keep working,
    // and `contains` is the builder's default. `word` is the opt-in fix.
    expect(on(automation({ keywords: ["k"] }), "thanks")).toBe(true);
    expect(on(automation({ keywords: ["cat"] }), "category")).toBe(true);
  });

  it("`word` matches only standalone words", () => {
    const a = automation({ keywords: ["k"], match_type: "word" });
    expect(on(a, "thanks")).toBe(false);
    expect(on(a, "k")).toBe(true);
    expect(on(a, "press k to continue")).toBe(true);
    expect(on(a, "press K!")).toBe(true);
  });

  it("`word` respects punctuation and line edges around the keyword", () => {
    const a = automation({ keywords: ["hi"], match_type: "word" });
    expect(on(a, "hi")).toBe(true);
    expect(on(a, "hi!")).toBe(true);
    expect(on(a, "(hi)")).toBe(true);
    expect(on(a, "say hi.")).toBe(true);
    expect(on(a, "this")).toBe(false);
    expect(on(a, "hiya")).toBe(false);
  });

  it("`word` handles a keyword that itself carries punctuation", () => {
    // `\b` can't do this: /\bhi!\b/ demands a word char after the "!",
    // so it never matches. Hence the lookaround implementation.
    const a = automation({ keywords: ["hi!"], match_type: "word" });
    expect(on(a, "say hi!")).toBe(true);
    expect(on(a, "hi! there")).toBe(true);
  });

  it("`word` treats regex metacharacters in a keyword as literal", () => {
    // Account-supplied free text — an unescaped "(" would throw.
    const a = automation({ keywords: ["c++ (beginner)"], match_type: "word" });
    expect(on(a, "I want the c++ (beginner) course")).toBe(true);
    expect(on(a, "I want the cxx beginner course")).toBe(false);
    expect(() => on(automation({ keywords: ["("], match_type: "word" }), "(")).not.toThrow();
  });

  it("`word` is case-insensitive unless case_sensitive is set", () => {
    expect(on(automation({ keywords: ["Hi"], match_type: "word" }), "hi")).toBe(true);
    expect(
      on(
        automation({ keywords: ["Hi"], match_type: "word", case_sensitive: true }),
        "hi",
      ),
    ).toBe(false);
    expect(
      on(
        automation({ keywords: ["Hi"], match_type: "word", case_sensitive: true }),
        "Hi",
      ),
    ).toBe(true);
  });

  it("`word` finds a space-delimited keyword in a non-Latin script", () => {
    // ASCII `\b` fails outright here — every character of "안녕" is a
    // non-word character to it, so /\b안녕\b/ matches nothing.
    const a = automation({ keywords: ["안녕"], match_type: "word" });
    expect(on(a, "안녕")).toBe(true);
    expect(on(a, "저기 안녕 하세요")).toBe(true);
    // Documented limitation, not an accident: a language written without
    // spaces has no word edge inside a run of characters.
    expect(on(a, "안녕하세요")).toBe(false);
  });

  it("`exact` still requires the whole message to be the keyword", () => {
    const a = automation({ keywords: ["hi"], match_type: "exact" });
    expect(on(a, "hi")).toBe(true);
    expect(on(a, "hi there")).toBe(false);
  });

  it("ignores empty keywords and empty messages in `word` mode", () => {
    expect(on(automation({ keywords: [""], match_type: "word" }), "anything")).toBe(false);
    expect(on(automation({ keywords: ["hi"], match_type: "word" }), "")).toBe(false);
  });
});

// ------------------------------------------------------------
// wait_for_reply — park after Send Buttons / List, resume on reply
// ------------------------------------------------------------

describe("wait_for_reply", () => {
  function menuAutomation(overrides: Record<string, unknown> = {}) {
    return {
      id: "a1",
      account_id: ACCOUNT,
      user_id: "u1",
      trigger_type: "new_message_received",
      trigger_config: {},
      is_active: true,
      ...overrides,
    };
  }

  function step(
    id: string,
    step_type: string,
    position: number,
    step_config: Record<string, unknown>,
    parent?: { id: string; branch: "yes" | "no" },
  ) {
    return {
      id,
      automation_id: "a1",
      step_type,
      position,
      parent_step_id: parent?.id ?? null,
      branch: parent?.branch ?? null,
      step_config,
    };
  }

  const buttons = (wait: boolean) => ({
    kind: "buttons",
    body: "Which service?",
    buttons: [
      { id: "web", title: "Website" },
      { id: "mkt", title: "Marketing" },
    ],
    ...(wait ? { wait_for_reply: true } : {}),
  });
  const say = (text: string) => ({ text });
  const contains = (value: string) => ({
    subject: "message_content",
    operand: "contains",
    value,
  });

  // The user's menu: buttons, then branch on what was tapped, then a
  // closing root step after the condition.
  function userMenu(wait = true) {
    return [
      step("btn", "send_buttons", 0, buttons(wait)),
      step("cond", "condition", 1, contains("Website")),
      step("yes1", "send_message", 0, say("crm.stelltech.ai"), { id: "cond", branch: "yes" }),
      step("no1", "send_message", 0, say("Other options"), { id: "cond", branch: "no" }),
      step("after", "send_message", 2, say("Thanks for contacting")),
    ];
  }

  const sentTexts = () =>
    vi.mocked(engineSendText).mock.calls.map(([a]) => (a as { text: string }).text);

  async function trigger(text: string) {
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { message_text: text, conversation_id: "conv1" },
    });
  }

  function reply(text: string, interactive_reply_id?: string) {
    return resumeAwaitingReply({
      accountId: ACCOUNT,
      contactId: "c1",
      context: { message_text: text, conversation_id: "conv1", interactive_reply_id },
    });
  }

  beforeEach(() => {
    h.state.owned = { id: "c1" };
    h.state.ownedConversation = { id: "conv1" };
    h.state.automations = [menuAutomation()];
  });

  it("parks after the buttons instead of evaluating the condition on the trigger text", async () => {
    h.state.steps = userMenu();

    await trigger("Hii");

    expect(engineSendInteractive).toHaveBeenCalledTimes(1);
    // Neither branch nor the closing step ran yet.
    expect(engineSendText).not.toHaveBeenCalled();
    expect(h.state.pending).toHaveLength(1);
    const parked = h.state.pending[0];
    expect(parked).toMatchObject({
      status: "awaiting_reply",
      account_id: ACCOUNT,
      contact_id: "c1",
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
    });
    const deadline = Date.parse(parked.run_at as string) - Date.now();
    expect(deadline).toBeGreaterThan(23.9 * 3_600_000);
    expect(deadline).toBeLessThanOrEqual(24 * 3_600_000);
    expect(h.state.logUpdates.at(-1)).toMatchObject({ status: "partial" });
  });

  it("resumes with the tapped button, so the condition takes the YES branch", async () => {
    h.state.steps = userMenu();
    await trigger("Hii");

    const consumed = await reply("Website", "web");

    expect(consumed).toBe(true);
    expect(sentTexts()).toEqual(["crm.stelltech.ai", "Thanks for contacting"]);
    expect(h.state.pending[0].status).toBe("done");
    expect(h.state.logUpdates.at(-1)).toMatchObject({ status: "success" });
  });

  it("routes a non-matching reply down the NO branch", async () => {
    h.state.steps = userMenu();
    await trigger("Hii");

    await reply("Marketing", "mkt");

    expect(sentTexts()).toEqual(["Other options", "Thanks for contacting"]);
  });

  it("hands the reply to steps after the wait as {{ message.text }}", async () => {
    h.state.steps = [
      step("btn", "send_buttons", 0, buttons(true)),
      step("echo", "send_message", 1, say("You picked {{ message.text }}")),
    ];
    await trigger("Hii");

    await reply("Website", "web");

    expect(sentTexts()).toEqual(["You picked Website"]);
  });

  it("stops the enclosing scopes when a branch parks, then climbs back out on resume", async () => {
    // Buttons inside the "Hii" YES branch, with a step after them in the
    // branch and another after the condition at the root.
    h.state.steps = [
      step("hii", "condition", 0, contains("Hii")),
      step("btn", "send_buttons", 0, buttons(true), { id: "hii", branch: "yes" }),
      step("inBranch", "send_message", 1, say("in branch"), { id: "hii", branch: "yes" }),
      step("atRoot", "send_message", 1, say("at root")),
    ];

    await trigger("Hii");
    // The root step after the condition must NOT have run ahead.
    expect(engineSendText).not.toHaveBeenCalled();
    expect(h.state.pending[0]).toMatchObject({
      parent_step_id: "hii",
      branch: "yes",
      next_step_position: 1,
    });

    await reply("anything");

    expect(sentTexts()).toEqual(["in branch", "at root"]);
    expect(h.state.logUpdates.at(-1)).toMatchObject({ status: "success" });
  });

  describe("condition branch outcomes reach the root scope", () => {
    const statuses = () =>
      h.state.logUpdates.filter((u) => "status" in u).map((u) => u.status);

    function branchThenRoot() {
      return [
        step("hii", "condition", 0, contains("Hii")),
        step("inBranch", "send_message", 0, say("in branch"), { id: "hii", branch: "yes" }),
        step("atRoot", "send_message", 1, say("at root")),
      ];
    }

    it("stops the run and fails the log when a branch step fails", async () => {
      h.state.steps = branchThenRoot();
      vi.mocked(engineSendText).mockRejectedValueOnce(new Error("meta down"));

      await trigger("Hii");

      expect(sentTexts()).toEqual(["in branch"]);
      expect(statuses().at(-1)).toBe("failed");
      expect(statuses()).not.toContain("success");
      expect(h.state.logUpdates).toContainEqual(
        expect.objectContaining({ error_message: "meta down" }),
      );
    });

    it("fails through every enclosing branch when a nested branch step fails", async () => {
      h.state.steps = [
        step("outer", "condition", 0, contains("Hii")),
        step("inner", "condition", 0, contains("Hii"), { id: "outer", branch: "yes" }),
        step("deep", "send_message", 0, say("deep"), { id: "inner", branch: "yes" }),
        step("afterInner", "send_message", 1, say("after inner"), { id: "outer", branch: "yes" }),
        step("atRoot", "send_message", 1, say("at root")),
      ];
      vi.mocked(engineSendText).mockRejectedValueOnce(new Error("meta down"));

      await trigger("Hii");

      expect(sentTexts()).toEqual(["deep"]);
      expect(statuses().at(-1)).toBe("failed");
      expect(statuses()).not.toContain("success");
    });

    it("leaves the log partial when a branch parks for a reply", async () => {
      h.state.steps = [
        step("hii", "condition", 0, contains("Hii")),
        step("btn", "send_buttons", 0, buttons(true), { id: "hii", branch: "yes" }),
        step("atRoot", "send_message", 1, say("at root")),
      ];

      await trigger("Hii");

      expect(engineSendText).not.toHaveBeenCalled();
      expect(statuses()).toEqual(["partial"]);
    });

    it("fails the log when a branch step fails after resuming from a reply", async () => {
      h.state.steps = [
        step("hii", "condition", 0, contains("Hii")),
        step("btn", "send_buttons", 0, buttons(true), { id: "hii", branch: "yes" }),
        step("inBranch", "send_message", 1, say("in branch"), { id: "hii", branch: "yes" }),
        step("atRoot", "send_message", 1, say("at root")),
      ];
      await trigger("Hii");
      vi.mocked(engineSendText).mockRejectedValueOnce(new Error("meta down"));

      await reply("anything");

      expect(sentTexts()).toEqual(["in branch"]);
      expect(statuses().at(-1)).toBe("failed");
    });

    it("still runs the steps after a condition when its branch succeeds", async () => {
      h.state.steps = branchThenRoot();

      await trigger("Hii");

      expect(sentTexts()).toEqual(["in branch", "at root"]);
      expect(statuses()).toEqual(["success"]);
    });
  });

  it("does not resume a run whose 24h deadline has passed", async () => {
    h.state.steps = userMenu();
    await trigger("Hii");
    h.state.pending[0].run_at = new Date(Date.now() - 1000).toISOString();

    const consumed = await reply("Website", "web");

    expect(consumed).toBe(false);
    expect(engineSendText).not.toHaveBeenCalled();
    expect(h.state.pending[0].status).toBe("awaiting_reply");
  });

  it("supersedes an older waiting run for the same contact", async () => {
    h.state.steps = userMenu();
    await trigger("Hii");
    await trigger("Hii");

    expect(h.state.pending.map((r) => r.status)).toEqual(["superseded", "awaiting_reply"]);
  });

  it("fails the run instead of parking when there is no contact (issue #642)", async () => {
    h.state.automations = [menuAutomation({ trigger_type: "time_based" })];
    h.state.steps = userMenu();

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "time_based",
      contactId: null,
      context: { conversation_id: "conv1" },
    });

    expect(engineSendInteractive).not.toHaveBeenCalled();
    expect(engineSendText).not.toHaveBeenCalled();
    expect(h.state.pending).toHaveLength(0);
    expect(h.state.logUpdates.at(-1)).toMatchObject({
      status: "failed",
      error_message: "send_buttons needs a contact",
    });
  });

  it("fails the run when superseding the older wait errors (issue #642)", async () => {
    h.state.steps = userMenu();
    h.state.pendingUpdateError = { message: "db down" };

    await trigger("Hii");

    expect(h.state.pending).toHaveLength(0);
    expect(engineSendText).not.toHaveBeenCalled();
    expect(h.state.logUpdates.at(-1)).toMatchObject({
      status: "failed",
      error_message: "could not park for reply: db down",
    });
  });

  it("releases the message when the automation was paused while waiting", async () => {
    h.state.steps = userMenu();
    await trigger("Hii");
    h.state.automations = [menuAutomation({ is_active: false })];

    const consumed = await reply("Website", "web");

    expect(consumed).toBe(false);
    expect(engineSendText).not.toHaveBeenCalled();
    expect(h.state.pending[0].status).toBe("expired");
  });

  it("re-verifies the reply's conversation before sending (GHSA-m4fx-g6pr-hrw8)", async () => {
    h.state.steps = userMenu();
    await trigger("Hii");
    // The conversation no longer resolves inside this account.
    h.state.ownedConversation = null;

    await reply("Website", "web");

    expect(engineSendText).not.toHaveBeenCalled();
    expect(h.state.logUpdates).toContainEqual(
      expect.objectContaining({ error_message: "conversation does not belong to this account" }),
    );
  });

  it("returns false when nothing is waiting for the contact", async () => {
    expect(await reply("hello")).toBe(false);
  });

  it("without the checkbox, keeps today's single-pass behaviour", async () => {
    h.state.steps = userMenu(false);

    await trigger("Hii");

    expect(h.state.pending).toHaveLength(0);
    // The condition ran immediately against "Hii" — the documented
    // single-pass semantics that wait_for_reply exists to opt out of.
    expect(sentTexts()).toEqual(["Other options", "Thanks for contacting"]);
  });

  it("expires lapsed waits and explains why on the log", async () => {
    h.state.steps = userMenu();
    await trigger("Hii");
    h.state.pending[0].run_at = new Date(Date.now() - 1000).toISOString();

    const expired = await expireAwaitingReplies();

    expect(expired).toBe(1);
    expect(h.state.pending[0].status).toBe("expired");
    expect(h.state.logUpdates.at(-1)).toEqual({ error_message: "no reply within 24h" });
  });

  describe("integrity of parked runs", () => {
    const wait = { amount: 1, unit: "hours" };

    function resumeDue(index = 0) {
      const row = h.state.pending[index];
      return resumePendingExecution({
        id: row.id as string,
        automation_id: row.automation_id as string,
        account_id: ACCOUNT,
        user_id: "u1",
        contact_id: (row.contact_id as string | null) ?? null,
        log_id: (row.log_id as string | null) ?? null,
        parent_step_id: (row.parent_step_id as string | null) ?? null,
        branch: (row.branch as "yes" | "no" | null) ?? null,
        next_step_position: row.next_step_position as number,
        parked_step_id: (row.parked_step_id as string | null) ?? null,
        context: (row.context as Record<string, unknown>) ?? {},
      });
    }

    function waitInBranch() {
      return [
        step("first", "send_message", 0, say("first")),
        step("hii", "condition", 1, contains("Hii")),
        step("wait", "wait", 0, wait, { id: "hii", branch: "yes" }),
        step("afterWait", "send_message", 1, say("after wait"), { id: "hii", branch: "yes" }),
      ];
    }

    it("records which step parked the run", async () => {
      h.state.steps = waitInBranch();
      await trigger("Hii");

      expect(h.state.pending[0]).toMatchObject({
        status: "pending",
        parked_step_id: "wait",
        parent_step_id: "hii",
        branch: "yes",
      });
    });

    it("expires a time wait when the automation was paused", async () => {
      h.state.steps = waitInBranch();
      await trigger("Hii");
      vi.mocked(engineSendText).mockClear();
      h.state.automations = [menuAutomation({ is_active: false })];

      await resumeDue();

      expect(engineSendText).not.toHaveBeenCalled();
      expect(h.state.pending[0].status).toBe("expired");
      expect(h.state.logUpdates.at(-1)).toEqual({
        error_message: "automation paused while waiting",
      });
    });

    it("expires a time wait whose step was removed, instead of re-running root steps", async () => {
      h.state.steps = waitInBranch();
      await trigger("Hii");
      vi.mocked(engineSendText).mockClear();
      h.state.steps = h.state.steps.filter((s) => s.id === "first");

      await resumeDue();

      expect(engineSendText).not.toHaveBeenCalled();
      expect(h.state.pending[0].status).toBe("expired");
      expect(h.state.logUpdates.at(-1)).toEqual({
        error_message: "the step this run was waiting at was removed or moved out of its branch",
      });
    });

    it("expires a legacy branch row whose parent pointer was nulled", async () => {
      h.state.steps = waitInBranch();
      await trigger("Hii");
      vi.mocked(engineSendText).mockClear();
      Object.assign(h.state.pending[0], { parked_step_id: null, parent_step_id: null });

      await resumeDue();

      expect(engineSendText).not.toHaveBeenCalled();
      expect(h.state.pending[0].status).toBe("expired");
    });

    it("resumes after the parked step's current position when steps were reordered", async () => {
      h.state.steps = waitInBranch();
      await trigger("Hii");
      vi.mocked(engineSendText).mockClear();
      h.state.steps = [
        step("first", "send_message", 0, say("first")),
        step("hii", "condition", 1, contains("Hii")),
        step("inserted", "send_message", 0, say("inserted before"), { id: "hii", branch: "yes" }),
        step("wait", "wait", 1, wait, { id: "hii", branch: "yes" }),
        step("afterWait", "send_message", 2, say("after wait"), { id: "hii", branch: "yes" }),
      ];

      await resumeDue();

      expect(sentTexts()).toEqual(["after wait"]);
      expect(h.state.pending[0].status).toBe("done");
    });

    it("releases a reply whose waiting step was removed", async () => {
      h.state.steps = userMenu();
      await trigger("Hii");
      h.state.steps = h.state.steps.filter((s) => s.id !== "btn");

      const consumed = await reply("Website", "web");

      expect(consumed).toBe(false);
      expect(engineSendText).not.toHaveBeenCalled();
      expect(h.state.pending[0].status).toBe("expired");
    });

    it("fails the log when the time wait cannot be scheduled", async () => {
      h.state.steps = waitInBranch();
      h.state.pendingInsertError = { message: "db down" };

      await trigger("Hii");

      expect(sentTexts()).toEqual(["first"]);
      const statuses = h.state.logUpdates.filter((u) => "status" in u).map((u) => u.status);
      expect(statuses.at(-1)).toBe("failed");
      expect(h.state.logUpdates).toContainEqual(
        expect.objectContaining({ error_message: "could not schedule the wait: db down" }),
      );
    });

    it("stamps claimed_at when claiming and requeues claims older than the stall window", async () => {
      h.state.steps = waitInBranch();
      await trigger("Hii");
      const claimTime = new Date("2026-10-16T10:00:00Z");

      expect(await claimPendingExecution("p1", claimTime)).toBe(true);
      expect(await claimPendingExecution("p1", claimTime)).toBe(false);
      expect(h.state.pending[0]).toMatchObject({
        status: "running",
        claimed_at: claimTime.toISOString(),
      });

      const early = new Date(claimTime.getTime() + STALLED_CLAIM_MS - 1000);
      expect(await requeueStalledExecutions(early)).toBe(0);
      expect(h.state.pending[0].status).toBe("running");

      const late = new Date(claimTime.getTime() + STALLED_CLAIM_MS + 1000);
      expect(await requeueStalledExecutions(late)).toBe(1);
      expect(h.state.pending[0]).toMatchObject({ status: "pending", claimed_at: null });
    });

    it("never requeues a reply run claimed by the webhook", async () => {
      h.state.pending.push({ id: "r1", status: "running", claimed_at: null });

      expect(await requeueStalledExecutions(new Date(Date.now() + 2 * STALLED_CLAIM_MS))).toBe(0);
      expect(h.state.pending[0].status).toBe("running");
    });
  });

  describe("condition values", () => {
    it("treats an empty message_content value as no match", async () => {
      h.state.steps = [
        step("cond", "condition", 0, contains("")),
        step("yes1", "send_message", 0, say("yes"), { id: "cond", branch: "yes" }),
        step("no1", "send_message", 0, say("no"), { id: "cond", branch: "no" }),
      ];

      await trigger("anything");

      expect(sentTexts()).toEqual(["no"]);
    });

    it("evaluates time_of_day in the condition's time zone", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-16T16:30:00Z"));
      try {
        const window = (timezone?: string) => ({
          subject: "time_of_day",
          operand: "18:00-09:00",
          ...(timezone ? { timezone } : {}),
        });
        const branchSteps = (cfg: Record<string, unknown>) => [
          step("cond", "condition", 0, cfg),
          step("yes1", "send_message", 0, say("closed"), { id: "cond", branch: "yes" }),
          step("no1", "send_message", 0, say("open"), { id: "cond", branch: "no" }),
        ];

        h.state.steps = branchSteps(window("Europe/Vilnius"));
        await trigger("hi");
        h.state.steps = branchSteps(window());
        await trigger("hi");

        expect(sentTexts()).toEqual(["closed", "open"]);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

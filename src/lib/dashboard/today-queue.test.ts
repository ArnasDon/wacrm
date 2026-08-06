import { describe, expect, it } from "vitest";
import { partitionTodayQueue } from "./queries";
import type { TodayQueueDealRaw } from "./types";

// Deals de prueba — solo los campos que la partición usa.
function deal(partial: Partial<TodayQueueDealRaw> & { id: string }): TodayQueueDealRaw {
  return {
    title: "",
    value: null,
    currency: null,
    status: "open",
    score: null,
    priority: null,
    tags: null,
    expected_close_date: null,
    contact: null,
    conversation: null,
    ...partial,
  };
}

describe("partitionTodayQueue — 3 secciones 🔥⏳💤 (DAD §7.4)", () => {
  it("urgencia=2 → 🔥 hot (menos de 30 días)", () => {
    const { sections } = partitionTodayQueue([
      deal({ id: "a", tags: { urgencia: 2, documentos: 2 } }),
    ]);
    expect(sections.find((s) => s.key === "hot")!.deals).toHaveLength(1);
    expect(sections.find((s) => s.key === "docs")!.deals).toHaveLength(0);
    expect(sections.find((s) => s.key === "nurture")!.deals).toHaveLength(0);
  });

  it("documentos != 2 → ⏳ docs (esperando docs)", () => {
    const { sections } = partitionTodayQueue([
      // urgencia 1 ≠ 2 → no es hot; documentos 0 ≠ 2 → docs
      deal({ id: "a", tags: { urgencia: 1, documentos: 0 } }),
      deal({ id: "b", tags: { urgencia: 0, documentos: 1 } }),
      // documentos null dentro de un objeto tags (JSONB puede tener null) →
      // se trata como 0 → docs
      deal({
        id: "c",
        tags: { urgencia: 0, documentos: null as unknown as number },
      }),
    ]);
    expect(sections.find((s) => s.key === "docs")!.deals.map((d) => d.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("documentos == 2 y sin urgencia → 💤 nurture", () => {
    const { sections } = partitionTodayQueue([
      deal({ id: "a", tags: { urgencia: 0, documentos: 2 } }),
      deal({ id: "b", tags: null }),
    ]);
    expect(sections.find((s) => s.key === "nurture")!.deals.map((d) => d.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("orden dentro de la sección: prioridad desc (top > warm > tibio > cold)", () => {
    const { sections } = partitionTodayQueue([
      deal({ id: "cold", priority: "cold", tags: { urgencia: 0, documentos: 2 } }),
      deal({ id: "top", priority: "top", tags: { urgencia: 0, documentos: 2 } }),
      deal({ id: "warm", priority: "warm", tags: { urgencia: 0, documentos: 2 } }),
    ]);
    const nurture = sections.find((s) => s.key === "nurture")!;
    expect(nurture.deals.map((d) => d.id)).toEqual(["top", "warm", "cold"]);
  });

  it("tie-break: última interacción más reciente primero (last_message_at)", () => {
    const { sections } = partitionTodayQueue([
      deal({
        id: "old",
        priority: "top",
        tags: { urgencia: 0, documentos: 2 },
        conversation: { id: "conv-old", last_message_at: "2026-05-01T10:00:00Z", last_message_text: null },
      }),
      deal({
        id: "new",
        priority: "top",
        tags: { urgencia: 0, documentos: 2 },
        conversation: { id: "conv-new", last_message_at: "2026-05-05T10:00:00Z", last_message_text: "hola" },
      }),
    ]);
    const nurture = sections.find((s) => s.key === "nurture")!;
    expect(nurture.deals.map((d) => d.id)).toEqual(["new", "old"]);
  });

  it("normaliza relaciones anidadas en array (PostgREST 1:1) a objeto", () => {
    const { sections } = partitionTodayQueue([
      deal({
        id: "a",
        tags: { urgencia: 0, documentos: 2 },
        contact: [{ id: "c1", name: "Ana", phone: "+521", email: "a@x.com" }],
        conversation: [{ id: "conv-a", last_message_at: "2026-05-05T10:00:00Z", last_message_text: "ok" }],
      }),
    ]);
    const nurture = sections.find((s) => s.key === "nurture")!;
    expect(nurture.deals[0].contact).toEqual({
      id: "c1",
      name: "Ana",
      phone: "+521",
      email: "a@x.com",
    });
    expect(nurture.deals[0].conversation?.last_message_text).toBe("ok");
  });

  it("no muta los rows de entrada (deals inmutables)", () => {
    const input = [
      deal({ id: "a", tags: { urgencia: 2, documentos: 2 } }),
      deal({ id: "b", tags: { urgencia: 0, documentos: 0 } }),
    ];
    partitionTodayQueue(input);
    expect(Array.isArray(input[0].contact)).toBe(false);
    expect(Array.isArray(input[1].contact)).toBe(false);
    expect(input).toHaveLength(2);
  });
});

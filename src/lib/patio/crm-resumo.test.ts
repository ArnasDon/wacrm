import { describe, it, expect } from "vitest";
import { temposDeResposta, mediana } from "./crm-resumo";

describe("tempo de resposta", () => {
  it("conta da primeira mensagem do cliente até a primeira resposta de uma pessoa, por conversa", () => {
    const t = temposDeResposta([
      { conversation_id: "a", sender_type: "customer", created_at: "2026-11-01T10:00:00Z" },
      { conversation_id: "a", sender_type: "customer", created_at: "2026-11-01T10:02:00Z" },
      { conversation_id: "a", sender_type: "agent", created_at: "2026-11-01T10:10:00Z" },
      { conversation_id: "a", sender_type: "agent", created_at: "2026-11-01T10:11:00Z" },
      { conversation_id: "b", sender_type: "agent", created_at: "2026-11-01T09:00:00Z" },
      { conversation_id: "b", sender_type: "customer", created_at: "2026-11-01T09:30:00Z" },
      { conversation_id: "b", sender_type: "bot", created_at: "2026-11-01T09:31:00Z" },
      { conversation_id: "c", sender_type: "customer", created_at: "2026-11-01T09:30:00Z" },
    ]);
    expect(t).toEqual([10]); // o robô (bot) não conta como resposta
    expect(mediana([1, 10, 4])).toBe(4);
    expect(mediana([])).toBeNull();
  });
});

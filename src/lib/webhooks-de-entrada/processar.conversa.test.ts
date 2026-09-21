import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// O lead que chega por webhook (o Typebot) ganha a conversa ENCERRADA — ele
// ainda não escreveu, e a conversa vazia em "Abertas" seria ruído na caixa
// da equipe. Quem decide é o WEBHOOK, pedindo a `resolverDestinatario`; o
// Calendly e o aviso à equipe continuam como sempre.
// ============================================================

const motor = vi.hoisted(() => ({ dispararAutomacoes: vi.fn() }));
vi.mock("@/lib/automations/engine", () => motor);

const destino = vi.hoisted(() => ({ resolverDestinatario: vi.fn() }));
vi.mock("@/lib/automations/destinatario", () => destino);

import { processarAcionamento } from "./processar";

const admin = {
  from() {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      then: (f: (v: unknown) => unknown) =>
        Promise.resolve({ data: [{ id: "a1", trigger_config: { webhook_id: "w1" } }], error: null }).then(f),
    };
    return b;
  },
} as unknown as SupabaseClient;

const WEBHOOK = {
  id: "w1",
  nome: "Typebot",
  is_active: true,
  campo_telefone: "telefone",
  campo_nome: "nome",
};

beforeEach(() => {
  destino.resolverDestinatario
    .mockReset()
    .mockResolvedValue({ contactId: "c1", conversationId: "conv1", criouContato: true });
  motor.dispararAutomacoes
    .mockReset()
    .mockResolvedValue({ candidatas: 1, foraDoEscopo: 0, executadas: 1, comFalha: 0, emEspera: 0 });
});

describe("processarAcionamento — a conversa do lead", () => {
  it("CRÍTICO: pede a conversa nova ENCERRADA", async () => {
    const r = await processarAcionamento(admin, "conta-1", WEBHOOK, {
      variaveis: { telefone: "+5585999998888", nome: "Maria" },
    });

    expect(r.resultado).toBe("disparado");
    expect(destino.resolverDestinatario).toHaveBeenCalledWith(
      admin,
      "conta-1",
      "5585999998888",
      "Maria",
      { conversaNovaEncerrada: true }
    );
  });
});

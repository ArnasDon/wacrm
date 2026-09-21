import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// O token é lido cifrado; aqui ele é o que está gravado.
vi.mock("@/lib/whatsapp/encryption", () => ({
  decrypt: (v: string) => v,
  encrypt: (v: string) => v,
}));

import { EVENTOS_ASSINADOS, conferirAssinatura } from "./conexao";

// ------------------------------------------------------------
// ⚠️ A LISTA DE EVENTOS É FIXADA NA CRIAÇÃO da assinatura, lá no Calendly.
// Quem conectou antes de o cancelamento existir (20/09/2026) segue recebendo
// só `invitee.created` — e o sintoma é ausência: o cancelamento não chega, o
// lembrete da reunião cancelada sai, e a tela não diz nada. Por isso a
// conferência do cartão transforma isso em erro VISÍVEL.
// ------------------------------------------------------------

function bancoFalso(config: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = [];
  const db = {
    from() {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: config, error: null }),
        update: (v: Record<string, unknown>) => {
          updates.push(v);
          return b;
        },
        then: (f: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(f),
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { db, updates };
}

const clienteCom = (eventos: string[], estado: "active" | "disabled" = "active") =>
  () => ({ assinatura: async () => ({ estado, eventos }) }) as never;

const CONFIG = {
  access_token: "t",
  webhook_uri: "https://api.calendly.com/webhook_subscriptions/W1",
  webhook_state: "active",
  status: "ok",
  last_error: null,
};

describe("conferirAssinatura — assinatura incompleta", () => {
  it("CRÍTICO: assinatura sem o cancelamento vira erro visível", async () => {
    const { db, updates } = bancoFalso(CONFIG);
    await conferirAssinatura(db, "conta-1", { cliente: clienteCom(["invitee.created"]) });
    expect(updates).toContainEqual(
      expect.objectContaining({ status: "erro", last_error: "assinatura_incompleta" }),
    );
  });

  it("assinatura completa não acusa nada", async () => {
    const { db, updates } = bancoFalso(CONFIG);
    await conferirAssinatura(db, "conta-1", { cliente: clienteCom([...EVENTOS_ASSINADOS]) });
    expect(updates.some((u) => u.last_error === "assinatura_incompleta")).toBe(false);
  });

  it("reassinou: o aviso some sozinho na conferência seguinte", async () => {
    const { db, updates } = bancoFalso({ ...CONFIG, status: "erro", last_error: "assinatura_incompleta" });
    await conferirAssinatura(db, "conta-1", { cliente: clienteCom([...EVENTOS_ASSINADOS]) });
    // ⚠️ "conectado", não "ok": o CHECK do 0977 só aceita 'conectado'|'erro',
    // e "ok" seria recusado em silêncio — o cartão ficaria vermelho para
    // sempre depois de reassinar (Codex, PR #235).
    expect(updates).toContainEqual(expect.objectContaining({ status: "conectado", last_error: null }));
  });

  it("⚠️ NÃO apaga erro de outra causa de carona", async () => {
    const { db, updates } = bancoFalso({ ...CONFIG, status: "erro", last_error: "token_invalido" });
    await conferirAssinatura(db, "conta-1", { cliente: clienteCom([...EVENTOS_ASSINADOS]) });
    expect(updates.some((u) => u.last_error === null)).toBe(false);
  });

  it("os dois eventos são assinados — o cancelamento não pode sair da lista", () => {
    expect(EVENTOS_ASSINADOS).toEqual(["invitee.created", "invitee.canceled"]);
  });
});

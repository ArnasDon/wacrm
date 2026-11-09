import { describe, it, expect } from "vitest";
import { textoDoAlerta, destinoDoGrupo, itensDeConversas } from "./alertas";

describe("alertas", () => {
  it("texto do grupo com link e limite", () => {
    const itens = Array.from({ length: 12 }, (_, i) => ({ id: String(i), nome: `Carro ${i}`, href: `/patio/${i}` }));
    const t = textoDoAlerta({ regra: "Parados", itens });
    expect(t).toContain("*Parados*");
    expect(t).toContain("12 itens");
    expect(t).toContain("https://crmwga.com/patio/0");
    expect(t).toContain("e mais 2");
  });
  it("endereço do grupo por provedor", () => {
    expect(destinoDoGrupo("120363000000000000", "uazapi")).toBe("120363000000000000@g.us");
    expect(destinoDoGrupo("120363@g.us", "uazapi")).toBe("120363@g.us");
    expect(destinoDoGrupo("120363", "meta")).toBeNull();
  });
  it("minutos sem resposta", () => {
    const agora = Date.parse("2026-11-09T12:00:00Z");
    const r = itensDeConversas([{ id: "c", last_message_at: "2026-11-09T11:30:00Z", contact: null }, { id: "d", last_message_at: null, contact: null }], agora);
    expect(r).toEqual([{ id: "c", nome: "Cliente", href: "/inbox?conversation=c", valores: { minutos_sem_resposta: 30 } }]);
  });
});

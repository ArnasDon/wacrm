import { describe, it, expect } from "vitest";
import { montarCarro, separarParaFirestore, filtrarParaPapel, aplicarMudanca, diasNoPatio, recorte, type Carro } from "./veiculo";

const publico = {
  id: "abc123",
  cat: "carros",
  status: "available",
  brand: "BYD",
  model: "Song Plus",
  versao: "GS",
  year: "2025/2026",
  mileage: "10000",
  plate: "ABC1D23",
  badge: "Híbrido",
  description: "Texto",
  img: "https://x/1.jpg",
  images: [{ url: "https://x/1.jpg" }, { url: "https://x/2.jpg" }],
  ipva: "2026 pago",
  chave_manual: true,
  revisoes: "em dia",
  ownership_type: "proprio",
  premium: false,
  ordem: 2,
  finance: { sale_price: 218000 },
};
const privado = {
  seller: { name: "Dono", document: "000" },
  finance: { sale_price: 218000, purchase_price: 180000, old_price: 229000 },
  sale: {},
  documents: [{ id: "d1", name: "CRLV" }],
  unavailable: null,
  checklist: { laudo: "aprovado", pneus: "trocar", captacao: "Lucas" },
};

describe("montarCarro", () => {
  it("junta público e privado e leva ipva/chave/revisões para o checklist", () => {
    const c = montarCarro("abc123", publico, privado, { criadoEm: "2026-10-01T00:00:00Z" });
    expect(c.finance?.purchase_price).toBe(180000);
    expect(c.checklist).toMatchObject({ ipva: "2026 pago", chave_manual: true, revisoes: "em dia", laudo: "aprovado" });
    expect(c.oferta).toBe(false);
    expect(c.criado_em).toBe("2026-10-01T00:00:00Z");
  });
});

describe("separarParaFirestore", () => {
  it("devolve os mesmos documentos que o admin do site grava", () => {
    const c = montarCarro("abc123", publico, privado);
    const { publico: pub, privado: priv } = separarParaFirestore(c);
    expect(pub).toMatchObject({ id: "abc123", brand: "BYD", plate: "ABC1D23", ipva: "2026 pago", chave_manual: true, ordem: 2 });
    expect(pub.finance).toEqual({ sale_price: 218000, old_price: 229000 });
    expect(pub).not.toHaveProperty("seller");
    expect(priv.seller).toEqual(privado.seller);
    expect(priv.checklist).toEqual({ laudo: "aprovado", pneus: "trocar", captacao: "Lucas" });
    expect((priv.finance as Record<string, unknown>).purchase_price).toBe(180000);
  });
  it("grava oferta (o site lê esse campo) e premium igual", () => {
    const c = { ...montarCarro("abc123", publico, privado), oferta: true };
    const { publico: pub } = separarParaFirestore(c);
    expect(pub.oferta).toBe(true);
    expect(pub.premium).toBe(true);
  });
  it("ida e volta não perde nada", () => {
    const c1 = montarCarro("abc123", publico, privado);
    const { publico: p, privado: v } = separarParaFirestore(c1);
    const c2 = montarCarro("abc123", p, v);
    expect(separarParaFirestore(c2)).toEqual(separarParaFirestore(c1));
  });
});

describe("filtrarParaPapel", () => {
  const c = montarCarro("abc123", publico, privado);
  it("sócio vê tudo", () => {
    expect(filtrarParaPapel(c, "socio")).toBe(c);
  });
  it("marketing e vendedor não veem dono, custos, venda nem documentos", () => {
    for (const papel of ["marketing", "vendedor"] as const) {
      const f = filtrarParaPapel(c, papel);
      expect(f.seller).toBeUndefined();
      expect(f.documents).toBeUndefined();
      expect(f.sale).toBeUndefined();
      expect(f.finance).toEqual({ sale_price: 218000, old_price: 229000 });
    }
  });
});

describe("aplicarMudanca", () => {
  const c: Carro = montarCarro("abc123", publico, privado);
  it("vendedor não altera nada", () => {
    expect(aplicarMudanca(c, { description: "novo" }, "vendedor")).toHaveProperty("erro");
  });
  it("marketing altera campos do site e o preço", () => {
    const r = aplicarMudanca(c, { description: "novo", finance: { sale_price: 210000 }, checklist: { ipva: "pago" } }, "marketing");
    expect(r).not.toHaveProperty("erro");
    if ("carro" in r) {
      expect(r.campos.sort()).toEqual(["checklist.ipva", "description", "finance.sale_price"]);
      expect(r.carro.finance?.purchase_price).toBe(180000);
    }
  });
  it("venda gravada também no Financeiro, como no admin", () => {
    const r = aplicarMudanca(c, { sale: { final_price: 205000, date: "2026-11-08", payment: "PIX" } }, "socio");
    expect(r).not.toHaveProperty("erro");
    if ("carro" in r) {
      expect(r.carro.finance).toMatchObject({ sale_date: "2026-11-08", payment_method: "PIX", purchase_price: 180000 });
      expect(r.campos).toEqual(expect.arrayContaining(["sale", "finance.sale_date", "finance.payment_method"]));
    }
  });
  it("marketing não altera custo, dono nem marca como vendido", () => {
    expect(aplicarMudanca(c, { finance: { purchase_price: 1 } }, "marketing")).toHaveProperty("erro");
    expect(aplicarMudanca(c, { seller: { name: "x" } }, "marketing")).toHaveProperty("erro");
    expect(aplicarMudanca(c, { status: "sold" }, "marketing")).toHaveProperty("erro");
  });
  it("sócio marca como vendido; status inválido é recusado", () => {
    expect(aplicarMudanca(c, { status: "sold" }, "socio")).not.toHaveProperty("erro");
    expect(aplicarMudanca(c, { status: "sumiu" }, "socio")).toHaveProperty("erro");
  });
  it("campo desconhecido é recusado", () => {
    expect(aplicarMudanca(c, { qualquer: 1 }, "socio")).toHaveProperty("erro");
  });
  it("trocar as fotos atualiza a capa", () => {
    const r = aplicarMudanca(c, { images: [{ url: "https://x/2.jpg" }, { url: "https://x/1.jpg" }] }, "marketing");
    if ("carro" in r) {
      expect(r.carro.img).toBe("https://x/2.jpg");
      expect(r.campos).toContain("img");
    } else throw new Error(r.erro);
  });
  it("sem mudança real, lista vazia", () => {
    const r = aplicarMudanca(c, { brand: "BYD" }, "socio");
    expect("carro" in r && r.campos).toEqual([]);
  });
});

describe("diasNoPatio e recorte", () => {
  it("conta dias desde a criação", () => {
    expect(diasNoPatio({ criado_em: "2026-11-01T00:00:00Z" }, Date.parse("2026-11-09T12:00:00Z"))).toBe(8);
    expect(diasNoPatio({ criado_em: null })).toBeNull();
    expect(diasNoPatio({ criado_em: "2026-11-01T00:00:00Z", finance: { purchase_date: "2026-10-30" } }, Date.parse("2026-11-09T12:00:00Z"))).toBe(10);
    expect(diasNoPatio({ criado_em: "2026-11-01T00:00:00Z", finance: { purchase_date: "2099-01-01" } }, Date.parse("2026-11-09T12:00:00Z"))).toBe(8);
  });
  it("recorta só o que mudou e resume fotos", () => {
    const c = montarCarro("abc123", publico, privado);
    expect(recorte(c, ["brand", "finance.purchase_price", "images"])).toEqual({ brand: "BYD", "finance.purchase_price": 180000, images: "2 fotos" });
  });
});

import { novoCarro } from "./veiculo";
describe("novoCarro", () => {
  it("entra como rascunho, no formato do admin, com o card no privado", () => {
    const c = novoCarro("k1", { brand: "Toyota", model: "Hilux", plate: "rco1a97", sale_price: 190000, purchase_price: 160000, laudo: "A realizar", cat: "x" }, "*MARCA:* TOYOTA", new Date("2026-11-09T12:00:00Z"));
    expect(c).toMatchObject({ id: "k1", status: "review", cat: "carros", plate: "RCO1A97", badge: "carros" });
    const { publico, privado } = separarParaFirestore(c);
    expect(publico.finance).toEqual({ sale_price: 190000 });
    expect(publico.origem).toMatchObject({ canal: "sistema:colado" });
    expect((privado.finance as Record<string, unknown>).purchase_price).toBe(160000);
    expect(privado.entrada).toBe("*MARCA:* TOYOTA");
    expect(privado.checklist).toEqual({ laudo: "A realizar", pneus: "", captacao: "" });
  });
});

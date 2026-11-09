import { describe, it, expect } from "vitest";
import { extrairReferenciaDeAnuncio, carroPeloTexto, carroPeloLink } from "./origem-cliente";

describe("origem do cliente", () => {
  it("lê a referência do anúncio do Meta (Cloud API)", () => {
    expect(extrairReferenciaDeAnuncio({ from: "55", referral: { source_id: "120211", source_url: "https://fb.me/x", headline: "Song Plus" } }))
      .toEqual({ adId: "120211", sourceUrl: "https://fb.me/x", titulo: "Song Plus" });
  });
  it("lê o externalAdReply do uazapi/Baileys em qualquer profundidade", () => {
    expect(extrairReferenciaDeAnuncio({ content: { contextInfo: { externalAdReply: { sourceId: "999", title: "Nivus" } } } }))
      .toEqual({ adId: "999", titulo: "Nivus" });
  });
  it("sem anúncio, nada", () => {
    expect(extrairReferenciaDeAnuncio({ text: "oi", content: "oi" })).toBeNull();
  });
  it("acha o carro pela mensagem pronta do site (o nome mais longo vence)", () => {
    const carros = [{ id: "a", nome: "BYD SONG PLUS" }, { id: "b", nome: "BYD SONG PLUS GS" }, { id: "c", nome: "VOLKSWAGEN NIVUS COMFORTLINE" }];
    expect(carroPeloTexto("Olá, tenho interesse no BYD Song Plus GS 2025/2026. Gostaria de ser atendido.", carros)).toBe("b");
    expect(carroPeloTexto("Olá, tenho interesse no Volkswagen Nivus Comfortline 2021/2022.", carros)).toBe("c");
    expect(carroPeloTexto("bom dia", carros)).toBeNull();
  });
  it("acha o carro pelo link do site", () => {
    expect(carroPeloLink("olha https://iboxprime.com.br/carros/byd-song/ esse", { a: "/carros/byd-song/" })).toBe("a");
    expect(carroPeloLink("https://iboxprime.com.br/veiculo/?id=k9x2a7", {})).toBe("k9x2a7");
  });
});

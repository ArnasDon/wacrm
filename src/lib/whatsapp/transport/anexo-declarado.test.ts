import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MEDIA_MAX_BYTES_ENTRADA } from "@/lib/storage/upload-media";
import {
  anexoGrandeDemais,
  mediaBytesOf,
  nomeDeArquivoDeclarado, bytesDeclarados } from "./anexo-declarado";
import type { EvolutionUpsert } from "./evolution-inbound";

/**
 * Forma REAL medida na Evolution em 2026-09-09 (o PDF que a cliente mandou e
 * o CRM recusou). `fileLength` vem como STRING — é o detalhe que faz uma
 * comparação ingênua com o teto dar resultado errado sem erro nenhum.
 */
const documento = (patch: Record<string, unknown> = {}): EvolutionUpsert =>
  ({
    key: { id: "4A615BC7C1AB54E122CD", remoteJid: "5519999269530@s.whatsapp.net", fromMe: false },
    message: {
      documentMessage: {
        fileName: "Phag angut.pdf",
        mimetype: "application/pdf",
        fileLength: "17187121",
        caption: "￼",
        ...patch,
      },
    },
  }) as unknown as EvolutionUpsert;

describe("mediaBytesOf", () => {
  it("lê o tamanho declarado, mesmo vindo como string", () => {
    expect(mediaBytesOf(documento())).toBe(17187121);
  });

  it("sem tamanho declarado devolve null", () => {
    expect(mediaBytesOf(documento({ fileLength: undefined }))).toBeNull();
    expect(mediaBytesOf(documento({ fileLength: "nao-e-numero" }))).toBeNull();
    expect(mediaBytesOf(documento({ fileLength: "0" }))).toBeNull();
  });

  it("enxerga através do invólucro de legenda", () => {
    const embrulhado = {
      key: { id: "x", remoteJid: "5519@s.whatsapp.net", fromMe: false },
      message: {
        documentWithCaptionMessage: {
          message: { documentMessage: { fileLength: "999", fileName: "a.pdf" } },
        },
      },
    } as unknown as EvolutionUpsert;
    expect(mediaBytesOf(embrulhado)).toBe(999);
    expect(nomeDeArquivoDeclarado(embrulhado)).toBe("a.pdf");
  });

  it("mensagem de texto não tem anexo", () => {
    const texto = {
      key: { id: "x", remoteJid: "5519@s.whatsapp.net", fromMe: false },
      message: { conversation: "oi" },
    } as unknown as EvolutionUpsert;
    expect(mediaBytesOf(texto)).toBeNull();
    expect(nomeDeArquivoDeclarado(texto)).toBeNull();
  });
});

describe("nomeDeArquivoDeclarado", () => {
  it("devolve o nome como o remetente enviou", () => {
    expect(nomeDeArquivoDeclarado(documento())).toBe("Phag angut.pdf");
  });

  it("nome vazio ou ausente é null — foto e áudio não têm nome", () => {
    expect(nomeDeArquivoDeclarado(documento({ fileName: "" }))).toBeNull();
    expect(nomeDeArquivoDeclarado(documento({ fileName: "   " }))).toBeNull();
    expect(nomeDeArquivoDeclarado(documento({ fileName: undefined }))).toBeNull();
  });
});

describe("anexoGrandeDemais", () => {
  it("o caso que originou a feature: 16,39 MiB passava do teto ANTIGO e cabe no novo", () => {
    expect(anexoGrandeDemais(17187121)).toBe(false);
    expect(17187121).toBeGreaterThan(16 * 1024 * 1024);
  });

  it("o maior perdido em produção (46 MiB) cabe; o dobro dele não", () => {
    expect(anexoGrandeDemais(48307508)).toBe(false);
    expect(anexoGrandeDemais(96615016)).toBe(true);
  });

  it("exatamente no teto ainda cabe", () => {
    expect(anexoGrandeDemais(MEDIA_MAX_BYTES_ENTRADA)).toBe(false);
    expect(anexoGrandeDemais(MEDIA_MAX_BYTES_ENTRADA + 1)).toBe(true);
  });

  it("⚠️ tamanho DESCONHECIDO tenta baixar — o teto real fica no download", () => {
    expect(anexoGrandeDemais(null)).toBe(false);
    expect(anexoGrandeDemais(undefined)).toBe(false);
  });
});

/**
 * ⚠️ O ELO COM O BANCO. O teto do código e o `file_size_limit` do bucket são
 * o MESMO número em dois lugares: subir só um troca a recusa do CRM por uma
 * recusa do Storage (ou o contrário) — nos dois casos o documento do cliente
 * some do fio, e nada estoura. Mesma família do teste que amarra
 * `chaveDeTag` à migration 984.
 */
describe("o teto do código espelha a migration 986", () => {
  it("MEDIA_MAX_BYTES_ENTRADA === file_size_limit do chat-media", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/0986_cb_anexo_grande.sql"),
      "utf8",
    );
    const m = sql.match(/SET file_size_limit = (\d+)/);
    expect(m, "a migration precisa continuar declarando o teto").not.toBeNull();
    expect(Number(m![1])).toBe(MEDIA_MAX_BYTES_ENTRADA);
  });
});

describe('bytesDeclarados — a forma do fileLength muda com a versão da Evolution', () => {
  it('2.3.2: string (amostras de 09/09/2026)', () => {
    expect(bytesDeclarados('43407')).toBe(43407);
    expect(bytesDeclarados('148421')).toBe(148421);
  });

  it('⚠️ 2.4 / Baileys 7: objeto Long {low, high, unsigned} (medido no primeiro anexo depois do upgrade)', () => {
    expect(bytesDeclarados({ low: 59064, high: 0, unsigned: true })).toBe(59064);
    expect(bytesDeclarados({ low: 60869, high: 0, unsigned: true })).toBe(60869);
  });

  it('Long acima de 2 GiB: low negativo (com sinal) e high compõem sem sinal', () => {
    // 3 GiB = 0xC0000000 → como int32 com sinal, low = -1073741824
    expect(bytesDeclarados({ low: -1073741824, high: 0, unsigned: true })).toBe(3 * 2 ** 30);
    expect(bytesDeclarados({ low: 0, high: 1, unsigned: true })).toBe(2 ** 32);
  });

  it('número cru e lixo', () => {
    expect(bytesDeclarados(1234)).toBe(1234);
    expect(bytesDeclarados(undefined)).toBeNull();
    expect(bytesDeclarados('abc')).toBeNull();
    expect(bytesDeclarados({ low: 'x' })).toBeNull();
  });
});

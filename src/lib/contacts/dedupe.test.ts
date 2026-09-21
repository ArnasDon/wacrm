import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dedupeByPhone,
  findExistingContact,
  isExactMatch,
  isUniqueViolation,
  normalizeKey,
} from "./dedupe";

describe("normalizeKey", () => {
  it("strips every non-digit", () => {
    expect(normalizeKey("+1 (555) 123-4567")).toBe("15551234567");
    expect(normalizeKey("15551234567")).toBe("15551234567");
  });

  it("collapses different formats of the same number to one key", () => {
    expect(normalizeKey("+44 7911 123456")).toBe(normalizeKey("447911123456"));
  });
});

describe("isExactMatch", () => {
  it("treats different formatting of the same digits as exact", () => {
    expect(isExactMatch({ id: "1", phone: "+1 555-123-4567" }, "15551234567")).toBe(
      true,
    );
  });

  it("is false for a trunk-variant (fuzzy) match", () => {
    // last-8 match but not the same full number
    expect(isExactMatch({ id: "1", phone: "37063949836" }, "370063949836")).toBe(
      false,
    );
  });
});

describe("isUniqueViolation", () => {
  it("detects Postgres 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });
  it("is false for other errors / non-objects", () => {
    expect(isUniqueViolation({ code: "23502" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("boom")).toBe(false);
  });
});

describe("dedupeByPhone", () => {
  it("keeps the first occurrence and counts in-file duplicates", () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: "+1 555-1111", name: "A" },
      { phone: "15551111", name: "B" }, // same digits as #1
      { phone: "+1 555-2222", name: "C" },
    ]);
    expect(unique.map((r) => r.name)).toEqual(["A", "C"]);
    expect(duplicates).toBe(1);
  });

  it("drops rows with no digits", () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: "   " },
      { phone: "+1 555-3333" },
    ]);
    expect(unique).toHaveLength(1);
    expect(duplicates).toBe(1);
  });
});

describe("findExistingContact", () => {
  // Minimal SupabaseClient stub: resolves the
  // .from().select().eq().order().order().like() chain to a fixed candidate
  // set, anotando o que foi pedido de ORDEM (é o que o pino estrutural lê).
  function stubDb(
    rows: Array<{ id: string; phone: string }>,
    ordens: Array<{ col: string; opcoes?: { ascending?: boolean } }> = [],
  ): SupabaseClient {
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: (col: string, opcoes?: { ascending?: boolean }) => {
        ordens.push({ col, opcoes });
        return builder;
      },
      like: () => Promise.resolve({ data: rows, error: null }),
    };
    return { from: () => builder } as unknown as SupabaseClient;
  }

  it("returns a trunk-variant match via phonesMatch", async () => {
    const db = stubDb([{ id: "c1", phone: "37063949836" }]);
    const hit = await findExistingContact(db, "acct", "+370 063 949 836");
    expect(hit.contato?.id).toBe("c1");
    expect(hit.falhou).toBe(false);
  });

  it("returns no contact when no candidate matches", async () => {
    const db = stubDb([{ id: "c1", phone: "15559999999" }]);
    const hit = await findExistingContact(db, "acct", "+1 555-123-4567");
    expect(hit.contato).toBeNull();
    expect(hit.falhou).toBe(false);
  });

  it("returns no contact for an empty phone without querying", async () => {
    const db = stubDb([{ id: "c1", phone: "15551234567" }]);
    const hit = await findExistingContact(db, "acct", "   ");
    expect(hit.contato).toBeNull();
    expect(hit.falhou).toBe(false);
  });

  it("marca `falhou` quando a CONSULTA erra — nunca 'não achei' (#04)", async () => {
    // Colapsar erro em null era o que duplicava a ficha: a rota de abrir
    // conversa lia "não achei" e criava a variante do nono dígito.
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      like: () =>
        Promise.resolve({ data: null, error: { message: "timeout" } }),
    };
    const db = { from: () => builder } as unknown as SupabaseClient;
    const hit = await findExistingContact(db, "acct", "+1 555-123-4567");
    expect(hit.contato).toBeNull();
    expect(hit.falhou).toBe(true);
  });

  // ⚠️ Os quatro abaixo são a colisão de sufixo que a carga da Kommo traz:
  // 4 pares de fichas cujos ÚLTIMOS 8 DÍGITOS batem e cujo número inteiro
  // não. `phonesMatch` casa os dois lados, então a escolha tinha de deixar
  // de ser "o primeiro que o heap devolveu".
  describe("colisão de sufixo (carga da Kommo)", () => {
    // Mesmos 8 dígitos finais, DDDs diferentes: duas PESSOAS.
    const ALAGOAS = { id: "c-82", phone: "5582988745316" };
    const SAO_PAULO = { id: "c-15", phone: "5515988745316" };

    it("prefere o casamento EXATO ao tolerante", async () => {
      const db = stubDb([SAO_PAULO, ALAGOAS]);
      const hit = await findExistingContact(db, "acct", "+55 82 98874-5316");
      expect(hit.contato?.id).toBe("c-82");
    });

    it("a ORDEM em que o banco devolve não muda o resultado", async () => {
      // Era exatamente isto que invertia de um dia para o outro: um UPDATE
      // em qualquer das duas linhas (`nome_fixado_em` da carga,
      // `avatar_checked_at` a cada 30 dias) move a tupla no heap.
      for (const linhas of [
        [ALAGOAS, SAO_PAULO],
        [SAO_PAULO, ALAGOAS],
      ]) {
        const alagoas = await findExistingContact(
          stubDb(linhas),
          "acct",
          "5582988745316",
        );
        expect(alagoas.contato?.id).toBe("c-82");

        const sp = await findExistingContact(
          stubDb(linhas),
          "acct",
          "5515988745316",
        );
        expect(sp.contato?.id).toBe("c-15");
      }
    });

    it("sem nenhum exato, o tolerante do nono dígito continua casando", async () => {
      // A ficha antiga não tem o 9; o WhatsApp entrega o número com ele.
      // Aqui NÃO há candidato exato — é o caso que a 1ª passada não resolve
      // e que o `order` da consulta existe para deixar estável.
      const db = stubDb([{ id: "c-83", phone: "558388745316" }]);
      const hit = await findExistingContact(db, "acct", "+55 83 98874-5316");
      expect(hit.contato?.id).toBe("c-83");
      expect(hit.falhou).toBe(false);
    });

    it("pede ao banco uma ordem TOTAL — `created_at` e o desempate por `id`", async () => {
      // Pino estrutural: o dublê não ordena nada, então só a consulta
      // responde pelo caso fuzzy-puro. `created_at` é NULLABLE (001), e sem
      // o `id` no fim o empate volta a sair do heap.
      const ordens: Array<{ col: string; opcoes?: { ascending?: boolean } }> =
        [];
      await findExistingContact(
        stubDb([{ id: "c1", phone: "5582988745316" }], ordens),
        "acct",
        "5582988745316",
      );
      expect(ordens.map((o) => o.col)).toEqual(["created_at", "id"]);
      expect(ordens.every((o) => o.opcoes?.ascending === true)).toBe(true);
    });
  });
});

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  chaveDePessoa,
  dedupeByPhone,
  fichaQueVenceu,
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

  it("o mesmo celular com e sem o 9 é UMA pessoa (1024)", () => {
    // Pela grafia, as duas passavam e caíam no mesmo lote de INSERT — com o
    // índice canônico, o lote inteiro levava 23505.
    const { unique, duplicates } = dedupeByPhone([
      { phone: "5583980000016", name: "com o 9" },
      { phone: "+55 83 8000-0016", name: "sem o 9" },
    ]);
    expect(unique.map((r) => r.name)).toEqual(["com o 9"]);
    expect(duplicates).toBe(1);
  });
});

describe("chaveDePessoa", () => {
  it("é a grafia canônica: as duas grafias do nono dígito dão a mesma chave", () => {
    expect(chaveDePessoa("558380000016")).toBe(chaveDePessoa("+55 (83) 98000-0016"));
    expect(normalizeKey("558380000016")).not.toBe(normalizeKey("5583980000016"));
  });
});

describe("findExistingContact", () => {
  // Minimal SupabaseClient stub: resolves the
  // .from().select().eq().order().order().like() chain to a fixed candidate
  // set, anotando o que foi pedido de ORDEM (é o que o pino estrutural lê).
  function stubDb(
    rows: Array<{ id: string; phone: string }>,
    ordens: Array<{ col: string; opcoes?: { ascending?: boolean } }> = [],
    likes: Array<{ col: string; padrao: string }> = [],
  ): SupabaseClient {
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: (col: string, opcoes?: { ascending?: boolean }) => {
        ordens.push({ col, opcoes });
        return builder;
      },
      like: (col: string, padrao: string) => {
        likes.push({ col, padrao });
        return Promise.resolve({ data: rows, error: null });
      },
    };
    return { from: () => builder } as unknown as SupabaseClient;
  }

  it("filtra pelos DÍGITOS (`phone_normalized`), nunca pelo texto cru (regra 18)", async () => {
    // Sobre `phone`, a ficha gravada "+55 83 98000-0016" não casava
    // `%80000016`: a busca não a achava, o INSERT levava 23505, a releitura
    // falhava igual e a ingestão descartava a mensagem — todas, para sempre.
    const likes: Array<{ col: string; padrao: string }> = [];
    await findExistingContact(stubDb([], [], likes), "acct", "+55 83 98000-0016");
    expect(likes).toEqual([{ col: "phone_normalized", padrao: "%80000016" }]);
  });

  it("acha a ficha gravada COM separadores (o candidato volta pelos dígitos)", async () => {
    const db = stubDb([{ id: "c-fmt", phone: "+55 (83) 98000-0016" }]);
    const hit = await findExistingContact(db, "acct", "558380000016");
    expect(hit.contato?.id).toBe("c-fmt");
  });

  it("a tolerante NÃO entrega a ficha de outro DDD gravada com separador (revisão da 1024)", async () => {
    // Sobre o texto cru, "+55 15 98000-0016" nem voltava como candidata para
    // "5582980000016". Com o LIKE sobre os dígitos ela volta — e não pode ser
    // entregue: é outra pessoa.
    const db = stubDb([{ id: "c-15-fmt", phone: "+55 15 98000-0016" }]);
    const hit = await findExistingContact(db, "acct", "5582980000016");
    expect(hit.contato).toBeNull();
  });

  it("nenhum 9 é descontado fora do celular brasileiro (Codex, PR #240)", async () => {
    // "+49 9 1234-5678" e "4912345678" terminam igual e são números
    // diferentes; descontar o 9 final de qualquer prefixo os casava.
    const db = stubDb([{ id: "c-de", phone: "+49 9 1234-5678" }]);
    const hit = await findExistingContact(db, "acct", "4912345678");
    expect(hit.contato).toBeNull();
  });

  it("a tolerante continua casando a variante de TRONCO mesmo gravada com separador", async () => {
    const db = stubDb([{ id: "c-lt", phone: "+370 6394-9836" }]);
    const hit = await findExistingContact(db, "acct", "370063949836");
    expect(hit.contato?.id).toBe("c-lt");
  });

  it("o que casava antes continua casando (ficha só com dígitos, mesmo final)", async () => {
    // A régua do Asaas (D5) depende disto: o sufixo de outro número volta
    // como candidato para "Para confirmar", nunca como vínculo.
    const db = stubDb([{ id: "c-15", phone: "5515980000016" }]);
    const hit = await findExistingContact(db, "acct", "5582980000016");
    expect(hit.contato?.id).toBe("c-15");
  });

  it("a IRMÃ do nono dígito vence a ficha mais antiga de OUTRO DDD com o mesmo final", async () => {
    // A tolerante sozinha devolvia a mais antiga com os mesmos 8 finais — a
    // de outra pessoa. A canônica é a dona do número no índice.
    const outroDdd = { id: "c-15-antiga", phone: "5515980000016" };
    const irma = { id: "c-83", phone: "5583980000016" };
    const hit = await findExistingContact(stubDb([outroDdd, irma]), "acct", "558380000016");
    expect(hit.contato?.id).toBe("c-83");
  });

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
    const ALAGOAS = { id: "c-82", phone: "5582980000016" };
    const SAO_PAULO = { id: "c-15", phone: "5515980000016" };

    it("prefere o casamento EXATO ao tolerante", async () => {
      const db = stubDb([SAO_PAULO, ALAGOAS]);
      const hit = await findExistingContact(db, "acct", "+55 82 98000-0016");
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
          "5582980000016",
        );
        expect(alagoas.contato?.id).toBe("c-82");

        const sp = await findExistingContact(
          stubDb(linhas),
          "acct",
          "5515980000016",
        );
        expect(sp.contato?.id).toBe("c-15");
      }
    });

    it("sem nenhum exato, o tolerante do nono dígito continua casando", async () => {
      // A ficha antiga não tem o 9; o WhatsApp entrega o número com ele.
      // Aqui NÃO há candidato exato — é o caso que a 1ª passada não resolve
      // e que o `order` da consulta existe para deixar estável.
      const db = stubDb([{ id: "c-83", phone: "558380000016" }]);
      const hit = await findExistingContact(db, "acct", "+55 83 98000-0016");
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
        stubDb([{ id: "c1", phone: "5582980000016" }], ordens),
        "acct",
        "5582980000016",
      );
      expect(ordens.map((o) => o.col)).toEqual(["created_at", "id"]);
      expect(ordens.every((o) => o.opcoes?.ascending === true)).toBe(true);
    });
  });
});

describe("fichaQueVenceu (a releitura depois do 23505)", () => {
  function dbComRespostas(respostas: Array<{ data: unknown; error: unknown }>) {
    let chamadas = 0;
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      like: () => Promise.resolve(respostas[Math.min(chamadas++, respostas.length - 1)]),
    };
    return {
      db: { from: () => builder } as unknown as SupabaseClient,
      chamadas: () => chamadas,
    };
  }
  const semEspera = async () => {};

  it("releitura que FALHA é repetida, e a vencedora é entregue", async () => {
    // Na ingestão, é a diferença entre gravar a mensagem do cliente na ficha
    // dele e descartá-la: o provedor já recebeu 200 e não reenvia.
    const { db, chamadas } = dbComRespostas([
      { data: null, error: { message: "timeout" } },
      { data: [{ id: "c1", phone: "5583980000016" }], error: null },
    ]);
    const r = await fichaQueVenceu(db, "acct", "558380000016", semEspera);
    expect(r).toEqual({ contato: { id: "c1", phone: "5583980000016" }, falhou: false });
    expect(chamadas()).toBe(2);
  });

  it("para depois de três tentativas e diz que NÃO SABE (nunca 'não existe')", async () => {
    const { db, chamadas } = dbComRespostas([{ data: null, error: { message: "fora do ar" } }]);
    const r = await fichaQueVenceu(db, "acct", "558380000016", semEspera);
    expect(r).toEqual({ contato: null, falhou: true });
    expect(chamadas()).toBe(3);
  });

  it("'não achei' com a consulta respondida NÃO é repetido", async () => {
    const { db, chamadas } = dbComRespostas([{ data: [], error: null }]);
    const r = await fichaQueVenceu(db, "acct", "558380000016", semEspera);
    expect(r).toEqual({ contato: null, falhou: false });
    expect(chamadas()).toBe(1);
  });
});

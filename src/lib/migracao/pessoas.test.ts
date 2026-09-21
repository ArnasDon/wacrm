import { describe, expect, it } from "vitest";
import {
  chaveDoCard,
  indexarFichasExistentes,
  pessoaDoTelefone,
  resolverPessoa,
} from "./pessoas";

/** O par medido em produção: a MESMA pessoa nas duas grafias. */
const SEM_NOVE = "553172090560";
const COM_NOVE = "5531972090560";

describe("pessoas da carga da Kommo", () => {
  describe("a régua é a do NONO DÍGITO — o defeito de 320 fichas", () => {
    it("as duas grafias do mesmo número são a mesma pessoa", () => {
      const a = pessoaDoTelefone(SEM_NOVE);
      const b = pessoaDoTelefone(COM_NOVE);
      expect(a?.grafias).toContain(COM_NOVE);
      expect(b?.grafias).toContain(SEM_NOVE);
    });

    // ⚠️⚠️ O teste que justifica o módulo: a ficha está aqui numa grafia e a
    // Kommo manda a outra. Por igualdade, isto viraria ficha nova.
    it("acha a ficha gravada COM o 9 quando a Kommo manda SEM", () => {
      const aqui = indexarFichasExistentes([{ id: "ficha-1", phone_normalized: COM_NOVE }]);
      expect(resolverPessoa(SEM_NOVE, aqui)).toEqual({
        tipo: "existe",
        contactId: "ficha-1",
        telefone: SEM_NOVE,
      });
    });

    it("e o contrário também — gravada SEM, a Kommo manda COM", () => {
      const aqui = indexarFichasExistentes([{ id: "ficha-2", phone_normalized: SEM_NOVE }]);
      expect(resolverPessoa(COM_NOVE, aqui)).toEqual({
        tipo: "existe",
        contactId: "ficha-2",
        telefone: COM_NOVE,
      });
    });

    it("a igualdade crua NÃO acharia — é o que o módulo existe para impedir", () => {
      // O contraexemplo explícito: a régua ingênua.
      const porIgualdade = new Map([[COM_NOVE, "ficha-1"]]);
      expect(porIgualdade.get(SEM_NOVE)).toBeUndefined();
      // A régua certa acha.
      expect(resolverPessoa(SEM_NOVE, indexarFichasExistentes([
        { id: "ficha-1", phone_normalized: COM_NOVE },
      ])).tipo).toBe("existe");
    });
  });

  describe("pessoa que NÃO está aqui", () => {
    it("vira `criar`, não `existe`", () => {
      const aqui = indexarFichasExistentes([{ id: "x", phone_normalized: "5511999990000" }]);
      expect(resolverPessoa("5583988745316", aqui)).toEqual({
        tipo: "criar",
        telefone: "5583988745316",
      });
    });

    it("número de OUTRO DDD com final parecido não casa", () => {
      // 82 x 15: dois DDDs, mesmos 8 finais. A régua dos últimos 8 casaria.
      const aqui = indexarFichasExistentes([{ id: "pb", phone_normalized: "5582988745316" }]);
      expect(resolverPessoa("5515988745316", aqui).tipo).toBe("criar");
    });
  });

  describe("sem telefone é PULAR, nunca criar", () => {
    it.each([null, undefined, "", "   ", "abc"])("%s vira pular", (entrada) => {
      expect(resolverPessoa(entrada, new Map())).toEqual({
        tipo: "pular",
        motivo: "sem_telefone",
      });
    });

    it("`pessoaDoTelefone` devolve null no mesmo caso", () => {
      expect(pessoaDoTelefone(null)).toBeNull();
    });
  });

  describe("o índice", () => {
    it("indexa pelas DUAS grafias de cada ficha", () => {
      const aqui = indexarFichasExistentes([{ id: "f", phone_normalized: COM_NOVE }]);
      expect(aqui.get(COM_NOVE)).toBe("f");
      expect(aqui.get(SEM_NOVE)).toBe("f");
    });

    it("ficha sem telefone é ignorada, não quebra", () => {
      const aqui = indexarFichasExistentes([
        { id: "so-instagram", phone_normalized: null },
        { id: "com-telefone", phone_normalized: COM_NOVE },
      ]);
      expect(aqui.size).toBe(2); // as duas grafias da segunda
      expect(aqui.get(COM_NOVE)).toBe("com-telefone");
    });

    // ⚠️ A mais ANTIGA vence — o chamador entrega por created_at crescente.
    it("na colisão, a PRIMEIRA da lista vence", () => {
      const aqui = indexarFichasExistentes([
        { id: "antiga", phone_normalized: SEM_NOVE },
        { id: "nova", phone_normalized: COM_NOVE },
      ]);
      expect(aqui.get(SEM_NOVE)).toBe("antiga");
      expect(aqui.get(COM_NOVE)).toBe("antiga");
    });
  });

  describe("chaveDoCard — um card por pessoa e por ÁREA", () => {
    it("as duas grafias dão a MESMA chave", () => {
      expect(chaveDoCard(SEM_NOVE, "trabalhista")).toBe(chaveDoCard(COM_NOVE, "trabalhista"));
    });

    it("a mesma pessoa em áreas diferentes dá chaves diferentes", () => {
      expect(chaveDoCard(SEM_NOVE, "trabalhista")).not.toBe(chaveDoCard(SEM_NOVE, "bancario"));
    });

    it("pessoas diferentes nunca colidem", () => {
      expect(chaveDoCard("5511999990000", "bancario")).not.toBe(
        chaveDoCard("5511999990001", "bancario"),
      );
    });
  });
});

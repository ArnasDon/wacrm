import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { statusAoEntrarNaEtapa, statusPorResultado } from "./resultado";

/**
 * ⚠️ Paridade com o gatilho `cb_deals_aplica_resultado` (950), MEDIDO em
 * produção em 2026-08-29 num DO-block revertido:
 *   entrou em etapa 'ganho'  → status 'won'
 *   saiu para etapa neutra   → status FICOU 'won' (não reabre)
 *   (1031, 21/09/2026: o PERDIDO que sai para etapa neutra volta 'open')
 *   reabrir explícito        → 'open' (o gatilho não interfere)
 * Se este teste quebrar, ou o espelho divergiu do gatilho, ou alguém mudou o
 * gatilho sem mudar aqui — os dois são o mesmo bug: a tela mostrando um selo
 * e o banco gravando outro.
 */
describe("statusPorResultado — espelho do gatilho da 950", () => {
  it("ganho → won, perdido → lost", () => {
    expect(statusPorResultado("ganho")).toBe("won");
    expect(statusPorResultado("perdido")).toBe("lost");
  });

  it("etapa neutra → null (MANTÉM o status; sair de marcada não reabre)", () => {
    expect(statusPorResultado(null)).toBeNull();
    expect(statusPorResultado(undefined)).toBeNull();
    expect(statusPorResultado("")).toBeNull();
  });

  it("valor desconhecido não vira status (o CHECK do banco impede, mas o espelho não pode inventar)", () => {
    expect(statusPorResultado("qualquer")).toBeNull();
  });
});

describe("statusAoEntrarNaEtapa", () => {
  const stages = [
    { id: "a", resultado: "ganho" },
    { id: "b", resultado: null },
    { id: "c", resultado: "perdido" },
  ];

  it("resolve pela etapa de destino", () => {
    expect(statusAoEntrarNaEtapa(stages, "a", "open")).toBe("won");
    expect(statusAoEntrarNaEtapa(stages, "b", "open")).toBeNull();
    expect(statusAoEntrarNaEtapa(stages, "c", "open")).toBe("lost");
  });

  it("etapa não carregada → null (nunca chutar selo sem dado)", () => {
    expect(statusAoEntrarNaEtapa(stages, "inexistente", "open")).toBeNull();
    // nem o perdido reabre: sem a etapa, não se sabe se ela é neutra
    expect(statusAoEntrarNaEtapa(stages, "inexistente", "lost")).toBeNull();
  });

  // 1031 (21/09/2026): o lead desqualificado pode voltar a ser qualificado.
  it("CRÍTICO: PERDIDO que entra em etapa neutra volta ABERTO", () => {
    expect(statusAoEntrarNaEtapa(stages, "b", "lost")).toBe("open");
    // o formulário reenvia o status que já estava — continua valendo
    expect(statusAoEntrarNaEtapa(stages, "b", "lost", "lost")).toBe("open");
  });

  it("CRÍTICO: GANHO que sai para etapa neutra continua ganho (a transferência do jurídico)", () => {
    expect(statusAoEntrarNaEtapa(stages, "b", "won")).toBeNull();
  });

  it("perdido que entra em outra etapa marcada fica com o que a etapa diz", () => {
    expect(statusAoEntrarNaEtapa(stages, "c", "lost")).toBe("lost");
    expect(statusAoEntrarNaEtapa(stages, "a", "lost")).toBe("won");
  });

  it("status EXPLÍCITO no mesmo update vence: aberto que pede perdido fica perdido", () => {
    expect(statusAoEntrarNaEtapa(stages, "b", "open", "lost")).toBeNull();
    expect(statusAoEntrarNaEtapa(stages, "b", "lost", "won")).toBeNull();
  });
});

// O espelho e o gatilho são o MESMO bug quando divergem: a tela com um selo e o
// banco com outro. O corpo da função vigente é o da 1031.
describe("gatilho da 1031 — a regra escrita no SQL", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/1031_cb_perdido_pode_voltar.sql"),
    "utf8",
  );

  it("reabre só o perdido, só com a etapa achada, só sem troca de status", () => {
    expect(sql).toMatch(/ELSIF v_achou\s+AND v_resultado IS NULL\s+AND TG_OP = 'UPDATE'\s+AND OLD\.status = 'lost'\s+AND NEW\.status = 'lost' THEN\s+(--[^\n]*\n\s*)*NEW\.status := 'open';/);
  });

  it("não toca no ganho", () => {
    expect(sql).not.toMatch(/OLD\.status = 'won'/);
  });
});

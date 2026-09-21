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
    // 'lost' mandado de novo junto com a etapa (a API v1) também reabre: o
    // gatilho não distingue "não mexeu" de "mandou o mesmo"
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

  // A etapa IGUAL não passa pelo gatilho: quem reabre o perdido que o "Mover
  // card" leva à etapa em que ele já está é a RPC — e DENTRO do UPDATE, com o
  // status da linha na hora da escrita (Codex, PR #245: ler antes e pedir
  // 'open' depois sobrescrevia um ganho no meio).
  it("a RPC das automações reabre o perdido na MESMA escrita, sem sobrepor status explícito", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION cb_atualizar_negocio\(/);
    expect(sql).toMatch(
      /status\s+=\s+CASE\s+WHEN p_status IS NULL\s+AND p_stage_id IS NOT NULL\s+AND v_resultado IS NULL\s+AND status = 'lost'\s+THEN 'open'\s+ELSE coalesce\(p_status, status\)\s+END/,
    );
  });

  // O CASE protege só o STATUS: o card que a BUSCA do motor achou tem de
  // continuar no status em que foi achado, senão a ETAPA muda assim mesmo — e
  // o card de quem fechou no meio voltaria ao comercial (Codex, PR #245).
  it("a RPC só escreve no card achado pela busca se ele continua no status visto", () => {
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS cb_atualizar_negocio\(uuid, uuid, uuid, uuid, text, jsonb\);/);
    expect(sql).toMatch(/p_status_esperado text DEFAULT NULL/);
    expect(sql).toMatch(
      /WHERE id = p_deal_id AND account_id = p_account_id\s+(--[^\n]*\n\s*)*AND \(p_status_esperado IS NULL OR status = p_status_esperado\);\s+IF NOT FOUND THEN/,
    );
  });
});

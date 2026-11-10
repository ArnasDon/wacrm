import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { montarRelatorio } from "./relatorio-anuncios";
import { planilhaRelatorio } from "./relatorio-anuncios-xlsx";

describe("planilhaRelatorio", () => {
  it("gera as abas e esconde custo/lucro de quem não é sócio", async () => {
    const r = montarRelatorio({
      campanhas: [{ id: "c1", nome: "Hilux", status: "ACTIVE", car_id: "v1", divisao: null, categoria_objetivo: null, destino_id: null }],
      metricas: [{ campaign_id: "c1", data: "2026-10-01", gasto: 100, msgs: 10 }],
      linhasCarro: [{ car_id: "v1", campaign_id: "c1", data: "2026-10-01", gasto: 100, msgs: 10 }],
      divisoes: [],
      patio: [{ id: "p1", nome: "Hilux SRX", placa: "AAA1A11", status: "available", preco: 200000, custo: 180000 }],
      veiculos: [{ id: "v1", modelo: "Hilux", placa: "AAA1A11", site_vehicle_id: "p1" }],
    });
    for (const socio of [true, false]) {
      const buf = await planilhaRelatorio(r, { periodo: "desde o início", socio, geradoEm: "10/11/2026" });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      expect(wb.worksheets.map((w) => w.name)).toEqual(["Resumo", "Por carro", "Por campanha", "Divisões", "Sem vínculo", "Dia a dia"]);
      const cab = (wb.getWorksheet("Por carro")!.getRow(2).values as unknown[]).filter(Boolean);
      expect(cab.includes("Lucro depois do anúncio")).toBe(socio);
      expect(wb.getWorksheet("Por carro")!.getRow(3).getCell(5).value).toBe(112);
    }
  });
});

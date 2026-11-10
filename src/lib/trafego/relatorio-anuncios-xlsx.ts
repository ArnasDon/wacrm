import ExcelJS from "exceljs";
import type { Relatorio } from "./relatorio-anuncios";

// Planilha do relatório detalhado de anúncios (uma aba por visão).
// Valores em reais já com o imposto de 12% do Meta, salvo onde a coluna diz "sem imposto".

const MOEDA = '"R$" #,##0.00';
const dataBr = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");
const STATUS: Record<string, string> = { ACTIVE: "No ar", PAUSED: "Pausada", ARCHIVED: "Encerrada", DELETED: "Excluída", available: "À venda", reserved: "Reservado", sold: "Vendido", unavailable: "Indisponível", review: "Aguardando revisão", fora: "Fora do Pátio" };
const st = (s: string | null | undefined) => (s ? STATUS[s] ?? s : "");
const mesBr = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

type Col = { titulo: string; largura: number; moeda?: boolean; pct?: boolean };

function aba(wb: ExcelJS.Workbook, nome: string, cols: Col[], linhas: (string | number | null)[][], nota?: string) {
  const ws = wb.addWorksheet(nome, { views: [{ state: "frozen", ySplit: nota ? 2 : 1 }] });
  if (nota) {
    ws.addRow([nota]).font = { italic: true, color: { argb: "FF666666" } };
    ws.mergeCells(1, 1, 1, cols.length);
  }
  const cab = ws.addRow(cols.map((c) => c.titulo));
  cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cab.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17191B" } }; c.alignment = { vertical: "middle", wrapText: true }; });
  for (const l of linhas) ws.addRow(l);
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.largura;
    if (c.moeda) col.numFmt = MOEDA;
    if (c.pct) col.numFmt = '0.00"%"';
  });
  ws.autoFilter = { from: { row: nota ? 2 : 1, column: 1 }, to: { row: nota ? 2 : 1, column: cols.length } };
  return ws;
}

export async function planilhaRelatorio(r: Relatorio, o: { periodo: string; socio: boolean; geradoEm: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sistema iBox";
  wb.created = new Date();

  // Resumo
  const res = wb.addWorksheet("Resumo");
  res.getColumn(1).width = 38; res.getColumn(2).width = 20; res.getColumn(3).width = 14; res.getColumn(4).width = 16;
  res.addRow(["Relatório de anúncios — iBox Prime"]).font = { bold: true, size: 14 };
  res.addRow([`Período: ${o.periodo}`]);
  res.addRow([`Gerado em ${o.geradoEm}. Gasto conferido com o Meta (Facebook e Instagram). Valores com imposto de 12%, salvo indicação.`]).font = { italic: true, color: { argb: "FF666666" } };
  res.addRow([]);
  const t = res.addRow(["Total investido", r.total.gasto, `${r.total.msgs} conversas`, r.total.msgs ? r.total.gasto / r.total.msgs : null]);
  t.font = { bold: true };
  res.addRow(["  sem imposto (o que o Gerenciador mostra)", r.total.bruto]);
  res.addRow(["  imposto (12%)", r.total.imposto]);
  res.addRow([]);
  res.addRow(["Para onde foi", "Investido", "Conversas", "% do total"]).font = { bold: true };
  for (const d of r.porDestino) res.addRow([d.nome, d.gasto, d.msgs, r.total.gasto ? (d.gasto / r.total.gasto) * 100 : 0]);
  res.addRow([]);
  res.addRow(["Mês", "Investido", "Conversas", "Por conversa"]).font = { bold: true };
  for (const m of r.porMes) res.addRow([mesBr(m.mes), m.gasto, m.msgs, m.msgs ? m.gasto / m.msgs : null]);
  res.getColumn(2).numFmt = MOEDA;
  res.getColumn(4).numFmt = MOEDA;
  res.eachRow((row) => { if (row.getCell(1).value === "Para onde foi") row.getCell(4).numFmt = "@"; });
  r.porDestino.forEach((_, i) => { res.getRow(10 + i).getCell(4).numFmt = '0.0"%"'; });
  res.getRow(5).getCell(4).numFmt = MOEDA;

  // Por carro
  const colsCarro: Col[] = [
    { titulo: "Carro", largura: 42 }, { titulo: "Placa", largura: 11 }, { titulo: "Situação", largura: 16 }, { titulo: "Preço", largura: 14, moeda: true },
    { titulo: "Investido em anúncio", largura: 16, moeda: true }, { titulo: "Conversas", largura: 11 }, { titulo: "Custo por conversa", largura: 14, moeda: true },
    { titulo: "Campanhas", largura: 11 }, { titulo: "Primeiro dia", largura: 12 }, { titulo: "Último dia", largura: 12 },
    ...(o.socio ? [{ titulo: "Custo do carro", largura: 14, moeda: true }, { titulo: "Lucro (venda ou previsto)", largura: 16, moeda: true }, { titulo: "Lucro depois do anúncio", largura: 16, moeda: true }, { titulo: "Anúncio sobre o lucro", largura: 12, pct: true }] : []),
  ];
  aba(wb, "Por carro", colsCarro, r.carros.map((c) => [
    c.noPatio ? c.nome : `${c.nome} (fora do Pátio)`, c.placa ?? "", st(c.status), c.preco, c.gasto, c.msgs, c.msgs ? c.gasto / c.msgs : null,
    c.campanhas, dataBr(c.de), dataBr(c.ate),
    ...(o.socio ? [c.custoCarro, c.lucro, c.lucroDepois, c.lucro ? (c.gasto / c.lucro) * 100 : null] : []),
  ]), "Inclui a parte de cada campanha dividida. “Fora do Pátio” = cadastro antigo do Marketing ainda não ligado a um carro do Pátio.");

  // Por campanha
  aba(wb, "Por campanha", [
    { titulo: "Campanha", largura: 46 }, { titulo: "Status", largura: 11 }, { titulo: "Primeiro dia", largura: 12 }, { titulo: "Último dia", largura: 12 },
    { titulo: "Sem imposto", largura: 13, moeda: true }, { titulo: "Imposto", largura: 11, moeda: true }, { titulo: "Investido", largura: 13, moeda: true },
    { titulo: "Conversas", largura: 10 }, { titulo: "Custo por conversa", largura: 13, moeda: true }, { titulo: "Vínculo", largura: 22 }, { titulo: "Ligada a", largura: 52 },
  ], r.campanhas.map((c) => [c.nome, st(c.status), dataBr(c.de), dataBr(c.ate), c.bruto, c.imposto, c.gasto, c.msgs, c.msgs ? c.gasto / c.msgs : null, c.situacao, c.ligadaA]));

  // Divisões
  aba(wb, "Divisões", [
    { titulo: "Campanha", largura: 46 }, { titulo: "Como foi dividida", largura: 22 }, { titulo: "Carro / parte", largura: 46 },
    { titulo: "% combinado", largura: 12, pct: true }, { titulo: "% do gasto", largura: 11, pct: true }, { titulo: "Investido", largura: 13, moeda: true }, { titulo: "Conversas", largura: 10 },
  ], r.divisoes.map((d) => [d.campanha, d.modo, d.alvo, d.pctCombinado, d.pct, d.gasto, d.msgs]),
  r.divisoes.length ? "Por anúncio: cada carro recebe o gasto real dos anúncios dele. Em partes: o gasto da campanha é repartido pela porcentagem combinada." : "Nenhuma campanha dividida no período.");

  // Sem vínculo
  aba(wb, "Sem vínculo", [
    { titulo: "Campanha", largura: 46 }, { titulo: "Situação", largura: 26 }, { titulo: "Status", largura: 11 }, { titulo: "Primeiro dia", largura: 12 }, { titulo: "Último dia", largura: 12 },
    { titulo: "Investido", largura: 13, moeda: true }, { titulo: "Conversas", largura: 10 }, { titulo: "Ligada hoje a", largura: 40 },
  ], r.semVinculo.map((c) => [c.nome, c.situacao, st(c.status), dataBr(c.de), dataBr(c.ate), c.gasto, c.msgs, c.ligadaA]),
  "Gasto que ainda não está no custo de nenhum carro do Pátio. Ligue em Marketing → Ligar campanhas.");

  // Dia a dia
  aba(wb, "Dia a dia", [
    { titulo: "Data", largura: 11 }, { titulo: "Campanha", largura: 46 }, { titulo: "Destino", largura: 18 }, { titulo: "Carro / finalidade", largura: 46 },
    { titulo: "Investido", largura: 13, moeda: true }, { titulo: "Conversas", largura: 10 },
  ], r.dias.map((d) => [dataBr(d.data), d.campanha, d.destino === "patio" ? "Carro do Pátio" : d.destino === "fora" ? "Carro fora do Pátio" : d.destino === "finalidade" ? "Finalidade" : "Sem vínculo", d.alvo, d.gasto, d.msgs]));

  return Buffer.from(await wb.xlsx.writeBuffer());
}

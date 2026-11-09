// Filtros, ordenação, colunas e planilha do Pátio. Funções puras (testadas
// em filtros.test.ts), usadas pela tela e pela exportação.
import type { Carro } from "./veiculo";
import { custoTotal, temCusto, valorVenda } from "./resumo";

export type CarroLista = Carro & { dias: number | null; anuncios: { gasto: number; msgs: number; campanhas: unknown[] } | null; visitas?: number | null };

export type Filtros = {
  categoria: string; // "" = todas
  posse: string; // "" | proprio | consignado
  situacao: string; // "" | available | reserved | unavailable
  precoMin: string;
  precoMax: string;
  dias: string; // "" | "30" (até 30) | "31-60" | "45+" | "60+"
  anuncio: string; // "" | com | sem
  ordem: Ordem;
};
export type Ordem = "vitrine" | "mais_dias" | "menos_dias" | "maior_preco" | "menor_preco" | "mais_conversas" | "maior_lucro" | "recentes";

export const FILTROS_VAZIOS: Filtros = { categoria: "", posse: "", situacao: "", precoMin: "", precoMax: "", dias: "", anuncio: "", ordem: "vitrine" };

export const CATEGORIAS: Record<string, string> = { carros: "Carros", motos: "Motos", nautico: "Náutico", utv: "UTV / quadriciclo" };
export const POSSE: Record<string, string> = { proprio: "Próprio", consignado: "Consignado" };
export const ORDENS: Record<Ordem, string> = {
  vitrine: "Ordem da vitrine", mais_dias: "Mais tempo no pátio", menos_dias: "Menos tempo no pátio", maior_preco: "Maior preço",
  menor_preco: "Menor preço", mais_conversas: "Mais conversas", maior_lucro: "Maior lucro (sócio)", recentes: "Vendidos mais recentes",
};

const preco = (c: Carro) => Number(c.finance?.sale_price) || 0;
const reais = (s: string) => {
  const n = Number(String(s).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && s.trim() !== "" ? n : null;
};
export const lucro = (c: Carro): number | null => (temCusto(c) && valorVenda(c) ? valorVenda(c) - custoTotal(c) : null);

export function passaFiltros(c: CarroLista, f: Filtros): boolean {
  if (f.categoria && (c.cat || "carros") !== f.categoria) return false;
  if (f.posse && (c.ownership_type || "proprio") !== f.posse) return false;
  if (f.situacao && (c.status || "available") !== f.situacao) return false;
  const min = reais(f.precoMin), max = reais(f.precoMax);
  if (min != null && preco(c) < min) return false;
  if (max != null && (preco(c) === 0 || preco(c) > max)) return false;
  const d = c.dias;
  if (f.dias === "30" && !(d != null && d <= 30)) return false;
  if (f.dias === "31-60" && !(d != null && d > 30 && d <= 60)) return false;
  if (f.dias === "45+" && !(d != null && d > 45)) return false;
  if (f.dias === "60+" && !(d != null && d > 60)) return false;
  const temAnuncio = !!c.anuncios?.campanhas.length;
  if (f.anuncio === "com" && !temAnuncio) return false;
  if (f.anuncio === "sem" && temAnuncio) return false;
  return true;
}

export function buscaCasa(c: Carro, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return [c.brand, c.model, c.versao, c.plate, c.year, c.color].filter(Boolean).join(" ").toLowerCase().includes(t);
}

export function ordenar<T extends CarroLista>(lista: T[], o: Ordem): T[] {
  const v = (c: T) => (o === "recentes" ? Date.parse(String(c.sale?.date || c.finance?.sale_date || "")) || 0 : 0);
  const cmp: Record<Ordem, (a: T, b: T) => number> = {
    vitrine: (a, b) => (Number(a.ordem) || 999) - (Number(b.ordem) || 999) || (b.dias ?? 0) - (a.dias ?? 0),
    mais_dias: (a, b) => (b.dias ?? -1) - (a.dias ?? -1),
    menos_dias: (a, b) => (a.dias ?? 1e9) - (b.dias ?? 1e9),
    maior_preco: (a, b) => preco(b) - preco(a),
    menor_preco: (a, b) => (preco(a) || 1e12) - (preco(b) || 1e12),
    mais_conversas: (a, b) => (b.anuncios?.msgs ?? 0) - (a.anuncios?.msgs ?? 0),
    maior_lucro: (a, b) => (lucro(b) ?? -1e12) - (lucro(a) ?? -1e12),
    recentes: (a, b) => v(b) - v(a),
  };
  return [...lista].sort(cmp[o]);
}

/** Colunas da lista. `socio` = só aparece para sócio (custos e lucro). */
export type Coluna = { id: string; nome: string; socio?: boolean; valor: (c: CarroLista) => string | number | null };
export const COLUNAS: Coluna[] = [
  { id: "ano", nome: "Ano", valor: (c) => c.year ?? null },
  { id: "km", nome: "KM", valor: (c) => c.mileage ?? null },
  { id: "placa", nome: "Placa", valor: (c) => c.plate ?? null },
  { id: "cor", nome: "Cor", valor: (c) => c.color ?? null },
  { id: "categoria", nome: "Categoria", valor: (c) => CATEGORIAS[c.cat || "carros"] ?? c.cat ?? null },
  { id: "posse", nome: "Posse", valor: (c) => POSSE[c.ownership_type || "proprio"] ?? null },
  { id: "preco", nome: "Preço", valor: (c) => preco(c) || null },
  { id: "dias", nome: "Dias no pátio", valor: (c) => c.dias },
  { id: "visitas", nome: "Visitas no site (30 dias)", valor: (c) => c.visitas ?? null },
  { id: "conversas", nome: "Conversas (30 dias)", valor: (c) => (c.anuncios?.campanhas.length ? c.anuncios.msgs : null) },
  { id: "gasto", nome: "Anúncio (30 dias)", valor: (c) => (c.anuncios?.campanhas.length ? Math.round(c.anuncios.gasto * 100) / 100 : null) },
  { id: "cpc", nome: "Custo por conversa", valor: (c) => (c.anuncios?.msgs ? Math.round((c.anuncios.gasto / c.anuncios.msgs) * 100) / 100 : null) },
  { id: "compra", nome: "Compra / combinado", socio: true, valor: (c) => Number(c.ownership_type === "consignado" ? c.finance?.repasse_value : c.finance?.purchase_price) || null },
  { id: "custo", nome: "Custo total", socio: true, valor: (c) => (temCusto(c) ? custoTotal(c) : null) },
  { id: "fipe", nome: "FIPE", socio: true, valor: (c) => Number(c.finance?.fipe_value) || null },
  { id: "lucro", nome: "Lucro", socio: true, valor: (c) => lucro(c) },
  { id: "margem", nome: "Margem %", socio: true, valor: (c) => { const l = lucro(c); const v = valorVenda(c); return l != null && v ? Math.round((l / v) * 1000) / 10 : null; } },
  { id: "vs_fipe", nome: "Preço × FIPE", socio: true, valor: (c) => { const f = Number(c.finance?.fipe_value); return f && preco(c) ? preco(c) - f : null; } },
  { id: "venda", nome: "Vendido por", socio: true, valor: (c) => (c.status === "sold" ? valorVenda(c) || null : null) },
  { id: "data_venda", nome: "Data da venda", socio: true, valor: (c) => (String(c.sale?.date || c.finance?.sale_date || "") || null) },
  { id: "situacao", nome: "Situação", valor: (c) => c.status ?? null },
];
export const COLUNAS_PADRAO = ["ano", "preco", "dias", "visitas", "conversas", "situacao"];
export const COLUNAS_RENTABILIDADE = ["posse", "compra", "custo", "fipe", "preco", "lucro", "margem", "vs_fipe", "dias", "situacao"];

const celulaCsv = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Planilha (CSV com ;, que o Excel em português abre direto). */
export function planilha(carros: CarroLista[], colunas: string[], socio: boolean): string {
  const cols = COLUNAS.filter((c) => colunas.includes(c.id) && (socio || !c.socio));
  const cab = ["Marca", "Modelo", "Versão", ...cols.map((c) => c.nome)];
  const linhas = carros.map((c) => [c.brand ?? "", c.model ?? "", c.versao ?? "", ...cols.map((k) => { const v = k.valor(c); return typeof v === "number" ? String(v).replace(".", ",") : v ?? ""; })]);
  return "﻿" + [cab, ...linhas].map((l) => l.map(celulaCsv).join(";")).join("\n");
}

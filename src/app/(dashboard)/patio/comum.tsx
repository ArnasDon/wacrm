"use client";

import type { Carro, Papel } from "@/lib/patio/veiculo";
import type { AnunciosDoCarro } from "@/lib/patio/anuncios";

export type CarroUI = Carro & { dias: number | null; anuncios: AnunciosDoCarro | null };
export type { Papel };

export const STATUS_NOME: Record<string, string> = {
  available: "À venda",
  reserved: "Reservado",
  sold: "Vendido",
  unavailable: "Indisponível",
  review: "Aguardando revisão",
};

export const STATUS_SELO: Record<string, string> = {
  available: "s-ok",
  reserved: "s-az",
  sold: "s-ne",
  unavailable: "s-at",
  review: "s-at",
};

export function brl(v: unknown, casas = 0): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: casas });
}

export function seloDias(d: number | null): string {
  if (d == null) return "selo s-ne";
  return "selo " + (d <= 30 ? "s-ok" : d <= 60 ? "s-at" : "s-ru");
}

export function nomeCarro(c: Carro): string {
  return [c.brand, c.model].filter(Boolean).join(" ").trim() || "Sem nome";
}

export function Foto({ url, alt, className, style }: { url?: string; alt: string; className?: string; style?: React.CSSProperties }) {
  return (
    <span className={`foto ${className ?? ""}`} style={style}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- fotos vêm do armazenamento do site (vários domínios)
        <img src={url} alt={alt} loading="lazy" decoding="async" />
      ) : (
        <span className="semfoto">sem foto</span>
      )}
    </span>
  );
}

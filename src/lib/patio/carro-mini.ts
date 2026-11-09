"use client";

import { useEffect, useState } from "react";
import type { CarroMini } from "@/app/api/patio/mini/route";

// Busca em lote o essencial dos carros (funil, contatos): vários cartões
// pedindo ao mesmo tempo viram uma chamada só, e o resultado fica guardado.
export type { CarroMini };
const guardados = new Map<string, CarroMini | null>();
const ouvintes = new Set<() => void>();
let fila = new Set<string>();
let agendado = false;

function pedir(id: string) {
  if (guardados.has(id) || fila.has(id)) return;
  fila.add(id);
  if (agendado) return;
  agendado = true;
  setTimeout(async () => {
    const ids = [...fila];
    fila = new Set();
    agendado = false;
    try {
      const r = await fetch(`/api/patio/mini?ids=${ids.map(encodeURIComponent).join(",")}`, { cache: "no-store" });
      const d = (await r.json()) as { carros?: Record<string, CarroMini> };
      for (const id of ids) guardados.set(id, d.carros?.[id] ?? null);
    } catch {
      for (const id of ids) guardados.set(id, null);
    }
    ouvintes.forEach((f) => f());
  }, 30);
}

export function useCarroMini(id: string | null | undefined): CarroMini | null {
  const [, setTique] = useState(0);
  useEffect(() => {
    if (!id) return;
    const f = () => setTique((t) => t + 1);
    ouvintes.add(f);
    pedir(id);
    return () => { ouvintes.delete(f); };
  }, [id]);
  return id ? guardados.get(id) ?? null : null;
}

export async function todosOsCarros(): Promise<CarroMini[]> {
  try {
    const r = await fetch("/api/patio/mini?todos=1", { cache: "no-store" });
    const d = (await r.json()) as { carros?: Record<string, CarroMini> };
    return Object.values(d.carros ?? {}).sort((a, b) => a.nome.localeCompare(b.nome));
  } catch {
    return [];
  }
}

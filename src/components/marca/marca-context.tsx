"use client";

import { createContext, useContext } from "react";
import type { Marca } from "@/lib/marca/marca";

// La marca se lee en el servidor (config/ de la empresa) y baja por contexto
// a los componentes cliente: sidebar y pantallas de auth.
const MarcaContext = createContext<Marca | null>(null);

export function MarcaProvider({
  marca,
  children,
}: {
  marca: Marca;
  children: React.ReactNode;
}) {
  return <MarcaContext.Provider value={marca}>{children}</MarcaContext.Provider>;
}

export function useMarca(): Marca {
  const marca = useContext(MarcaContext);
  if (!marca) throw new Error("useMarca fuera de <MarcaProvider>");
  return marca;
}

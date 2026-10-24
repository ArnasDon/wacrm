'use client';

import { createContext, useContext } from 'react';

const ActivoContext = createContext<boolean>(false);

export function AsignacionProvider({
  activo,
  children,
}: {
  activo: boolean;
  children: React.ReactNode;
}) {
  return (
    <ActivoContext.Provider value={activo}>{children}</ActivoContext.Provider>
  );
}

/** Sin provider, módulo apagado. */
export function useAsignacion(): { activo: boolean } {
  return { activo: useContext(ActivoContext) };
}

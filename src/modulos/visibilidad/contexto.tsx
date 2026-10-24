'use client';

import { createContext, useContext, useMemo } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { visibleConversations, type Visibilidad } from './visibilidad';

const ActivoContext = createContext<boolean>(false);

export function VisibilidadProvider({
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

/** El `activo` del provider; sin provider, módulo apagado. */
export function useModuloVisibilidadActivo(): boolean {
  return useContext(ActivoContext);
}

export function useVisibilidad(): Visibilidad {
  const activo = useModuloVisibilidadActivo();
  const { user, accountRole } = useAuth();
  const userId = user?.id ?? null;
  return useMemo(
    () =>
      visibleConversations({ userId, rol: accountRole, moduloActivo: activo }),
    [userId, accountRole, activo]
  );
}

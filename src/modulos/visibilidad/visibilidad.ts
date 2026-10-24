// Única función de visibilidad (R27). Solo interfaz: no sustituye RLS.
// Pura, sin I/O: sirve en cliente y servidor.
import type { AccountRole } from '@/lib/auth/roles';

export interface UsuarioVisibilidad {
  userId: string | null;
  rol: AccountRole | null;
  moduloActivo: boolean;
}

type ConAsesor = { id: string; assigned_agent_id?: string | null };

export type Alcance =
  | { tipo: 'todas' }
  | { tipo: 'asesor'; asesorId: string }
  | { tipo: 'ninguna' };

export interface Visibilidad {
  /** Qué conversaciones alcanza a ver el usuario (sirve para acotar consultas). */
  readonly alcance: Alcance;
  /** false solo con módulo activo y rol o userId sin resolver. */
  listo: boolean;
  /** Módulo apagado, owner o admin. */
  veTodas: boolean;
  puedeVer(c: ConAsesor): boolean;
  filtrar<T extends ConAsesor>(lista: readonly T[]): T[];
}

export function visibleConversations(usuario: UsuarioVisibilidad): Visibilidad {
  const { userId, rol, moduloActivo } = usuario;
  const listo = !moduloActivo || (rol !== null && userId !== null);
  const veTodas =
    listo && (!moduloActivo || rol === 'owner' || rol === 'admin');
  const alcance: Alcance = !listo
    ? { tipo: 'ninguna' }
    : veTodas || userId === null
      ? { tipo: 'todas' }
      : { tipo: 'asesor', asesorId: userId };
  const puedeVer = (c: ConAsesor): boolean => {
    switch (alcance.tipo) {
      case 'ninguna':
        return false;
      case 'todas':
        return true;
      case 'asesor':
        return c.assigned_agent_id === alcance.asesorId;
    }
  };
  return {
    alcance,
    listo,
    veTodas,
    puedeVer,
    filtrar: <T extends ConAsesor>(lista: readonly T[]): T[] =>
      lista.filter(puedeVer),
  };
}

export type FiltroAsesor =
  | { tipo: 'todos' }
  | { tipo: 'sin-asignar' }
  | { tipo: 'asesor'; asesorId: string };

/** "Sin asignar" = sin asesor en cualquier estado (R29). */
export function filtrarPorAsesor<T extends ConAsesor>(
  lista: readonly T[],
  filtro: FiltroAsesor
): T[] {
  switch (filtro.tipo) {
    case 'todos':
      return [...lista];
    case 'sin-asignar':
      return lista.filter((c) => !c.assigned_agent_id);
    case 'asesor':
      return lista.filter((c) => c.assigned_agent_id === filtro.asesorId);
  }
}

/** Cuenta conversaciones (no mensajes) visibles con no leídos. */
export function contarNoLeidas(
  filas: readonly (ConAsesor & { unread_count: number | null })[],
  vis: Visibilidad
): number {
  return filas.filter((f) => (f.unread_count ?? 0) > 0 && vis.puedeVer(f))
    .length;
}

export type EnlaceDirecto<T> =
  | { tipo: 'ninguno' }
  | { tipo: 'abrir'; conversacion: T }
  | { tipo: 'sin-acceso' };

export function resolverEnlaceDirecto<T extends ConAsesor>(
  id: string | null,
  cargadas: readonly T[],
  vis: Visibilidad
): EnlaceDirecto<T> {
  if (!id) return { tipo: 'ninguno' };
  const c = cargadas.find((x) => x.id === id);
  if (c && vis.puedeVer(c)) return { tipo: 'abrir', conversacion: c };
  // Apagado y no cargada: se comporta como wacrm (ignora el enlace).
  if (vis.veTodas && vis.listo) return { tipo: 'ninguno' };
  return { tipo: 'sin-acceso' };
}

// Visibilidad de notificaciones (VIS.2, R26/R27). Pura, sin I/O.
import type { Visibilidad } from './visibilidad';

type ConAsesor = { id: string; assigned_agent_id?: string | null };

/**
 * Deja las notificaciones sin conversación y las de conversaciones visibles.
 * Una conversación ausente de `conversaciones` no es visible (falla cerrado).
 */
export function filtrarNotificaciones<
  N extends { conversation_id?: string | null },
>(
  notifs: readonly N[],
  conversaciones: readonly ConAsesor[],
  vis: Visibilidad
): N[] {
  if (vis.alcance.tipo === 'todas') return [...notifs];
  const porId = new Map(conversaciones.map((c) => [c.id, c]));
  return notifs.filter((n) => {
    if (!n.conversation_id) return vis.listo;
    const c = porId.get(n.conversation_id);
    return c !== undefined && vis.puedeVer(c);
  });
}

/** Aviso del navegador: false si no hay conversación, si !vis.listo o si no es visible. */
export function debeAvisar(
  conversacion: ConAsesor | null,
  vis: Visibilidad
): boolean {
  if (!conversacion || !vis.listo) return false;
  return vis.puedeVer(conversacion);
}

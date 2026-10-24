// Acota una consulta de supabase-js según el alcance de visibilidad (R27).
// Es la primera llave: evita que un `limit` deje al asesor sin sus filas.
// La decisión final sigue siendo vis.filtrar / vis.puedeVer sobre lo que llega.
import type { Visibilidad } from './visibilidad';

export interface ConsultaAcotable {
  eq(columna: string, valor: string): unknown;
}

/** null = el usuario no ve nada: no ejecutar la consulta y tratarla como vacía. */
export function acotarConsulta<Q extends ConsultaAcotable>(
  q: Q,
  vis: Visibilidad,
  columna = 'assigned_agent_id'
): Q | null {
  const { alcance } = vis;
  switch (alcance.tipo) {
    case 'todas':
      return q;
    case 'asesor':
      // eq de supabase-js devuelve el mismo tipo de builder; el genérico
      // recursivo ConsultaAcotable<Q> desborda el compilador, de ahí el cast.
      return q.eq(columna, alcance.asesorId) as Q;
    case 'ninguna':
      return null;
  }
}

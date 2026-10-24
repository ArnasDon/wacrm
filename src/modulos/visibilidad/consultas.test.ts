import { describe, expect, it } from 'vitest';
import { acotarConsulta } from './consultas';
import { visibleConversations } from './visibilidad';

const visTodas = visibleConversations({
  userId: 'OW',
  rol: 'owner',
  moduloActivo: true,
});
const visA1 = visibleConversations({
  userId: 'A1',
  rol: 'agent',
  moduloActivo: true,
});
const visSinRol = visibleConversations({
  userId: 'A1',
  rol: null,
  moduloActivo: true,
});

const falso = () => {
  const llamadas: [string, string][] = [];
  const q = {
    llamadas,
    eq(c: string, v: string) {
      llamadas.push([c, v]);
      return q;
    },
  };
  return q;
};

describe('acotarConsulta', () => {
  it('todas: no agrega filtro', () => {
    const q = falso();
    expect(acotarConsulta(q, visTodas)).toBe(q);
    expect(q.llamadas).toEqual([]);
  });
  it('asesor: eq por assigned_agent_id', () => {
    const q = falso();
    acotarConsulta(q, visA1);
    expect(q.llamadas).toEqual([['assigned_agent_id', 'A1']]);
  });
  it('columna de embed', () => {
    const q = falso();
    acotarConsulta(q, visA1, 'conversations.assigned_agent_id');
    expect(q.llamadas).toEqual([['conversations.assigned_agent_id', 'A1']]);
  });
  it('ninguna: null y sin llamadas', () => {
    const q = falso();
    expect(acotarConsulta(q, visSinRol)).toBeNull();
    expect(q.llamadas).toEqual([]);
  });
});

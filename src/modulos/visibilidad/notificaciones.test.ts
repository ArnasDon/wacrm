import { describe, expect, it } from 'vitest';
import { debeAvisar, filtrarNotificaciones } from './notificaciones';
import { visibleConversations } from './visibilidad';

const activo = (rol: 'owner' | 'agent' | null, userId: string | null = 'A1') =>
  visibleConversations({ userId, rol, moduloActivo: true });
const apagado = visibleConversations({
  userId: 'A1',
  rol: 'agent',
  moduloActivo: false,
});

const convs = [
  { id: 'c1', assigned_agent_id: 'A1' },
  { id: 'c2', assigned_agent_id: 'A2' },
];
const n1 = { id: 'n1', conversation_id: null };
const n2 = { id: 'n2', conversation_id: 'c1' };
const n3 = { id: 'n3', conversation_id: 'c2' };
const n4 = { id: 'n4', conversation_id: 'c9' };

describe('filtrarNotificaciones', () => {
  it('apagado: todas', () => {
    expect(filtrarNotificaciones([n1, n2, n3, n4], [], apagado)).toHaveLength(4);
  });
  it('asesor: sin conversación se ve; propia se ve; reasignada a otro no', () => {
    expect(filtrarNotificaciones([n1, n2, n3], convs, activo('agent'))).toEqual([
      n1,
      n2,
    ]);
  });
  it('conversación ausente del resultado no se ve', () => {
    expect(filtrarNotificaciones([n4], convs, activo('agent'))).toEqual([]);
  });
  it('owner ve todas', () => {
    expect(
      filtrarNotificaciones([n1, n2, n3, n4], [], activo('owner'))
    ).toHaveLength(4);
  });
  it('rol sin resolver no ve ninguna', () => {
    expect(filtrarNotificaciones([n1, n2], convs, activo(null))).toEqual([]);
  });
});

describe('debeAvisar', () => {
  it('propia sí, ajena no, sin asignar no', () => {
    expect(debeAvisar(convs[0], activo('agent'))).toBe(true);
    expect(debeAvisar(convs[1], activo('agent'))).toBe(false);
    expect(debeAvisar({ id: 'c3', assigned_agent_id: null }, activo('agent'))).toBe(
      false
    );
  });
  it('sin conversación no', () => {
    expect(debeAvisar(null, activo('agent'))).toBe(false);
  });
  it('rol sin resolver no', () => {
    expect(debeAvisar(convs[0], activo(null))).toBe(false);
  });
  it('apagado: sí aunque sea ajena (wacrm)', () => {
    expect(debeAvisar(convs[1], apagado)).toBe(true);
  });
});

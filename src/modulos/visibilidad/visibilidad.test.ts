import { describe, expect, it } from 'vitest';
import {
  contarNoLeidas,
  filtrarPorAsesor,
  resolverEnlaceDirecto,
  visibleConversations,
} from './visibilidad';

const c1 = { id: 'c1', assigned_agent_id: 'A1', status: 'open' };
const c2 = { id: 'c2', assigned_agent_id: 'A2', status: 'open' };
const c3 = { id: 'c3', assigned_agent_id: undefined, status: 'open' };
const c4 = { id: 'c4', assigned_agent_id: null, status: 'closed' };
const todas = [c1, c2, c3, c4];
const ids = (l: { id: string }[]) => l.map((c) => c.id);
const asesor = () =>
  visibleConversations({ userId: 'A1', rol: 'agent', moduloActivo: true });

describe('visibleConversations', () => {
  it('módulo apagado: todos ven todo, como wacrm (R16)', () => {
    const v = visibleConversations({
      userId: 'A1',
      rol: 'agent',
      moduloActivo: false,
    });
    expect(v).toMatchObject({ listo: true, veTodas: true });
    expect(v.filtrar(todas)).toEqual(todas);
  });
  it('asesor: solo las suyas, nunca las sin asignar (R26, R29)', () => {
    const v = asesor();
    expect(ids(v.filtrar(todas))).toEqual(['c1']);
    expect(v.puedeVer(c2)).toBe(false);
    expect(v.puedeVer(c3)).toBe(false);
  });
  it('viewer se trata como asesor', () => {
    const v = visibleConversations({
      userId: 'V',
      rol: 'viewer',
      moduloActivo: true,
    });
    expect(v.filtrar(todas)).toEqual([]);
    expect(v.veTodas).toBe(false);
  });
  it.each(['owner', 'admin'] as const)('%s ve todas', (rol) => {
    const v = visibleConversations({ userId: 'X', rol, moduloActivo: true });
    expect(v.veTodas).toBe(true);
    expect(v.filtrar(todas)).toEqual(todas);
  });
  it('sin rol resuelto no ve nada (falla cerrado)', () => {
    const v = visibleConversations({
      userId: 'A1',
      rol: null,
      moduloActivo: true,
    });
    expect(v.listo).toBe(false);
    expect(v.filtrar(todas)).toEqual([]);
  });
  it('sin userId no ve nada', () => {
    const v = visibleConversations({
      userId: null,
      rol: 'agent',
      moduloActivo: true,
    });
    expect(v.listo).toBe(false);
    expect(v.filtrar(todas)).toEqual([]);
  });
  it('reasignada a otro deja de verse', () => {
    expect(asesor().puedeVer({ ...c1, assigned_agent_id: 'A2' })).toBe(false);
  });
});

describe('filtrarPorAsesor', () => {
  it('todos', () => {
    expect(filtrarPorAsesor(todas, { tipo: 'todos' })).toEqual(todas);
  });
  it('sin-asignar incluye undefined y null en cualquier estado', () => {
    expect(ids(filtrarPorAsesor(todas, { tipo: 'sin-asignar' }))).toEqual([
      'c3',
      'c4',
    ]);
  });
  it('un asesor', () => {
    expect(
      ids(filtrarPorAsesor(todas, { tipo: 'asesor', asesorId: 'A2' }))
    ).toEqual(['c2']);
  });
});

describe('contarNoLeidas', () => {
  const filas = [
    { id: 'c1', assigned_agent_id: 'A1', unread_count: 3 },
    { id: 'c2', assigned_agent_id: 'A2', unread_count: 5 },
    { id: 'c3', assigned_agent_id: null, unread_count: 1 },
    { id: 'c5', assigned_agent_id: 'A1', unread_count: 0 },
  ];
  it('cuenta conversaciones (no mensajes) visibles con unread > 0', () => {
    const owner = visibleConversations({
      userId: 'OW',
      rol: 'owner',
      moduloActivo: true,
    });
    expect(contarNoLeidas(filas, asesor())).toBe(1);
    expect(contarNoLeidas(filas, owner)).toBe(3);
  });
  it('unread_count null cuenta como 0', () => {
    expect(
      contarNoLeidas(
        [{ id: 'c1', assigned_agent_id: 'A1', unread_count: null }],
        asesor()
      )
    ).toBe(0);
  });
});

describe('resolverEnlaceDirecto', () => {
  it('sin id → ninguno', () => {
    expect(resolverEnlaceDirecto(null, todas, asesor())).toEqual({
      tipo: 'ninguno',
    });
  });
  it('apagado: abre si está, ninguno si no (wacrm)', () => {
    const v = visibleConversations({
      userId: 'A1',
      rol: 'agent',
      moduloActivo: false,
    });
    expect(resolverEnlaceDirecto('c2', todas, v)).toEqual({
      tipo: 'abrir',
      conversacion: c2,
    });
    expect(resolverEnlaceDirecto('zz', todas, v)).toEqual({ tipo: 'ninguno' });
  });
  it('encendido: propia → abrir; ajena → sin-acceso; inexistente → sin-acceso', () => {
    const v = asesor();
    expect(resolverEnlaceDirecto('c1', todas, v)).toEqual({
      tipo: 'abrir',
      conversacion: c1,
    });
    expect(resolverEnlaceDirecto('c2', todas, v)).toEqual({
      tipo: 'sin-acceso',
    });
    expect(resolverEnlaceDirecto('zz', todas, v)).toEqual({
      tipo: 'sin-acceso',
    });
  });
  it('encendido con lista vacía → sin-acceso', () => {
    expect(resolverEnlaceDirecto('c2', [], asesor())).toEqual({
      tipo: 'sin-acceso',
    });
  });
});

describe('alcance', () => {
  it('apagado: todas', () => {
    expect(
      visibleConversations({ userId: 'A1', rol: 'agent', moduloActivo: false })
        .alcance
    ).toEqual({ tipo: 'todas' });
  });
  it.each(['owner', 'admin'] as const)('%s: todas', (rol) => {
    expect(
      visibleConversations({ userId: 'OW', rol, moduloActivo: true }).alcance
    ).toEqual({ tipo: 'todas' });
  });
  it.each(['agent', 'viewer'] as const)('%s: solo el suyo', (rol) => {
    expect(
      visibleConversations({ userId: 'A1', rol, moduloActivo: true }).alcance
    ).toEqual({ tipo: 'asesor', asesorId: 'A1' });
  });
  it('sin rol o sin userId con módulo encendido: ninguna', () => {
    expect(
      visibleConversations({ userId: 'A1', rol: null, moduloActivo: true })
        .alcance
    ).toEqual({ tipo: 'ninguna' });
    expect(
      visibleConversations({ userId: null, rol: 'agent', moduloActivo: true })
        .alcance
    ).toEqual({ tipo: 'ninguna' });
  });
  it('alcance y puedeVer coinciden', () => {
    const v = visibleConversations({
      userId: 'A1',
      rol: 'agent',
      moduloActivo: true,
    });
    expect(v.puedeVer({ id: 'c1', assigned_agent_id: 'A1' })).toBe(true);
    expect(v.puedeVer({ id: 'c2', assigned_agent_id: 'A2' })).toBe(false);
  });
});

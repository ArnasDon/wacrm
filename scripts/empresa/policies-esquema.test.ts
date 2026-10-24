import { describe, expect, it } from 'vitest';

import {
  leerPolicies,
  PoliciesInvalidasError,
  validarPolicies,
} from './policies-esquema.mjs';

const BASE_VALIDA = {
  version: 1,
  usuarios: [{ correo: 'dueno@empresa.co', nombre: 'Ana', rol: 'owner' }],
};
const U = (correo: string, rol: string) => ({ correo, nombre: 'X', rol });

describe('validarPolicies', () => {
  it('acepta el mínimo: un owner', () => {
    const p = validarPolicies({
      version: 1,
      usuarios: [{ correo: ' Dueno@Empresa.co ', nombre: 'Ana', rol: 'owner' }],
    });
    expect(p.usuarios[0]).toMatchObject({
      correo: 'dueno@empresa.co',
      rolCuenta: 'owner',
    });
    expect(p.etiquetas).toEqual([]);
  });

  it('traduce asesor a agent', () => {
    const p = validarPolicies({
      ...BASE_VALIDA,
      usuarios: [...BASE_VALIDA.usuarios, U('a@b.co', 'asesor')],
    });
    expect(p.usuarios[1].rolCuenta).toBe('agent');
  });

  it('pone valores por defecto al bot y al color', () => {
    const p = validarPolicies({
      ...BASE_VALIDA,
      etiquetas: [{ nombre: 'VIP' }],
      bot: { activo: true },
    });
    expect(p.etiquetas[0].color).toBe('#3b82f6');
    expect(p.bot).toEqual({
      activo: true,
      respuesta_automatica: false,
      tope_por_conversacion: 3,
    });
  });

  const FDH = {
    activa: true,
    texto: 'x',
    horario: '18:00-08:00',
    zona: 'America/Bogota',
  };
  it.each([
    ['sin owner', { usuarios: [U('a@b.co', 'admin')] }, 'usuarios'],
    [
      'dos owner',
      { usuarios: [U('a@b.co', 'owner'), U('c@d.co', 'owner')] },
      'usuarios',
    ],
    [
      'correo repetido con otra capitalización',
      { usuarios: [U('a@b.co', 'owner'), U('A@b.co', 'admin')] },
      'usuarios',
    ],
    [
      'rol desconocido',
      { usuarios: [U('a@b.co', 'viewer')] },
      'usuarios.0.rol',
    ],
    [
      'etiqueta repetida VIP/vip',
      { etiquetas: [{ nombre: 'VIP' }, { nombre: 'vip' }] },
      'etiquetas',
    ],
    [
      'etapa repetida',
      { embudo: { nombre: 'V', etapas: [{ nombre: 'A' }, { nombre: 'a' }] } },
      'embudo.etapas',
    ],
    [
      'color inválido',
      { etiquetas: [{ nombre: 'A', color: 'rojo' }] },
      'etiquetas.0.color',
    ],
    [
      'horario mal escrito',
      {
        automatizaciones: { fuera_de_horario: { ...FDH, horario: '6pm-8am' } },
      },
      'automatizaciones.fuera_de_horario.horario',
    ],
    [
      'zona inexistente',
      {
        automatizaciones: {
          fuera_de_horario: { ...FDH, zona: 'Marte/Olympus' },
        },
      },
      'automatizaciones.fuera_de_horario.zona',
    ],
    [
      'tope fuera de 1..20',
      { bot: { activo: true, tope_por_conversacion: 0 } },
      'bot.tope_por_conversacion',
    ],
    ['llave de módulo (No entra)', { asignacion: {} }, 'asignacion'],
    ['versión distinta de 1', { version: 2 }, 'version'],
  ])('rechaza %s nombrando el campo', (_caso, extra, campo) => {
    const datos = { ...BASE_VALIDA, ...extra };
    expect(() => validarPolicies(datos)).toThrow(PoliciesInvalidasError);
    try {
      validarPolicies(datos);
    } catch (e) {
      expect((e as PoliciesInvalidasError).problemas.join('\n')).toContain(
        campo
      );
    }
  });
});

describe('leerPolicies', () => {
  it('lee el ejemplo del template y es válido', () => {
    const p = leerPolicies('config.ejemplo/policies.yaml');
    expect(p.automatizaciones.bienvenida?.activa).toBe(true);
    expect(p.automatizaciones.fuera_de_horario?.horario).toMatch(
      /^\d{2}:\d{2}-\d{2}:\d{2}$/
    );
  });

  it('falla con PoliciesInvalidasError si el archivo no existe', () => {
    expect(() => leerPolicies('/no/existe/policies.yaml')).toThrow(
      PoliciesInvalidasError
    );
  });
});

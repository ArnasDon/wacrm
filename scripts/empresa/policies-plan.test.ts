import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { validateStepsForActivation } from '@/lib/automations/validate';

import {
  ConflictoPoliciesError,
  pasosDeseados,
  planificar,
} from './policies-plan.mjs';
import { validarPolicies } from './policies-esquema.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Estado = any;
type Op = any;

const POLICIES = validarPolicies({
  version: 1,
  usuarios: [
    { correo: 'dueno@empresa.co', nombre: 'Ana', rol: 'owner' },
    { correo: 'asesor@empresa.co', nombre: 'Beto', rol: 'asesor' },
  ],
  etiquetas: [
    { nombre: 'VIP', color: '#f59e0b' },
    { nombre: 'Mayorista', color: '#10b981' },
  ],
  embudo: {
    nombre: 'Ventas',
    etapas: [{ nombre: 'Nuevo' }, { nombre: 'Cotizado' }, { nombre: 'Ganado' }],
  },
  automatizaciones: {
    bienvenida: { activa: true, texto: 'Hola' },
    fuera_de_horario: {
      activa: true,
      texto: 'Cerrado',
      horario: '18:00-08:00',
      zona: 'America/Bogota',
    },
  },
  bot: { activo: true, respuesta_automatica: true, tope_por_conversacion: 5 },
});

const ESTADO_VACIO = (): Estado => ({
  cuenta: null,
  usuarios: [],
  etiquetas: [],
  embudo: null,
  automatizaciones: [],
  bot: null,
});

/** Los avisos no cambian la base: no cuentan para la idempotencia. */
const cambios = (ops: Op[]) => ops.filter((o) => o.tipo !== 'aviso');

/** Simula en memoria lo que `ejecutar` hace en la base. */
function aplicarEnMemoria(estado: Estado, ops: Op[]): Estado {
  const e = structuredClone(estado);
  for (const o of ops) {
    switch (o.tipo) {
      case 'crear-usuario': {
        const userId = randomUUID();
        if (o.rol === 'owner')
          e.cuenta = { id: randomUUID(), ownerUserId: userId };
        e.usuarios.push({
          userId,
          correo: o.correo,
          nombre: o.nombre,
          accountId: e.cuenta.id,
          rol: o.rol,
          cuentaPersonalVacia: false,
        });
        break;
      }
      case 'mover-usuario': {
        const u = e.usuarios.find((x: Op) => x.userId === o.userId);
        Object.assign(u, {
          accountId: e.cuenta.id,
          rol: o.rol,
          nombre: o.nombre,
        });
        break;
      }
      case 'cambiar-rol':
        e.usuarios.find((x: Op) => x.userId === o.userId).rol = o.rol;
        break;
      case 'cambiar-nombre-usuario':
        e.usuarios.find((x: Op) => x.userId === o.userId).nombre = o.nombre;
        break;
      case 'crear-etiqueta':
        e.etiquetas.push({
          id: randomUUID(),
          nombre: o.nombre,
          color: o.color,
        });
        break;
      case 'actualizar-etiqueta':
        e.etiquetas.find((x: Op) => x.id === o.id).color = o.color;
        break;
      case 'crear-embudo':
        e.embudo = { id: randomUUID(), nombre: o.nombre, etapas: [] };
        break;
      case 'crear-etapa':
        e.embudo.etapas.push({
          id: randomUUID(),
          nombre: o.nombre,
          color: o.color,
          posicion: o.posicion,
        });
        break;
      case 'actualizar-etapa': {
        const s = e.embudo.etapas.find((x: Op) => x.id === o.id);
        Object.assign(s, { color: o.color, posicion: o.posicion });
        break;
      }
      case 'crear-automatizacion':
        e.automatizaciones.push({
          id: randomUUID(),
          marcador: o.marcador,
          nombre: o.nombre,
          activa: o.activa,
          triggerType: o.triggerType,
          pasos: o.pasos,
        });
        break;
      case 'reemplazar-pasos':
        e.automatizaciones.find((x: Op) => x.id === o.id).pasos = o.pasos;
        break;
      case 'actualizar-automatizacion':
        Object.assign(
          e.automatizaciones.find((x: Op) => x.id === o.id),
          {
            activa: o.activa,
            triggerType: o.triggerType,
          }
        );
        break;
      case 'actualizar-bot':
        Object.assign(e.bot, {
          activo: o.activo,
          respuestaAutomatica: o.respuestaAutomatica,
          tope: o.tope,
        });
        break;
      case 'aviso':
        break;
      default:
        throw new Error(`op desconocida ${o.tipo}`);
    }
  }
  return e;
}

/** Base con la empresa ya aplicada, más un bot configurado (ai_configs existe). */
function estadoAplicado(): Estado {
  const base = ESTADO_VACIO();
  base.bot = {
    id: randomUUID(),
    activo: false,
    respuestaAutomatica: false,
    tope: 3,
  };
  return aplicarEnMemoria(base, planificar(base, POLICIES));
}

describe('planificar', () => {
  it('desde una base vacía crea owner primero y luego todo lo del archivo', () => {
    const ops = planificar(ESTADO_VACIO(), POLICIES);
    expect(ops[0]).toMatchObject({
      tipo: 'crear-usuario',
      correo: 'dueno@empresa.co',
      rol: 'owner',
    });
    expect(
      ops
        .filter((o: Op) => o.tipo === 'crear-etiqueta')
        .map((o: Op) => o.nombre)
    ).toEqual(['VIP', 'Mayorista']);
    expect(
      ops.filter((o: Op) => o.tipo === 'crear-etapa').map((o: Op) => o.posicion)
    ).toEqual([0, 1, 2]);
    expect(
      ops
        .filter((o: Op) => o.tipo === 'crear-automatizacion')
        .map((o: Op) => o.marcador)
    ).toEqual(['policies.yaml:bienvenida', 'policies.yaml:fuera_de_horario']);
  });

  it('aplicar y volver a planear da un plan vacío (idempotente)', () => {
    const despues = aplicarEnMemoria(
      ESTADO_VACIO(),
      planificar(ESTADO_VACIO(), POLICIES)
    );
    expect(cambios(planificar(despues, POLICIES))).toEqual([]);
  });

  it('reconoce la etiqueta existente "vip" como "VIP" y solo actualiza el color', () => {
    const e = estadoAplicado();
    e.etiquetas.find((t: Op) => t.nombre === 'VIP').nombre = 'vip';
    e.etiquetas.find((t: Op) => t.nombre === 'vip').color = '#000000';
    const ops = planificar(e, POLICIES);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      tipo: 'actualizar-etiqueta',
      color: '#f59e0b',
    });
  });

  it('cambiar el texto actualiza, no duplica', () => {
    const e = estadoAplicado();
    const nuevo = validarPolicies({
      ...POLICIES,
      usuarios: POLICIES.usuarios.map((u: Op) => ({
        correo: u.correo,
        nombre: u.nombre,
        rol: u.rol,
      })),
      automatizaciones: {
        ...POLICIES.automatizaciones,
        bienvenida: { activa: true, texto: 'Hola, otra vez' },
      },
    });
    const ops = planificar(e, nuevo);
    const id = e.automatizaciones.find(
      (a: Op) => a.marcador === 'policies.yaml:bienvenida'
    ).id;
    expect(
      ops.filter((o: Op) => o.tipo === 'crear-automatizacion')
    ).toHaveLength(0);
    expect(ops).toEqual([
      expect.objectContaining({ tipo: 'reemplazar-pasos', id }),
    ]);
  });

  it('no borra etiquetas, etapas ni usuarios que no están en el archivo', () => {
    const e = estadoAplicado();
    e.etiquetas.push({ id: 'x', nombre: 'Otra', color: '#111111' });
    e.embudo.etapas.push({
      id: 'y',
      nombre: 'Extra',
      color: '#111111',
      posicion: 9,
    });
    e.usuarios.push({
      userId: 'z',
      correo: 'otro@empresa.co',
      nombre: 'Otro',
      accountId: e.cuenta.id,
      rol: 'agent',
      cuentaPersonalVacia: false,
    });
    expect(planificar(e, POLICIES)).toEqual([]);
  });

  it('cambia el rol de un miembro de la cuenta', () => {
    const e = estadoAplicado();
    e.usuarios.find((u: Op) => u.correo === 'asesor@empresa.co').rol = 'admin';
    expect(planificar(e, POLICIES)).toEqual([
      expect.objectContaining({ tipo: 'cambiar-rol', rol: 'agent' }),
    ]);
  });

  it('mueve a la cuenta un usuario existente cuya cuenta personal está vacía', () => {
    const e = estadoAplicado();
    const u = e.usuarios.find((x: Op) => x.correo === 'asesor@empresa.co');
    Object.assign(u, {
      accountId: 'personal-1',
      rol: 'owner',
      cuentaPersonalVacia: true,
    });
    expect(planificar(e, POLICIES)).toEqual([
      expect.objectContaining({
        tipo: 'mover-usuario',
        cuentaPersonalId: 'personal-1',
        rol: 'agent',
      }),
    ]);
  });

  it('lanza ConflictoPoliciesError si un usuario de la lista es miembro de otra cuenta con datos', () => {
    const e = estadoAplicado();
    const u = e.usuarios.find((x: Op) => x.correo === 'asesor@empresa.co');
    Object.assign(u, {
      accountId: 'ajena',
      rol: 'owner',
      cuentaPersonalVacia: false,
    });
    expect(() => planificar(e, POLICIES)).toThrow(ConflictoPoliciesError);
  });

  it('lanza ConflictoPoliciesError si el owner del archivo no es el dueño actual de la cuenta', () => {
    const e = estadoAplicado();
    e.cuenta.ownerUserId = 'otro-usuario';
    expect(() => planificar(e, POLICIES)).toThrow(ConflictoPoliciesError);
  });

  it('bot activo sin ai_configs => una operación aviso y nada más del bot', () => {
    const ops = planificar(ESTADO_VACIO(), POLICIES);
    const delBot = ops.filter((o: Op) => /bot|aviso/.test(o.tipo));
    expect(delBot).toEqual([expect.objectContaining({ tipo: 'aviso' })]);
  });

  it('actualiza el bot cuando la fila existe y difiere', () => {
    const e = estadoAplicado();
    expect(planificar(e, POLICIES)).toEqual([]);
    e.bot.activo = false;
    expect(planificar(e, POLICIES)).toEqual([
      expect.objectContaining({
        tipo: 'actualizar-bot',
        activo: true,
        tope: 5,
      }),
    ]);
  });

  it('sobre un estado a medio aplicar planea solo lo que falta', () => {
    const ops = planificar(ESTADO_VACIO(), POLICIES);
    const mitad = aplicarEnMemoria(
      ESTADO_VACIO(),
      ops.slice(0, Math.floor(ops.length / 2))
    );
    const resto = planificar(mitad, POLICIES);
    expect(resto.length).toBeLessThan(ops.length);
    expect(
      cambios(planificar(aplicarEnMemoria(mitad, resto), POLICIES))
    ).toEqual([]);
  });
});

describe('pasosDeseados', () => {
  it('fuera de horario: condición time_of_day en la raíz y send_message en la rama yes', () => {
    const { fuera_de_horario } = pasosDeseados(POLICIES);
    expect(fuera_de_horario).toEqual([
      {
        stepType: 'condition',
        stepConfig: {
          subject: 'time_of_day',
          operand: '18:00-08:00',
          timezone: 'America/Bogota',
        },
        branch: null,
        parentIndex: null,
      },
      {
        stepType: 'send_message',
        stepConfig: { text: 'Cerrado' },
        branch: 'yes',
        parentIndex: 0,
      },
    ]);
  });

  it('los pasos deseados pasan validateStepsForActivation de wacrm', () => {
    const { bienvenida, fuera_de_horario } = pasosDeseados(POLICIES);
    expect(
      validateStepsForActivation(
        bienvenida.map((p: Op) => ({
          step_type: p.stepType,
          step_config: p.stepConfig,
        }))
      )
    ).toEqual([]);
    const [cond, envio] = fuera_de_horario;
    expect(
      validateStepsForActivation([
        {
          step_type: cond.stepType,
          step_config: cond.stepConfig,
          branches: {
            yes: [{ step_type: envio.stepType, step_config: envio.stepConfig }],
          },
        },
      ])
    ).toEqual([]);
  });
});

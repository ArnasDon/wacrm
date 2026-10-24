// Verificación del publicador de I3, cerrada por MOD.1 contra el fork.
import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ModulosSchema } from '../cfg/tenant-config';
import {
  definirModulo,
  ErrorConfigModulo,
  ErrorDefinicionModulo,
  EventoEntradaSchema,
  MIGRACION_WACRM,
  type EventoEntrada,
} from './module';
import { IDS_STUB } from './module.stub';

const h = vi.hoisted(() => ({
  llamadas: [] as string[],
  enganche: vi.fn(),
  after: [] as (() => Promise<void> | void)[],
  upsert: [{ id: '44444444-4444-4444-8444-444444444444' }] as { id: string }[],
  flows: vi.fn(),
  auto: vi.fn(),
  resume: vi.fn(),
  ia: vi.fn(),
  saliente: vi.fn(),
  estado: vi.fn(),
}));

function cadena(tabla: string, datos: () => unknown): unknown {
  const p: unknown = new Proxy(() => {}, {
    get: (_t, prop) =>
      prop === 'then'
        ? (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
            Promise.resolve({ data: datos(), error: null }).then(ok, ko)
        : () => {
            h.llamadas.push(`${tabla}.${String(prop)}`);
            return p;
          },
  });
  return p;
}

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    h.after.push(cb);
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(tabla: string) {
      const datos = (): unknown => {
        switch (tabla) {
          case 'whatsapp_config':
            return [
              {
                account_id: '11111111-1111-4111-8111-111111111111',
                user_id: 'u',
                access_token: 'enc',
                mirror_inbound_media: false,
              },
            ];
          case 'conversations':
            return [
              {
                id: '22222222-2222-4222-8222-222222222222',
                account_id: '11111111-1111-4111-8111-111111111111',
                unread_count: 0,
                assigned_agent_id: null,
                status: 'open',
              },
            ];
          case 'messages':
            return h.upsert;
          case 'contacts':
            return null;
          default:
            return [];
        }
      };
      return cadena(tabla, datos);
    },
    rpc: (nombre: string) => {
      h.llamadas.push(`rpc.${nombre}`);
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'plain-token',
  encrypt: (v: string) => v,
  isLegacyFormat: () => false,
}));
vi.mock('@/lib/whatsapp/webhook-signature', () => ({
  verifyMetaWebhookSignature: () => true,
}));
vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: vi.fn(async () => ({
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Ada',
    phone: '15551230000',
  })),
  isUniqueViolation: () => false,
}));
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.auto,
  resumeAwaitingReply: h.resume,
}));
vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: (...a: unknown[]) => {
    h.llamadas.push('dispatchInboundToFlows');
    return h.flows(...a);
  },
}));
vi.mock('@/lib/ai/auto-reply', () => ({ dispatchInboundToAiReply: h.ia }));
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: h.saliente }));
vi.mock('@/lib/whatsapp/message-status-sync', () => ({
  applyMessageStatus: h.estado,
}));
vi.mock('@/lib/whatsapp/template-webhook', () => ({
  isTemplateWebhookField: () => false,
  handleTemplateWebhookChange: vi.fn(),
}));

import { POST } from '@/app/api/whatsapp/webhook/route';
import { verificarMigraciones } from '@/modulos/migraciones';
import {
  arrancarModulos,
  fijarFlujoEntrada,
} from '@/modulos/arranque';
import { crearFlujoEntrada } from '@/modulos/flujo-entrada';
import { MODULOS, registrarModulos } from '@/modulos/registro';

const demo = (alEntrar: (e: EventoEntrada, c: { limite: number }) => Promise<void>) =>
  definirModulo({
    nombre: 'demo',
    configSchema: z.strictObject({ limite: z.number().min(1) }),
    migraciones: [],
    alEntrarMensaje: alEntrar as never,
  });

const ENCENDIDO = { demo: { activo: true, config: { limite: 1 } } };

function peticion(value: Record<string, unknown>) {
  return new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers: { 'x-hub-signature-256': 'sha256=stub' },
    body: JSON.stringify({
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: { metadata: { phone_number_id: 'pn-1' }, ...value },
            },
          ],
        },
      ],
    }),
  });
}

async function enviar(value: Record<string, unknown>) {
  const res = await POST(peticion(value));
  for (const cb of h.after) await cb();
  return res;
}

const TEXTO = {
  contacts: [{ wa_id: '15551230000', profile: { name: 'Ada' } }],
  messages: [
    {
      id: 'wamid.T1',
      from: '15551230000',
      timestamp: '1700000000',
      type: 'text',
      text: { body: 'hola' },
    },
  ],
};
const REACCION = {
  contacts: TEXTO.contacts,
  messages: [
    {
      id: 'wamid.R1',
      from: '15551230000',
      timestamp: '1700000000',
      type: 'reaction',
      reaction: { message_id: 'wamid.T1', emoji: '👍' },
    },
  ],
};
const ESTADO = {
  statuses: [{ id: 'wamid.T1', status: 'delivered', timestamp: '1700000000' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.llamadas = [];
  h.after = [];
  h.upsert = [{ id: IDS_STUB.mensaje }];
  h.enganche.mockImplementation(async () => {
    h.llamadas.push('ENGANCHE');
  });
  h.flows.mockResolvedValue({ consumed: false });
  h.resume.mockResolvedValue(false);
  h.ia.mockResolvedValue(undefined);
  h.saliente.mockResolvedValue(undefined);
  h.estado.mockResolvedValue([]);
  h.auto.mockResolvedValue(undefined);
});

describe('verificación del publicador de I3 (MOD.1)', () => {
  it('todas las migraciones de wacrm en supabase/migrations cumplen MIGRACION_WACRM', () => {
    const reales = fs
      .readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql') && !f.startsWith('mod_'));
    expect(reales.length).toBeGreaterThan(0);
    for (const f of reales) expect(f).toMatch(MIGRACION_WACRM);
  });

  it('toda migración mod_*.sql en supabase/migrations pertenece a un módulo registrado', () => {
    const reales = fs
      .readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'));
    expect(verificarMigraciones(reales, MODULOS)).toEqual([]);
    const con = verificarMigraciones(
      [...reales, 'mod_fantasma_001.sql'],
      MODULOS
    );
    expect(con).toEqual([
      {
        archivo: 'mod_fantasma_001.sql',
        motivo: expect.stringMatching(/no registrado/),
      },
    ]);
  });

  it('el registro de módulos del fork pasa cada módulo por definirModulo', () => {
    expect(() =>
      registrarModulos([
        { nombre: 'Mal', configSchema: z.object({}), migraciones: [] },
      ])
    ).toThrow(ErrorDefinicionModulo);
    for (const m of MODULOS) expect(Object.isFrozen(m)).toBe(true);
  });

  it('el arranque carga los módulos con cargarModulo y la config de I1, y falla con ErrorConfigModulo', () => {
    const d = demo(async () => {});
    expect(() =>
      arrancarModulos({
        modulos: [d],
        interruptores: ModulosSchema.parse({
          demo: { activo: true, config: { limite: 0 } },
        }),
      })
    ).toThrow(ErrorConfigModulo);
    const f = arrancarModulos({
      modulos: [d],
      interruptores: ModulosSchema.parse({
        demo: { activo: true, config: { limite: 2 } },
      }),
    });
    expect(f.cargados[0]).toMatchObject({ activo: true, config: { limite: 2 } });
  });

  it('el webhook de entrada llama alEntrarMensaje con un EventoEntrada válido después de guardar el mensaje', async () => {
    fijarFlujoEntrada(crearFlujoEntrada([demo(h.enganche)], ENCENDIDO));
    await enviar(TEXTO);
    expect(h.enganche).toHaveBeenCalledTimes(1);
    const evento = h.enganche.mock.calls[0][0];
    expect(() => EventoEntradaSchema.parse(evento)).not.toThrow();
    expect(evento.mensajeId).toBe(IDS_STUB.mensaje);
    expect(evento.asesorAsignadoId).toBeNull();
    const i = h.llamadas.indexOf('ENGANCHE');
    expect(h.llamadas.indexOf('messages.upsert')).toBeGreaterThanOrEqual(0);
    expect(h.llamadas.indexOf('messages.upsert')).toBeLessThan(i);
    expect(i).toBeLessThan(h.llamadas.indexOf('dispatchInboundToFlows'));
  });

  it('ni reacciones ni estados de entrega disparan enganches', async () => {
    fijarFlujoEntrada(crearFlujoEntrada([demo(h.enganche)], ENCENDIDO));
    await enviar(REACCION);
    await enviar(ESTADO);
    h.upsert = [];
    await enviar(TEXTO);
    expect(h.enganche).not.toHaveBeenCalled();
  });

  it('el error de un enganche se registra y el webhook responde igual a Meta', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.enganche.mockRejectedValue(new Error('boom'));
    fijarFlujoEntrada(crearFlujoEntrada([demo(h.enganche)], ENCENDIDO));
    const res = await enviar(TEXTO);
    expect(res).toEqual({ body: { status: 'received' }, init: { status: 200 } });
    expect(err.mock.calls.some((c) => c[0] === '[modulos]')).toBe(true);
    expect(h.flows).toHaveBeenCalled();
    expect(h.saliente).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'message.received',
      expect.anything()
    );
    err.mockRestore();
  });

  it('con todos los módulos apagados, el webhook se comporta igual que wacrm', async () => {
    const correr = async () => {
      vi.clearAllMocks();
      h.llamadas = [];
      h.after = [];
      h.flows.mockResolvedValue({ consumed: false });
      h.resume.mockResolvedValue(false);
      h.saliente.mockResolvedValue(undefined);
      h.auto.mockResolvedValue(undefined);
      await enviar(TEXTO);
      return {
        llamadas: [...h.llamadas],
        flows: h.flows.mock.calls.length,
        auto: h.auto.mock.calls.length,
        ia: h.ia.mock.calls.length,
        saliente: h.saliente.mock.calls.map((c) => c[2]),
      };
    };
    fijarFlujoEntrada(crearFlujoEntrada([], {}));
    const a = await correr();
    fijarFlujoEntrada(
      crearFlujoEntrada([demo(h.enganche)], {
        demo: { activo: false, config: { limite: 'basura' } },
      } as never)
    );
    const b = await correr();
    expect(b).toEqual(a);
    expect(h.enganche).not.toHaveBeenCalled();
    fijarFlujoEntrada(undefined);
  });
});

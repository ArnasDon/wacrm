#!/usr/bin/env node
/**
 * Aplica config/policies.yaml a la base de la empresa (CFG.2, R14). Idempotente.
 *
 * Uso (desde el checkout del repo hijo, con `npm ci` hecho y la base arriba):
 *   node scripts/empresa/aplicar-policies.mjs [--dir <ruta>] [--plan]
 *
 * Códigos de salida: 0 aplicado o sin cambios · 1 archivo inválido o falta una variable
 * · 2 conflictos con el estado de la base (nada escrito) · 3 falla durante la escritura
 * (volver a correr es seguro: el plan es por diferencia).
 * Ver docs/policies.md.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { createClient } from '@supabase/supabase-js';

import { leerPolicies, PoliciesInvalidasError } from './policies-esquema.mjs';
import {
  ConflictoPoliciesError,
  MARCADORES,
  planificar,
} from './policies-plan.mjs';

// Ruta del contrato CT.1 (contracts/cfg/tenant-config.ts, `policiesPath`); una prueba lo fija.
export const POLICIES_PATH = 'config/policies.yaml';

/** KEY=VALUE por línea; ignora comentarios y vacías; la última definición gana. */
function leerEnvArchivo(ruta) {
  const env = {};
  if (!existsSync(ruta)) return env;
  for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
    const t = linea.trim();
    if (t === '' || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) env[t.slice(0, i)] = t.slice(i + 1);
  }
  return env;
}

export function clienteServicio(env) {
  const url = env.SUPABASE_INTERNAL_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const llave = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error('Falta NEXT_PUBLIC_SUPABASE_URL (o SUPABASE_INTERNAL_URL)');
  }
  if (!llave) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, llave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function ok({ data, error }, que) {
  if (error) throw new Error(`${que}: ${error.message}`);
  return data;
}

/**
 * Tablas con datos de la cuenta que `redeem_invitation` revisa antes de borrar una cuenta personal
 * (supabase/migrations/047_account_membership_integrity.sql). Una prueba compara las dos listas.
 */
export const TABLAS_CUENTA = [
  'contacts',
  'conversations',
  'broadcasts',
  'automations',
  'automation_logs',
  'automation_pending_executions',
  'flows',
  'flow_runs',
  'pipelines',
  'deals',
  'message_templates',
  'tags',
  'custom_fields',
  'contact_notes',
  'whatsapp_config',
  'api_keys',
  'webhook_endpoints',
  'quick_replies',
  'notifications',
  'ai_configs',
  'ai_knowledge_documents',
  'ai_knowledge_chunks',
  'ai_usage_log',
];

async function contar(cliente, tabla, columna, valor) {
  const r = await cliente
    .from(tabla)
    .select('id', { count: 'exact', head: true })
    .eq(columna, valor);
  if (r.error) throw new Error(`leer ${tabla}: ${r.error.message}`);
  return r.count ?? 0;
}

/** Lee de la base lo que el planificador necesita (ver Estado en policies-plan.test.ts). */
export async function leerEstado(cliente, policies) {
  const correos = policies.usuarios.map((u) => u.correo);
  const perfiles =
    ok(
      await cliente
        .from('profiles')
        .select('user_id, email, full_name, account_id, account_role')
        .in('email', correos),
      'leer profiles'
    ) ?? [];
  const cuentasIds = [
    ...new Set(perfiles.map((p) => p.account_id).filter(Boolean)),
  ];
  const cuentas = cuentasIds.length
    ? ok(
        await cliente
          .from('accounts')
          .select('id, owner_user_id')
          .in('id', cuentasIds),
        'leer accounts'
      )
    : [];
  const duenoDe = new Map(cuentas.map((c) => [c.id, c.owner_user_id]));

  const owner = policies.usuarios.find((u) => u.rol === 'owner');
  const perfilOwner = perfiles.find(
    (p) => p.email.toLowerCase() === owner.correo
  );
  const cuenta = perfilOwner?.account_id
    ? {
        id: perfilOwner.account_id,
        ownerUserId: duenoDe.get(perfilOwner.account_id),
      }
    : null;

  const usuarios = [];
  for (const p of perfiles) {
    let cuentaPersonalVacia = false;
    if (p.account_id && p.account_id !== cuenta?.id) {
      const esPropia = duenoDe.get(p.account_id) === p.user_id;
      if (esPropia) {
        const miembros = await contar(
          cliente,
          'profiles',
          'account_id',
          p.account_id
        );
        const datos = await Promise.all(
          TABLAS_CUENTA.map((t) =>
            contar(cliente, t, 'account_id', p.account_id)
          )
        );
        cuentaPersonalVacia = miembros === 1 && datos.every((n) => n === 0);
      }
    }
    usuarios.push({
      userId: p.user_id,
      correo: p.email.toLowerCase(),
      nombre: p.full_name,
      accountId: p.account_id,
      rol: p.account_role,
      cuentaPersonalVacia,
    });
  }

  const estado = {
    cuenta,
    usuarios,
    etiquetas: [],
    embudo: null,
    automatizaciones: [],
    bot: null,
  };
  if (!cuenta) return estado;

  estado.etiquetas = ok(
    await cliente
      .from('tags')
      .select('id, name, color')
      .eq('account_id', cuenta.id),
    'leer tags'
  ).map((t) => ({ id: t.id, nombre: t.name, color: t.color }));

  if (policies.embudo) {
    const ps = ok(
      await cliente
        .from('pipelines')
        .select('id, name')
        .eq('account_id', cuenta.id)
        .eq('name', policies.embudo.nombre)
        .order('created_at')
        .limit(1),
      'leer pipelines'
    );
    if (ps.length > 0) {
      const etapas = ok(
        await cliente
          .from('pipeline_stages')
          .select('id, name, color, position')
          .eq('pipeline_id', ps[0].id),
        'leer pipeline_stages'
      );
      estado.embudo = {
        id: ps[0].id,
        nombre: ps[0].name,
        etapas: etapas.map((e) => ({
          id: e.id,
          nombre: e.name,
          color: e.color,
          posicion: e.position,
        })),
      };
    }
  }

  const autos = ok(
    await cliente
      .from('automations')
      .select('id, name, description, is_active, trigger_type')
      .eq('account_id', cuenta.id)
      .in('description', Object.values(MARCADORES)),
    'leer automations'
  );
  for (const a of autos) {
    const pasos = ok(
      await cliente
        .from('automation_steps')
        .select('id, parent_step_id, branch, step_type, step_config, position')
        .eq('automation_id', a.id)
        .order('position'),
      'leer automation_steps'
    );
    const raices = pasos.filter((p) => !p.parent_step_id);
    const ordenados = [...raices];
    for (const r of raices) {
      ordenados.push(...pasos.filter((p) => p.parent_step_id === r.id));
    }
    estado.automatizaciones.push({
      id: a.id,
      marcador: a.description,
      nombre: a.name,
      activa: a.is_active,
      triggerType: a.trigger_type,
      pasos: ordenados.map((p) => ({
        stepType: p.step_type,
        stepConfig: p.step_config,
        branch: p.branch ?? null,
        parentIndex: p.parent_step_id
          ? ordenados.findIndex((x) => x.id === p.parent_step_id)
          : null,
      })),
    });
  }

  const bot = ok(
    await cliente
      .from('ai_configs')
      .select(
        'id, is_active, auto_reply_enabled, auto_reply_max_per_conversation'
      )
      .eq('account_id', cuenta.id)
      .maybeSingle(),
    'leer ai_configs'
  );
  if (bot) {
    estado.bot = {
      id: bot.id,
      activo: bot.is_active,
      respuestaAutomatica: bot.auto_reply_enabled,
      tope: bot.auto_reply_max_per_conversation,
    };
  }
  return estado;
}

async function insertarPasos(cliente, automationId, pasos) {
  const ids = [];
  const posiciones = new Map();
  for (const p of pasos) {
    const clave = `${p.parentIndex ?? 'raiz'}:${p.branch ?? ''}`;
    const position = posiciones.get(clave) ?? 0;
    posiciones.set(clave, position + 1);
    const fila = ok(
      await cliente
        .from('automation_steps')
        .insert({
          automation_id: automationId,
          parent_step_id: p.parentIndex === null ? null : ids[p.parentIndex],
          branch: p.branch,
          step_type: p.stepType,
          step_config: p.stepConfig,
          position,
        })
        .select('id')
        .single(),
      'crear paso de automatización'
    );
    ids.push(fila.id);
  }
}

async function moverACuenta(
  cliente,
  ctx,
  { userId, cuentaPersonalId, rol, nombre }
) {
  ok(
    await cliente
      .from('profiles')
      .update({
        account_id: ctx.cuentaId,
        account_role: rol,
        full_name: nombre,
      })
      .eq('user_id', userId),
    'mover usuario a la cuenta'
  );
  // Primero el perfil (profiles.account_id es ON DELETE CASCADE), luego la cuenta personal vacía.
  ok(
    await cliente.from('accounts').delete().eq('id', cuentaPersonalId),
    'borrar cuenta personal vacía'
  );
}

/**
 * Ejecuta las operaciones en orden. `ctx` trae lo ya existente (cuentaId, ownerUserId, embudoId).
 * @returns {Promise<{contrasenas: {correo: string, contrasena: string}[], avisos: string[]}>}
 */
export async function ejecutar(cliente, ops, ctx = {}) {
  const contrasenas = [];
  const avisos = [];
  for (const op of ops) {
    try {
      switch (op.tipo) {
        case 'crear-usuario': {
          const contrasena = randomBytes(18).toString('base64url');
          const r = await cliente.auth.admin.createUser({
            email: op.correo,
            email_confirm: true,
            password: contrasena,
            user_metadata: { full_name: op.nombre },
          });
          if (r.error) throw new Error(r.error.message);
          contrasenas.push({ correo: op.correo, contrasena });
          const userId = r.data.user.id;
          const perfil = ok(
            await cliente
              .from('profiles')
              .select('account_id')
              .eq('user_id', userId)
              .single(),
            'leer perfil recién creado'
          );
          if (op.rol === 'owner') {
            ctx.cuentaId = perfil.account_id;
            ctx.ownerUserId = userId;
          } else {
            await moverACuenta(cliente, ctx, {
              userId,
              cuentaPersonalId: perfil.account_id,
              rol: op.rol,
              nombre: op.nombre,
            });
          }
          break;
        }
        case 'mover-usuario':
          await moverACuenta(cliente, ctx, op);
          break;
        case 'cambiar-rol':
          ok(
            await cliente
              .from('profiles')
              .update({ account_role: op.rol })
              .eq('user_id', op.userId),
            'cambiar rol'
          );
          break;
        case 'cambiar-nombre-usuario':
          ok(
            await cliente
              .from('profiles')
              .update({ full_name: op.nombre })
              .eq('user_id', op.userId),
            'cambiar nombre'
          );
          break;
        case 'crear-etiqueta':
          ok(
            await cliente.from('tags').insert({
              account_id: ctx.cuentaId,
              user_id: ctx.ownerUserId,
              name: op.nombre,
              color: op.color,
            }),
            'crear etiqueta'
          );
          break;
        case 'actualizar-etiqueta':
          ok(
            await cliente
              .from('tags')
              .update({ color: op.color })
              .eq('id', op.id),
            'actualizar etiqueta'
          );
          break;
        case 'crear-embudo':
          ctx.embudoId = ok(
            await cliente
              .from('pipelines')
              .insert({
                account_id: ctx.cuentaId,
                user_id: ctx.ownerUserId,
                name: op.nombre,
              })
              .select('id')
              .single(),
            'crear embudo'
          ).id;
          break;
        case 'crear-etapa':
          ok(
            await cliente.from('pipeline_stages').insert({
              pipeline_id: ctx.embudoId,
              name: op.nombre,
              color: op.color,
              position: op.posicion,
            }),
            'crear etapa'
          );
          break;
        case 'actualizar-etapa':
          ok(
            await cliente
              .from('pipeline_stages')
              .update({ color: op.color, position: op.posicion })
              .eq('id', op.id),
            'actualizar etapa'
          );
          break;
        case 'crear-automatizacion': {
          const a = ok(
            await cliente
              .from('automations')
              .insert({
                account_id: ctx.cuentaId,
                user_id: ctx.ownerUserId,
                name: op.nombre,
                description: op.marcador,
                trigger_type: op.triggerType,
                trigger_config: {},
                is_active: false,
              })
              .select('id')
              .single(),
            'crear automatización'
          );
          await insertarPasos(cliente, a.id, op.pasos);
          if (op.activa) {
            ok(
              await cliente
                .from('automations')
                .update({ is_active: true })
                .eq('id', a.id),
              'activar automatización'
            );
          }
          break;
        }
        case 'reemplazar-pasos':
          ok(
            await cliente
              .from('automation_steps')
              .delete()
              .eq('automation_id', op.id),
            'borrar pasos'
          );
          await insertarPasos(cliente, op.id, op.pasos);
          break;
        case 'actualizar-automatizacion':
          ok(
            await cliente
              .from('automations')
              .update({ is_active: op.activa, trigger_type: op.triggerType })
              .eq('id', op.id),
            'actualizar automatización'
          );
          break;
        case 'actualizar-bot':
          ok(
            await cliente
              .from('ai_configs')
              .update({
                is_active: op.activo,
                auto_reply_enabled: op.respuestaAutomatica,
                auto_reply_max_per_conversation: op.tope,
              })
              .eq('id', op.id),
            'actualizar bot'
          );
          break;
        case 'aviso':
          avisos.push(op.mensaje);
          break;
        default:
          throw new Error(`operación desconocida: ${op.tipo}`);
      }
    } catch (e) {
      // Las contraseñas ya generadas viajan con el error: en la siguiente corrida esos usuarios
      // ya existen y no se vuelven a generar.
      const error = new Error(
        `${op.tipo}: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e }
      );
      error.contrasenas = contrasenas;
      throw error;
    }
  }
  return { contrasenas, avisos };
}

/** leerEstado → planificar → (si no es solo plan) ejecutar. */
export async function aplicarPolicies(cliente, policies, opciones = {}) {
  const estado = await leerEstado(cliente, policies);
  const ops = planificar(estado, policies);
  if (opciones.soloPlan) {
    return {
      ops,
      contrasenas: [],
      avisos: ops.filter((o) => o.tipo === 'aviso').map((o) => o.mensaje),
    };
  }
  const ctx = {
    cuentaId: estado.cuenta?.id,
    ownerUserId: estado.cuenta?.ownerUserId,
    embudoId: estado.embudo?.id,
  };
  const r = await ejecutar(cliente, ops, ctx);
  return { ops, contrasenas: r.contrasenas, avisos: r.avisos };
}

function describir(op) {
  const { tipo, ...resto } = op;
  const detalle = Object.entries(resto)
    .filter(([k]) => !['pasos', 'id', 'userId', 'cuentaPersonalId'].includes(k))
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  return `${tipo}${detalle ? ` ${detalle}` : ''}`;
}

export function imprimirContrasenas(contrasenas) {
  if (contrasenas.length === 0) return;
  console.log('Contraseñas temporales (se muestran una sola vez):');
  for (const c of contrasenas) console.log(`  ${c.correo}  ${c.contrasena}`);
}

export async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { dir: { type: 'string' }, plan: { type: 'boolean' } },
  });
  const dir = resolve(values.dir ?? process.cwd());

  // 1) El archivo: se valida entero antes de tocar la red.
  let policies;
  try {
    policies = leerPolicies(join(dir, POLICIES_PATH));
  } catch (e) {
    if (e instanceof PoliciesInvalidasError) {
      console.error(
        `${POLICIES_PATH} no es válido (no se escribió nada):\n- ${e.problemas.join('\n- ')}`
      );
      return 1;
    }
    throw e;
  }

  // 2) El entorno.
  const env = { ...leerEnvArchivo(join(dir, '.env')), ...process.env };
  let cliente;
  try {
    cliente = clienteServicio(env);
  } catch (e) {
    console.error(`${e.message} (en .env o en el entorno)`);
    return 1;
  }

  // 3) El estado de la base y la escritura.
  try {
    const r = await aplicarPolicies(cliente, policies, {
      soloPlan: values.plan,
    });
    const cambios = r.ops.filter((o) => o.tipo !== 'aviso');
    if (values.plan) {
      console.log(
        cambios.length === 0
          ? `Sin cambios: la base ya coincide con ${POLICIES_PATH}`
          : `Se aplicarían ${cambios.length} operaciones:\n${cambios.map((o) => `- ${describir(o)}`).join('\n')}`
      );
    } else if (cambios.length === 0) {
      console.log(`Sin cambios: la base ya coincide con ${POLICIES_PATH}`);
    } else {
      console.log(
        `Aplicadas ${cambios.length} operaciones desde ${POLICIES_PATH}.`
      );
    }
    for (const a of r.avisos) console.log(`Aviso: ${a}`);
    imprimirContrasenas(r.contrasenas);
    return 0;
  } catch (e) {
    if (e instanceof ConflictoPoliciesError) {
      console.error(e.message);
      return 2;
    }
    imprimirContrasenas(e?.contrasenas ?? []);
    console.error(
      `Falló al aplicar policies: ${e instanceof Error ? e.message : e}\nVolver a correr es seguro: solo se aplica lo que falte.`
    );
    return 3;
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  process.exitCode = await main(process.argv.slice(2));
}

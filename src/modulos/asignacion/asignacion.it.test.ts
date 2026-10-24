/**
 * IT del motor de asignación (ASG.1) contra el Postgres del compose.
 *
 * Apagada por defecto: solo corre con COMPOSE_IT=1 (workflow compose-it.yml).
 * Levanta solo la parte de Supabase de un repo hijo desechable y llama
 * mod_asignacion_asignar por psql.
 */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SERVICE_NAMES } from '../../../contracts/base/compose-services';
import {
  crearRepoHijo,
  type RepoHijo,
} from '../../../scripts/empresa/repo-hijo';

const execFileAsync = promisify(execFile);
const PUERTO = '8011';
const SERVICIOS = SERVICE_NAMES.filter(
  (s) => s.startsWith('supabase-') && s !== 'supabase-studio'
);

const OWNER = '00000000-0000-4000-8000-000000000001';
const A1 = '00000000-0000-4000-8000-0000000000a1';
const A2 = '00000000-0000-4000-8000-0000000000a2';
const A3 = '00000000-0000-4000-8000-0000000000a3';
const ASESORES = [A1, A2, A3];

const REGLAS = `array['asesor-previo','reparto-equitativo']`;
const SOLO_REPARTO = `array['reparto-equitativo']`;

type Resultado = { asesorId: string; regla: string } | null;

describe.skipIf(process.env['COMPOSE_IT'] !== '1')(
  'motor de asignación contra Postgres',
  () => {
    let hijo: RepoHijo;
    let cuenta = '';
    let n = 0;

    const compose = (...args: string[]) =>
      execFileSync('docker', ['compose', ...args], {
        cwd: hijo.dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 20 * 1024 * 1024,
      });
    const sql = (q: string) =>
      compose(
        'exec',
        '-T',
        'supabase-db',
        'psql',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-tAc',
        q
      ).trim();
    const nuevaConversacion = () => {
      n += 1;
      const contacto = `00000000-0000-4000-8000-1${String(n).padStart(11, '0')}`;
      const conv = `00000000-0000-4000-8000-2${String(n).padStart(11, '0')}`;
      sql(
        `insert into contacts (id, user_id, account_id, phone) values ('${contacto}','${OWNER}','${cuenta}','+57300${String(n).padStart(7, '0')}');
         insert into conversations (id, user_id, account_id, contact_id) values ('${conv}','${OWNER}','${cuenta}','${contacto}')`
      );
      return { contacto, conv };
    };
    const asignar = (conv: string, reglas = REGLAS): Resultado => {
      const out = sql(
        `select coalesce(mod_asignacion_asignar('${conv}', gen_random_uuid(), ${reglas})::text, 'null')`
      );
      return JSON.parse(out) as Resultado;
    };
    const asesorDe = (conv: string) =>
      sql(
        `select coalesce(assigned_agent_id::text,'') from conversations where id='${conv}'`
      );
    const desasignar = (conv: string) =>
      sql(
        `update conversations set assigned_agent_id = null where id='${conv}'`
      );
    const desactivar = (u: string) =>
      sql(
        `insert into mod_asignacion_asesores (user_id, account_id, activo) values ('${u}','${cuenta}',false)
         on conflict (user_id) do update set activo = false`
      );
    const registros = (conv: string) =>
      Number(
        sql(
          `select count(*) from mod_asignacion_registro where conversacion_id='${conv}'`
        )
      );

    beforeAll(() => {
      hijo = crearRepoHijo({ id: 'asignacion-it', nombre: 'Asignacion IT' });
      appendFileSync(
        join(hijo.dir, '.env'),
        `\nKONG_HTTP_PORT=${PUERTO}\nNEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${PUERTO}\n`
      );
      try {
        compose('up', '-d', '--wait', '--wait-timeout', '600', ...SERVICIOS);
      } catch (e) {
        console.error(compose('ps'));
        console.error(compose('logs', '--tail', '200'));
        throw e;
      }
      compose(
        'exec',
        '-T',
        'supabase-db',
        'sh',
        '-c',
        'for f in /migrations/*.sql; do psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f "$f" >/dev/null || exit 1; done'
      );
      for (const [i, u] of [OWNER, ...ASESORES].entries()) {
        sql(
          `insert into auth.users (id, email) values ('${u}','u${i}@asg.test')`
        );
      }
      cuenta = sql(`select account_id from profiles where user_id='${OWNER}'`);
      sql(
        `update profiles set account_id='${cuenta}', account_role='agent' where user_id in ('${A1}','${A2}','${A3}')`
      );
    }, 900_000);

    afterAll(() => {
      if (!hijo) return;
      try {
        compose('down', '-v', '--remove-orphans');
      } finally {
        hijo.limpiar();
      }
    }, 300_000);

    beforeEach(() => {
      sql(
        `delete from mod_asignacion_registro; delete from mod_asignacion_cursor;
         delete from mod_asignacion_asesores;
         update profiles set account_role='agent' where user_id in ('${A1}','${A2}','${A3}')`
      );
    });

    it('un contacto que vuelve queda con su asesor previo', () => {
      const { conv } = nuevaConversacion();
      const primero = asignar(conv)!;
      expect(primero.regla).toBe('reparto-equitativo');
      desasignar(conv);
      expect(asignar(conv)).toEqual({
        asesorId: primero.asesorId,
        regla: 'asesor-previo',
      });
    });

    it('asesor previo inactivo: se aplica la siguiente regla', () => {
      const { conv } = nuevaConversacion();
      const primero = asignar(conv)!;
      desasignar(conv);
      desactivar(primero.asesorId);
      const segundo = asignar(conv)!;
      expect(segundo.regla).toBe('reparto-equitativo');
      expect(segundo.asesorId).not.toBe(primero.asesorId);

      // Variante: el previo pasó a admin y ya no es asesor.
      desasignar(conv);
      sql(`delete from mod_asignacion_asesores`);
      sql(
        `update profiles set account_role='admin' where user_id='${segundo.asesorId}'`
      );
      const tercero = asignar(conv)!;
      expect(tercero.regla).toBe('reparto-equitativo');
      expect(tercero.asesorId).not.toBe(segundo.asesorId);
    });

    it('el reparto alterna entre los asesores activos', () => {
      const vistos = [1, 2, 3, 4].map(
        () => asignar(nuevaConversacion().conv, SOLO_REPARTO)!.asesorId
      );
      expect(vistos).toEqual([A1, A2, A3, A1]);
      desactivar(A2);
      const despues = [1, 2, 3].map(
        () => asignar(nuevaConversacion().conv, SOLO_REPARTO)!.asesorId
      );
      expect(despues).toEqual([A3, A1, A3]);
    });

    it('sin asesores activos la conversación queda sin asignar', () => {
      const { conv } = nuevaConversacion();
      for (const a of ASESORES) desactivar(a);
      expect(asignar(conv)).toBeNull();
      expect(asesorDe(conv)).toBe('');
      expect(registros(conv)).toBe(0);
      sql(
        `update mod_asignacion_asesores set activo = true where user_id='${A1}'`
      );
      expect(asignar(conv)).toMatchObject({ asesorId: A1 });
    });

    it('cada asignación queda registrada con su regla', () => {
      const { conv, contacto } = nuevaConversacion();
      const primero = asignar(conv)!;
      desasignar(conv);
      asignar(conv);
      const filas = sql(
        `select regla || '|' || asesor_id || '|' || contacto_id || '|' || account_id || '|' || (asignado_en is not null)
         from mod_asignacion_registro where conversacion_id='${conv}' order by asignado_en`
      ).split('\n');
      expect(filas).toEqual([
        `reparto-equitativo|${primero.asesorId}|${contacto}|${cuenta}|true`,
        `asesor-previo|${primero.asesorId}|${contacto}|${cuenta}|true`,
      ]);
      expect(asesorDe(conv)).toBe(primero.asesorId);
    });

    it('dos llamadas seguidas no reasignan', () => {
      const { conv } = nuevaConversacion();
      expect(asignar(conv)).not.toBeNull();
      expect(asignar(conv)).toBeNull();
      expect(registros(conv)).toBe(1);

      const manual = nuevaConversacion().conv;
      sql(
        `update conversations set assigned_agent_id='${A3}' where id='${manual}'`
      );
      expect(asignar(manual)).toBeNull();
      expect(asesorDe(manual)).toBe(A3);
      expect(registros(manual)).toBe(0);
    });

    it('llamadas simultáneas asignan una sola vez', async () => {
      const { conv } = nuevaConversacion();
      const q = `select coalesce(mod_asignacion_asignar('${conv}', gen_random_uuid(), ${REGLAS})::text,'null')`;
      const salidas = await Promise.all(
        Array.from({ length: 6 }, async () => {
          const { stdout } = await execFileAsync(
            'docker',
            [
              'compose',
              'exec',
              '-T',
              'supabase-db',
              'psql',
              '-U',
              'postgres',
              '-d',
              'postgres',
              '-tAc',
              q,
            ],
            { cwd: hijo.dir }
          );
          return stdout.trim();
        })
      );
      expect(salidas.filter((x) => x !== 'null')).toHaveLength(1);
      expect(registros(conv)).toBe(1);
    });

    it('solo service_role ejecuta la asignación', () => {
      const { conv } = nuevaConversacion();
      expect(() =>
        sql(
          `set role authenticated; select mod_asignacion_asignar('${conv}', gen_random_uuid(), ${REGLAS})`
        )
      ).toThrow(/permission denied/);
      expect(asesorDe(conv)).toBe('');
    });
  }
);

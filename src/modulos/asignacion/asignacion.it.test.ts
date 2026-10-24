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
const TODAS = `array['asesor-previo','etiqueta','palabra-clave','campo','reparto-equitativo']`;
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
    const asignar = (
      conv: string,
      reglas = REGLAS,
      mensajeId?: string
    ): Resultado => {
      const msg = mensajeId ? `'${mensajeId}'` : 'gen_random_uuid()';
      const out = sql(
        `select coalesce(mod_asignacion_asignar('${conv}', ${msg}, ${reglas})::text, 'null')`
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

    const uuid = () => sql('select gen_random_uuid()');
    const crearEtiqueta = (nombre: string, cuentaId = cuenta) => {
      const id = uuid();
      sql(
        `insert into tags (id, user_id, account_id, name) values ('${id}','${OWNER}','${cuentaId}','${nombre}')`
      );
      return id;
    };
    const etiquetar = (contacto: string, tag: string) =>
      sql(
        `insert into contact_tags (contact_id, tag_id) values ('${contacto}','${tag}')`
      );
    const crearCampo = (nombre: string) => {
      const id = uuid();
      sql(
        `insert into custom_fields (id, user_id, account_id, field_name) values ('${id}','${OWNER}','${cuenta}','${nombre}')`
      );
      return id;
    };
    const ponerCampo = (contacto: string, campo: string, valor: string) =>
      sql(
        `insert into contact_custom_values (contact_id, custom_field_id, value) values ('${contacto}','${campo}','${valor}')`
      );
    const mensaje = (conv: string, texto: string | null) => {
      const id = uuid();
      sql(
        texto === null
          ? `insert into messages (id, conversation_id, sender_type, content_type) values ('${id}','${conv}','customer','image')`
          : `insert into messages (id, conversation_id, sender_type, content_text) values ('${id}','${conv}','customer','${texto}')`
      );
      return id;
    };
    const crearRegla = (r: {
      orden: number;
      tipo: 'etiqueta' | 'palabra-clave' | 'campo';
      tagId?: string;
      campoId?: string;
      valor?: string;
      asesorId: string;
      activa?: boolean;
      cuentaId?: string;
    }) => {
      const id = uuid();
      const q = (v?: string) => (v ? `'${v}'` : 'null');
      sql(
        `insert into mod_asignacion_reglas (id, account_id, orden, tipo, tag_id, custom_field_id, valor, asesor_id, activa)
         values ('${id}','${r.cuentaId ?? cuenta}',${r.orden},'${r.tipo}',${q(r.tagId)},${q(r.campoId)},${q(r.valor)},'${r.asesorId}',${r.activa ?? true})`
      );
      return id;
    };

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
         delete from mod_asignacion_reglas; delete from contact_tags;
         delete from contact_custom_values; delete from tags;
         delete from custom_fields; delete from messages;
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

    describe('reglas de la empresa (ASG.2)', () => {
      it('regla por etiqueta asigna al asesor de la regla', () => {
        const c1 = nuevaConversacion();
        const c2 = nuevaConversacion();
        const vip = crearEtiqueta('VIP');
        etiquetar(c1.contacto, vip);
        const regla = crearRegla({
          orden: 1,
          tipo: 'etiqueta',
          tagId: vip,
          asesorId: A3,
        });
        expect(asignar(c1.conv, TODAS)).toEqual({
          asesorId: A3,
          regla: 'etiqueta',
        });
        expect(
          sql(
            `select regla || '|' || regla_id from mod_asignacion_registro where conversacion_id='${c1.conv}'`
          )
        ).toBe(`etiqueta|${regla}`);
        expect(asignar(c2.conv, TODAS)?.regla).toBe('reparto-equitativo');
      });

      it('regla por palabra clave asigna al asesor de la regla', () => {
        const [c1, c2, c3, c4] = [1, 2, 3, 4].map(() => nuevaConversacion());
        crearRegla({
          orden: 1,
          tipo: 'palabra-clave',
          valor: 'credito',
          asesorId: A2,
        });
        const m1 = mensaje(c1!.conv, 'Hola, quiero info de CRÉDITO');
        expect(asignar(c1!.conv, TODAS, m1)).toEqual({
          asesorId: A2,
          regla: 'palabra-clave',
        });
        const m2 = mensaje(c2!.conv, 'ya quedó acreditado');
        expect(asignar(c2!.conv, TODAS, m2)?.regla).toBe('reparto-equitativo');
        const m3 = mensaje(c3!.conv, null);
        expect(asignar(c3!.conv, TODAS, m3)?.regla).toBe('reparto-equitativo');
        // el mensaje de C1 no es de la conversación C4
        expect(asignar(c4!.conv, TODAS, m1)?.regla).toBe('reparto-equitativo');
      });

      it('regla por campo asigna al asesor de la regla', () => {
        const c1 = nuevaConversacion();
        const c2 = nuevaConversacion();
        const ciudad = crearCampo('Ciudad');
        ponerCampo(c1.contacto, ciudad, ' medellín ');
        ponerCampo(c2.contacto, ciudad, 'Bogotá');
        crearRegla({
          orden: 1,
          tipo: 'campo',
          campoId: ciudad,
          valor: 'Medellin',
          asesorId: A1,
        });
        expect(asignar(c1.conv, TODAS)).toEqual({
          asesorId: A1,
          regla: 'campo',
        });
        expect(asignar(c2.conv, TODAS)?.regla).toBe('reparto-equitativo');
      });

      it('con varias reglas que se cumplen, gana la primera en orden', () => {
        const { conv, contacto } = nuevaConversacion();
        const vip = crearEtiqueta('VIP');
        const ciudad = crearCampo('Ciudad');
        etiquetar(contacto, vip);
        ponerCampo(contacto, ciudad, 'Medellín');
        const msg = mensaje(conv, 'credito');
        crearRegla({ orden: 10, tipo: 'etiqueta', tagId: vip, asesorId: A3 });
        crearRegla({
          orden: 20,
          tipo: 'palabra-clave',
          valor: 'credito',
          asesorId: A2,
        });
        crearRegla({
          orden: 30,
          tipo: 'campo',
          campoId: ciudad,
          valor: 'Medellin',
          asesorId: A1,
        });
        // (a) orden de tipos por defecto
        expect(asignar(conv, TODAS, msg)).toMatchObject({
          asesorId: A3,
          regla: 'etiqueta',
        });
        // (b) el orden de tipos de la config manda
        desasignar(conv);
        sql(`delete from mod_asignacion_registro`);
        expect(
          asignar(conv, `array['campo','etiqueta','reparto-equitativo']`, msg)
        ).toMatchObject({ asesorId: A1, regla: 'campo' });
        // (c) mismo tipo: gana el orden menor
        desasignar(conv);
        sql(`delete from mod_asignacion_registro`);
        crearRegla({ orden: 5, tipo: 'etiqueta', tagId: vip, asesorId: A1 });
        expect(asignar(conv, TODAS, msg)).toMatchObject({
          asesorId: A1,
          regla: 'etiqueta',
        });
        // (d) asesor previo va primero
        desasignar(conv);
        expect(asignar(conv, TODAS, msg)).toMatchObject({
          asesorId: A1,
          regla: 'asesor-previo',
        });
      });

      it('regla con asesor inactivo se salta', () => {
        const c = nuevaConversacion();
        const vip = crearEtiqueta('VIP');
        etiquetar(c.contacto, vip);
        crearRegla({ orden: 1, tipo: 'etiqueta', tagId: vip, asesorId: A3 });
        crearRegla({ orden: 2, tipo: 'etiqueta', tagId: vip, asesorId: A2 });
        desactivar(A3);
        expect(asignar(c.conv, TODAS)).toEqual({
          asesorId: A2,
          regla: 'etiqueta',
        });
        desasignar(c.conv);
        sql(`delete from mod_asignacion_registro`);
        sql(`update profiles set account_role='admin' where user_id='${A2}'`);
        expect(asignar(c.conv, TODAS)?.regla).toBe('reparto-equitativo');
      });

      it('regla desactivada o de otra cuenta no aplica', () => {
        const c = nuevaConversacion();
        const vip = crearEtiqueta('VIP');
        etiquetar(c.contacto, vip);
        crearRegla({
          orden: 1,
          tipo: 'etiqueta',
          tagId: vip,
          asesorId: A3,
          activa: false,
        });
        expect(asignar(c.conv, TODAS)?.regla).toBe('reparto-equitativo');

        const c2 = nuevaConversacion();
        const dueno = uuid();
        sql(
          `insert into auth.users (id, email) values ('${dueno}','ajeno-${dueno}@asg.test')`
        );
        const ajena = sql(
          `select account_id from profiles where user_id='${dueno}'`
        );
        const tagAjena = crearEtiqueta('VIP-ajena', ajena);
        etiquetar(c2.contacto, tagAjena);
        crearRegla({
          orden: 2,
          tipo: 'etiqueta',
          tagId: tagAjena,
          asesorId: A1,
          cuentaId: ajena,
        });
        expect(asignar(c2.conv, TODAS)?.regla).toBe('reparto-equitativo');
      });

      it('un asesor no puede escribir reglas', () => {
        const vip = crearEtiqueta('VIP');
        const ins = (sub: string) =>
          sql(
            `begin; set local role authenticated;
             select set_config('request.jwt.claims','{"sub":"${sub}","role":"authenticated"}',true);
             insert into mod_asignacion_reglas (account_id, orden, tipo, tag_id, asesor_id)
             values ('${cuenta}', 99, 'etiqueta', '${vip}', '${A1}'); commit`
          );
        expect(() => ins(A1)).toThrow(/row-level security/);
        expect(() => ins(OWNER)).not.toThrow();
      });
    });
    describe('ASG.3 · reasignación manual', () => {
      const comoUsuario = (uid: string, q: string, rol = 'authenticated') =>
        sql(
          `begin; set local role ${rol};
           select set_config('request.jwt.claims','{"sub":"${uid}","role":"${rol}"}',true);
           ${q}; commit`
        );
      const reasignar = (uid: string, conv: string, asesor: string) => {
        const out = comoUsuario(
          uid,
          `select mod_asignacion_reasignar('${conv}','${asesor}')::text`
        );
        const linea =
          out.split('\n').find((l) => l.includes('"regla"')) ?? 'null';
        return JSON.parse(linea) as {
          asesorId: string;
          anteriorId: string | null;
          regla: string;
          cambio: boolean;
        };
      };
      const ultimoRegistro = (conv: string) =>
        sql(
          `select regla||'|'||asesor_id||'|'||coalesce(asignado_por::text,'')||'|'||coalesce(mensaje_id::text,'') from mod_asignacion_registro
           where conversacion_id='${conv}' order by asignado_en desc, id desc limit 1`
        );
      const crearAjeno = () => {
        const dueno = uuid();
        sql(
          `insert into auth.users (id, email) values ('${dueno}','ajeno-${dueno}@asg.test')`
        );
        return dueno;
      };

      it('un admin reasigna y queda registrado como manual', () => {
        const { conv } = nuevaConversacion();
        expect(asignar(conv)?.asesorId).toBe(A1);
        expect(reasignar(OWNER, conv, A2)).toEqual({
          asesorId: A2,
          anteriorId: A1,
          regla: 'manual',
          cambio: true,
        });
        expect(asesorDe(conv)).toBe(A2);
        expect(ultimoRegistro(conv)).toBe(`manual|${A2}|${OWNER}|`);
        sql(`update profiles set account_role='admin' where user_id='${A3}'`);
        expect(reasignar(A3, conv, A1).cambio).toBe(true);
        expect(ultimoRegistro(conv)).toBe(`manual|${A1}|${A3}|`);
      });

      it('un mensaje nuevo en una conversación reasignada a mano no cambia su asesor', () => {
        const { conv } = nuevaConversacion();
        asignar(conv);
        reasignar(OWNER, conv, A2);
        const antes = registros(conv);
        expect(asignar(conv, REGLAS)).toBeNull();
        expect(asignar(conv, TODAS)).toBeNull();
        expect(asesorDe(conv)).toBe(A2);
        expect(registros(conv)).toBe(antes);
      });

      it('un asesor no puede reasignar', () => {
        const { conv } = nuevaConversacion();
        asignar(conv);
        expect(() => reasignar(A1, conv, A2)).toThrow(/sin permiso/);
        sql(`update profiles set account_role='viewer' where user_id='${A2}'`);
        expect(() => reasignar(A2, conv, A3)).toThrow(/sin permiso/);
        const sinPerfil = uuid();
        expect(() => reasignar(sinPerfil, conv, A3)).toThrow(
          /no encontrada|sin permiso/
        );
        expect(() =>
          comoUsuario(
            A1,
            `select mod_asignacion_reasignar('${conv}','${A2}')`,
            'anon'
          )
        ).toThrow(/permission denied/);
        expect(asesorDe(conv)).toBe(A1);
        expect(registros(conv)).toBe(1);
      });

      it('reasignar al mismo asesor no registra', () => {
        const { conv } = nuevaConversacion();
        asignar(conv);
        expect(reasignar(OWNER, conv, A1).cambio).toBe(false);
        expect(registros(conv)).toBe(1);
        expect(asesorDe(conv)).toBe(A1);
      });

      it('asesor destino inválido', () => {
        const { conv } = nuevaConversacion();
        asignar(conv);
        sql(`update profiles set account_role='viewer' where user_id='${A2}'`);
        const ajeno = crearAjeno();
        for (const destino of [A2, ajeno, uuid()]) {
          expect(() => reasignar(OWNER, conv, destino)).toThrow(
            /asesor inválido/
          );
        }
        expect(asesorDe(conv)).toBe(A1);
        expect(registros(conv)).toBe(1);
      });

      it('admin de otra cuenta', () => {
        const { conv } = nuevaConversacion();
        asignar(conv);
        const ajeno = crearAjeno();
        expect(() => reasignar(ajeno, conv, A2)).toThrow(
          /conversación no encontrada/
        );
        expect(asesorDe(conv)).toBe(A1);
        expect(registros(conv)).toBe(1);
      });

      it('tras desasignar vuelve al asesor manual', () => {
        const { conv } = nuevaConversacion();
        reasignar(OWNER, conv, A3);
        desasignar(conv);
        expect(asignar(conv, REGLAS)).toEqual({
          asesorId: A3,
          regla: 'asesor-previo',
        });
      });

      it('reasignar y luego asignar en la misma transacción no duplica', () => {
        const { conv } = nuevaConversacion();
        const out = sql(
          `begin; set local role authenticated;
           select set_config('request.jwt.claims','{"sub":"${OWNER}","role":"authenticated"}',true);
           select mod_asignacion_reasignar('${conv}','${A2}');
           reset role;
           select coalesce(mod_asignacion_asignar('${conv}', gen_random_uuid(), ${REGLAS})::text,'null');
           commit`
        );
        expect(
          out
            .split('\n')
            .filter((l) => l !== '' && l !== 'COMMIT')
            .pop()
        ).toBe('null');
        expect(registros(conv)).toBe(1);
        expect(asesorDe(conv)).toBe(A2);
      });
    });
  }
);

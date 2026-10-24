/**
 * IT: aplicar config/policies.yaml a la base de una empresa (CFG.2).
 *
 * Apagada por defecto: solo corre con COMPOSE_IT=1 (workflow compose-it.yml).
 * Levanta solo la parte de Supabase del compose de un repo hijo desechable.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SERVICE_NAMES } from '../../contracts/base/compose-services';
import { validateStepsForActivation } from '../../src/lib/automations/validate';
import { clienteServicio } from './aplicar-policies.mjs';
import { crearRepoHijo, leerEnv, type RepoHijo } from './repo-hijo';

const PUERTO = '8010';
// Solo la parte de Supabase (sin app, cron ni túnel). Las migraciones necesitan también
// storage y realtime (buckets, publicación), por eso van todos menos studio.
const SERVICIOS = SERVICE_NAMES.filter(
  (s) => s.startsWith('supabase-') && s !== 'supabase-studio'
);
const CLI = join(process.cwd(), 'scripts', 'empresa', 'aplicar-policies.mjs');

const POLICIES_IT = `version: 1
usuarios:
  - { correo: dueno@policies.test, nombre: Ana Dueña, rol: owner }
  - { correo: admin@policies.test, nombre: Beto Admin, rol: admin }
  - { correo: asesor@policies.test, nombre: Carla Asesora, rol: asesor }
etiquetas:
  - { nombre: VIP, color: '#f59e0b' }
  - { nombre: Mayorista, color: '#10b981' }
embudo:
  nombre: Ventas
  etapas:
    - { nombre: Nuevo, color: '#3b82f6' }
    - { nombre: Cotizado, color: '#8b5cf6' }
    - { nombre: Ganado, color: '#10b981' }
automatizaciones:
  bienvenida: { activa: true, texto: 'Hola, gracias por escribir' }
  fuera_de_horario:
    activa: true
    texto: 'Estamos cerrados'
    horario: '18:00-08:00'
    zona: America/Bogota
bot: { activo: false }
`;

const POLICIES_DOS_OWNER = POLICIES_IT.replace('rol: admin }', 'rol: owner }');

describe.skipIf(process.env['COMPOSE_IT'] !== '1')(
  'aplicar policies.yaml a la base de la empresa',
  () => {
    let hijo: RepoHijo;
    let salidaAplicar = '';

    const compose = (...args: string[]) =>
      execFileSync('docker', ['compose', ...args], {
        cwd: hijo.dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 20 * 1024 * 1024,
      });
    const escribirPolicies = (texto: string) => {
      mkdirSync(join(hijo.dir, 'config'), { recursive: true });
      writeFileSync(join(hijo.dir, 'config', 'policies.yaml'), texto);
    };
    const cli = (...args: string[]) =>
      spawnSync(process.execPath, [CLI, '--dir', hijo.dir, ...args], {
        encoding: 'utf8',
        env: {
          PATH: process.env['PATH'] ?? '',
        } as unknown as NodeJS.ProcessEnv,
      });
    const conteos = () =>
      compose(
        'exec',
        '-T',
        'supabase-db',
        'psql',
        '-U',
        'postgres',
        '-tAc',
        `select (select count(*) from auth.users),(select count(*) from tags),
         (select count(*) from pipelines),(select count(*) from pipeline_stages),
         (select count(*) from automations),(select count(*) from automation_steps),
         (select count(*) from accounts),(select count(*) from profiles)`
      ).trim();

    beforeAll(() => {
      hijo = crearRepoHijo({ id: 'policies-it', nombre: 'Policies IT' });
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
      // Las migraciones necesitan auth.users (la crea gotrue): se aplican después del primer
      // `up --wait`, como describe docs/docker.md; luego PostgREST recarga su esquema.
      compose(
        'exec',
        '-T',
        'supabase-db',
        'sh',
        '-c',
        'for f in /migrations/*.sql; do psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f "$f" >/dev/null || exit 1; done'
      );
      compose('restart', 'supabase-rest');
      compose('up', '-d', '--wait', '--wait-timeout', '120', 'supabase-rest');
      escribirPolicies(POLICIES_IT);
    }, 900_000);

    afterAll(() => {
      if (!hijo) return;
      try {
        compose('down', '-v', '--remove-orphans');
      } finally {
        hijo.limpiar();
      }
    }, 300_000);

    it('un policies.yaml inválido falla antes de escribir en la base', () => {
      const antes = conteos();
      escribirPolicies(POLICIES_DOS_OWNER);
      const r = cli();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('usuarios');
      expect(conteos()).toBe(antes);
      escribirPolicies(POLICIES_IT);
    });

    it('aplicar deja etiquetas, etapas, usuarios, roles y automatizaciones del archivo', async () => {
      const r = cli();
      expect(r.status, r.stderr).toBe(0);
      salidaAplicar = r.stdout;

      const env = { ...leerEnv(join(hijo.dir, '.env')), ...process.env };
      const db = clienteServicio(env);

      const { data: perfiles } = await db
        .from('profiles')
        .select('email, account_id, account_role')
        .order('email');
      const rol = Object.fromEntries(
        (perfiles ?? []).map((p) => [p.email, p.account_role])
      );
      expect(rol).toEqual({
        'admin@policies.test': 'admin',
        'asesor@policies.test': 'agent',
        'dueno@policies.test': 'owner',
      });
      const cuentas = new Set((perfiles ?? []).map((p) => p.account_id));
      expect(cuentas.size).toBe(1);
      const cuenta = [...cuentas][0] as string;
      const { count: nCuentas } = await db
        .from('accounts')
        .select('id', { count: 'exact', head: true });
      expect(nCuentas).toBe(1);

      const { data: tags } = await db
        .from('tags')
        .select('name, color')
        .eq('account_id', cuenta)
        .order('name');
      expect(tags).toEqual([
        { name: 'Mayorista', color: '#10b981' },
        { name: 'VIP', color: '#f59e0b' },
      ]);

      const { data: pipelines } = await db
        .from('pipelines')
        .select('id, name')
        .eq('account_id', cuenta);
      expect(pipelines?.map((p) => p.name)).toEqual(['Ventas']);
      const { data: etapas } = await db
        .from('pipeline_stages')
        .select('name')
        .eq('pipeline_id', pipelines![0]!.id)
        .order('position');
      expect(etapas?.map((e) => e.name)).toEqual([
        'Nuevo',
        'Cotizado',
        'Ganado',
      ]);

      const { data: autos } = await db
        .from('automations')
        .select('id, description, trigger_type, is_active')
        .eq('account_id', cuenta)
        .order('description');
      expect(autos).toEqual([
        expect.objectContaining({
          description: 'policies.yaml:bienvenida',
          trigger_type: 'first_inbound_message',
          is_active: true,
        }),
        expect.objectContaining({
          description: 'policies.yaml:fuera_de_horario',
          trigger_type: 'new_message_received',
          is_active: true,
        }),
      ]);
      for (const a of autos!) {
        const { data: pasos } = await db
          .from('automation_steps')
          .select(
            'id, parent_step_id, branch, step_type, step_config, position'
          )
          .eq('automation_id', a.id);
        const raices = pasos!.filter((p) => !p.parent_step_id);
        const arbol = raices.map((r) => ({
          step_type: r.step_type,
          step_config: r.step_config,
          branches: {
            yes: pasos!
              .filter((p) => p.parent_step_id === r.id && p.branch === 'yes')
              .map((p) => ({
                step_type: p.step_type,
                step_config: p.step_config,
              })),
          },
        }));
        expect(validateStepsForActivation(arbol)).toEqual([]);
      }

      // La contraseña temporal impresa del asesor sirve para entrar.
      const linea = salidaAplicar
        .split('\n')
        .find((l) => l.includes('asesor@policies.test'));
      expect(linea).toBeDefined();
      const contrasena = linea!.trim().split(/\s+/)[1]!;
      const anon = createClient(
        `http://127.0.0.1:${PUERTO}`,
        env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
        { auth: { persistSession: false } }
      );
      const login = await anon.auth.signInWithPassword({
        email: 'asesor@policies.test',
        password: contrasena,
      });
      expect(login.error).toBeNull();
    });

    it('aplicarlo dos veces no duplica datos', () => {
      const antes = conteos();
      const r = cli();
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('Sin cambios');
      expect(r.stdout).not.toContain('Contraseñas temporales');
      expect(conteos()).toBe(antes);
    });

    it('cambiar el texto de bienvenida actualiza la automatización, no crea otra', () => {
      escribirPolicies(
        POLICIES_IT.replace('Hola, gracias por escribir', 'Hola de nuevo')
      );
      const antes = conteos().split('|');
      const r = cli();
      expect(r.status, r.stderr).toBe(0);
      expect(conteos().split('|')).toEqual(antes);
      const texto = compose(
        'exec',
        '-T',
        'supabase-db',
        'psql',
        '-U',
        'postgres',
        '-tAc',
        `select step_config->>'text' from automation_steps s join automations a on a.id=s.automation_id where a.description='policies.yaml:bienvenida'`
      ).trim();
      expect(texto).toBe('Hola de nuevo');
    });
  },
  900_000
);

/* eslint-disable @typescript-eslint/no-explicit-any -- dobles de prueba del cliente Supabase */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { TenantConfigSchema } from '../../contracts/cfg/tenant-config';
import { readFileSync } from 'node:fs';

import {
  ejecutar,
  leerEstado,
  POLICIES_PATH,
  TABLAS_CUENTA,
} from './aplicar-policies.mjs';

const CLI = join(process.cwd(), 'scripts', 'empresa', 'aplicar-policies.mjs');
const dirs: string[] = [];

const ENV_OK =
  'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9\nSUPABASE_SERVICE_ROLE_KEY=x\n';
const SIN_OWNER = `version: 1
usuarios:
  - { correo: a@b.co, nombre: A, rol: admin }
`;
const VALIDO = `version: 1
usuarios:
  - { correo: a@b.co, nombre: A, rol: owner }
`;

function hijo(policies: string | null, env: string) {
  const dir = mkdtempSync(join(tmpdir(), 'aplicar-policies-'));
  dirs.push(dir);
  if (policies !== null) {
    mkdirSync(join(dir, 'config'));
    writeFileSync(join(dir, 'config', 'policies.yaml'), policies);
  }
  writeFileSync(join(dir, '.env'), env);
  return dir;
}

function cli(dir: string) {
  return spawnSync(process.execPath, [CLI, '--dir', dir], {
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '' } as unknown as NodeJS.ProcessEnv,
    timeout: 30_000,
  });
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('aplicar-policies (CLI)', () => {
  it('usa la ruta de policies del contrato CT.1', () => {
    expect(POLICIES_PATH).toBe(
      TenantConfigSchema.shape.policiesPath.parse(undefined)
    );
  });

  it('con un policies.yaml inválido sale 1, nombra el campo y no toca la red', () => {
    const r = cli(hijo(SIN_OWNER, ENV_OK));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('usuarios');
    expect(r.stderr).not.toMatch(/fetch failed|ECONNREFUSED/);
  });

  it('sin config/policies.yaml sale 1 nombrando config/policies.yaml', () => {
    const r = cli(hijo(null, ENV_OK));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('config/policies.yaml');
  });

  it('sin SUPABASE_SERVICE_ROLE_KEY sale 1 nombrando la variable', () => {
    const r = cli(
      hijo(VALIDO, 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9\n')
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('con la base inalcanzable sale 3 diciendo que volver a correr es seguro', () => {
    const r = cli(hijo(VALIDO, ENV_OK));
    expect(r.status).toBe(3);
    expect(r.stderr).toContain('Volver a correr es seguro');
  }, 30_000);
});

describe('cuenta personal vacía', () => {
  const policies = {
    usuarios: [
      { correo: 'o@b.co', rol: 'owner' },
      { correo: 'a@b.co', rol: 'admin' },
    ],
  };

  function falso(conDatosEn: string | null) {
    const filas: Record<string, unknown[]> = {
      profiles: [
        {
          user_id: 'u1',
          email: 'o@b.co',
          full_name: 'O',
          account_id: 'c1',
          account_role: 'owner',
        },
        {
          user_id: 'u2',
          email: 'a@b.co',
          full_name: 'A',
          account_id: 'c2',
          account_role: 'owner',
        },
      ],
      accounts: [
        { id: 'c1', owner_user_id: 'u1' },
        { id: 'c2', owner_user_id: 'u2' },
      ],
    };
    return {
      from(tabla: string) {
        let cols = '';
        let val: unknown;
        const q: any = {
          select: (c: string) => ((cols = c), q),
          in: () => q,
          order: () => q,
          maybeSingle: async () => ({ data: null, error: null }),
          eq: (_c: string, v: unknown) => ((val = v), q),
          then: (res: (r: unknown) => void) => {
            if (tabla === 'profiles' && cols.includes('email')) {
              return res({ data: filas['profiles'], error: null });
            }
            if (tabla === 'accounts')
              return res({ data: filas['accounts'], error: null });
            if (tabla === 'profiles') return res({ count: 1, error: null });
            return res({
              count: tabla === conDatosEn && val === 'c2' ? 1 : 0,
              data: [],
              error: null,
            });
          },
        };
        return q;
      },
    };
  }

  it('revisa las mismas tablas que redeem_invitation (047)', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/047_account_membership_integrity.sql'
      ),
      'utf8'
    );
    const enSql = [
      ...sql.matchAll(
        /SELECT 1 FROM (\w+) WHERE account_id = v_old_account_id/g
      ),
    ].map((m) => m[1]);
    expect([...TABLAS_CUENTA].sort()).toEqual([...enSql].sort());
  });

  it('una cuenta personal sin datos se considera vacía', async () => {
    const e = await leerEstado(falso(null), policies);
    expect(
      e.usuarios.find((u: any) => u.userId === 'u2')?.cuentaPersonalVacia
    ).toBe(true);
  });

  it('una cuenta personal con whatsapp_config no es vacía', async () => {
    const e = await leerEstado(falso('whatsapp_config'), policies);
    expect(
      e.usuarios.find((u: any) => u.userId === 'u2')?.cuentaPersonalVacia
    ).toBe(false);
  });
});

describe('ejecutar con falla a medias', () => {
  it('adjunta al error las contraseñas ya generadas', async () => {
    const cliente = {
      auth: {
        admin: {
          createUser: async () => ({
            data: { user: { id: 'u9' } },
            error: null,
          }),
        },
      },
      from: () => {
        const q: any = {
          select: () => q,
          eq: () => q,
          single: async () => ({ data: { account_id: 'c9' }, error: null }),
        };
        return q;
      },
    };
    const ops = [
      { tipo: 'crear-usuario', correo: 'o@b.co', nombre: 'O', rol: 'owner' },
      { tipo: 'operacion-rota' },
    ];
    const err: any = await ejecutar(cliente, ops, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.contrasenas).toHaveLength(1);
    expect(err.contrasenas[0].correo).toBe('o@b.co');
    expect(err.contrasenas[0].contrasena.length).toBeGreaterThan(10);
  });
});

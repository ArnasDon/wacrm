// Verificación del publicador de I1. La cierra CFG.1, que debe convertir cada it.todo
// en prueba real contra el repo hijo (slices/CFG.1-separacion-config-empresa.md).
import { describe, it } from 'vitest';

describe('verificación del publicador de I1 (CFG.1)', () => {
  it.todo('el repo hijo trae todas las RUTAS_EMPRESA del contrato');
  it.todo('el .env.local.example del template declara todas las VARS_EMPRESA');
  it.todo('config/modules.yaml del repo hijo parsea con TenantConfigSchema');
  it.todo('ningún archivo del template cae en esRutaDeEmpresa');
  it.todo(
    'el repo hijo arranca con su propio .env sin tocar archivos del template'
  );
});

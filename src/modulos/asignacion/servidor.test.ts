import { describe, it, expect } from 'vitest';
import { cargarModulo } from '@contracts/mod/module';
import { estadoAsignacion } from './servidor';
import { moduloAsignacion } from './modulo';

describe('estadoAsignacion', () => {
  it('apagado o no cargado no está activo; encendido sí', () => {
    expect(estadoAsignacion([])).toEqual({ activo: false });
    expect(
      estadoAsignacion([
        cargarModulo(moduloAsignacion, { activo: false, config: {} }),
      ])
    ).toEqual({ activo: false });
    expect(
      estadoAsignacion([
        cargarModulo(moduloAsignacion, { activo: true, config: {} }),
      ])
    ).toEqual({ activo: true });
  });
});

import { definirModulo } from '@contracts/mod/module';
import { ConfigVisibilidadSchema } from './config';

export const NOMBRE_VISIBILIDAD = 'visibilidad';

/** Sin migraciones ni enganche al flujo de entrada (R27: solo interfaz). */
export const moduloVisibilidad = definirModulo({
  nombre: NOMBRE_VISIBILIDAD,
  configSchema: ConfigVisibilidadSchema,
  migraciones: [],
});

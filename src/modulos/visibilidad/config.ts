import { z } from 'zod';

// Los roles que ven todo los fija R26, no la empresa: config vacía.
export const ConfigVisibilidadSchema = z.strictObject({});
export type ConfigVisibilidad = z.infer<typeof ConfigVisibilidadSchema>;

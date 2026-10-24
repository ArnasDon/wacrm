// Verificación del publicador de I3. La cierra MOD.1, que debe convertir cada it.todo
// en prueba real contra el fork (slices/MOD.1-mecanismo-modulos.md).
import { describe, it } from 'vitest';

describe('verificación del publicador de I3 (MOD.1)', () => {
  it.todo(
    'todas las migraciones de wacrm en supabase/migrations cumplen MIGRACION_WACRM'
  );
  it.todo(
    'toda migración mod_*.sql en supabase/migrations pertenece a un módulo registrado'
  );
  it.todo('el registro de módulos del fork pasa cada módulo por definirModulo');
  it.todo(
    'el arranque carga los módulos con cargarModulo y la config de I1, y falla con ErrorConfigModulo'
  );
  it.todo(
    'el webhook de entrada llama alEntrarMensaje con un EventoEntrada válido después de guardar el mensaje'
  );
  it.todo('ni reacciones ni estados de entrega disparan enganches');
  it.todo(
    'el error de un enganche se registra y el webhook responde igual a Meta'
  );
  it.todo(
    'con todos los módulos apagados, el webhook se comporta igual que wacrm'
  );
});

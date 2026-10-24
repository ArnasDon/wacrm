// Arranque del servidor Next: carga y valida los módulos del fork (MOD.1).
// En producción Next 16 no tumba el proceso si register() rechaza (solo
// registra el error y responde 500 en cada petición), así que una config de
// módulo inválida sale explícitamente con código 1 (R18).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { obtenerFlujoEntrada } = await import('@/modulos/arranque');
    const flujo = obtenerFlujoEntrada();
    const encendidos = flujo.cargados
      .filter((m) => m.activo)
      .map((m) => m.nombre);
    console.log(
      `[modulos] encendidos: ${encendidos.join(', ') || '(ninguno)'}`
    );
  } catch (e) {
    console.error('[modulos] arranque inválido', e);
    process.exit(1);
  }
}

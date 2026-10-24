// IT de cobertura (VIS.2): todo el código de interfaz que consulta
// `conversations` pasa por la visibilidad (R27). Prueba estática por texto.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ_REPO = join(__dirname, '..', '..', '..');
const RAICES = [
  'src/app/(dashboard)',
  'src/components',
  'src/hooks',
  'src/lib/dashboard',
  'src/lib/notifications',
  'src/lib/inbox',
  'src/lib/contacts',
];
const EXCEPCIONES: Record<string, string> = {
  'src/components/inbox/message-thread.tsx':
    'solo escribe sobre la conversación abierta, ya validada por la página (VIS.1)',
  'src/components/inbox/conversation-list.tsx':
    'solo entrega la carga a la página, que la pasa por vis.filtrar y le devuelve `visibles` (VIS.1)',
};
// Archivos que hoy consultan conversations y se cubren en la Parte 2 de VIS.2.
const PENDIENTES_VIS2_PARTE2 = [
  'src/hooks/use-browser-notifications.ts',
  'src/components/pipelines/deal-form.tsx',
];

const REGEX_CONSULTA =
  /\.from\(\s*['"]conversations['"]\s*\)|conversations(!inner)?\s*\(/g;
const REGEX_IMPORT = /from\s+['"]@\/modulos\/visibilidad\//;
const REGEX_USO =
  /useVisibilidad\(|visibleConversations\(|acotarConsulta\(|\.filtrar\(|\.puedeVer\(|contarNoLeidas\(|resolverEnlaceDirecto\(|filtrarNotificaciones\(|debeAvisar\(|cargarAtencionVisible\(/g;

function contarConsultas(texto: string): number {
  return (texto.match(REGEX_CONSULTA) ?? []).length;
}
function consultaConversaciones(texto: string): boolean {
  return contarConsultas(texto) > 0;
}
function contarUsosVisibilidad(texto: string): number {
  return (texto.match(REGEX_USO) ?? []).length;
}
function pasaPorVisibilidad(texto: string): boolean {
  return REGEX_IMPORT.test(texto) && contarUsosVisibilidad(texto) > 0;
}
function archivosSinVisibilidad(
  archivos: { ruta: string; texto: string }[]
): string[] {
  return archivos
    .filter(
      (a) =>
        consultaConversaciones(a.texto) &&
        (!pasaPorVisibilidad(a.texto) ||
          contarUsosVisibilidad(a.texto) < contarConsultas(a.texto))
    )
    .map((a) => a.ruta);
}

function recorrer(dir: string, salida: string[]): void {
  if (!existsSync(dir)) return;
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) recorrer(ruta, salida);
    else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\./.test(nombre))
      salida.push(ruta);
  }
}
function leerRaices(): { ruta: string; texto: string }[] {
  const rutas: string[] = [];
  for (const r of RAICES) recorrer(join(RAIZ_REPO, r), rutas);
  return rutas.map((r) => ({
    ruta: relative(RAIZ_REPO, r),
    texto: readFileSync(r, 'utf8'),
  }));
}

describe('cobertura de visibilidad', () => {
  it('detecta un archivo que consulta sin visibilidad', () => {
    expect(
      archivosSinVisibilidad([
        { ruta: 'x.tsx', texto: 'supabase.from("conversations").select("*")' },
      ])
    ).toEqual(['x.tsx']);
    expect(
      archivosSinVisibilidad([
        { ruta: 'y.ts', texto: ".select('id, conversations(contact_id)')" },
      ])
    ).toEqual(['y.ts']);
  });
  it('acepta un archivo que importa y usa la visibilidad', () => {
    const texto =
      'import { acotarConsulta } from "@/modulos/visibilidad/consultas";\nacotarConsulta(supabase.from("conversations"), vis)';
    expect(archivosSinVisibilidad([{ ruta: 'z.ts', texto }])).toEqual([]);
  });
  it('importar sin usar no basta', () => {
    const texto =
      'import { acotarConsulta } from "@/modulos/visibilidad/consultas";\nsupabase.from("conversations")';
    expect(archivosSinVisibilidad([{ ruta: 'w.ts', texto }])).toEqual(['w.ts']);
  });
  it('todo el código de interfaz que consulta conversations pasa por visibleConversations', () => {
    const faltan = archivosSinVisibilidad(leerRaices()).filter(
      (r) => !(r in EXCEPCIONES) && !PENDIENTES_VIS2_PARTE2.includes(r)
    );
    expect(faltan).toEqual([]);
  });
  it('cuenta consultas frente a usos: dos consultas y un solo uso falla', () => {
    const texto =
      'import { acotarConsulta } from "@/modulos/visibilidad/consultas";\nacotarConsulta(db.from("conversations"), vis);\ndb.from("conversations").select("id")';
    expect(archivosSinVisibilidad([{ ruta: 'v.ts', texto }])).toEqual(['v.ts']);
  });
  it('las excepciones y pendientes existen y consultan conversations hoy (no quedan viejas)', () => {
    for (const ruta of [
      ...Object.keys(EXCEPCIONES),
      ...PENDIENTES_VIS2_PARTE2,
    ]) {
      const abs = join(RAIZ_REPO, ruta);
      expect(existsSync(abs), ruta).toBe(true);
      expect(consultaConversaciones(readFileSync(abs, 'utf8')), ruta).toBe(true);
    }
  });
});

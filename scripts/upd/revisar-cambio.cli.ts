/**
 * UPD.1 · CLI del chequeo de actualización.
 *   --rango <base>...<head> | --merge   [--repo <ruta>]
 * Salida: 0 pasa; 1 rechazado; 2 merge con conflictos fuera de rutas de la
 * empresa; 3 argumentos inválidos.
 */

import { resolve } from 'node:path';

import { cambiosDesdeGit, composeDesdeGit, type Origen } from './git';
import { formatearReporte, revisarCambio } from './revisar-cambio';

function main(argv: string[]): number {
  let origen: Origen | undefined;
  let repo = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--merge') origen = { tipo: 'merge' };
    else if (a === '--rango' && argv[i + 1]?.includes('...')) {
      origen = { tipo: 'rango', rango: argv[++i]! };
    } else if (a === '--repo' && argv[i + 1]) repo = argv[++i]!;
    else {
      console.error(
        'Uso: revisar-cambio.cli.ts (--rango <base>...<head> | --merge) [--repo <ruta>]',
      );
      return 3;
    }
  }
  if (!origen) {
    console.error('Falta --rango <base>...<head> o --merge');
    return 3;
  }
  repo = resolve(repo);
  const cambios = cambiosDesdeGit(repo, origen);
  const veredicto = revisarCambio(cambios, composeDesdeGit(repo, origen));
  console.log(formatearReporte(veredicto));
  if (!veredicto.ok) return 1;
  const conflictos = cambios.filter((c) => c.estado === 'U');
  if (conflictos.length > 0) {
    console.log('Conflictos sin resolver:');
    for (const c of conflictos) console.log(`  - ${c.ruta}`);
    return 2;
  }
  return 0;
}

process.exit(main(process.argv.slice(2)));
